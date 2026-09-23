# Lead capture — how it currently works

A snapshot of the lead-capture framework as it stands today: the state
machine, the guardrails that make it reliable, the extensibility design, and
the TEST-ONLY inactivity-timer mechanism layered on top of it. For what's
still open or not yet built (real email, durable logging, the production
version of the timer), see `DEPLOYMENT.md` items #10, #11, #13.

## The state

`lead` is a plain object, round-tripped between browser and server every
turn — the backend is stateless, so the browser is the source of truth.
It accumulates fields as the conversation progresses:

```
name, email, phone, contactMethod, identityConfirmed, interest, notes,
...(any QUALIFYING_QUESTIONS fields), _saved
```

## Three ways in

Lead capture starts from one of three triggers, and fires **at most once
per conversation** regardless of which one reaches it first
(`src/lib/systemPrompt.js`, LEAD CAPTURE section):

1. **Several questions answered well** — `src/lib/tools/searchDocs.js` tells
   the model to invite the visitor in once `hitCount` reaches
   `LEAD_PROMPT_AFTER_HITS` (`src/lib/config.js`).
2. **`search_company_docs` comes up empty** — the first miss this session
   flows directly into lead capture, starting with their name in the same
   reply.
3. **TEST-ONLY: 30 seconds of inactivity** before either of the above has
   happened — see the timer section below.

## The sequence

`state.lead` moves through a strict order, defined once in `FIELD_SEQUENCE`
(`src/lib/tools/leadCapture.js`):

```
name → email → phone → contactMethod → identityConfirmed → ...QUALIFYING_FIELDS
```

**`stripFieldsAheadOfSequence`** is the actual correctness guarantee: no
matter what fields the model's `submit_appointment_info` call includes,
anything past the current unfilled field gets silently dropped before
merging. This is what stops the model from pre-filling e.g. `contactMethod`
on the same call it's introducing itself with its name — enforced in code,
not by asking nicely in the prompt.

Three stages, in order:

1. **Collecting** (`missingFields(lead).length > 0`) — one required field at
   a time, phrased as a topic (`REQUIRED_FIELD_PROMPTS`), not a script, so
   the model asks warmly in its own words. The very first ask (nothing
   collected yet) additionally requires a brief, varied transition — "While
   I have you," or similar — before asking for the name. This is the only
   point in the whole flow where the conversation pivots from answering
   questions to requesting contact info, so it's the only one that needs
   easing into; every later field is already mid-flow.
2. **Confirming** (`!lead.identityConfirmed`) — all four required fields are
   in, nothing saved yet. The model recaps them and asks the visitor to
   confirm.
3. **Saved** (`!lead._saved`) — fires once: a real DB write via `saveLead()`
   (`src/lib/apiServer.js`) into api-server's `appointment_leads` table,
   falling back to a `console.log` dump of the lead if that write throws
   (must fail independently — a DB hiccup never blocks the visitor's reply).
   Then asks any `QUALIFYING_QUESTIONS`, one at a time — **currently empty**,
   so this step is skipped entirely and the flow goes straight to closing
   ("Do you have any other questions?").

Every `submit_appointment_info` call is logged (raw args, args after
stripping, resulting lead, what's still missing) — this is what makes bugs
in this sequence actually diagnosable instead of guessed at from the visible
transcript.

## Three layers, not two

Worked out while debugging this session — useful for judging where a future
fix belongs:

1. **State checks decide *what* happens next** — the sequence order, which
   field is missing, whether it's confirmed/saved. Fully deterministic, code
   only, the model has no say.
2. **Code decides *whether the tool call happens at all*, in some cases** —
   `stripFieldsAheadOfSequence` filters what data gets accepted, and
   `tool_choice: 'required'` (`src/lib/orchestrator.js`,
   `isLeadCaptureInProgress`) forces the call once lead capture has already
   begun. This is enforcement, not persuasion.
3. **Prompt engineering decides *how it's phrased*** — the `resultText` fed
   back after the tool runs tells the model what to accomplish, but leaves
   the wording to it.

The rule of thumb: if something needs to *reliably happen*, it belongs in
layer 1 or 2. If it only affects *tone*, layer 3 is fine and expected —
that's genuinely the model's job.

## Extensibility: qualifying questions

`QUALIFYING_QUESTIONS` (`src/lib/leads/state.js`) is the single source of
truth for optional follow-up questions asked after the lead is saved. It's
empty today — no qualifying questions are asked — by design, not by
omission: everything downstream (`QUALIFYING_FIELDS`, the tool schema's
extra properties, `FIELD_SEQUENCE`, and the "ask the next one" logic in
`src/lib/tools/leadCapture.js`) derives from this one list. Adding a real
question later is a one-line addition:

```js
export const QUALIFYING_QUESTIONS = [
  { field: 'timeline', prompt: 'When are you hoping to get started?' },
]
```

No other file needs to change. This replaces an earlier version that had
three hardcoded, literal placeholder questions ("Placeholder 1/2/3") wired
directly into the schema and the asking logic — removed in favor of this
data-driven shape specifically so the mechanism could be reused instead of
rebuilt whenever real questions are defined.

## TEST-ONLY: the inactivity timer

Client-side only (`src/components/ChatWidget/ChatWidget.jsx`), a scaled-down
stand-in for the fuller design in `DEPLOYMENT.md` item #11 — proves the
mechanisms work, not the final timing or UX.

**Before lead capture starts:** 30 seconds of silence after the visitor's
first message → fires a `timer_lead_prompt` trigger. This is **hard-
triggered, not prompt engineering**: `orchestrator.js` forces the specific
`submit_appointment_info` tool call on this turn (not a bare `'required'`,
which could just as easily pick `search_company_docs` instead) whenever the
trigger fires and lead capture hasn't started yet. Before this fix, the
nudge was purely a bracketed instruction the model could — and sometimes
did — just ignore.

**After the visitor confirms their info**, two stages, both reliable by
construction rather than by hoping the model cooperates:

- **60 seconds** → a plain warning message is appended directly to the chat
  — *"The session will end in 60 seconds if no response is sent."* No API
  call, no model involved at all. There's nothing for prompt wording to get
  wrong when the text never changes.
- **120 seconds** → fires `timer_goodbye`. The model still writes the warm
  goodbye line itself (tone is legitimately its job), but immediately after
  that reply lands, code deterministically appends *"Session ended. Feel
  free to ask more questions here to start a new session."* and resets the
  browser's round-trip state (`input`, `lead`, `missCount`, `hitCount` all
  cleared, conversation ID cleared) and re-arms the countdown mechanism to
  fully dormant. None of that depends on what the model actually said.

**Visible chat history is never cleared** — only the backend state resets.
The visitor sees the conversation stay on screen with the goodbye at the
bottom; if they type again, it's a genuinely fresh conversation underneath
(the model has no memory of the old one), which means lead capture can
start over from scratch if they engage again.

**No partial-lead salvage.** If the visitor goes quiet mid-sequence (say,
after giving just their name) and the goodbye timer clears state, that
partial data is simply discarded — a deliberate simplification, not an
oversight. In practice this is lower-risk than it sounds: the real DB save
already happens the moment `identityConfirmed` is set, which is *before*
this post-confirmation timer's window even starts — so by the time this
timer could ever fire, the core contact info is already durably saved. Only
qualifying-question answers (currently none) would ever be at risk.

In between (lead capture started but not yet confirmed) — no timer runs at
all. Nudging further mid-flow would just interrupt the visitor.

## What's still open

- Real company-alert email around a save (`DEPLOYMENT.md` item #10, pieces
  2–3 — the DB write itself is real and already live).
- The production version of the inactivity timer — 3-minute timeout with a
  2-minute warning, tab-close handling via `sendBeacon`, and hooking into a
  real finalize/fallback-extraction pipeline so abandoned conversations
  aren't silently lost (`DEPLOYMENT.md` item #11).
- Durable, monitored logging in production (`DEPLOYMENT.md` item #13).
- Real qualifying-question content — the extensible list is ready, just
  empty.
