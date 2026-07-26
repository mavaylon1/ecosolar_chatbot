# src/lib/rag/

## `search.js`

`searchCompanyDocs(query)` — the only export. Given a visitor's question:

1. Embeds it with OpenAI (`EMBEDDING_MODEL` from `src/lib/config.js` — must
   match whatever `src/scripts/ingest-docs.js` used to embed the docs, or the
   comparison below is meaningless).
2. Loads `src/data/embeddings/faq-embeddings.json` (cached in memory after
   the first call in a given process).
3. Computes a plain dot product between the query embedding and every stored
   chunk embedding. OpenAI's embeddings are pre-normalized to length 1, so a
   dot product *is* cosine similarity here — no extra magnitude division
   needed.
4. Logs the query and the top 6 scores either way (see below), then returns
   the top `RAG_TOP_K` chunks that clear `RAG_SIMILARITY_THRESHOLD` — both
   constants live in `src/lib/config.js`.

### Why the threshold is `0.42`, not something more obvious like `0.5`

Originally `0.35`, calibrated against on-topic paraphrases (0.46–0.80) vs.
the closest fully off-topic near-miss (0.296). That calibration missed a
third case: a query that's topically *adjacent* to a chunk but doesn't
actually answer it — "what brands do you sell" scored 0.3646 against the
(unrelated) warranty FAQ, clearing `0.35` and getting treated as a real
answer purely because of shared surface phrasing ("do you offer"). Two
things fixed this together, not one:

- **Switching the embedding model** from `text-embedding-3-small` to
  `text-embedding-3-large` pulled those same false-positive scores down to
  0.30–0.37 while leaving genuine matches at 0.72+ — the larger model
  separates actual meaning from shared wording much better.
- **Raising the threshold to `0.42`** — safely above every observed
  adjacent-but-wrong score, safely below every observed genuine on-topic
  score under the larger model.

This is a general risk with this whole approach: `0.42` is calibrated
against the specific false positives observed so far, not a universal
constant. If a new adjacent-but-wrong case surfaces with a score above 0.42,
that's real evidence the threshold (or the doc content itself) needs another
look — not a sign the approach is broken.

### Logging

Every call logs the query plus the top 6 chunk scores (marked with which
ones cleared the threshold), regardless of whether anything was actually
returned. This exists specifically so a near-miss or a borderline false
positive is visible in server logs after the fact, instead of having to
reverse-engineer what happened from the model's final reply.
