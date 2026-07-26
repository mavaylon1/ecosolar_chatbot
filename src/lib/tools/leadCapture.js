import { mergeLeadFields, missingFields, missingQualifyingFields } from '../leads/state.js'

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
      placeholder1: { type: 'string', description: 'Stand-in, not a real question yet — ask the visitor the literal text "Placeholder 1", word for word. Do not substitute a real question.' },
      placeholder2: { type: 'string', description: 'Stand-in, not a real question yet — ask the visitor the literal text "Placeholder 2", word for word. Do not substitute a real question.' },
      placeholder3: { type: 'string', description: 'Stand-in, not a real question yet — ask the visitor the literal text "Placeholder 3", word for word. Do not substitute a real question.' },
    },
    required: [],
  },
}

// Placeholders are deliberately meaningless stand-ins, asked verbatim, word for word.
// Real qualifying questions get defined later — see src/lib/tools/README.md.
const PLACEHOLDER_QUESTIONS = { placeholder1: 'Placeholder 1', placeholder2: 'Placeholder 2', placeholder3: 'Placeholder 3' }

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
// call it's introducing itself with its name.
const FIELD_SEQUENCE = ['name', 'email', 'phone', 'contactMethod', 'identityConfirmed', 'placeholder1', 'placeholder2', 'placeholder3']

function stripFieldsAheadOfSequence(currentLead, incomingArgs) {
  const firstUnfilledIndex = FIELD_SEQUENCE.findIndex(f => !currentLead[f])
  const boundary = firstUnfilledIndex === -1 ? FIELD_SEQUENCE.length : firstUnfilledIndex
  const allowed = { ...incomingArgs }
  FIELD_SEQUENCE.forEach((field, i) => {
    if (i > boundary) delete allowed[field]
  })
  return allowed
}

// Identical in both cases where a placeholder gets asked — the only thing
// that differs is what comes before it (see the two call sites below).
const PLACEHOLDER_REPLY_MUST_BE_RECORDED = (nextPlaceholder) =>
  `IMPORTANT: whatever the visitor replies with next — even if it seems like nonsense, since these are placeholder questions with no real meaning yet — you MUST call submit_appointment_info with "${nextPlaceholder}" set to their reply, before writing anything else. Do not skip the tool call just because the answer doesn't seem meaningful.`

// First time reaching a placeholder — right after the lead is saved, in the
// same reply as the thank-you.
const askFirstPlaceholder = (nextPlaceholder) =>
  `MANDATORY NEXT STEP — do this in this same reply, do not skip it: thank the visitor and mention a consultant will follow up, then say "So that we can give you the most tailored information, allow me to ask a few questions," then immediately ask this exact literal text: "${PLACEHOLDER_QUESTIONS[nextPlaceholder]}" — word for word, nothing else. This is not optional. ${PLACEHOLDER_REPLY_MUST_BE_RECORDED(nextPlaceholder)}`

// Subsequent placeholders — the lead is already saved, just keep going.
const askNextPlaceholder = (nextPlaceholder) =>
  `MANDATORY NEXT STEP — ask this exact literal text next, in this reply: "${PLACEHOLDER_QUESTIONS[nextPlaceholder]}" — word for word, nothing else, do not skip it. ${PLACEHOLDER_REPLY_MUST_BE_RECORDED(nextPlaceholder)}`

const CLOSING_PROMPT = 'close with a warm statement, then ask an actual question: "Do you have any other questions?" (or similar) — not just a passive statement that they\'re welcome to.'

// Executes submit_appointment_info and returns { resultText, nextState }.
// `state` is { lead, missCount, hitCount } — round-tripped from the client each turn.
export function executeLeadCapture(args, state) {
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
    return {
      resultText: `MANDATORY NEXT STEP: warmly ask the visitor for ${REQUIRED_FIELD_PROMPTS[nextField]} — in your own words, not a script. Do not guess, infer, or fill in this value yourself, even if it seems obvious from context — always ask. (Already have: ${JSON.stringify(lead)}.)`,
      nextState,
    }
  }

  // Step 5: all four contact fields are in, but the visitor hasn't confirmed them yet.
  if (!lead.identityConfirmed) {
    const { name: n, email, phone, contactMethod } = lead
    return {
      resultText: `MANDATORY NEXT STEP: do not treat this as saved yet. In this reply, recap these back to the visitor in a clean, readable format and ask them to confirm it's correct: ${JSON.stringify({ name: n, email, phone, contactMethod })}. Only after they confirm in a future message, call submit_appointment_info again with identityConfirmed: true.`,
      nextState,
    }
  }

  // Step 6: confirmed — save once, then transition into the qualifying questions.
  if (!currentLead._saved) {
    // STUBBED: this is where a real save + company alert email would fire.
    // The interface and the completeness logic above are the real, final
    // design — only this line changes when storage is wired up.
    console.log('[LEAD CAPTURED — stub, not persisted]', lead)
    console.log('[FAKE EMAIL — company alert]', `New lead: ${lead.name}, ${lead.email}, ${lead.phone} (prefers ${lead.contactMethod})`)

    const nextPlaceholder = missingQualifying[0]
    const resultText = nextPlaceholder
      ? `${askFirstPlaceholder(nextPlaceholder)} (Lead confirmed and saved: ${JSON.stringify(lead)}.)`
      : `Lead confirmed and saved: ${JSON.stringify(lead)}. All placeholder questions are done — ${CLOSING_PROMPT}`

    return { resultText, nextState: { ...nextState, lead: { ...lead, _saved: true } } }
  }

  const nextPlaceholder = missingQualifying[0]
  const resultText = nextPlaceholder
    ? `${askNextPlaceholder(nextPlaceholder)} (Lead already saved — do not re-thank or re-announce it as newly captured.)`
    : `All placeholder questions are done (lead already saved — do not re-thank or re-announce it as newly captured). Close with a warm statement, then ask an actual question: "Do you have any other questions?" (or similar) — not just a passive statement that they're welcome to.`

  return { resultText, nextState }
}
