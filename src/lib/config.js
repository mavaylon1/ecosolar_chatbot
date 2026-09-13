// Every tunable constant for the chatbot lives here — model choices, RAG
// thresholds, and lead-capture pacing. Previously these were scattered across
// four files, with EMBEDDING_MODEL literally duplicated in both
// src/lib/rag/search.js and src/scripts/ingest-docs.js — a real risk, since
// updating one and forgetting the other would silently make ingestion and
// runtime search use different embedding spaces. Centralizing means tuning
// any of these is a one-file change, and search/ingest can never drift apart.

// OpenAI Responses API model used for the actual chat turns.
export const CHAT_MODEL = 'gpt-5.4-mini'

// OpenAI embeddings model used for both ingestion (src/scripts/ingest-docs.js)
// and runtime search (src/lib/rag/search.js) — must always be the same model,
// since embeddings from different models aren't comparable to each other.
export const EMBEDDING_MODEL = 'text-embedding-3-large'

// How many chunks searchCompanyDocs returns at most.
export const RAG_TOP_K = 4

// A chunk merely "related" to a query isn't the same as one that answers it.
// With text-embedding-3-small, "what brands do you sell/offer" scored
// 0.36-0.45 against the (unrelated) warranty FAQ purely on shared phrasing
// ("do you offer"). Switching to text-embedding-3-large pulled those same
// false positives down to 0.30-0.37 while leaving genuine matches at 0.72+ —
// 0.42 sits safely in the gap between the two under the larger model.
export const RAG_SIMILARITY_THRESHOLD = 0.42

// How many consecutive "nothing found" doc searches happen before the bot
// shifts from a soft handoff to a firmer push toward a human consultant.
export const MISS_CAP = 3

// How many successfully-answered questions happen before the bot invites the
// visitor into lead capture on the "everything's going fine" path.
export const LEAD_PROMPT_AFTER_HITS = 3

// Safety valve on the tool-calling loop in lib/orchestrator.js — if the model
// hasn't produced a plain-text reply within this many tool round-trips in a
// single turn, bail out with a fallback message rather than looping forever.
export const MAX_TOOL_ITERATIONS = 5

// ── Abuse-protection caps — see SECURITY.md for the full design, the
// reasoning behind each number, and known limitations. All token counts
// below are estimates (src/lib/tokenEstimate.js), not exact.

// Layer 2: max tokens allowed in one incoming visitor message, checked in
// route.js before anything is sent to OpenAI.
export const MAX_MESSAGE_TOKENS = 600

// Layer 3: max tokens OpenAI may generate in a single reply
// (`max_output_tokens` on the Responses API call in orchestrator.js). Kept
// well above a typical reply's real size (verified live: a full
// submit_appointment_info call with a verbose `notes` field completed in
// well under 300) so a forced tool-call round — which needs reasoning plus
// real function-call JSON, not just conversational text — has headroom and
// doesn't risk truncating into invalid JSON mid-lead-capture.
export const MAX_REPLY_TOKENS = 500

// Layer 4: the fixed portion of every call's input — the system prompt
// plus the two tool schemas, both effectively constant (~2,810 + ~360
// tokens measured directly). Estimated once here rather than computed
// live on every request, since neither changes per-deploy.
export const FIXED_CALL_OVERHEAD_TOKENS = 3200

// Layer 4: max total input tokens (FIXED_CALL_OVERHEAD_TOKENS + the
// client-supplied `input` array + the new message) allowed on a single
// request — bounds the resent-conversation-history field specifically,
// since it's otherwise fully trusted and could be forged to be arbitrarily
// large in one shot. Leaves ~5,300 tokens of real headroom (this minus
// FIXED_CALL_OVERHEAD_TOKENS) for history + new message combined —
// comfortably above the ~4,300-token peak a genuine 25-turn conversation's
// history alone reaches, plus a full MAX_MESSAGE_TOKENS-sized message on
// top, plus slack for estimateTokens() being a rough heuristic.
export const MAX_INPUT_TOKENS = 8500

// Layer 5: hard cap on turns in a single conversation, enforced server-side
// (the widget's own send-pacing is UX, not enforcement — see SECURITY.md).
export const MAX_CONVERSATION_TURNS = 25

// Layer 6: cumulative token ceiling for one turn's entire tool-call loop
// (up to MAX_TOOL_ITERATIONS rounds), checked before each round rather than
// only capping each round's own output — closes the gap where
// MAX_TOOL_ITERATIONS alone would let a single turn cost up to 5x one
// round's worth. Sized to comfortably cover a legitimate 2-round
// (search-then-reply) turn with headroom, while still cutting off well
// short of all 5 rounds running at full cost.
export const MAX_TURN_TOKENS = 18000

// Layer 7: shared daily token budget across every conversation and visitor,
// site-wide (not per-user — this app has no login system). Sized for 15
// conversations/day at the 25-turn/18,000-token-per-turn worst case; see
// SECURITY.md for the full cost math.
export const DAILY_TOKEN_BUDGET = 6_750_000

// Layer 8: site-wide request-rate ceiling, requests per rolling minute —
// not per-IP, see apiServer.js's rateLimitExceeded() for why.
export const RATE_LIMIT_PER_MINUTE = 20
