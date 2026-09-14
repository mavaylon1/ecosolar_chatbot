import { mergeLeadFields, missingFields, missingQualifyingFields, REQUIRED_FIELDS, QUALIFYING_FIELDS, QUALIFYING_QUESTIONS } from '../leads/state.js'
import { saveLead } from '../apiServer.js'
import { summarizeConversation } from '../summarize.js'

// Qualifying-field schema properties are generated from QUALIFYING_QUESTIONS
// (src/lib/leads/state.js) instead of hardcoded — empty today, so this
// contributes nothing. Adding a real question there is enough to make it
// show up here too, no separate schema edit needed.
const qualifyingProperties = Object.fromEntries(
  QUALIFYING_QUESTIONS.map(({ field, prompt }) => [
    field,
    { type: 'string', description: `Answer to the qualifying question "${prompt}"` },
  ])
)

export const SUBMIT_APPOINTMENT_INFO_TOOL_DEF = {
  type: 'function',
  name: 'submit_appointment_info',
  description:
    'Record any lead information the visitor has shared so far. Call this every time the visitor provides a new piece of this information, even a single field — it merges with anything already collected. Do not wait to have everything before calling it. Includes the required contact fields, the identity-confirmation flag, and optional qualifying details that help the consultant prepare.',
  parameters: {
    type: 'object',
    properties: {
      name: { type: 'string', description: 'The visitor\'s name' },
      email: { type: 'string', description: 'The visitor\'s email address' },
      phone: { type: 'string', description: 'The visitor\'s phone number' },
      contactMethod: {
        type: 'string',
        enum: ['email', 'phone'],
        description: 'Which of the two the visitor prefers to be reached by. Only set this after explicitly asking and hearing their answer — never infer or default it yourself just because email and phone are both already known.',
      },
      identityConfirmed: {
        type: 'boolean',
        description: 'Set to true only after the visitor has explicitly confirmed the recapped name/email/phone/contact-method are correct. Never set this on the same call that first completes the four contact fields — that call should trigger the recap instead.',
      },
      interest: {
        type: 'string',
        description: 'What they are interested in, if it comes up naturally, e.g. residential solar, commercial solar, battery backup',
      },
      notes: { type: 'string', description: 'Any other relevant detail they mentioned, including the original question(s) they asked that prompted this' },
      ...qualifyingProperties,
    },
    required: [],
  },
}

// Real fields, in the order they're asked — phrased as a topic, not a script,
// so the model can ask warmly in its own words. Correctness (never skipping or
// self-guessing a field) is enforced separately in code below, not by rigid
// wording — that's what actually fixed contactMethod getting silently defaulted
// to "email": wording alone didn't stop the model from sending it anyway.
const REQUIRED_FIELD_PROMPTS = {
  name: 'their name',
  email: 'the best email address to reach them at',
  phone: 'the best phone number to reach them at',
  contactMethod: 'which of the two — email or phone — they\'d prefer to be reached by (ask this explicitly, don\'t assume)',
}

// Fixed order of the whole lead-capture sequence. A field only "counts" if the
// visitor has actually been asked for it — so before merging, anything past the
// current unfilled field gets dropped, no matter what the model tries to send.
// This is what stops the model from pre-filling e.g. contactMethod on the same
// call it's introducing itself with its name. QUALIFYING_FIELDS is empty today
// (see src/lib/leads/state.js) so it contributes nothing — the sequence and
// this guarantee both still apply automatically once real ones are added.
const FIELD_SEQUENCE = ['name', 'email', 'phone', 'contactMethod', 'identityConfirmed', ...QUALIFYING_FIELDS]

function stripFieldsAheadOfSequence(currentLead, incomingArgs) {
  const firstUnfilledIndex = FIELD_SEQUENCE.findIndex(f => !currentLead[f])
  const boundary = firstUnfilledIndex === -1 ? FIELD_SEQUENCE.length : firstUnfilledIndex
  const allowed = { ...incomingArgs }
  FIELD_SEQUENCE.forEach((field, i) => {
    if (i > boundary) delete allowed[field]
  })
  return allowed
}

// Generic version of what used to be separate askFirstPlaceholder/
// askNextPlaceholder functions hardcoded to placeholder1/2/3 — this reads the
// question text from QUALIFYING_QUESTIONS by field name instead, so it works
// for whatever real questions get defined there later with no further changes
// here. `isFirst` only affects whether the thank-you/save preamble is included.
function askQualifyingQuestion(field, { isFirst }) {
  const question = QUALIFYING_QUESTIONS.find(q => q.field === field)?.prompt ?? field
  const preamble = isFirst
    ? `do this in this same reply, do not skip it: thank the visitor and mention a consultant will follow up, then say "So that we can give you the most tailored information, allow me to ask a few questions," then immediately ask`
    : `ask next, in this reply,`
  return `MANDATORY NEXT STEP — ${preamble} this exact literal text: "${question}" — word for word, nothing else. This is not optional. IMPORTANT: whatever the visitor replies with next you MUST call submit_appointment_info with "${field}" set to their reply, before writing anything else. Do not skip the tool call just because the answer doesn't seem meaningful.`
}

const CLOSING_PROMPT = 'close with a warm statement, then ask an actual question: "Do you have any other questions?" (or similar) — not just a passive statement that they\'re welcome to.'

// Executes submit_appointment_info and returns { resultText, nextState, tokensUsed }.
// `state` is { lead, missCount, hitCount } — round-tripped from the client each turn.
// `keyData` is the api-server key metadata from route.js (see
// DEPLOYMENT.md item #12) — used to attribute a saved lead to the right
// account; saveLead() itself no-ops safely if api-server isn't configured.
export async function executeLeadCapture(args, state, keyData, transcript) {
  const currentLead = state.lead || {}
  const allowedArgs = stripFieldsAheadOfSequence(currentLead, args)
  const lead = mergeLeadFields(currentLead, allowedArgs)
  const nextState = { ...state, lead }
  const missing = missingFields(lead)
  const missingQualifying = missingQualifyingFields(lead)
  console.log(`[submit_appointment_info] args=${JSON.stringify(args)} allowed=${JSON.stringify(allowedArgs)} → lead=${JSON.stringify(lead)} missing=${JSON.stringify(missing)} missingQualifying=${JSON.stringify(missingQualifying)}`)

  // Step 1-4: still collecting name, email, phone, or preferred contact method —
  // one at a time, in REQUIRED_FIELDS order. Any value for a later field the
  // model tried to sneak in early was already dropped above.
  if (missing.length > 0) {
    const nextField = missing[0]
    // Only the very first ask (nothing collected yet) is the actual pivot
    // from answering questions to requesting contact info — every later
    // field in the sequence is already mid-flow and doesn't need easing
    // into again. Required, not optional: without this, the ask can land
    // as an abrupt jump straight to "what's your name" right after the
    // visitor was just asking about something else entirely.
    const isFirstAsk = missing.length === REQUIRED_FIELDS.length
    const transitionInstruction = isFirstAsk
      ? ` Before asking, you must ease into it with a brief, natural transition, e.g. "While I have you," "While you're thinking of any other questions," or similar — vary the actual phrasing each time rather than reusing the same line. This softens the pivot from answering questions to asking for contact info; it is not optional.`
      : ''
    return {
      resultText: `MANDATORY NEXT STEP: warmly ask the visitor for ${REQUIRED_FIELD_PROMPTS[nextField]} — in your own words, not a script.${transitionInstruction} Do not guess, infer, or fill in this value yourself, even if it seems obvious from context — always ask. (Already have: ${JSON.stringify(lead)}.)`,
      nextState,
      tokensUsed: 0,
    }
  }

  // Step 5: all four contact fields are in, but the visitor hasn't confirmed them yet.
  if (!lead.identityConfirmed) {
    const { name: n, email, phone, contactMethod } = lead
    return {
      resultText: `MANDATORY NEXT STEP: do not treat this as saved yet. In this reply, recap these back to the visitor in a clean, readable format and ask them to confirm it's correct: ${JSON.stringify({ name: n, email, phone, contactMethod })}. Only after they confirm in a future message, call submit_appointment_info again with identityConfirmed: true.`,
      nextState,
      tokensUsed: 0,
    }
  }

  // Step 6: confirmed — save once, then transition into the qualifying questions.
  if (!currentLead._saved) {
    // A separate OpenAI call from the normal chat turns (DEPLOYMENT.md item
    // #10) — never blocks the lead save if it fails, just omits the summary.
    let summary = null
    let tokensUsed = 0
    try {
      ;({ summary, tokensUsed } = await summarizeConversation(transcript))
    } catch (err) {
      console.error('[submit_appointment_info] summarizeConversation failed — saving lead without a summary:', err.message)
    }

    // Real DB write into api-server's appointment_leads table, which also
    // fires the Resend company-alert email as its own side effect (see
    // api-server/lib/resend.js). Must fail independently, per DEPLOYMENT.md
    // item #10: a DB hiccup never blocks the reply the visitor already gets,
    // and falls back to a console log so the lead isn't silently lost.
    try {
      await saveLead(keyData, { name: lead.name, email: lead.email, phone: lead.phone, summary })
    } catch (err) {
      console.error('[submit_appointment_info] saveLead failed — lead NOT persisted, logging as fallback:', err.message)
      console.log('[LEAD CAPTURED — fallback, DB write failed]', lead, { summary })
    }

    const nextQualifying = missingQualifying[0]
    const resultText = nextQualifying
      ? `${askQualifyingQuestion(nextQualifying, { isFirst: true })} (Lead confirmed and saved: ${JSON.stringify(lead)}.)`
      : `Lead confirmed and saved: ${JSON.stringify(lead)}. All qualifying questions are done — ${CLOSING_PROMPT}`

    return { resultText, nextState: { ...nextState, lead: { ...lead, _saved: true } }, tokensUsed }
  }

  const nextQualifying = missingQualifying[0]
  const resultText = nextQualifying
    ? `${askQualifyingQuestion(nextQualifying, { isFirst: false })} (Lead already saved — do not re-thank or re-announce it as newly captured.)`
    : `All qualifying questions are done (lead already saved — do not re-thank or re-announce it as newly captured). Close with a warm statement, then ask an actual question: "Do you have any other questions?" (or similar) — not just a passive statement that they're welcome to.`

  return { resultText, nextState, tokensUsed: 0 }
}
