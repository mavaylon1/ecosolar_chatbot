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
