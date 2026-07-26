import { NAVY } from '../components/ChatWidget/theme.js'

// This is NOT the demo — the demo lives in the standalone demo/ folder at the
// repo root, which iframes /embed/ecosolarusa exactly like a real client site
// would (see demo/README.md). This root page just orients anyone who lands
// on the bare app: what this service is and where the actual pieces are.
export default function Home() {
  return (
    <div style={{ maxWidth: 640, margin: '0 auto', padding: '60px 24px', color: '#1c2230' }}>
      <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: NAVY, marginBottom: 10 }}>
        EcoSolar USA — chatbot service
      </div>
      <h1 style={{ fontSize: 28, margin: '0 0 12px' }}>This is the backend, not the demo</h1>
      <p style={{ color: '#5b6270', maxWidth: 520, lineHeight: 1.6 }}>
        This app serves the chat widget and its API. The widget itself renders at{' '}
        <code>/embed/ecosolarusa</code> — that's the page a client's site iframes.
        To see the widget the way a visitor would encounter it on a real page, run
        the standalone demo in the <code>demo/</code> folder at the repo root — it
        doesn't share any code with this app, it just iframes the embed route above,
        the same way a real client integration would.
      </p>
    </div>
  )
}
