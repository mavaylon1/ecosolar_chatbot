import { SYSTEM_PROMPT } from './systemPrompt.js'
import { TOOL_DEFS, executeTool } from './tools/index.js'
import { missingFields, missingQualifyingFields } from './leads/state.js'
import { CHAT_MODEL, MAX_TOOL_ITERATIONS, MAX_REPLY_TOKENS, MAX_TURN_TOKENS } from './config.js'

async function callResponsesAPI(input, toolChoice) {
  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      instructions: SYSTEM_PROMPT,
      input,
      tools: TOOL_DEFS,
      tool_choice: toolChoice,
      // Layer 3 (SECURITY.md): bounds a single reply's length regardless of
      // how short or leading the input that produced it was.
      max_output_tokens: MAX_REPLY_TOKENS,
    }),
  })

  if (!res.ok) {
    throw new Error(`OpenAI Responses API failed: ${res.status} ${await res.text()}`)
  }

  return res.json()
}

// True whenever the lead-capture sequence has started but isn't fully done —
// required fields, confirmation, and the placeholder questions all count.
// Prompt wording alone ("this is mandatory") repeatedly failed to stop the
// model from just skipping the tool call and writing a plain closing reply
// instead — most visibly, it never called submit_appointment_info at all
// after the visitor replied to "Placeholder 1". Forcing tool_choice on the
// first call of the turn removes that option structurally: the model must
// call some tool (not necessarily submit_appointment_info specifically, so
// it can still call search_company_docs if the visitor asks something else
// mid-sequence) rather than reply with bare text.
function isLeadCaptureInProgress(lead) {
  if (!lead || Object.keys(lead).length === 0) return false
  if (missingFields(lead).length > 0) return true
  if (!lead.identityConfirmed) return true
  if (missingQualifyingFields(lead).length > 0) return true
  return false
}

// The 30s inactivity trigger fires while lead capture hasn't started yet
// (lead is still `{}`), so isLeadCaptureInProgress above doesn't force
// anything here — this was the actual gap behind visitors seeing no
// lead-capture prompt after the timer fired. Bracketed instruction text
// alone wasn't reliable: the model sometimes read its own earlier small
// talk as "already started" and skipped the tool. Pin the forced call to
// submit_appointment_info specifically (not a bare 'required') so it can't
// wander into search_company_docs instead — the only other tool available.
function resolveToolChoice(i, lead, trigger) {
  if (i !== 0) return 'auto'
  if (isLeadCaptureInProgress(lead)) return 'required'
  if (trigger === 'timer_lead_prompt') return { type: 'function', name: 'submit_appointment_info' }
  return 'auto'
}

function extractText(messageItem) {
  return (messageItem.content || [])
    .filter(part => part.type === 'output_text')
    .map(part => part.text)
    .join('')
}

// Runs one full user turn: appends the user message, loops through any tool
// calls the model makes, and returns once the model produces a plain reply.
// `input` is the full Responses-API input array from the previous turn
// (messages + any function_call/function_call_output items) — the backend
// is stateless, so the caller (the client) is responsible for round-tripping it.
// `keyData` is the api-server key metadata from validateApiServerKey() in
// route.js (see DEPLOYMENT.md item #12) — threaded through to leadCapture.js
// so a confirmed lead can be attributed to the right account, and used here
// to total up tokensUsed for the whole turn (every callResponsesAPI round
// trip, not just the last one) for route.js to report back afterward.
// TEST-ONLY: instruction text for each inactivity-timer trigger from
// ChatWidget.jsx — neither is something the visitor actually said. See
// DEPLOYMENT.md item #11 for the full (not-yet-built) production design
// these are a quick stand-in for. Bracketed clearly so the model reads each
// as an instruction, not visitor speech, the same way tool-result text
// already steers behavior via plain input content rather than a dedicated role.
const TEST_TRIGGER_INSTRUCTIONS = {
  timer_lead_prompt: '[TEST TRIGGER — not something the visitor said. 30 seconds of inactivity elapsed. If lead capture has not already started this session, proactively invite the visitor into it now, following the LEAD CAPTURE instructions. If it has already started, just continue naturally.]',
  timer_goodbye: '[TEST TRIGGER — not something the visitor said. 2 minutes of inactivity elapsed since the visitor confirmed their contact info (a 60-second warning already showed in the chat). End the conversation now with a warm, polite goodbye — thank them for their time and let them know a consultant will be in touch. Do not ask them anything else.]',
}

// Thrown instead of letting a mid-loop failure (an OpenAI API error, a tool
// call throwing) propagate as a bare Error — carries whatever tokensUsed
// had already accumulated from earlier, successfully-paid-for rounds in
// this same turn before the failure. Without this, that real cost was
// silently lost: the caller (route.js) never gets a tokensUsed value at all
// when runTurn() throws, so a turn that made 1-2 real OpenAI calls before
// failing on a later round reported (and settled/billed) as if it cost
// nothing. route.js catches this specifically to recover that partial
// figure for both the daily-budget settlement and the per-key usage report.
export class TurnFailedError extends Error {
  constructor(cause, tokensUsed) {
    super(cause?.message || 'Turn failed')
    this.cause = cause
    this.tokensUsed = tokensUsed
  }
}

export async function runTurn({ input, lead, missCount, hitCount, userMessage, keyData, trigger }) {
  const turnContent = trigger
    ? (TEST_TRIGGER_INSTRUCTIONS[trigger] ?? userMessage)
    : userMessage

  if (trigger) console.log(`[test-timer] runTurn received trigger="${trigger}"`)

  let nextInput = [...input, { role: 'user', content: turnContent }]
  let state = { lead: lead || {}, missCount: missCount || 0, hitCount: hitCount || 0 }
  let tokensUsed = 0

  try {
    for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
      // Layer 6 (SECURITY.md): stop the tool-call loop once this turn's
      // running total is already spent, rather than only capping each
      // round's own output — MAX_TOOL_ITERATIONS alone would still let a
      // single turn cost up to 5x one round's worth before it kicked in.
      if (tokensUsed >= MAX_TURN_TOKENS) break

      // Only force it on the first call of the turn — once a tool has already
      // run this turn, let the model wrap up with a normal reply as usual.
      const toolChoice = resolveToolChoice(i, state.lead, trigger)
      const response = await callResponsesAPI(nextInput, toolChoice)
      tokensUsed += response.usage?.total_tokens ?? 0
      const output = response.output || []

      // Preserve every output item for the next turn, per OpenAI's guidance.
      nextInput = [...nextInput, ...output]

      const functionCalls = output.filter(item => item.type === 'function_call')

      if (functionCalls.length === 0) {
        const messageItem = output.find(item => item.type === 'message')
        const reply = messageItem ? extractText(messageItem) : ''
        return { reply, input: nextInput, lead: state.lead, missCount: state.missCount, hitCount: state.hitCount, tokensUsed }
      }

      for (const call of functionCalls) {
        const args = JSON.parse(call.arguments || '{}')
        const { resultText, nextState, tokensUsed: toolTokensUsed } = await executeTool(call.name, args, state, keyData, nextInput)
        state = nextState
        // A tool call can trigger its own separate OpenAI call outside this
        // loop's own callResponsesAPI accounting — search_company_docs
        // embeds the query, submit_appointment_info summarizes the
        // conversation once a lead saves. Both previously went untracked by
        // Layer 7's daily budget (SECURITY.md) despite being real cost;
        // folding them into this turn's running total here is what makes
        // route.js's post-turn accounting (and the reservation settlement)
        // actually reflect everything a turn spent, not just the main
        // chat-completion rounds.
        tokensUsed += toolTokensUsed || 0
        nextInput.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: resultText,
        })
      }
    }
  } catch (err) {
    throw new TurnFailedError(err, tokensUsed)
  }

  return {
    reply: "I'm having trouble pulling that together right now — let me get you connected with a consultant instead.",
    input: nextInput,
    lead: state.lead,
    missCount: state.missCount,
    hitCount: state.hitCount,
    tokensUsed,
  }
}
