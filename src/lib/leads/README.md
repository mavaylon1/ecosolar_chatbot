# src/lib/leads/

## `state.js`

Pure, side-effect-free helpers for tracking what a lead looks like — no
persistence, no I/O, just shape and completeness logic:

- `REQUIRED_FIELDS` — `['name', 'email', 'phone', 'contactMethod']`. Gates
  whether a lead counts as "complete."
- `QUALIFYING_QUESTIONS` — `[]` today. Optional follow-ups asked one at a
  time *after* the lead is saved, never blocking completeness. Each entry is
  `{ field, prompt }` — `field` becomes both the tool-schema property name
  and the lead-object key, `prompt` is the literal question text asked word
  for word. Empty means none are asked right now; adding a real one later is
  a one-line addition to this array — `QUALIFYING_FIELDS` below and
  everything in `src/lib/tools/leadCapture.js` that reads from it (the tool
  schema, the field sequence, the "ask the next one" logic) all derive from
  this list automatically, no other file needs to change. See
  `LEAD_CAPTURE.md` at the repo root for the full design.
- `QUALIFYING_FIELDS` — `QUALIFYING_QUESTIONS.map(q => q.field)`. Just the
  field names, for code that only needs to check completeness.
- `mergeLeadFields(current, incoming)` — merges new field values in,
  dropping anything null/empty.
- `missingFields(lead)` / `missingQualifyingFields(lead)` — what's still
  needed from each list.

**No persistence here on purpose** — this file only tracks shape and
completeness. The lead object round-trips through the browser with the rest
of the conversation state (see `src/lib/orchestrator.js` and the API
contract in `src/app/README.md`) until it's complete and confirmed; the
actual DB write happens in `src/lib/tools/leadCapture.js` via `saveLead()`
(`src/lib/apiServer.js`), a real insert into api-server's `appointment_leads`
table — not a stub. The field-completeness contract defined here is the
real, final design regardless of where the data eventually gets written.
