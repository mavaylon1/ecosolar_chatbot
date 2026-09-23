# src/lib/tools/

The two things the model can actually *do*, beyond just talking. Split by
concern — these two tools have almost nothing to do with each other, which
is exactly why they used to be smashed into one 190-line file and were hard
to reason about independently.

## `index.js`

`TOOL_DEFS` (the two tool schemas, combined) and `executeTool(name, args,
state, keyData)` — a thin dispatcher that routes to whichever of the two
files below matches the tool name. `keyData` (the api-server key metadata
from `route.js` — see `DEPLOYMENT.md` item #12) is only ever used by
`leadCapture.js`, to attribute a saved lead to the right account.
`src/lib/orchestrator.js` only ever imports from here, never reaches into
`searchDocs.js`/`leadCapture.js` directly.

## `searchDocs.js` — the `search_company_docs` tool

Wraps `src/lib/rag/search.js` and owns all of the escalation/hand-off
behavior around it:

- **Hit** (something cleared the similarity threshold): resets `missCount`,
  bumps `hitCount`, and — the first time `hitCount` reaches
  `LEAD_PROMPT_AFTER_HITS` (from `src/lib/config.js`), *and* lead capture
  hasn't already started this session — tells the model to invite the
  visitor into lead capture after answering.
- **Miss** (nothing cleared the threshold): bumps `missCount`. The **first**
  miss (if lead capture hasn't started) kicks off lead capture directly, with
  an explicit "acknowledge → a consultant will follow up with them personally
  → their name enables that → more questions still welcome" chain — this
  exact wording is built once via `leadCaptureKickoffChain()` and reused for
  both the soft (early miss) and firm (`MISS_CAP` reached) tone, rather than
  being written out multiple times with drifting wording, which is what the
  original single-file version did.
- **Already started this session**: any hit-that-doesn't-really-answer, or
  any later miss, just gets a brief warm acknowledgment — never re-asks for
  contact info. Lead capture fires **at most once per conversation**, from
  whichever trigger reaches it first.

## `leadCapture.js` — the `submit_appointment_info` tool

Owns the entire lead-capture state machine. `state.lead` moves through a
strict sequence, defined once in `FIELD_SEQUENCE`:

```
name → email → phone → contactMethod → identityConfirmed → ...QUALIFYING_FIELDS
```

`QUALIFYING_FIELDS` (`src/lib/leads/state.js`) is empty today, so the
sequence currently ends at `identityConfirmed` in practice — see
`LEAD_CAPTURE.md` at the repo root for the full extensibility design.

**`stripFieldsAheadOfSequence`** is the key correctness guarantee here: no
matter what fields the model's tool call includes, anything past the current
unfilled field in that sequence gets silently dropped before merging. This is
enforced in code, not by prompt wording — wording alone ("ask this
explicitly, don't assume") repeatedly failed to stop the model from
self-filling `contactMethod` before ever asking for it.

Three stages, in order:
1. **Collecting** (`missingFields(lead).length > 0`) — one required field at
   a time, phrased as a *topic* to ask about (`REQUIRED_FIELD_PROMPTS`), not
   a script, so the model can ask warmly in its own words. The very first ask
   (nothing collected yet) additionally requires a brief, varied transition
   ("While I have you," or similar) before asking for the name — the only
   point in the sequence where the conversation pivots from answering
   questions to requesting contact info, so it's the only one that needs
   easing into.
2. **Confirming** (`!lead.identityConfirmed`) — all four required fields are
   in, but nothing is saved yet. The model is told to recap them and ask for
   confirmation.
3. **Saved** (`!lead._saved`) — fires the save + alert exactly once: a real
   DB write into api-server's `appointment_leads` table via `saveLead()`
   (`src/lib/apiServer.js`), falling back to a `console.log` if that write
   throws (must fail independently — see the inline comment at that call
   site). The lead is saved with an AI-generated conversation summary
   (`summarizeConversation()`, `src/lib/summarize.js`) when available, and
   api-server fires the real company-alert email itself as a side effect of
   the save (`lib/resend.js` on that side) — no stub left in either piece.
   Then starts asking any
   `QUALIFYING_QUESTIONS` (`src/lib/leads/state.js`), one at a time via the
   generic `askQualifyingQuestion(field, { isFirst })` — these are asked
   literal, word-for-word text, unlike the required fields, since they may
   be simple checkbox-style questions with no real content to interpret.
   **The list is empty today**, so this step is skipped entirely and the
   flow goes straight to closing after save. Adding a real question is a
   one-line addition to `QUALIFYING_QUESTIONS` — nothing in this file needs
   to change, since the tool schema, `FIELD_SEQUENCE`, and the asking logic
   all derive from that same list. See `LEAD_CAPTURE.md` at the repo root
   for the full picture.

Every `submit_appointment_info` call is logged (query args, allowed args
after stripping, resulting lead state) — this is what made the
`contactMethod` self-fill bug and the "model skipped calling the tool after a
placeholder answer" bug actually diagnosable, instead of guessing from the
visible chat transcript. The second bug also needed a fix beyond this file —
see `tool_choice: 'required'` in `src/lib/orchestrator.js`, since wording
alone can't force a tool call to happen at all, only shape it once it does.
The same forcing is also used for the TEST-ONLY `timer_lead_prompt` trigger
(`src/components/ChatWidget/ChatWidget.jsx`) — pinned to this specific tool
rather than a bare `'required'`, so it can't wander into `search_company_docs`
instead. See `LEAD_CAPTURE.md` at the repo root for the full timer design.
