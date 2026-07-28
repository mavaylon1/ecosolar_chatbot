# Deployment plan — decision log

This tracks the decisions, owners, and open questions for taking this from
local-only to a real production deployment on the client's site. It builds
on two outside sources: an architecture recommendation from the CTO (widget
loader → iframe → Vercel), and a permissions/security note from the client's
WordPress site admin. Each item below is one thing that needs a decision,
an owner, or both — filled in as we work through them, not all at once.

Status key: **Decided** (settled, may still need building) · **Open** (not
yet decided) · **Built** (actually implemented, not just decided).

Organized into three sections:
- **Section 1** — Vercel integration and a Vercel-hosted test site, using the
  exact same embedding mechanism production will use. None of this needs
  WordPress/client access at all.
- **Section 2** — WordPress/Elementor-side work. Depends on the client's site
  and can wait until Section 1 is proven out.
- **Section 3** — needed regardless of either platform.

---

# Section 1 — Vercel integration + test site

## 1. Vercel project + domain

**What it is:** the chatbot's actual "brain" (the API, the RAG search, the
lead-capture logic) has to run as a real program somewhere, reachable by a
real address — it can't live inside the client's WordPress hosting, since
it's built in different technology (Next.js/Node, not PHP) and needs to keep
a secret API key server-side. That address is never visited directly by a
person; it's only ever called invisibly by the floating widget embedded on
the client's page (the same way "Chat with us" widgets like Intercom or
Drift work — the visible button lives on the client's page, but the actual
thinking happens on a totally separate domain in the background).

The choice was between Vercel's free default address
(`something.vercel.app`) and a custom branded subdomain of the client's own
domain (`chat.ecosolarusa.com`) — the latter requiring the client to add a
DNS record pointing at Vercel.

**Decision:** use Vercel's free default domain. No real practical downside
for an invisible backend at this stage — the minor reasons to prefer a
custom domain (a technical visitor noticing it in dev tools, occasional
corporate-firewall unfamiliarity with `*.vercel.app`, easier long-term
provider migration) aren't worth the client-side DNS setup right now.
Attaching a custom domain later, if it ever matters, doesn't require any
code changes — just a Vercel settings change.

**Confirmed separately:** this choice has no bearing on any of the
WordPress/Elementor permission items (Section 2) — those are all about the
*act* of pasting a `<script>` tag into Elementor, not about which domain
that tag points to.

**Owner / task:** **CTO** — provision the Vercel project, deploy this repo,
and record whatever the resulting `*.vercel.app` address ends up being (that
address is what `widget.js` and the CSP allowlist, below, will need to
reference).

**Built:** `vercel.json` added, and this app wired into the monorepo's
`servers_vercel/deploy.sh` (`bash servers_vercel/deploy.sh ecosolar`,
included by default with the other three services) — same deploy path the
other three `servers_vercel/*` projects already use. The root route (`/`,
`src/app/page.jsx`) is now the actual test site itself — a real EcoSolar USA
page with the chatbot iframed in via `/embed/ecosolarusa` — so whatever
`*.vercel.app` address the CTO's `vercel --prod` produces is immediately a
working, presentable proof of the widget, not a placeholder.

**Status:** Mechanism built; running the actual `vercel`/`vercel --prod`
deploy (which requires a logged-in Vercel account) and recording the
resulting address is still the CTO's step.

---

## 2. Environment variables — Production vs. Preview

**What it is:** Vercel automatically creates a temporary test deployment for
every branch pushed ("Preview"), separate from the real live site
("Production"). Both can hold their own copies of secrets like
`OPENAI_API_KEY`. If they share the same key, every test branch spends real
money and shares the same usage limits as the live client site.

**Decision: use a single shared `OPENAI_API_KEY` for both Production and
Preview** — mimicking the same handshake/pattern already used for another
project's chatbot on Vercel. No compelling reason to split keys right now,
and a single key is simpler and cheaper to manage.

The usual reason to split (a test branch accidentally running up production
cost/usage) doesn't really apply here anyway: clients are charged a **flat
fee**, not metered per-token — actual OpenAI usage is an internal cost the
business absorbs, not something billed pass-through to the client. So even a
noisy test branch doesn't create a client-facing cost or billing problem, it
just adds to the flat internal cost the business already expects to carry.

This isn't a one-way door — splitting into separate keys later is a Vercel
dashboard change, not a code change, if a real reason to split ever comes up
(e.g. a spike in raw usage volume worth isolating for tracking purposes).

**Owner / task:** **CTO** — same step as item #1 (setting `OPENAI_API_KEY` in
Vercel's environment variables when the project is provisioned), just one
key, no Preview/Production split needed.

**Status:** Decided.

---

## 3. CSP header on `/embed/[clientId]`

**What it is:** a security header telling browsers which *other websites*
are allowed to put our `/embed` page inside an iframe on their own page —
not which people/visitors can use the widget (anyone still can, regardless).
Think of it like which sites YouTube allows to embed its video player, not
which viewers can watch — it's the same distinction here. Without this,
browsers may block the iframe once really deployed, and without it, in
principle an unrelated site could also embed our widget on their own page.
This pairs with item #4 (origin validation): this header stops other sites
from *displaying* our widget, origin validation stops other sites from
*actually calling* our backend even if they got it displaying somehow —
neither alone is a full boundary.

**Decision + built:** implemented, but deliberately deferred which real
domains go on the allowlist — those aren't known yet (no confirmed staging
domain, possibly not the final production domain naming either). Rather
than block on that, the mechanism is built now with the actual domain list
read from a new environment variable, **`ALLOWED_EMBED_ORIGINS`**
(`next.config.mjs`, documented in `.env.example`) — a comma-separated list
of full origins, e.g. `https://ecosolarusa.com,https://www.ecosolarusa.com`.
If that variable isn't set (true in local dev today), no header gets added
at all — `demo/index.html` keeps working with zero restriction, exactly as
it does now. Verified locally: no CSP header is sent as of this change.

**Owner / task:** **CTO** for the Vercel setting; the actual domain *value*
depends on the client (Section 2) — the mechanism itself needs nothing from
them.

**TODO (CTO):**
- [ ] Confirm the real production domain(s) `ecosolarusa.com` /
      `www.ecosolarusa.com` (or whatever the final client domain naming is)
      — see Section 2.
- [ ] Confirm whether a separate staging domain exists/will be used, and if
      so, get that domain too — it needs to go on the same list, at least
      temporarily during testing.
- [ ] Set `ALLOWED_EMBED_ORIGINS` in Vercel's environment variables to the
      full comma-separated list of confirmed origins (e.g.
      `https://ecosolarusa.com,https://www.ecosolarusa.com`).

**Status:** Built (mechanism); the actual domain value is Open until deploy
time.

---

## 4. Origin validation on `/api/chat`

**The problem, concretely:** our chatbot's actual "brain" lives at a
specific web address (`/api/chat`), and today it answers *anyone* who asks
it a question, no questions asked. Since that address is visible in a
browser's network activity, someone could write their own small script that
talks to it directly — completely bypassing the real widget and the client's
site entirely — and get free, unlimited use of it, running up real OpenAI
cost with zero connection to an actual EcoSolar visitor. `data-client-id`/
`clientId` alone doesn't stop this — it's just a copyable string in a URL,
not a real security boundary.

**The fix, conceptually:** every request secretly carries a tag saying where
it came from (the `Origin` header, added automatically by browsers). Add one
rule: only answer requests whose tag matches our own widget's page — refuse
everyone else. Like a delivery gate that only opens for trucks coming from
the correct warehouse, regardless of who's in the truck.

**Where exactly this sits, precisely (this took a few passes to land on):**
the existing flow is browser → `/api/chat/route.js` (our code) →
`orchestrator.js` (our code) → OpenAI's actual API. A stranger can only ever
reach OpenAI *through* our server, since only our server holds the secret
key — so the real gap is entirely at the *first* hop (browser → our route).
The fix isn't a new separate service or a new network hop between existing
pieces — it's a handful of new lines added at the very top of the
already-existing `route.js`, checked before anything else in that file runs:
if the check fails, respond `403 Forbidden` immediately, before the request
ever reaches `orchestrator.js` or touches OpenAI at all; if it passes,
everything continues exactly as it does today.

**An important nuance vs. item #3:** this checks *our own* domain, not the
client's. Our widget's code runs *inside* the iframe, and that iframe's
content is served from our own domain — so when the widget calls
`/api/chat`, the request's `Origin` is our own domain, not
`ecosolarusa.com`. Item #3 asks "who can display our page" (the client's
domain); this item asks "does this request actually come from our own page"
(our domain). Two different checks, even though both involve "domains."

**Where the actual value comes from:** unlike item #3 (waiting on the
client to hand us their domain), this depends on *our own* domain, which we
get to choose in advance — Vercel's free default address is based on
whatever project name is picked at creation (`<project-name>.vercel.app`),
not something assigned to us passively. **Assumed project name:
`ecosolar-chatbot`, giving `https://ecosolar-chatbot.vercel.app`** — this
needs confirming once the project actually exists, since `.vercel.app`
names are shared globally across all Vercel users and there's a small
chance of a naming collision requiring a different name.

**Built:** `SITE_ORIGIN` env var (`.env.example`), checked in
`src/app/api/chat/route.js` before any other logic runs. Unset in local dev
on purpose — confirmed locally that requests still work normally with no
`SITE_ORIGIN` set (same no-op-when-unset pattern as item #3's
`ALLOWED_EMBED_ORIGINS`).

**Does this affect our own `demo/` testing?** No — the demo page itself
never calls `/api/chat` directly; it only embeds an iframe whose *content*
is served from our own domain, so that iframe's internal calls to
`/api/chat` already carry our own origin regardless of what page hosts the
iframe (a local `file://` demo page, `ecosolarusa.com`, anything). This is
different from item #3's CSP header, which *can* affect the demo once
`ALLOWED_EMBED_ORIGINS` is set restrictively — a locally-opened
`demo/index.html` (a `file://` page) isn't `ecosolarusa.com`, so if it were
ever pointed at the real deployed URL after that CSP is locked down, the
browser would refuse to render the iframe at all. There's no clean way to
put a `file://` page on a production allowlist (browsers handle `file://`
origins inconsistently for this purpose), so the practical answer is: keep
testing the demo against `localhost` (where nothing is restricted, as today)
and treat "does it actually iframe correctly on the client's real site" as
something verified directly against the real deployment, not via the local
demo file.

**TODO (CTO):**
- [ ] Confirm the Vercel project ends up named `ecosolar-chatbot` (or note
      the actual resulting name, if a naming collision forced a different
      one).
- [ ] Set `SITE_ORIGIN` in Vercel's environment variables to the confirmed
      `https://<actual-project-name>.vercel.app` address.

**Status:** Built (mechanism + assumed value); needs confirming once the
Vercel project actually exists.

---

## 5. Rate limiting on `/api/chat`

**What it is:** capping how often one visitor/source can hit the chat, to
stop abuse or a runaway script from running up cost or degrading service.

**Real gotcha, already flagged:** a naive "count requests in a variable"
approach does not work correctly on Vercel — serverless functions don't
share memory across instances, so an in-memory counter resets constantly and
doesn't actually enforce a limit under real traffic. This needs externally
shared state from day one (Vercel's own rate-limiting product, or something
like Upstash Redis) — not a thing to prototype the easy way and harden later.

**The refresh/reset question — how a returning visitor is handled:** rate
limits aren't a permanent ban counter, they're scoped to a rolling time
window (e.g. "20 messages per 5 minutes," "100 messages per hour") — not a
lifetime count. So if a visitor comes back a few hours later, or the next
day, they get a completely fresh allowance automatically — the window
expires on its own. This isn't extra logic we need to build; it's built
into how these systems work (e.g. Upstash's rate-limit library, or Vercel's
own rate-limiting product, both handle the window/expiry natively via
short-lived keys with a TTL). What's still an open decision: the actual
limit and window size (how many messages, over how long), and what
identifies "one visitor" for this purpose — most likely IP address, since
there's no login/account system here. IP-based limiting has a known
soft spot worth being aware of (not necessarily solving now): visitors
sharing an IP — a busy office network, a mobile carrier's shared address
pool — could occasionally look like one high-traffic "visitor" and get
limited together.

**Decision:** Open — needs to pick a specific rate-limiting approach/service,
plus the actual limit/window numbers once picked.

**Status:** Open, not built.

---

## 6. `widget.js` — the real client-facing loader script

**What it is:** the actual `<script>` file the client's WordPress admin
pastes into Elementor (per the CTO's plan — the "one line of code" the
client needs). Its job: draw the floating button, and on click, create the
iframe pointing at our `/embed/ecosolarusa` route. Doesn't exist yet —
today, `demo/index.html` fakes this by hardcoding the iframe directly, as a
stand-in for our own local testing only. This can be built and tested
entirely against our own Vercel test site (Section 1) — no WordPress access
needed until it's time to actually paste it into the client's real page
(Section 2).

**New requirement surfaced from the client's admin's permissions note:** if
the client's site shows a cookie-consent banner, this script needs to wait
for consent before even creating the iframe — not just before collecting a
visitor's name/email inside a conversation.

**Decision:** Open — not yet built at all.

**Status:** Open, not built.

---

## 7. Resize handshake between the iframe and `widget.js`

**What it is:** today's stand-in reserves one big fixed rectangle
(480×740px) for the whole widget, sized to fit it whether open or closed —
which means that invisible rectangle blocks clicks/scroll on the real page
underneath it, even across its empty transparent areas. The real fix: the
iframe tells the parent page (via `postMessage`, a safe way for an iframe
and its host page to communicate) how much space it actually needs right
now — tiny when just showing the button, larger when the chat is open — and
`widget.js` resizes the iframe element to match. Same as item #6 — buildable
and testable against our own Vercel test site, no WordPress needed yet.

**Decision:** Open — agreed this is the right approach; not yet built.
**Backup plan if this gets complicated:** keep the current fixed-size iframe
approach (already working, just imperfect) rather than blocking launch on it.

**Status:** Open, not built.

---

# Section 2 — WordPress / Elementor (can wait until Section 1 is done)

## 8. WordPress/Elementor permissions & site prep

**What it is:** three permission-related concerns the client's own WordPress
admin surfaced, all entirely on their side — nothing in this codebase
touches any of it:

- **Elementor Role Manager** — controls which WordPress user roles are even
  allowed to open the Elementor editor. Since pasting a raw `<script>` tag
  into an HTML widget is considered a security-sensitive action, the client
  may want to restrict who's allowed near that part of the editor.
- **`unfiltered_html` capability** — WordPress strips `<script>` tags from
  saved content by default, for most user roles. Only users with this
  capability (usually just true Administrators) can save the widget's script
  tag without WordPress silently deleting it.
- **Deactivating their existing chat plugins** (WG Live Chat, and confirm
  whether Olark needs it too) — otherwise a visitor could see two floating
  chat buttons, or the scripts could conflict.
- **If EcoSolar's own site enforces its own CSP**, they may need to
  explicitly allowlist our domain on *their* side, or their page won't even
  be allowed to load `widget.js` in the first place.

**Decision:** Open — this becomes a short checklist to hand to the client's
WordPress admin once we have a final domain and script.

**TODO (client's WordPress admin):**
- [ ] Confirm who (which role) is allowed to edit the Elementor HTML widget,
      and whether Role Manager restrictions need adjusting.
- [ ] Confirm whoever pastes the script has `unfiltered_html` capability, or
      the script will get silently stripped on save.
- [ ] Deactivate WG Live Chat – Code Integration.
- [ ] Confirm whether Olark Live Chat also needs deactivating.
- [ ] Confirm whether the site has its own CSP; if so, allowlist our domain
      (from item #1) on their side.

**Status:** Open, not built/confirmed.

---

## 9. Actual Elementor integration steps

**What it is:** the mechanical steps to get the script live on the real
site, per the CTO's original recommendation.

**TODO (client's WordPress admin):**
- [ ] Elementor → Custom Code → add the `widget.js` loader script (once
      item #6 exists).
- [ ] Set the code's location to **Body End**.
- [ ] Initially target the **staging environment** only (see item #3's note
      on a possible separate staging domain).
- [ ] Once approved, change the condition to **Entire Site**.
- [ ] Clear Elementor and site caches after any change.
- [ ] Test on both `ecosolarusa.com` and `www.ecosolarusa.com`.

**Status:** Open, not started — depends on Section 1 items #1, #3, #4, #6
being ready first.

---

# Section 3 — Needed in general (not tied to either platform)

## 10. Leads + company-email mechanism

**What it is:** right now, when a lead is fully captured and confirmed, the
code does this instead of anything real:

```js
console.log('[LEAD CAPTURED — stub, not persisted]', lead)
console.log('[FAKE EMAIL — company alert]', ...)
```

So the *shape* of "a lead gets captured, then an alert fires" was already
designed in — it's just fake right now. This is arguably the most urgent
item in this whole document: shipping before this is fixed means every real
lead a visitor submits effectively vanishes into logs nobody's watching.

**Services decided:** **Neon** for SQL (already set up separately, CTO to
refine the schema/connection details), **Resend** tentatively for email.

**Trigger — confirmed NOT a cron job.** Cron is for "run this on a fixed
schedule regardless of what's happening" — the opposite of what's needed
here, which is "the instant a lead completes, act immediately." The correct
trigger point already exists in the code: the exact spot in
`src/lib/tools/leadCapture.js` where the stub above currently fires, right
after the visitor confirms their info. No scheduling involved.

**The three pieces, and how they fit together:**
1. **Store the contact info** — a real `INSERT` into a `leads` table (name,
   email, phone, contact method, interest, notes, timestamp) in Neon, at
   that same trigger point.
2. **Summarize the conversation** — a separate, additional OpenAI call at
   that same moment, feeding it the full transcript already held in memory
   and asking for a short summary. Small/cheap relative to a full
   conversational turn.
3. **Send the email** — via Resend, composed from the lead's contact info
   plus the summary (or raw transcript — still an open question, see below).

**Design principles agreed on:**
- The three pieces (DB write, summary, email) must fail independently — a
  hiccup in one (e.g. the email service being briefly down) must never
  crash the conversation or block the visitor from getting their normal
  reply, and must never prevent the other two pieces from completing.
- **Verify the Neon write actually succeeded** before treating the lead as
  safely captured — don't just assume the `INSERT` worked.
- **If the Neon write fails, don't just lose the lead — get it in front of a
  human immediately.** Decided approach: reuse the Resend integration we're
  already building — send an immediate alert email (to an internal/dev
  address, not the client's lead inbox) containing the full raw lead data,
  effectively using that email as the "temp storage to refer to during a
  debug." This was chosen over standing up a dedicated store (e.g. Vercel
  KV/Blob) specifically to avoid a third piece of infrastructure for what
  should be a rare edge case — reuses what's already being built instead.
- The existing `_saved` guard (already prevents the stub from re-firing on
  every later `submit_appointment_info` call) carries over automatically —
  this won't cause duplicate DB rows or duplicate emails.

**Still open, needed before building:**
1. Which inbox receives the *successful* new-lead email (e.g.
   `leads@ecosolarusa.com`)?
2. Raw transcript in that email, the AI-generated summary, or both?
3. Should the visitor's reply wait for all of this to finish, or return
   immediately while it runs in the background? (Next.js/Vercel support
   letting a response return while work continues briefly afterward —
   `after()`/`waitUntil()` — worth using if a second or two of added latency
   on every completed lead isn't acceptable.)

**Decision:** Open — needs answers to the three questions above before this
can be built; the overall shape/services/failure-handling approach is
otherwise settled.

**Status:** Open, not built. Stubbed shape already exists in
`src/lib/tools/leadCapture.js`.

---

## 11. `/api/leads` — design question, not a bug

**What it is:** the CTO's original plan assumed a separate address just for
lead data, distinct from the chat conversation endpoint. Our actual design
instead captures leads *inside* the ongoing chat conversation (the model
triggers an internal `submit_appointment_info` action, still through the one
`/api/chat` address) — a deliberate difference, not an oversight.

**Decision:** Open — worth a conscious call once item #10 is settled: do we
ever want a standalone leads endpoint, e.g. for an internal staff dashboard
to view captured leads directly, separate from the conversation flow?

**Status:** Open, no action needed unless a dashboard or similar becomes a
real requirement.
