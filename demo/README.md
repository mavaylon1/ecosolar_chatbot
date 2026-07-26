# demo/

Throwaway. This folder is not part of the product — delete it freely, it
won't break anything else in the repo.

## What it is

A single static file (`index.html`) standing in for the client's real
website (ecosolarusa.com). It has **zero code connection** to the chatbot
app — no imports, no shared components, nothing. The only thing it knows is
one URL: `http://localhost:3000/embed/ecosolarusa`, which it loads in an
`<iframe>` positioned over the bottom-right corner of the page.

This is deliberate: it's the same integration a real client site will use
(per the deployment plan — see `src/README.md`), just pointed at a local dev
server instead of the production domain. If the widget works here, it works
the same way on the real site, because it's *the same route*, not a lookalike.

## Running it

1. Start the actual app first (from the repo root): `npm run dev` — this
   serves `/embed/ecosolarusa` at `http://localhost:3000`.
2. Open `demo/index.html` directly in a browser (double-click it, or
   `open demo/index.html` on macOS). No build step, no server needed for this
   file itself — it's plain HTML.

## Known limitation (not fixed yet)

The iframe is a fixed 480×740px transparent rectangle sized to fit the
widget's floating button *and* its fully-expanded chat panel. Since there's
no dynamic resize handshake between the iframe and this host page, that
whole rectangle intercepts clicks and scroll on the page underneath — even
across the transparent areas, when the chat is closed. The real fix is a
`postMessage`-based resize (the iframe tells the host page how much space it
actually needs right now, and the host page's `widget.js` loader resizes the
iframe accordingly) — that's part of the still-to-be-built production
`widget.js` loader script, not implemented here.
