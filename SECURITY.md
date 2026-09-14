# Chatbot abuse protections (v1)

This is the design doc for `/api/chat`'s abuse/cost protections — what each
layer does, why it exists, where it lives (or will live) in the code, and
what's still an open number or a known, accepted gap. Companion to
`DEPLOYMENT.md` item #5 (rate limiting), which this supersedes with an
actual design rather than an open question.

**Status: all 8 layers are built.** Layers 7-8 depend on api-server (see
`DEPLOYMENT.md` item #12) being reachable and its `API_SERVER_URL`/
`API_SERVER_KEY`/`INTERNAL_SECRET` env vars actually set — see Layer 7
below.

## Threat model

This is a lead-gen chatbot widget for a small business's marketing site —
not a system handling money or sensitive data. The realistic risk is a
runaway OpenAI bill (a bug, a bored visitor poking at it, a lazy script)
and denial-of-service via exhausting a shared cost ceiling, not a
sophisticated attacker who reverse-engineers exact thresholds. The design
below is sized for that risk level, not for adversarial-proof security.

**Core principle:** `/api/chat` is a public URL. Nobody has to go through
the widget to call it — a script can send it whatever JSON it wants. So
nothing enforced only in the browser (the widget's own send-pacing, its
`conversationId`, its `input` array) counts as protection. Every layer
below is enforced server-side, checked against data the server itself
holds or computes — never trusted because "the widget would only send it
this way."

## Model & pricing reference

- Chat model: `gpt-5.4-mini` (`src/lib/config.js:10`) — $0.75 / 1M input
  tokens, $4.50 / 1M output tokens. All cost figures below use this.
- Embeddings model: `text-embedding-3-large` (`src/lib/config.js:13`) —
  $0.13 / 1M tokens, used only for RAG doc search. Small, flat per-query
  cost — not part of the cost model below, which is dominated by chat
  completions.
- The system prompt (`src/lib/systemPrompt.js`) is ~11.2K characters,
  roughly **~2,800 tokens**, and per the mechanism below, is resent in
  full on *every single call* to OpenAI — not just once per conversation.

## Why cost isn't just "message length × number of messages"

`/api/chat` is stateless by design: the server holds no memory of a
conversation between requests. The client (`src/components/ChatWidget/
ChatWidget.jsx`) holds the growing conversation and resends the whole
thing every turn, and `src/lib/orchestrator.js:14` sends the system prompt
(`instructions: SYSTEM_PROMPT`) fresh on every API call too — not cached,
not summarized, the full ~2,800 tokens every time. On top of that, a
single visitor turn can trigger *more than one* OpenAI call: when the bot
needs to search the docs, it calls the tool, gets a result, then makes a
second call to actually write the reply — up to `MAX_TOOL_ITERATIONS`
round-trips (see Layer 1).

Net effect: a normal, honest 25-exchange conversation costs roughly
**100K-170K tokens** (~$0.13-0.18), almost entirely input tokens (resent
prompt + resent history), not output. That's the baseline every cap below
is sized against.

---

## Layer 1 — Tool-call loop cap (built)

**What:** caps how many tool-calling round-trips a single turn can make
before the code forces a bail-out with a fallback reply, instead of
letting the model loop on tool calls forever.

**Where:** `src/lib/orchestrator.js` — `MAX_TOOL_ITERATIONS` constant
(defined in `src/lib/config.js`, currently `5`), enforced by the `for`
loop in `runTurn()`.

**Status:** Built.

---

## Layer 2 — Per-message input cap (built)

**What:** reject an incoming `message` whose token count exceeds a limit,
checked before any OpenAI call is made. Cheapest possible check — a
rejection here costs nothing.

**Where:** `src/app/api/chat/route.js`, right after the existing
`message`-presence check, using `estimateTokens()`
(`src/lib/tokenEstimate.js`). Limit: `MAX_MESSAGE_TOKENS = 600`
(`src/lib/config.js`).

---

## Layer 3 — Per-message output cap (built)

**What:** pass `max_output_tokens` (the Responses API's field name — Chat
Completions calls this `max_tokens`) on the OpenAI call itself, bounding
how long a single reply can run — independent of input size, since a
short, clever prompt can still fish for a very long response.

**Where:** `src/lib/orchestrator.js`, `callResponsesAPI()`, alongside
`model` / `instructions` / `input` / `tools`. Limit: `MAX_REPLY_TOKENS =
500` (`src/lib/config.js`). Verified against the live API, including a
forced-tool-call round (lead capture in progress, `tool_choice: 'required'`)
with a verbose `submit_appointment_info` payload — completed cleanly with
room to spare, no truncation.

---

## Layer 4 — `input`-array size cap (built)

**What:** bound the total size of the client-supplied `input` field (the
full conversation history) plus the fixed prompt/tool-schema overhead
every call also carries — that combined total is what actually determines
a request's real input-token cost, regardless of which field the text
lives in. Without this, `input` was fully trusted and unchecked (`route.js`
destructured it straight from the request body; `orchestrator.js` spreads
it directly into the OpenAI call) — a script could skip real conversation
growth entirely and submit a single request with a fabricated, massive
`input` array.

**Where:** `src/app/api/chat/route.js`, checked as
`estimateTokens(input) + estimateTokens(message) + FIXED_CALL_OVERHEAD_TOKENS
> MAX_INPUT_TOKENS` — includes the new message's own size too, since
`orchestrator.js` appends it to `input` before the real OpenAI call; an
earlier version of this check omitted it, letting the true first-call
input exceed the ceiling by up to a message's worth even when each field
passed its own check. `FIXED_CALL_OVERHEAD_TOKENS = 3200` (measured:
~2,810 tokens of system prompt + ~360 tokens of tool schemas).
`MAX_INPUT_TOKENS = 8500` (`src/lib/config.js`) — leaves ~5,300 tokens of
real headroom for the `input` array plus new message combined, comfortably
above the ~4,300-token peak a genuine 25-turn conversation's history alone
reaches by its final turn, with a full-size message on top of that.

**Note:** this bounds *size*, not *authenticity* — it can't tell a real
24-turn history from a forged one of the same size. See Known Limitations.

---

## Layer 5 — Hard per-conversation turn limit (built)

**What:** reject once a conversation exceeds a fixed number of turns.
Enforced as a hard rejection, not a soft client-side nudge — a soft limit
does nothing against a script that ignores it, for the same reason the
widget's own send-pacing (see Layer 8) isn't real protection on its own.

**Where:** `src/app/api/chat/route.js`, counting `role === 'user'` items in
`input` against `MAX_CONVERSATION_TURNS = 25` (`src/lib/config.js`), before
calling `runTurn()`. Excludes items whose content starts with `[TEST
TRIGGER` — `orchestrator.js`'s inactivity-timer triggers
(`TEST_TRIGGER_INSTRUCTIONS`) are appended to `input` with `role: 'user'`
too even though the visitor didn't actually say anything; counting those
would let a genuinely idle visitor's session hit the cap purely from
bot-initiated nudges rather than real exchanges.

---

## Layer 6 — Per-turn cumulative token budget (built)

**What:** closes a gap in Layers 1+3 combined — `MAX_TOOL_ITERATIONS`
allows up to 5 OpenAI calls within a single turn, and if the output cap
(Layer 3) were only checked per call, a single turn could cost up to `5 ×`
a single call's max cost. This layer tracks the turn's running total (the
code already computes it — `tokensUsed += response.usage?.total_tokens` in
`runTurn()`'s loop, previously only used for post-hoc reporting) and,
before starting another tool-loop round, checks whether the turn has
already spent its budget. If so, the loop breaks and falls through to the
same fallback reply Layer 1's own `MAX_TOOL_ITERATIONS` exhaustion already
used, rather than allowing further rounds.

**Where:** `src/lib/orchestrator.js`, top of the `for` loop in `runTurn()`
— `if (tokensUsed >= MAX_TURN_TOKENS) break`. `MAX_TURN_TOKENS = 18000`
(`src/lib/config.js`) — sized to comfortably cover a legitimate 2-round
(search-then-reply) turn (~16,000-16,600 tokens worst case) with margin,
while still cutting a turn off after roughly 2-3 rounds rather than the
full 5.

**Known imprecision:** the check happens *before* a round starts, using
the total from *prior* rounds — so the round that finally crosses the
threshold can still land, pushing the true worst case for one turn to
roughly `MAX_TURN_TOKENS` + one more round's max cost (`MAX_INPUT_TOKENS +
MAX_REPLY_TOKENS` = 9,000) ≈ **27,000 tokens**, not exactly 18,000.
Accepted: tightening this further would mean estimating a round's cost
*before* letting it start, which isn't available from the API in advance —
not worth the complexity at this risk level.

---

## Layer 7 — Global daily token cap (built, needs infra)

**What:** one shared token budget across every conversation and visitor,
site-wide, per day. Once exceeded, no further requests are served until
reset. Deliberately not per-user/per-IP — a shared pool sidesteps needing
to identify individual visitors at all (this app has no login system), and
directly caps worst-case total spend regardless of how traffic is
distributed.

**Where:** counters live in `truvala-api-server` (a separate repo/service
this app already talks to for key validation and token-usage reporting —
see `DEPLOYMENT.md` item #12), not in this repo. Its `lib/db.js` holds a
`chat_daily_budget` table (one row per UTC day) and three functions —
`getDailyTokensUsed()` (a plain read, used only for diagnostics now, not
enforcement), `addDailyTokens()` (atomic `INSERT ... ON CONFLICT ... DO
UPDATE ... RETURNING`, accepts a negative delta too), and
`reserveDailyTokens()` (the same atomic upsert but with a `WHERE
tokens_used + reserve <= budget` guard, so the write only happens if it
fits) — reached over HTTP via `api/internal/chat-daily-budget.js` (GET to
read; POST accepts either `{tokens}` for a plain signed add or
`{reserve, budget}` for the guarded reservation).

**Reserve-then-settle, not check-then-report.** This app's
`src/lib/apiServer.js` calls `reserveDailyBudget()` — checked in `route.js`
right before `runTurn()`, *after* the cheaper layers 2/4/5 — which
atomically reserves `RESERVE_TOKENS` (36,000, this app's own documented
worst case for one turn: Layer 6's ~27,000 plus headroom for a
once-per-conversation `summarizeConversation()` call) against the budget in
one database statement. If it doesn't fit, the request is blocked before
any OpenAI work happens. Once the turn actually finishes (success *or*
failure — see `TurnFailedError` in `orchestrator.js` and the try/catch/
finally in `route.js`), `settleDailyBudget()` adjusts the reservation back
down to the turn's real cost — almost always a partial refund of the unused
slack between 36,000 and what the turn actually spent. This replaced an
earlier read-then-write-later design (see Known Limitations below — the
TOCTOU race that design had is now closed, not just bounded) and closes a
second gap for free: previously, if a turn failed partway through *after*
one or more real, already-paid OpenAI calls had already run, that real cost
was silently unreported (`route.js` never even reached the code that
reported it). `TurnFailedError` now carries whatever `tokensUsed` had
already accumulated at the point of failure, so it still gets settled and
reported correctly instead of vanishing. `DAILY_TOKEN_BUDGET = 3,075,000`
(`src/lib/config.js`) — the threshold lives here, not on api-server, which
only holds the raw counter and is told the threshold on every reserve call.
When it trips, the visitor sees a plain "We will return tomorrow to answer
any of your questions" rather than an error-shaped message (`route.js`).

**Dependency:** requires `API_SERVER_URL`/`API_SERVER_KEY`/
`INTERNAL_SECRET` actually set on this app's Vercel deployment (see
`.env.example`, `DEPLOYMENT.md` item #12) — no separate account/service
needed beyond that, since this reuses the api-server connection this app
already has for other things. In local dev (`VERCEL_ENV` unset), until
those three are set, `reserveDailyBudget()`/`settleDailyBudget()`/
`rateLimitExceeded()` all silently no-op (see `configured()` in
`apiServer.js`) and layers 7-8 don't run; layers 2-6 don't depend on this
and work regardless.

**Fails closed, not open.** `reserveDailyBudget()`/`rateLimitExceeded()`/
`validateApiServerKey()` all block the request (rather than silently
allowing it) whenever api-server can't be reached, returns a non-OK
response, or — on a real production deployment (`VERCEL_ENV === 'production'`)
specifically — when the three env vars above are missing entirely (see
`misconfiguredInProduction()` in `apiServer.js`). This was a deliberate
change from an earlier fail-open design: failing open meant a transient
api-server outage, or the env vars silently disappearing in production,
would leave the chatbot running with zero cost protection and no visible
symptom. Failing closed trades availability for safety — any api-server
trouble now takes the chatbot down (loudly, in logs) instead of quietly
removing the ceiling on OpenAI spend. Accepted, since this is a low-traffic
widget where an outage is cheap and a silent unmetered-cost hole is not.

To verify the counters are actually reachable on the real database (not
just that the code compiles): `truvala-api-server`'s
`scripts/verify-chat-abuse-protection.js` writes one clearly-artificial row
to each table (`day_key`/`minute_key` = `'TEST-VERIFY'`) so it's visible
and easy to spot in the Neon console, separate from real traffic.

**Sizing.** `DAILY_TOKEN_BUDGET` is the number actually enforced — its
cost, at the ~96%-input/4%-output split this input-heavy architecture
produces:

| | Value |
|---|---|
| **Daily cap (enforced)** | **3,075,000 tokens, ~$2.77** |
| **Monthly (× 30 days)** | **~92,250,000 tokens, ~$83** |

**Deliberately sized against realistic usage, not the full worst-case
ceiling.** An earlier version of this budget (6,750,000/day, ~$182/month)
was sized bottom-up from the worst case — 15 conversations/day × 25 turns
× ~18,000 tokens/turn (Layer 6's nominal ceiling), assuming every single
conversation maxes every cap on every turn. That fully covered the
worst case for expected volume, at the cost of a much higher ceiling on
attacker spend. This budget instead targets a $83/month cost target: at
SECURITY.md's own real-world estimate of ~$0.13-0.18 per genuine 25-turn
conversation, 3,075,000 tokens/day covers roughly **18-30 honest
conversations/day** — comfortably above the original 15/day
expected-volume baseline under normal conditions.

**The tradeoff:** a day where legitimate traffic happens to run
unusually expensive (heavier document lookups, longer conversations, more
tool calls — not an attack, just a heavier-than-typical day) could
plausibly exhaust this budget before 15 honest conversations complete,
where the old ceiling had much more room to absorb that. Accepted in
favor of a much lower worst-case cost ceiling (~$54/month vs ~$182/month).

---

## Layer 8 — Rate limit (built, needs infra)

**What:** server-side, atomic, fixed-window (1 minute) cap on request
frequency, closing the gap where the widget's own client-side pacing —
`queueRef` / `processQueue` in `ChatWidget.jsx`, which already makes the
widget wait for a reply before sending the next message — can be trivially
bypassed by calling `/api/chat` directly instead of through the widget.
The client-side queue is real UX, not enforcement.

**Where:** same api-server database as Layer 7 — a `chat_rate_limit` table
(one row per epoch-minute bucket), incremented atomically via
`incrementRateLimit()` in api-server's `lib/db.js`, reached over HTTP via
`api/internal/chat-rate-limit.js` (POST, returns the new count). This app's
`src/lib/apiServer.js#rateLimitExceeded()` calls it and compares the
returned count against `RATE_LIMIT_PER_MINUTE = 6` (`src/lib/config.js`) — a
fixed clock-minute bucket (`currentMinuteKey()` in api-server's `lib/db.js`
is `Math.floor(Date.now() / 60_000)`), not a rolling window, so a burst can
straddle a minute boundary for up to roughly 2x the limit in a short
real-time span. Chosen well above realistic concurrent legitimate traffic
(15 conversations/day baseline) while meaningfully slowing a sustained-spam
attempt to drain Layer 7's daily budget (at ~6/minute, roughly 3,250 tokens
per minimal request, sustained spam takes on the order of hours rather than
~1.5-2 hours to exhaust `DAILY_TOKEN_BUDGET`) — not a fix for the
shared-pool fairness problem below, just real added resistance.
Same `API_SERVER_URL`/`API_SERVER_KEY`/`INTERNAL_SECRET` dependency as
Layer 7 — no separate service.

**Decision made:** site-wide, not per-IP — matches Layer 7's shared-pool
approach, and avoids the shared-IP soft spot IP-based limiting would
inherit (see Known Limitations item 4, and `DEPLOYMENT.md` item #5).

---

## Known limitations / accepted risk (even with all layers built)

1. ~~Daily-cap race condition (TOCTOU)~~ — **fixed.** Previously, the
   pre-flight check was a plain read happening *before* the OpenAI call,
   with nothing recorded until *after* — so a burst of concurrent requests
   could all read the same stale "still under budget" value and all
   proceed before any of them reported usage back. `reserveDailyBudget()`
   (see Layer 7 above) closes this: the check and the write are now the
   same atomic database statement (api-server's `reserveDailyTokens()`),
   the same way Layer 8's rate limit already had no race at all. A
   companion gap closed at the same time: a turn that failed partway
   through, after already making one or more real, paid OpenAI calls,
   previously lost track of that real cost entirely (`route.js` never
   reached the reporting code on a throw) — `TurnFailedError`
   (`orchestrator.js`) now carries the partial `tokensUsed` through the
   failure so it still gets settled and reported.
2. **Daily-cap reset-boundary doubling.** A burst timed to straddle the
   daily reset (some requests just before, more just after) can extract
   close to two days' worth of budget in one short window. Accepted for
   v1 — a fully rolling window instead of a fixed daily boundary would
   close this, deferred as unnecessary complexity at this risk level.
3. **`input` is bounded but not authenticated.** Layer 4 caps how big a
   forged `input` payload can be, but the server still can't tell a real
   24-turn history from a fabricated one of the same size — so a script
   could send 25 separate requests, each with `input` padded to just under
   the Layer 4 ceiling, maximizing cost while technically complying with
   every rule. Full fix requires the server to hold authoritative
   conversation state itself (reconstructing history server-side instead
   of trusting the client's copy) — real hardening, bigger scope than v1,
   deferred until there's evidence of actual abuse.
4. **The global rate/budget pools (Layers 7-8) have no per-identity
   fairness.** Because they're deliberately not keyed by IP/user (to
   sidestep the shared-IP soft spot), one visitor exhausting either pool
   blocks every other visitor too — a tradeoff explicitly accepted in favor
   of simplicity and avoiding the shared-IP problem, not an oversight.
5. **No cap on reply "usefulness" within budget** — e.g. a prompt
   injection trying to make every allowed token low-value. Not a
   cost-ceiling bypass, just a quality concern; out of scope here.

## Open decisions

- What a visitor actually sees when a cap trips: today, every layer
  (2, 4, 5, 7, 8) returns *some* reply — layers 2/4/5 return an in-band,
  chat-shaped message so the widget renders it normally with no
  widget-side changes; layers 7/8 return a raw HTTP error (429/503) that
  the widget doesn't currently have special handling for. Whether 7/8
  should also degrade to an in-band chat message is a product decision,
  not yet made — would need a small widget-side change to handle
  gracefully rather than showing a generic error.
- Daily reset time/timezone for Layer 7 (currently UTC calendar day, via
  `currentDayKey()` in api-server's `lib/db.js`).
- All the numeric constants in `src/lib/config.js` are tunable — chosen
  for the stated risk level and expected volume, not load-tested.
