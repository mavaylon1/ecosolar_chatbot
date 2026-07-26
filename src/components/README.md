# src/components/

## `ChatWidget/`

The chat widget's UI — and the **only** place this UI is defined. It's
rendered by exactly one route, `src/app/embed/[clientId]/page.jsx`, and
nowhere else. The demo host page (`demo/index.html`, at the repo root) does
**not** import this component — it reaches the exact same rendered widget by
loading that embed route in an iframe, the same way a real client's site
will. This is deliberate: it means there is only ever one copy of the
widget's UI to keep correct, and the demo is a true test of the real
integration path, not a lookalike.

- **`ChatWidget.jsx`** — the actual floating icon + expandable chat panel.
  Owns all UI state (open/closed, message history, input text, loading) and
  the `fetch('/api/chat')` round-trip. The panel and icon both use
  `position: fixed`, which positions relative to *whatever page renders this
  component* — inside an iframe, that's the iframe's own viewport, which is
  why the iframe embedding it needs to be sized/positioned to match (see
  `demo/README.md` for the current, imperfect way that's handled).
- **`Bubble.jsx`** — a single message bubble, styled differently for
  `role: 'user'` vs. `role: 'assistant'`.
- **`TypingDots.jsx`** — the "assistant is typing" indicator, shown while a
  request to `/api/chat` is in flight. Self-contained — it owns its own
  `@keyframes` animation CSS, so nothing rendering it needs to remember to
  supply that separately.
- **`theme.js`** — the shared visual constants: colors (`NAVY`, `NAVY_DARK`,
  `SURFACE`, `SURFACE_MUTED`, `TEXT_ON_SURFACE`, `BORDER`) and corner-radius
  values (`RADIUS_PANEL`, `RADIUS_BUBBLE`, `RADIUS_PILL`). Current look is
  iOS-inspired: mostly white, navy for anything that needs emphasis (header,
  the user's own messages, buttons — always paired with white text), generous
  rounding throughout. Kept in one file so `Bubble.jsx`, `TypingDots.jsx`, and
  `ChatWidget.jsx` can't drift out of sync with slightly different values.

None of these files know anything about `clientId` yet — there's only one
client's configuration right now. If a second client is ever added, this is
where per-client theming/copy would need to start branching.
