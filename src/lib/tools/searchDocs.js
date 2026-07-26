import { searchCompanyDocs } from '../rag/search.js'
import { MISS_CAP, LEAD_PROMPT_AFTER_HITS } from '../config.js'

export const SEARCH_DOCS_TOOL_DEF = {
  type: 'function',
  name: 'search_company_docs',
  description:
    'Search EcoSolar USA company documentation (FAQs and company info) for facts relevant to the visitor\'s question. Always call this before answering any factual question about EcoSolar, solar systems, pricing policy, warranties, financing, or the company itself — never answer those from general knowledge.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The visitor\'s question or topic to search for' },
    },
    required: ['query'],
  },
}

// Shared building block for both "hit but doesn't really answer it" and "miss"
// paths — the one-time lead-capture kickoff chain. Previously this exact
// chain (acknowledge → personal follow-up → name → more questions welcome)
// was written out three separate times with minor wording drift; now it's
// composed once and reused, so tone changes only need to happen in one place.
function leadCaptureKickoffChain(tone) {
  const acknowledgment = tone === 'firm'
    ? `Say something warm but firm like: "That's a great question. Let me get you connected with one of our solar consultants who can go over the specifics with you directly."`
    : `Respond personably, not like an error message — for example: "That's an excellent question."`

  return `${acknowledgment} Then explain that a consultant will follow up with THEM directly (not just "relay it to the team" — that doesn't explain why you'd need their name), and flow straight into asking for their name so you can pass it to that consultant — e.g. "Let me have a consultant follow up with you directly on that. What's your name, so I can get them looped in?" Also promise, in this same reply, that more questions are still welcome after — e.g. "After I send them a message, we can absolutely dive into more of your questions." The chain has to be explicit and connected: acknowledge → a real person will follow up with THEM → their name is needed to make that happen → more questions still welcome. Not a bare, disconnected question, and not an offer requiring their permission either (avoid "if you'd like," "would that be okay," "can I..."). Collect their info via submit_appointment_info (including the original question in "notes" so the consultant has context). This is the only time lead capture starts this session — later misses or non-answers just get a brief warm acknowledgment instead. Never use a dash to join clauses in what you actually say to the visitor — use a period or "and"/"so" instead.`
}

// Shared text for "lead capture already ran this session — don't restart it."
const ALREADY_CAPTURED_ACK = `Lead capture already happened earlier this session — do NOT ask for their name/contact info again. Just say something warm and brief acknowledging you'll flag this question for the consultant too, e.g. "Great question. I'll make sure that gets passed along to them as well." Then continue helping with whatever else they ask.`

function leadCaptureStarted(lead) {
  return Object.keys(lead || {}).length > 0
}

// Executes search_company_docs and returns { resultText, nextState }.
export async function executeSearchDocs(args, state) {
  const matches = await searchCompanyDocs(args.query)

  if (matches.length > 0) {
    const hitCount = (state.hitCount || 0) + 1
    const nextState = { ...state, missCount: 0, hitCount }
    const resultText = matches.map(m => `### ${m.heading}\n${m.text}`).join('\n\n')

    const alreadyStarted = leadCaptureStarted(state.lead)
    const selfCheckNote = alreadyStarted
      ? `If none of it truly answers what they asked: ${ALREADY_CAPTURED_ACK}`
      : `If none of it truly answers what they asked, don't state these facts as if they do; instead treat this exactly like nothing was found: ${leadCaptureKickoffChain('soft')}`

    const leadInvite = hitCount === LEAD_PROMPT_AFTER_HITS && !alreadyStarted
      ? `\n\n(You've now answered ${LEAD_PROMPT_AFTER_HITS} questions well. After delivering this answer, invite the visitor to share their contact info so a consultant can follow up with more tailored detail — mention it's optional, and promise more questions are still welcome after, e.g. "and once that's sent over, we can keep going with anything else you're curious about." Then move into the info-gathering steps directly. Don't repeat "you can keep asking questions" at each step; save the final reminder for once the whole sequence wraps up. This invite only ever happens once per session.)`
      : ''

    return {
      resultText: `Potentially relevant company documentation found:\n\n${resultText}\n\n(Only use the above if it actually and specifically answers the visitor's exact question — not just the same general topic. ${selfCheckNote})${leadInvite}`,
      nextState,
    }
  }

  const missCount = (state.missCount || 0) + 1
  const nextState = { ...state, missCount }
  const capReached = missCount >= MISS_CAP
  const alreadyStarted = leadCaptureStarted(state.lead)

  const resultText = alreadyStarted
    ? `Nothing specific enough was found (miss ${missCount} of ${MISS_CAP}). ${ALREADY_CAPTURED_ACK}`
    : `Nothing specific enough was found (miss ${missCount} of ${MISS_CAP}${capReached ? ' — cap reached' : ''}). ${leadCaptureKickoffChain(capReached ? 'firm' : 'soft')}`

  return { resultText, nextState }
}
