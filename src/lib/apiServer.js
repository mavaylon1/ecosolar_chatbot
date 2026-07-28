// Talks to api-server's /internal/* endpoints — the same handshake
// widget-server already uses for its own OPENAI_API_KEY usage (see
// servers_vercel/widget-server/api/proxy/concierge.js for the reference
// implementation this mirrors). See DEPLOYMENT.md item #12.
//
// All three functions below are no-ops (permissive for validate, silent
// no-op for report/save) when API_SERVER_URL isn't configured — same
// leave-unset-locally convention as SITE_ORIGIN/ALLOWED_EMBED_ORIGINS, so
// local dev never needs a live api-server/Neon connection.

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

// Stores a confirmed lead's contact info in api-server's appointment_leads
// table (piece 1 of DEPLOYMENT.md item #10 — the summary-email and
// company-alert pieces are still open, not built here). Throws on failure
// so the caller (leadCapture.js) can fall back to its own console.log stub —
// this must fail independently and never crash the conversation.
export async function saveLead(keyData, { name, email, phone }) {
  if (!configured()) throw new Error('api-server not configured')
  const res = await fetch(`${process.env.API_SERVER_URL}/internal/leads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-internal-secret': process.env.INTERNAL_SECRET },
    body: JSON.stringify({ key_id: keyData?.key_id, user_id: keyData?.user_id, name, email, phone }),
    signal: AbortSignal.timeout(8_000),
  })
  if (!res.ok) throw new Error(`api-server /internal/leads returned ${res.status}`)
}
