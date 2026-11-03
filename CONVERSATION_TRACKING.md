# Conversation tracking — word-for-word transcripts + per-conversation cost

**Status: built, not yet merged.** Spans two repos, both currently sitting
on feature branches:

- **`truvala-api-server`**, branch `conversation-transcripts` — the new
  table, the write/link/cleanup functions, the new endpoint, and the
  weekly cleanup cron job. 1 commit ahead of `master`.
- **`ecosolar_chatbot`** (this repo), branch `conversation-transcript-logging`
  — the calls that actually use it: logging every turn, threading the
  conversation ID through to lead-saving so a converted lead can be linked
  back to its transcript. 2 commits ahead of `main`.

Deploy order matters: `truvala-api-server`'s branch needs to merge and
deploy first (it's purely additive, safe on its own), then this repo's
branch — otherwise the chatbot would be calling an endpoint that doesn't
exist yet, same failure shape as the `node_modules` outage earlier this
project's history. Also needs a `CRON_SECRET` env var set on
`truvala-api-server`'s Vercel project before the cleanup job will run.

## The point of this

Up to now, the only durable record of a conversation was `appointment_leads`
— and only for conversations that actually convert, and only as a short AI
*summary*, never the real exchange. Every non-converting conversation left
no permanent trace at all once its transient resume draft expired.

The goal: see what visitors are actually asking, word for word, for *every*
conversation — not just ones that convert — specifically so patterns in
what non-converting visitors ask (confusion, missing info, a question the
bot can't answer) are visible and actionable, instead of only ever seeing
the success cases.

## What got built

A new table, `conversation_transcripts`, in the same Neon/Postgres database
`truvala-api-server` already uses for everything else:

```sql
CREATE TABLE conversation_transcripts (
  id          UUID        PRIMARY KEY,          -- same conversationId the widget generates
  key_id      UUID        REFERENCES api_keys(id) ON DELETE SET NULL,
  lead_id     UUID        REFERENCES appointment_leads(id) ON DELETE SET NULL,
  transcript  JSONB       NOT NULL,              -- full input array, word for word
  tokens_used INTEGER     NOT NULL DEFAULT 0,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

- **Deliberately separate from `conversation_drafts`** (the existing
  transient, 24h-expiring resume cache) — this is the permanent record,
  and must never be affected by future changes to the resume feature.
- **One row per conversation**, upserted every successful turn — the
  `transcript` field is overwritten with the latest full history each
  time (nothing lost, since each write is a superset of the last), and
  `tokens_used` is atomically *incremented*, not replaced.
- **`lead_id` stays `NULL` unless/until the conversation converts** — the
  join that makes "what do non-converting visitors ask" queryable
  (`WHERE lead_id IS NULL`).
- **No encryption**, deliberately — this table isn't reachable from any
  public endpoint, only direct database access, and the whole point is to
  be readable/searchable directly rather than requiring an app-level
  decrypt step. The real trade-off: a raw DB compromise would expose full
  conversation text in plaintext, including anything a visitor typed
  beyond name/email/phone.
- **A weekly cron job** deletes anything untouched for ~2 months, from
  both this table and `conversation_drafts`.

## Gaps found since building it — none yet fixed

Thinking through this carefully after the fact surfaced four real
problems, none of which are built-around yet:

### 1. There's no concept of "conversation ended" at all

The table is just continuously overwritten every turn — no status field,
no finished/ended marker. A row looks identical whether the visitor is
about to send another message in 10 seconds or left 3 weeks ago.

There *is* one existing "end" signal in the app already — a 2-minute
inactivity timer that sends a warm goodbye and resets the conversation —
but **it only arms after a lead has confirmed its contact info**. For a
conversation where lead capture never happened (exactly the set you most
want to study), there is no end signal of any kind, implicit or explicit.
Practically, this means `WHERE lead_id IS NULL` doesn't mean "didn't
convert" — it means "hasn't converted *yet*," which lumps truly abandoned
conversations in with ones still actively happening right now.

**Being discussed (not yet decided):** making that goodbye timer fire
unconditionally — regardless of whether a lead ever started or
confirmed — rather than only after a confirmed lead. This would also give
every conversation the same clean reset the goodbye already does today
(clears the saved state and conversation ID), which is a faster fix for
non-converting visitors getting stuck than the 24h draft-expiry fallback
alone. Two open questions before building it:
- The goodbye message's current wording assumes a confirmed lead ("a
  consultant will be in touch") — needs to branch depending on whether
  there's actually a lead to reference.
- Whether it should also fire *mid-flow* (lead capture started but not
  yet confirmed) or only for "never started" and "confirmed" — today that
  middle state deliberately runs no timer at all, reasoning being "don't
  interrupt someone mid-answer."
- Caveat either way: this only counts down while the browser tab stays
  open and idle. A visitor who closes the tab outright skips this
  entirely — the 24h draft-expiry fallback is still what recovers that
  case.

### 2. Per-conversation token tracking goes incomplete on a failed turn

The call that updates `conversation_transcripts.tokens_used` only runs
after a turn finishes successfully — it sits in the same code path as the
draft-save checkpoint, which has always been success-only. If a turn fails
partway through *after* already spending real tokens, that cost gets
correctly captured in the site-wide daily budget (which was built with a
`finally` block specifically so it survives failure) but **not** in this
conversation's own `tokens_used` — the two numbers can drift apart.

### 3. Transcript content goes missing on a failed turn — same root cause as #2

Same code path, same gap: a failed turn's actual content (what the visitor
asked that triggered the failure) never gets saved at all. Worse case: if
the *very first* turn of a brand-new conversation fails, no row ever gets
created for it — that conversation is completely invisible to this table,
not just missing its latest turn.

This is arguably the more important half of the two gaps, given the
stated purpose of this table: a failed turn is exactly the kind of moment
worth being able to see, and right now it's the one thing guaranteed to
vanish.

**The fix for both #2 and #3** (one fix covers both, since it's the same
call): have `orchestrator.js` hand back whatever partial content and cost
it had *at the moment of failure* — it already has this information
internally, it just doesn't currently return it on a throw — and move the
save-to-table call into a `finally` block so it always runs, logging
either the real turn (on success) or whatever partial state existed (on
failure), instead of nothing.

### 4. The transcript write isn't safe against out-of-order/concurrent requests

`transcript` is blindly overwritten each turn
(`transcript = EXCLUDED.transcript`), not checked against what's already
there. In normal use this never matters — the widget sends one message at
a time and waits for each reply. But `/api/chat` is a public endpoint, and
nothing stops two requests for the *same* conversation ID from being sent
at once. If that happened, whichever write lands last wins, even if it has
*less* content than the one already stored — a longer transcript could get
silently overwritten by a shorter, stale one.

**Possible fix:** add a cheap ordering guard on the write (e.g., only
accept the new transcript if it's actually longer than what's stored),
same idea as the guard already used on the daily-budget reservation.
Lower priority than #1-#3 — the real widget's own behavior makes this hard
to trigger outside direct API abuse.

## Status

All four gaps above: identified, not yet built. The conversation-tracking
feature itself (table, endpoint, logging calls) is built and pushed to the
two branches named at the top, also not yet merged.
