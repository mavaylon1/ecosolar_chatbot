# src/lib/

The backend "brain." Everything here runs server-side only (Next.js API
routes / server components) — nothing in this folder ever ships to the
browser.

## Files directly in this folder

- **`config.js`** — every tunable constant (model names, RAG threshold,
  lead-capture pacing). Read this first when tuning behavior — it used to be
  scattered across four files, with the embedding model name literally
  duplicated in two of them.
- **`orchestrator.js`** — `runTurn()`, the one function that actually drives
  a conversation turn: calls the OpenAI Responses API, runs whatever tools
  the model calls (via `tools/index.js`), loops until the model produces a
  plain-text reply (capped by `MAX_TOOL_ITERATIONS`). Also owns
  `isLeadCaptureInProgress()`, which decides when to force `tool_choice:
  'required'` — a real API-level constraint (not just prompt wording) that
  stops the model from silently skipping a tool call mid-lead-capture. See
  the inline comment there for the specific bug this fixed.
- **`systemPrompt.js`** — the one large `SYSTEM_PROMPT` string: sourcing
  rules, tone, formatting, and how the lead-capture sequence should read.
  This is policy in prose, read once per API call as the Responses API's
  `instructions`. The actual *mechanics* of lead capture (what state comes
  next, what's mandatory) live in code in `tools/leadCapture.js`, not here —
  this file describes how to *sound* while following that mechanism, not the
  mechanism itself.

## Subfolders

- **`tools/`** — the two things the model can actually do
  (`search_company_docs`, `submit_appointment_info`) and their execution
  logic. See `tools/README.md`.
- **`rag/`** — the embedding-based search over company docs. See
  `rag/README.md`.
- **`leads/`** — pure lead-state helpers (completeness, merging), no
  persistence. See `leads/README.md`.

## Request flow, top to bottom

```
app/api/chat/route.js
  → orchestrator.js: runTurn()
      → OpenAI Responses API (model + SYSTEM_PROMPT + TOOL_DEFS)
      → tools/index.js: executeTool()
          → tools/searchDocs.js   → rag/search.js  → data/embeddings/*.json
          → tools/leadCapture.js  → leads/state.js
```

The backend is stateless across requests — `runTurn()` takes the full prior
conversation state as arguments and returns the updated version; there's no
session store anywhere in here. See `src/app/README.md` for the actual
request/response contract.
