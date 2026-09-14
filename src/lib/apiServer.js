// Talks to api-server's /internal/* endpoints — the same handshake
// widget-server already uses for its own OPENAI_API_KEY usage (see
// servers_vercel/widget-server/api/proxy/concierge.js for the reference
// implementation this mirrors). See DEPLOYMENT.md item #12.
//
// In local dev (API_SERVER_URL unset, VERCEL_ENV unset), key validation and
// the cost-protection checks below all no-op permissively — same
// leave-unset-locally convention as SITE_ORIGIN/ALLOWED_EMBED_ORIGINS, so
// local dev never needs a live api-server/Neon connection. On a real
// production deployment, missing config or an unreachable/erroring
// api-server instead fails closed (blocks the request) — see
// misconfiguredInProduction() below.

import { DAILY_TOKEN_BUDGET, RATE_LIMIT_PER_MINUTE, RESERVE_TOKENS } from './config.js'

function configured() {
  return Boolean(process.env.API_SERVER_URL && process.env.INTERNAL_SECRET && process.env.API_SERVER_KEY)
}

// True when this is a real Vercel production deployment (VERCEL_ENV is only
// ever 'production' there — never set in local dev) but the api-server env
// vars are missing anyway. The plain `!configured()` no-op below exists so
// local dev never needs a live api-server/Neon connection; that same no-op
// would be dangerous in production, since it would silently disable key
// validation *and* both cost-protection layers at once, with nothing else
// standing in front of unmetered OpenAI usage. Checked ahead of the plain
// `!configured()` case in every function below so production fails closed
// instead of quietly behaving like local dev.
function misconfiguredInProduction() {
  return process.env.VERCEL_ENV === 'production' && !configured()
}

// Validates API_SERVER_KEY against api-server before any OpenAI call is
// allowed. Returns { ok: true, keyData } or { ok: false, status, error } —
// the caller blocks the request on ok: false.
export async function validateApiServerKey() {
  if (misconfiguredInProduction()) {
    console.error('[apiServer] production deployment missing API_SERVER_URL/INTERNAL_SECRET/API_SERVER_KEY — failing closed.')
    return { ok: false, status: 503, error: 'Service temporarily unavailable.' }
  }
  if (!configured()) return { ok: true, keyData: null }

  let res
  try {
    res = await fetch(`${process.env.API_SERVER_URL}/internal/validate-key`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
      body: JSON.stringify({ key: process.env.API_SERVER_KEY }),
      signal: AbortSignal.timeout(8_000),
    })
  } catch (err) {
    console.error('[apiServer] validate-key network error:', err.message)
    return { ok: false, status: 503, error: 'Key validation service unavailable.' }
  }

  if (res.status === 402) {
    const body = await res.json().catch(() => ({}))
    return { ok: false, status: 402, error: body.error || 'Monthly token quota exhausted.' }
  }
  if (!res.ok) return { ok: false, status: 403, error: 'Invalid or revoked api-server key.' }

  const keyData = await res.json()
  return { ok: true, keyData }
}

// Reports total tokens used this turn back to api-server. Fire-and-forget
// from the caller's perspective — a failure here must never surface to the
// visitor or block the reply they already received.
export async function reportTokenUsage(keyData, tokens) {
  if (!configured() || !keyData || !tokens || tokens <= 0) return
  try {
    await fetch(`${process.env.API_SERVER_URL}/internal/track-tokens`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
      body: JSON.stringify({ key_id: keyData.key_id, user_id: keyData.user_id, tokens, endpoint: 'ecosolar-chat' }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.warn('[apiServer] track-tokens report failed:', err.message)
  }
}

// Layer 7 (SECURITY.md): atomically reserve RESERVE_TOKENS (this turn's
// worst-case cost) against today's site-wide budget *before* the turn does
// any OpenAI work — the check and the write are the same database statement
// (api-server's reserveDailyTokens()), so concurrent requests can't all read
// "still under budget" before any of them account for their own usage, the
// way a separate check-then-later-report pattern allowed (see SECURITY.md's
// former "daily-cap race condition" known limitation — this closes it).
// Returns true if the reservation succeeded (turn may proceed) or false if
// it would exceed the budget, api-server is unreachable/erroring, or (on a
// real production deployment) the env vars are missing — fails closed for
// the same reason the old read-only check did: this is the last line of
// defense against unmetered OpenAI cost, and silently allowing requests
// through on a failure defeats the point of having it. Every reservation
// this makes must eventually be settled back to the turn's real cost via
// settleDailyBudget() below, even if the turn errors out — route.js
// guarantees that with a try/finally.
export async function reserveDailyBudget() {
  if (misconfiguredInProduction()) {
    console.error('[apiServer] production deployment missing api-server env vars — failing closed on daily budget reservation.')
    return false
  }
  if (!configured()) return true
  try {
    const res = await fetch(`${process.env.API_SERVER_URL}/internal/chat-daily-budget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
      body: JSON.stringify({ reserve: RESERVE_TOKENS, budget: DAILY_TOKEN_BUDGET }),
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      console.error(`[apiServer] chat-daily-budget reserve returned ${res.status} — failing closed.`)
      return false
    }
    const { reserved } = await res.json()
    return Boolean(reserved)
  } catch (err) {
    console.error('[apiServer] reserveDailyBudget failed, failing closed:', err.message)
    return false
  }
}

// Settles a reservation made by reserveDailyBudget() back down to the
// turn's real (not estimated, not the worst-case reservation amount) token
// usage — the delta is almost always negative (giving back the unused slack
// between RESERVE_TOKENS and what the turn actually cost), atomically added
// via the same addDailyTokens() upsert api-server already uses for the
// positive case. Best-effort/fire-and-forget like every other post-response
// accounting call here — there's nothing left to block by this point, the
// visitor already has their reply. If this repeatedly fails, unsettled
// reservations stay counted against the budget until it recovers, making
// the day look busier than it really was — an accepted, self-correcting
// imprecision (resets at midnight either way), not silent unmetered spend
// the way the old fail-open design risked.
export async function settleDailyBudget(realTokens) {
  if (!configured()) return
  const delta = (realTokens || 0) - RESERVE_TOKENS
  if (delta === 0) return
  try {
    await fetch(`${process.env.API_SERVER_URL}/internal/chat-daily-budget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
      body: JSON.stringify({ tokens: delta }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.warn('[apiServer] settleDailyBudget failed:', err.message)
  }
}

// Layer 8: atomic, fixed-window (1 minute) request-rate check, site-wide
// rather than per-IP — see SECURITY.md for why. api-server does the atomic
// increment; this just compares the returned count against our own limit.
// Fails closed for the same reason reserveDailyBudget() does above.
export async function rateLimitExceeded() {
  if (misconfiguredInProduction()) {
    console.error('[apiServer] production deployment missing api-server env vars — failing closed on rate limit check.')
    return true
  }
  if (!configured()) return false
  try {
    const res = await fetch(`${process.env.API_SERVER_URL}/internal/chat-rate-limit`, {
      method: 'POST',
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      console.error(`[apiServer] chat-rate-limit check returned ${res.status} — failing closed.`)
      return true
    }
    const { request_count } = await res.json()
    return request_count > RATE_LIMIT_PER_MINUTE
  } catch (err) {
    console.error('[apiServer] rateLimitExceeded check failed, failing closed:', err.message)
    return true
  }
}

// Stores a confirmed lead's contact info (plus, when available, an AI
// summary of the conversation — see lib/summarize.js) in api-server's
// appointment_leads table. api-server fires the Resend notification email
// itself as a side effect of this write (lib/resend.js on that side) — this
// function has no email concern at all. Throws on failure so the caller
// (leadCapture.js) can fall back to its own console.log stub — this must
// fail independently and never crash the conversation.
export async function saveLead(keyData, { name, email, phone, summary }) {
  if (!configured()) throw new Error('api-server not configured')
  const res = await fetch(`${process.env.API_SERVER_URL}/internal/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
    body: JSON.stringify({ key_id: keyData?.key_id, user_id: keyData?.user_id, name, email, phone, summary }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`api-server /internal/leads returned ${res.status}`)
}

// Mid-conversation checkpoint (see DEPLOYMENT.md item #10's conversation-ID
// note and api-server's conversation_drafts table). All three are best-effort
// from the caller's perspective — a hiccup here must never surface to the
// visitor or block the reply they already received.

export async function saveDraft(keyData, conversationId, state) {
  if (!configured()) return
  try {
    await fetch(`${process.env.API_SERVER_URL}/internal/drafts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
      body: JSON.stringify({ id: conversationId, key_id: keyData?.key_id, state }),
      signal: AbortSignal.timeout(8_000),
    })
  } catch (err) {
    console.warn('[apiServer] saveDraft failed:', err.message)
  }
}

// Unlike saveDraft/deleteDraft, the caller (api/resume/route.js) needs the
// actual result to decide what to show the visitor, so this returns null on
// any failure/absence rather than throwing — resuming is always best-effort;
// worst case the conversation just starts fresh.
export async function getDraft(keyData, conversationId) {
  if (!configured()) return null
  try {
    const res = await fetch(`${process.env.API_SERVER_URL}/internal/drafts/${conversationId}`, {
      method: 'GET',
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      signal: AbortSignal.timeout(8_000),
    })
    if (!res.ok) return null
    const { state } = await res.json()
    return state
  } catch (err) {
    console.warn('[apiServer] getDraft failed:', err.message)
    return null
  }
}

export async function deleteDraft(keyData, conversationId) {
  if (!configured()) return
  try {
    await fetch(`${process.env.API_SERVER_URL}/internal/drafts/${conversationId}`, {
      method: 'DELETE',
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      signal: AbortSignal.timeout(8_000),
    })
  } catch (err) {
    console.warn('[apiServer] deleteDraft failed:', err.message)
  }
}
