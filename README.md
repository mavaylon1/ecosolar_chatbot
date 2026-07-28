# EcoSolar USA — Chatbot

A floating-icon website chatbot: grounded Q&A over EcoSolar's company docs,
plus a guided lead-capture flow.

## Where things live

- **[`src/README.md`](src/README.md)** — the real app: architecture, how the
  RAG pipeline and lead-capture flow work, design decisions and the bugs that
  shaped them, what's stubbed, what's not built yet. Start here.
- **[`demo/README.md`](demo/README.md)** — a throwaway, standalone HTML page
  that previews the widget by iframing the real embed route, the same way a
  real client site will. Delete this folder freely; nothing else depends on
  it.
- **[`DEPLOYMENT.md`](DEPLOYMENT.md)** — the decision log for going to
  production on the client's real site: domain, env vars, CSP, origin
  validation, rate limiting, the `widget.js` loader, and what's still open
  vs. decided vs. actually built.

Every subfolder under `src/` has its own `README.md` explaining what's in it
and how it connects to the rest — `src/app/`, `src/components/`, `src/lib/`
(and its `tools/`, `rag/`, `leads/` subfolders), `src/data/`, `src/scripts/`.

## Quick start

```bash
npm install
npm run ingest   # only needed once, or whenever src/data/docs/*.md changes
npm run dev
```

Then open `http://localhost:3000` for the full test-site preview (a real
EcoSolar USA page with the chatbot iframed in — this is also what's served
at `/` once deployed to Vercel, see `DEPLOYMENT.md` Section 1), or
`http://localhost:3000/embed/ecosolarusa` directly for just the widget, or
open `demo/index.html` in a browser for the throwaway standalone preview.

`OPENAI_API_KEY` goes in `.env.local` at the repo root (copy `.env.example`).
