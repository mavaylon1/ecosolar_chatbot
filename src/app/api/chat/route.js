import { runTurn } from '../../../lib/orchestrator.js'

// Rejects any request whose Origin doesn't match our own deployed domain —
// stops someone from calling this API directly, bypassing the widget/iframe
// entirely. Only a stranger hitting this endpoint straight (skipping our
// own /embed page) gets blocked here — the widget's own calls, made from
// inside the iframe we serve, always carry our own origin. See
// DEPLOYMENT.md item #4 for the full write-up (problem, fix, and the
// two-hop request flow this sits in front of).
//
// SITE_ORIGIN is unset in local dev on purpose, so this is a no-op locally —
// same pattern as ALLOWED_EMBED_ORIGINS in next.config.mjs.
function isAllowedOrigin(request) {
  const expected = process.env.SITE_ORIGIN
  if (!expected) return true // not configured yet — allow everything (dev)

  const origin = request.headers.get('origin')
  return origin === expected
}

export async function POST(request) {
  try {
    if (!isAllowedOrigin(request)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const body = await request.json()
    const { input = [], lead = {}, missCount = 0, hitCount = 0, message } = body

    if (!message || typeof message !== 'string') {
      return Response.json({ error: 'message is required' }, { status: 400 })
    }

    const result = await runTurn({ input, lead, missCount, hitCount, userMessage: message })
    return Response.json(result)
  } catch (err) {
    console.error('[api/chat] error:', err)
    return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
