// Rejects any request whose Origin doesn't match our own deployed domain —
// stops someone from calling our API routes directly, bypassing the
// widget/iframe entirely. See DEPLOYMENT.md item #4 for the full write-up.
//
// SITE_ORIGIN is unset in local dev on purpose, so this is a no-op locally —
// same pattern as ALLOWED_EMBED_ORIGINS in next.config.mjs.
export function isAllowedOrigin(request) {
  const expected = process.env.SITE_ORIGIN
  if (!expected) return true // not configured yet — allow everything (dev)

  const origin = request.headers.get('origin')
  return origin === expected
}
