// Pure helpers for tracking lead-capture state. No persistence here on purpose —
// for this demo, the lead object round-trips through the client with the rest
// of the conversation state. Swapping this for a real save is a change inside
// the tool handler in lib/tools/leadCapture.js, not a change to this file's shape.

export const REQUIRED_FIELDS = ['name', 'email', 'phone', 'contactMethod']

// Optional — enrich a lead for the consultant, but never block completeness.
// Placeholders for now; the real qualifying questions get defined later.
export const QUALIFYING_FIELDS = ['placeholder1', 'placeholder2', 'placeholder3']

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
