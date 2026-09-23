// Rejects any request whose Origin doesn't match this app's own origin (or
// an explicitly-configured extra one) — stops someone from calling our API
// routes directly, bypassing the widget/iframe entirely. See
// DEPLOYMENT.md item #4 for the full write-up.
//
// SITE_ORIGIN is unset in local dev on purpose, so this is a no-op locally —
// same pattern as ALLOWED_EMBED_ORIGINS in next.config.mjs.
//
// Once SITE_ORIGIN *is* set (production), same-origin requests are always
// allowed regardless of which URL this deployment is actually reached at —
// same bug class as next.config.mjs's CSP 'self' fix: a real request from
// this app's own /embed or demo pages always has an Origin equal to
// whatever URL is currently serving them (production alias, a git-branch
// URL, a per-deployment preview URL — Vercel hands out several valid URLs
// for the same deployment), so comparing against one fixed string broke on
// every URL besides whichever one SITE_ORIGIN happened to name. Comparing
// against the request's own host needs no enumeration at all — SITE_ORIGIN
// becomes an *additional* explicit allowance on top (comma-separated, same
// shape as ALLOWED_EMBED_ORIGINS), for a genuinely different origin that
// isn't this deployment itself.
export function isAllowedOrigin(request) {
  const configured = process.env.SITE_ORIGIN
  if (!configured) return true // not configured yet — allow everything (dev)

  const origin = request.headers.get('origin')
  if (!origin) return false

  const selfOrigin = request.nextUrl.origin
  const extraAllowed = configured.split(',').map(o => o.trim())
  return origin === selfOrigin || extraAllowed.includes(origin)
}
