# src/scripts/

## `ingest-docs.js`

Run manually whenever `src/data/docs/*.md` changes:

```bash
npm run ingest
```

What it does:
1. Reads every `.md` file in `src/data/docs/`.
2. Splits each file into one chunk per `## ` heading (each file is already
   organized as one heading per FAQ or topic, so this is a near-free split).
3. Embeds every chunk with OpenAI (`EMBEDDING_MODEL`, from `src/lib/config.js`
   — currently `text-embedding-3-large`).
4. Writes the result to `src/data/embeddings/faq-embeddings.json`, which is
   what `src/lib/rag/search.js` actually searches at runtime.

This script and `src/lib/rag/search.js` both import `EMBEDDING_MODEL` from
the same `src/lib/config.js` constant — never hardcode the model name in
either file directly. If ingestion and runtime search ever used different
embedding models, similarity scores between them would be meaningless (each
model has its own embedding space), so this one shared constant is a real
correctness guarantee, not just tidiness.

Needs `OPENAI_API_KEY` set in `.env.local` at the repo root — the script
loads that file itself (see `loadEnvLocal()` at the top), since it runs as a
plain Node script outside of Next's own env-loading.
