# src/ — the real app

A floating-icon website chatbot: grounded Q&A over EcoSolar's company docs,
plus a guided lead-capture flow. This folder is the actual product — API,
widget UI, RAG search, lead-capture state machine. The repo-root `demo/`
folder is a separate, throwaway harness that exercises this from the outside
(see `demo/README.md`); it is not part of this folder and shares no code
with it.

**Status:** the conversational design — RAG search, guardrails, the
lead-capture state machine — is the real, final shape. What's not wired up
yet: real lead storage (see "What's stubbed" below), and the actual
placeholder qualifying questions (see `lib/tools/README.md`).

## Folder map

```
src/
  app/          → Next.js routes: api/chat, embed/[clientId], root page. See app/README.md.
  components/   → the widget UI (ChatWidget). See components/README.md.
  lib/          → the backend brain: orchestrator, system prompt, config, tools, RAG, lead state.
                  See lib/README.md, and its subfolder READMEs (tools/, rag/, leads/).
  data/         → docs/ (hand-edited source) and embeddings/ (generated artifact). See data/README.md.
  scripts/      → ingest-docs.js. See scripts/README.md.
```

## Running it

From the repo root:

```bash
npm install
npm run ingest   # only needed once, or whenever src/data/docs/*.md changes
npm run dev
```

Open `http://localhost:3000` for a minimal info page (not the demo — see
`demo/README.md` at the repo root for the real widget preview), or go
directly to `http://localhost:3000/embed/ecosolarusa` to see the widget
itself, unwrapped.

`OPENAI_API_KEY` lives in `.env.local` at the repo root, server-side only —
no `NEXT_PUBLIC_` prefix, so it never reaches the browser.

## How it works

```
Visitor's browser (inside the /embed/[clientId] page, or a client's iframe)
  → ChatWidget.jsx → click opens the panel
  → fetch → /api/chat (app/api/chat/route.js)
  → orchestrator (lib/orchestrator.js) — the tool-calling loop
      ↔ OpenAI Responses API (gpt-5.4-mini) — chat + tool calls
      ↔ lib/tools/index.js — dispatches search_company_docs / submit_appointment_info
          → lib/tools/searchDocs.js  → lib/rag/search.js → data/embeddings/faq-embeddings.json
          → lib/tools/leadCapture.js → lib/leads/state.js
```

The backend is stateless between requests — there's no session store. The
browser holds the conversation state (the Responses API `input` array, the
collected lead fields, `missCount`, `hitCount`) and sends it back with every
message; the API route returns the updated version each time. This is also
why it deploys cleanly to Vercel: there's no local file or in-memory session
to lose between serverless invocations.

### The RAG pipeline

1. **Ingestion** (`npm run ingest`, `scripts/ingest-docs.js`): reads
   `data/docs/*.md`, splits each file into one chunk per `## ` heading,
   embeds every chunk with `EMBEDDING_MODEL` (`lib/config.js` —
   `text-embedding-3-large`), and writes `data/embeddings/faq-embeddings.json`
   (~70 chunks currently).
2. **Runtime** (`lib/rag/search.js`): embeds the visitor's question, computes
   a dot product against every stored chunk embedding, returns the top
   `RAG_TOP_K` matches that clear `RAG_SIMILARITY_THRESHOLD` (0.42). Full
   detail on why 0.42, and the embedding-model switch that made it hold, is
   in `lib/rag/README.md`.

No database and no vector store are involved — one JSON file plus
arithmetic, appropriate at this scale. See `data/README.md` for when that
stops being true and what to do about it.

## How the original sheet was parsed into docs and prompts

The client's only source material at first was `EcoSolar - Script.xlsx`, a
live-chat operator script written for a human agent (LiveAdmins), not a docs
corpus. It mixed three different kinds of content, each given a different
treatment rather than being dumped into one search index:

| From the sheet | Became | Why |
|---|---|---|
| About Us, USPs, ~55 FAQs | `data/docs/company-info.md` + `data/docs/faqs.md`, chunked and embedded | Genuine facts that need to be retrieved only when relevant |
| Never discuss price beyond docs, mention the promo code, CCPA script, no tech support, greeting/sign-off | `lib/systemPrompt.js` | Rules that must hold on *every* message — putting them behind search risks them being missed on turns a search doesn't surface them |
| Zip codes, business hours | **Not built** — see below | The sheet's own instruction says not to gate on this |

### Three judgment calls made while converting it (flagged, not silently resolved)

1. **Zip code / service area.** The sheet lists ~200 zip codes but also
   says, more than once: *"No need to check the zip codes, welcome everyone,
   get their info and refer."* Taken at face value — no service-area gating
   was built at all.
2. **Two different promo codes.** The sheet says `LiveAdmins` when sharing
   the phone number generally, but `SOLARLIVE` in the specific case where a
   visitor won't share contact info. The bot currently only implements the
   general rule (`LiveAdmins`) — needs a client decision on whether the
   second code is intentional.
3. **Pricing tension.** The instructions say "DO NOT discuss Price/Cost,"
   but one FAQ gives a real starting figure ("$9,750 and up"). Resolved by
   the rule "never state a price beyond what `search_company_docs` returns"
   — since that FAQ is itself approved, retrievable content, the bot can
   share it when asked directly, but can't go further into real quoting.

### A second source: real sales-call transcripts

Beyond the original spreadsheet, transcribed calls between EcoSolar sales
reps and customers were used to add further FAQ content — panel-sizing logic
for ADUs, ADU-vs-main-house incentive-program eligibility, cash/finance/lease
tradeoffs, battery-vs-panel warranty duration, EV charging timing,
net-metering buyback economics (with real peak-rate figures), re-permitting
when adding panels later, homeowner's insurance coverage, monitoring
hardware-vs-app distinctions, battery cost range, and equipment
compatibility (Enphase vs. Tesla Powerwall) — all in `data/docs/faqs.md`.
Two things from the calls were deliberately **not** brought in:

- **Most dollar figures the calls quoted** — panel/system prices, financing
  payments, buyout amounts. These were personalized, per-customer quotes that
  didn't agree with each other across calls, not stable facts. Only
  pre-existing rate-style figures (the ~40% incentive-program savings, the
  ~6-8¢/kWh buyback rate, the 35-45¢/kWh peak rate, the $7,950-$14,500
  battery *range*) were kept, since those are program mechanics/ranges, not
  computed price quotes.
- **An "optional paid labor-warranty add-on"** described in some calls — it
  directly contradicts an already-approved FAQ claiming the standard 25-year
  warranty includes labor. Flagged as an open discrepancy, not silently
  overwritten.

Some call content (an existing customer's account remediation — permission-
to-operate corrections, competitor-lease buyouts) was left out entirely as
out of scope for a general prospective-visitor bot.

## How the interaction works

**Greeting** — hardcoded verbatim as the first message shown, not
model-generated, so the client's exact wording always appears.

**Answering questions** — the model calls `search_company_docs` before
answering anything factual, and only states what the tool returns. Nothing
gets invented, calculated, or extrapolated — including pricing: the bot
never gives a computed number beyond exactly what a doc states, and pushes
anything more specific into a consultation instead. A second guard (rule 2
in `lib/systemPrompt.js`) requires the model to check that a retrieved chunk
*actually answers the specific question*, not just shares the same general
topic — this exists because "what brands do you offer" was initially
answered using unrelated, topically-adjacent chunks (company overview,
warranty info) padded together into a non-answer that read as confident.

**Two paths both lead into lead capture, and each runs the exact same
sequence — but only once per conversation, from whichever trigger fires
first:**
1. **The bot answers `LEAD_PROMPT_AFTER_HITS` (3) questions well** —
   `hitCount` increments every time `search_company_docs` finds something.
   The first time it hits 3 (and lead capture hasn't started), the tool
   result tells the model to invite the visitor in, mentioning it's optional.
2. **`search_company_docs` doesn't find anything specific enough** —
   `missCount` increments, capped at `MISS_CAP` (3). The first miss (if lead
   capture hasn't started) flows directly into asking for the visitor's
   name in that same reply, with an explicit chain: acknowledge → a
   consultant will personally follow up → their name enables that → more
   questions still welcome. This is deliberately not phrased as an offer
   requiring permission, and deliberately not a bare question tacked onto
   the acknowledgment either — both were earlier mistakes. At the cap, the
   tone shifts firmer.

**Once lead capture has started, neither trigger fires it again** — a later
unanswered question (or a hit that doesn't really answer it) just gets a
brief warm acknowledgment, no repeat of the name/contact request.

**Lead capture** itself moves through a strict sequence — full detail in
`lib/tools/README.md`:
1. Collecting (name → email → phone → contactMethod, one at a time)
2. Confirming (recap all four, wait for explicit confirmation)
3. Saved (fires the stub once) → three placeholder qualifying questions,
   asked word-for-word → closes with a warm statement and an actual
   question ("Do you have any other questions?")

### Two bugs that needed code-level fixes, not just prompt wording

1. **The model sent a value it wasn't asked for** — `contactMethod` got
   silently set to `"email"` before ever being asked, despite explicit
   prompt instructions not to guess it. Fixed with
   `stripFieldsAheadOfSequence` in `lib/tools/leadCapture.js`: before merging
   any incoming tool-call args into the lead, anything past the current
   unfilled field in the sequence gets discarded, regardless of what the
   model sends.
2. **The model didn't call the tool at all** — after asking "Placeholder 1"
   and getting a reply, the model sometimes just wrote a closing-sounding
   reply instead of calling `submit_appointment_info`. No amount of "this is
   mandatory" wording fixed this reliably, since wording is conditioning text
   the model can still disregard — it isn't a constraint on what the API is
   allowed to return. The real fix is `tool_choice: 'required'` on the
   Responses API call (`lib/orchestrator.js`, `isLeadCaptureInProgress`),
   forced only on the first call of a turn where lead capture is mid-flight.
   This is enforced by OpenAI's API itself — the model literally cannot
   return a plain-text-only reply under `tool_choice: 'required'` (though it
   can still choose *which* tool to call).

Both fixes are enforced in code/by the API regardless of prompt compliance —
a structurally different guarantee than asking the model nicely.

### Logging

Every `search_company_docs` call logs the query and the top 6 chunk scores
(`lib/rag/search.js`), marked with which cleared the threshold, regardless of
whether anything was returned. Every `submit_appointment_info` call logs its
raw arguments alongside the resulting lead state (`lib/tools/leadCapture.js`).
Both were added specifically to make the two bugs above diagnosable from
server output instead of by guessing from the visible chat transcript — worth
gating behind an env flag before real production traffic, since raw lead PII
(name/email/phone) shouldn't stream into logs indefinitely.

## What's stubbed, and why it's not filler

The **only** placeholder in the lead-capture logic is the save step in
`lib/tools/leadCapture.js`: instead of writing to a real database and
sending a real email, it does:

```js
console.log('[LEAD CAPTURED — stub, not persisted]', lead)
console.log('[FAKE EMAIL — company alert]', ...)
```

Everything around it — the tool's contract, the field-completeness state
machine, when it fires — is the real, final design. Wiring up real storage
is a change *inside* that one function, not a rewrite of anything the model
or conversation depends on.

Separately, the **placeholder qualifying questions** (`PLACEHOLDER_QUESTIONS`
in `lib/tools/leadCapture.js`, `QUALIFYING_FIELDS` in `lib/leads/state.js`)
are literal stand-in text ("Placeholder 1", "Placeholder 2", "Placeholder
3"), not filler either — the mechanism around them (asking one at a time,
recording each reply, closing once done) is final; only the actual question
content needs to be written.

## Not yet built (out of scope so far)

- Real persistence (e.g. Postgres) for leads.
- The confirmation email back to the visitor.
- Real qualifying-question content (see above).
- Production hardening for the `/embed` + `/api/chat` routes: rate limiting
  is still genuinely not built (needs shared external state, not an
  in-memory counter — see `DEPLOYMENT.md` item #5). Origin validation on
  `/api/chat` *is* built (`SITE_ORIGIN` env var, `route.js`) and the CSP
  `frame-ancestors` header *is* built (`next.config.mjs`, `ALLOWED_EMBED_ORIGINS`)
  — both just waiting on real domain values, a CTO task at deploy time. A
  prod/preview env var split was considered and explicitly decided against
  (single shared `OPENAI_API_KEY`, flat-fee billing model makes the usual
  cost-isolation reason moot). Full decision log for all of this:
  **`DEPLOYMENT.md`** at the repo root.
- A production `widget.js` loader script (the one `<script>` tag a real
  client site would add, which creates and positions the iframe dynamically,
  including the resize handshake noted in `demo/README.md`). Today,
  `demo/index.html` hardcodes a fixed-size iframe directly as an interim
  stand-in for this.
- **Consent-gating the widget script (GDPR/CCPA)**: if EcoSolar's site loads
  a cookie-consent banner, `widget.js` should wait for consent before
  creating the iframe at all, not just before collecting lead data inside it
  — this needs to be a real check in the loader script, not an afterthought.
  The existing CCPA rule in `lib/systemPrompt.js` (collect contact info, point
  to the privacy policy) only covers what happens *inside* a conversation
  that's already started; it doesn't cover whether the widget should be
  allowed to load in the first place.

### What's the client's responsibility, not this repo's

Their WordPress/Elementor admin surfaced a few permission concerns worth
recording here so they don't get conflated with the items above — none of
these are things this codebase can implement, they're entirely
site-configuration on EcoSolar's end: restricting who can edit the Elementor
HTML widget or `functions.php` (Role Manager, `unfiltered_html` capability),
and — if their site enforces its own CSP — allowlisting our production
widget domain so their page is even allowed to load the script. The CORS and
CSP work that *is* ours to build (the embed page allowing itself to be
framed by `ecosolarusa.com`, the API accepting cross-origin requests if
ever needed) is already listed above under production hardening.
