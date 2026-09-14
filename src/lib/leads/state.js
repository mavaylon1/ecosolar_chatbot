// Pure helpers for tracking lead-capture state. No persistence here on purpose —
// for this demo, the lead object round-trips through the client with the rest
// of the conversation state. Swapping this for a real save is a change inside
// the tool handler in lib/tools/leadCapture.js, not a change to this file's shape.

export const REQUIRED_FIELDS = ['name', 'email', 'phone', 'contactMethod']

// Optional — enrich a lead for the consultant, but never block completeness.
// Empty for now (no qualifying questions defined yet) — deliberately
// data-driven so adding a real one later is a one-line addition here, not a
// restructure. Each entry is `{ field, prompt }`: `field` is the tool-schema
// property name, `prompt` is the literal question text asked word for word
// (see leadCapture.js's askQualifyingQuestion). e.g. later:
// [{ field: 'timeline', prompt: 'When are you hoping to get started?' }]
export const QUALIFYING_QUESTIONS = []

export const QUALIFYING_FIELDS = QUALIFYING_QUESTIONS.map(q => q.field)

export function mergeLeadFields(current, incoming) {
  const clean = Object.fromEntries(
    Object.entries(incoming || {}).filter(([, v]) => v != null && String(v).trim() !== '')
  )
  return { ...current, ...clean }
}

export function missingFields(lead) {
  return REQUIRED_FIELDS.filter(field => !lead[field])
}

export function missingQualifyingFields(lead) {
  return QUALIFYING_FIELDS.filter(field => !lead[field])
}
