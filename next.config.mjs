import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the tracing root to this project. This repo now stands alone (moved
  // out of truvala_widgets, its own git remote), but the parent directory
  // (/Users/matchu/truvala/) has its own package.json/package-lock.json and
  // several unrelated sibling projects — without this, Next would try to
  // infer a workspace root and could get confused by that ancestor lockfile.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),

  // src/lib/rag/search.js reads this large (5.9MB) file at runtime via
  // fs.readFileSync with a dynamically-built path. Next's automatic file
  // tracing already includes it (verified via the deployed function's
  // filePathMap), so this is defense-in-depth, not a fix for anything
  // observed — explicit beats implicit for a file this size that every
  // /api/chat call depends on. The actual bug that broke this file in
  // production was unrelated to tracing: uploading it via the Vercel CLI
  // from a /mnt/c-mounted path under WSL silently corrupted it mid-file —
  // see TROUBLESHOOTING.md Issue 8.
  outputFileTracingIncludes: {
    '**': ['./src/data/embeddings/faq-embeddings.json'],
  },

  // Dev-only floating indicator Next.js normally injects — disabled since it
  // visually collides with the widget's own floating icon during local
  // testing. Never appears in a production build regardless of this setting.
  devIndicators: false,

  // Restricts which outside websites are allowed to put /embed/[clientId] in
  // an iframe (CSP frame-ancestors) — see DEPLOYMENT.md item #3. The real
  // domain list is read from an env var rather than hardcoded: set
  // ALLOWED_EMBED_ORIGINS in Vercel to the real customer domain(s) — no code
  // change needed there. Left unset in local dev on purpose: if it's not
  // set, no header gets added at all, so demo/index.html keeps working with
  // no restriction, exactly like it does today.
  //
  // 'self' is always included on top of whatever's in the env var —
  // discovered this was missing after ALLOWED_EMBED_ORIGINS got set to just
  // ecosolarusa.com on Vercel: src/app/page.jsx (the test/demo page) embeds
  // itself via a relative iframe src, and CSP frame-ancestors doesn't
  // implicitly allow same-origin framing once any value is specified — it
  // has to be listed explicitly, same as any other allowed origin. 'self'
  // resolves to whichever origin is actually serving the response, so this
  // keeps the demo page working on any deployment (a fresh preview URL,
  // production's stable alias, etc.) without ever needing to be
  // enumerated by hand, while ALLOWED_EMBED_ORIGINS stays scoped purely to
  // real external customer domains. It can never grant a third-party
  // domain permission — 'self' only ever matches the exact origin making
  // the request, so this doesn't weaken the actual protection (blocking
  // clickjacking from untrusted sites) at all.
  async headers() {
    const allowedOrigins = process.env.ALLOWED_EMBED_ORIGINS
    if (!allowedOrigins) return []

    const sources = ["'self'", ...allowedOrigins.split(',').map(o => o.trim())]

    return [
      {
        source: '/embed/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${sources.join(' ')}`,
          },
        ],
      },
    ]
  },
}

export default nextConfig
