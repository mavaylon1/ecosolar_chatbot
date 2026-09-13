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

import { DAILY_TOKEN_BUDGET, RATE_LIMIT_PER_MINUTE } from './config.js'

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

// Layer 7 (SECURITY.md): has today's site-wide token budget already been
// spent? A plain GET, not itself atomic — the real enforcement is
// addToDailyBudget's atomic increment (done in api-server's Postgres, see
// its lib/db.js) after each turn. See SECURITY.md's "daily-cap race
// condition" known limitation. Fails closed (blocks the request) whenever
// this can't be verified — unreachable api-server, a non-OK response, or a
// production deployment missing its env vars — since this is the last line
// of defense against unmetered OpenAI cost and silently allowing requests
// through defeats the point of having it. The tradeoff is availability: any
// api-server trouble now takes the chatbot down instead of quietly running
// with no cost protection.
export async function dailyBudgetExceeded() {
  if (misconfiguredInProduction()) {
    console.error('[apiServer] production deployment missing api-server env vars — failing closed on daily budget check.')
    return true
  }
  if (!configured()) return false
  try {
    const res = await fetch(`${process.env.API_SERVER_URL}/internal/chat-daily-budget`, {
      method: 'GET',
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) {
      console.error(`[apiServer] chat-daily-budget check returned ${res.status} — failing closed.`)
      return true
    }
    const { tokens_used } = await res.json()
    return tokens_used >= DAILY_TOKEN_BUDGET
  } catch (err) {
    console.error('[apiServer] dailyBudgetExceeded check failed, failing closed:', err.message)
    return true
  }
}

// Adds this turn's real (not estimated) token usage to today's site-wide
// total — api-server does the atomic increment.
export async function addToDailyBudget(tokens) {
  if (!configured() || !tokens || tokens <= 0) return
  try {
    await fetch(`${process.env.API_SERVER_URL}/internal/chat-daily-budget`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
      body: JSON.stringify({ tokens }),
      signal: AbortSignal.timeout(5_000),
    })
  } catch (err) {
    console.warn('[apiServer] addToDailyBudget failed:', err.message)
  }
}

// Layer 8: atomic, fixed-window (1 minute) request-rate check, site-wide
// rather than per-IP — see SECURITY.md for why. api-server does the atomic
// increment; this just compares the returned count against our own limit.
// Fails closed for the same reason dailyBudgetExceeded() does above.
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
