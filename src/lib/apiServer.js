// Talks to api-server's /internal/* endpoints — the same handshake
// widget-server already uses for its own OPENAI_API_KEY usage (see
// servers_vercel/widget-server/api/proxy/concierge.js for the reference
// implementation this mirrors). See DEPLOYMENT.md item #12.
//
// All three functions below are no-ops (permissive for validate, silent
// no-op for report/save) when API_SERVER_URL isn't configured — same
// leave-unset-locally convention as SITE_ORIGIN/ALLOWED_EMBED_ORIGINS, so
// local dev never needs a live api-server/Neon connection.

import { DAILY_TOKEN_BUDGET, RATE_LIMIT_PER_MINUTE } from './config.js'

function configured() {
  return Boolean(process.env.API_SERVER_URL && process.env.INTERNAL_SECRET && process.env.API_SERVER_KEY)
}

// Validates API_SERVER_KEY against api-server before any OpenAI call is
// allowed. Returns { ok: true, keyData } or { ok: false, status, error } —
// the caller blocks the request on ok: false.
export async function validateApiServerKey() {
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
// condition" known limitation. Fails open (allows the request) if
// api-server is unreachable, same as every other best-effort call here.
export async function dailyBudgetExceeded() {
  if (!configured()) return false
  try {
    const res = await fetch(`${process.env.API_SERVER_URL}/internal/chat-daily-budget`, {
      method: 'GET',
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return false
    const { tokens_used } = await res.json()
    return tokens_used >= DAILY_TOKEN_BUDGET
  } catch (err) {
    console.warn('[apiServer] dailyBudgetExceeded check failed, allowing request:', err.message)
    return false
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
export async function rateLimitExceeded() {
  if (!configured()) return false
  try {
    const res = await fetch(`${process.env.API_SERVER_URL}/internal/chat-rate-limit`, {
      method: 'POST',
      headers: { 'x-internal-secret': process.env.INTERNAL_SECRET },
      signal: AbortSignal.timeout(5_000),
    })
    if (!res.ok) return false
    const { request_count } = await res.json()
    return request_count > RATE_LIMIT_PER_MINUTE
  } catch (err) {
    console.warn('[apiServer] rateLimitExceeded check failed, allowing request:', err.message)
    return false
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
