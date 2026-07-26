import { fileURLToPath } from 'node:url'

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Pin the tracing root to this project. This repo now stands alone (moved
  // out of truvala_widgets, its own git remote), but the parent directory
  // (/Users/matchu/truvala/) has its own package.json/package-lock.json and
  // several unrelated sibling projects — without this, Next would try to
  // infer a workspace root and could get confused by that ancestor lockfile.
  outputFileTracingRoot: fileURLToPath(new URL('.', import.meta.url)),

  // Dev-only floating indicator Next.js normally injects — disabled since it
  // visually collides with the widget's own floating icon during local
  // testing. Never appears in a production build regardless of this setting.
  devIndicators: false,

  // Restricts which outside websites are allowed to put /embed/[clientId] in
  // an iframe (CSP frame-ancestors) — see DEPLOYMENT.md item #3. The real
  // domain list isn't known yet, so it's read from an env var rather than
  // hardcoded: set ALLOWED_EMBED_ORIGINS in Vercel once the production (and
  // staging, if any) domains are decided — no code change needed at that
  // point, just filling in that one setting. Left unset in local dev on
  // purpose: if it's not set, no header gets added at all, so demo/index.html
  // keeps working with no restriction, exactly like it does today.
  async headers() {
    const allowedOrigins = process.env.ALLOWED_EMBED_ORIGINS
    if (!allowedOrigins) return []

    return [
      {
        source: '/embed/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: `frame-ancestors ${allowedOrigins.split(',').map(o => o.trim()).join(' ')}`,
          },
        ],
      },
    ]
  },
}

export default nextConfig
