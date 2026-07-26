# src/app/

Next.js App Router routes. Three things live here, each with a distinct job:

## `api/chat/route.js` — the one API endpoint

`POST /api/chat`. Request body:

```json
{ "input": [...], "lead": {...}, "missCount": 0, "hitCount": 0, "message": "..." }
```

`input`/`lead`/`missCount`/`hitCount` are whatever the *previous* response
returned (empty/zero on the very first message) — the browser is responsible
for round-tripping this every request, since the backend itself is
stateless. Calls `runTurn()` (`src/lib/orchestrator.js`) and returns its
result directly: `{ reply, input, lead, missCount, hitCount }`.

Rejects any request whose `Origin` header doesn't match `SITE_ORIGIN` (our
own deployed domain, not the client's — see `DEPLOYMENT.md` item #4) —
stops someone from calling this endpoint directly and bypassing the
widget/iframe entirely. Unset in local dev on purpose, so this is a no-op
locally. Rate limiting is still genuinely not built — see the "not yet
built" notes in `src/README.md` before this goes to production.

## `embed/[clientId]/page.jsx` — the actual embeddable widget page

This is what a client's site iframes (per the deployment plan in
`src/README.md`): `<iframe src="https://your-domain/embed/ecosolarusa">`.
Renders `<ChatWidget />` (from `src/components/ChatWidget/`) and nothing
else — no page chrome, no demo content, transparent background (see
`layout.jsx` below). `clientId` isn't read yet — there's only one client's
config right now — but the route is already parameterized so a second client
is a data change later, not a routing change.

This route is also where the CSP `frame-ancestors` header gets applied
(`next.config.mjs`, gated on the `ALLOWED_EMBED_ORIGINS` env var — see
`DEPLOYMENT.md` item #3) — the header controls which *other websites* are
allowed to iframe this page at all, not which visitors can use the widget.
Unset locally on purpose, so no header is sent in dev.

## `page.jsx` — root info page, NOT the demo

Served at `/`. This used to *be* the demo (floating icon + full widget UI
inline), but that's been extracted — see `src/components/README.md` and
`demo/README.md` at the repo root. This page is now just a small pointer:
what this app is, and where to actually find the widget (`/embed/ecosolarusa`)
and the real demo (the standalone `demo/` folder).

## `layout.jsx` — shared root layout

Sets the page title and a transparent `<body>` background. The transparent
background matters specifically for `embed/[clientId]` — since that page
gets iframed over a client's real site, it must never impose its own opaque
background.
