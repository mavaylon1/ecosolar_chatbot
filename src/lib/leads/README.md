# src/lib/leads/

## `state.js`

Pure, side-effect-free helpers for tracking what a lead looks like — no
persistence, no I/O, just shape and completeness logic:

- `REQUIRED_FIELDS` — `['name', 'email', 'phone', 'contactMethod']`. Gates
  whether a lead counts as "complete."
- `QUALIFYING_FIELDS` — `['placeholder1', 'placeholder2', 'placeholder3']`.
  Optional, enrich the lead for the consultant, never block completeness.
  These are currently literal stand-ins — see `src/lib/tools/README.md` for
  where the actual question text lives and why it's still placeholder text.
- `mergeLeadFields(current, incoming)` — merges new field values in,
  dropping anything null/empty.
- `missingFields(lead)` / `missingQualifyingFields(lead)` — what's still
  needed from each list.

**No persistence here on purpose.** The lead object round-trips through the
browser with the rest of the conversation state (see `src/lib/orchestrator.js`
and the API contract in `src/app/README.md`) — there's no database, no
session store. When real storage gets wired up, it's a change *inside*
`src/lib/tools/leadCapture.js` (the one `console.log` stub marked in that
file), not a change to this file's shape. The field-completeness contract
defined here is the real, final design regardless of where the data
eventually gets written.
