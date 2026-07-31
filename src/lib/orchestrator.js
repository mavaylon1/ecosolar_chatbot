import { SYSTEM_PROMPT } from './systemPrompt.js'
import { TOOL_DEFS, executeTool } from './tools/index.js'
import { missingFields, missingQualifyingFields } from './leads/state.js'
import { CHAT_MODEL, MAX_TOOL_ITERATIONS } from './config.js'

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
export async function runTurn({ input, lead, missCount, hitCount, userMessage, keyData }) {
  let nextInput = [...input, { role: 'user', content: userMessage }]
  let state = { lead: lead || {}, missCount: missCount || 0, hitCount: hitCount || 0 }
  let tokensUsed = 0

  for (let i = 0; i < MAX_TOOL_ITERATIONS; i++) {
    // Only force it on the first call of the turn — once a tool has already
    // run this turn, let the model wrap up with a normal reply as usual.
    const toolChoice = i === 0 && isLeadCaptureInProgress(state.lead) ? 'required' : 'auto'
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
      const { resultText, nextState } = await executeTool(call.name, args, state, keyData, nextInput)
      state = nextState
      nextInput.push({
        type: 'function_call_output',
        call_id: call.call_id,
        output: resultText,
      })
    }
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
