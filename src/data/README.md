# src/data/

## `docs/` — source of truth, hand-edited

Plain markdown files (`faqs.md`, `company-info.md`). Each `## ` heading
becomes one searchable chunk — see `src/scripts/README.md` for how ingestion
splits these. When adding new facts (from a new recording, a client
correction, anything), edit these files directly, then run `npm run ingest`
to regenerate the embeddings below. There is no other source of truth for
what the bot knows — if it's not in here (or in `src/lib/systemPrompt.js` for
always-on policy), the bot doesn't know it.

**As this grows**: right now there are two files, organized by document type
(FAQs vs. company overview) rather than by topic. That's fine at the current
size, but if this keeps growing (e.g. from more recordings), consider
splitting by topic instead — `pricing.md`, `financing.md`, `warranties.md`,
`adu.md`, etc. — purely so a human editing this can tell at a glance whether
a fact is already covered somewhere, before adding a duplicate. Chunking
happens per-heading regardless of which file a heading lives in, so this is a
maintainability choice, not something that affects retrieval.

## `embeddings/faq-embeddings.json` — generated artifact, never hand-edit

Produced by `npm run ingest` (`src/scripts/ingest-docs.js`). A flat JSON
array of `{ id, source, heading, text, embedding }` — one entry per chunk,
`embedding` being a ~3072-dimensional vector from OpenAI's
`text-embedding-3-large`. `src/lib/rag/search.js` loads this whole file into
memory and does a brute-force cosine-similarity comparison against every
chunk for each query — no vector database involved.

This is genuinely fine at the current scale (~70 chunks, a few milliseconds
per search). Two things worth knowing as content grows:
- **Serverless cold starts**: the search module caches this file in a
  module-level variable, which only helps while a given function instance
  stays warm — every cold start re-reads the whole file from disk. Still
  cheap at today's size (~5-6MB); would be worth watching if content grows
  an order of magnitude.
- **Brute-force itself** only really stops scaling in the thousands-of-chunks
  range — nowhere close today. If that ever becomes real, smarter
  partitioning (e.g. only searching within a likely category) is a more
  proportionate first step than reaching for a vector database.

If you ever see this file with stale or missing content, the fix is always
`npm run ingest`, never a hand edit — anything typed in here directly won't
have a real embedding vector and will never match anything.
