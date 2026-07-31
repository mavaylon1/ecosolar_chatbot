'use client'

import { useState, useRef, useEffect } from 'react'
import Bubble from './Bubble.jsx'
import TypingDots from './TypingDots.jsx'
import { NAVY, NAVY_DARK, SURFACE, BORDER, TEXT_ON_SURFACE, RADIUS_PANEL, RADIUS_PILL } from './theme.js'

const GREETING = 'Welcome to EcoSolar USA. Let me know if there are any questions I can answer for you?'
const CONVERSATION_ID_KEY = 'truvala_ecosolar_conversation_id'

// Rebuilds a human-readable message list from a saved Responses-API `input`
// array (see lib/summarize.js for the same shape handling, server-side).
function extractDisplayMessages(input) {
  return (input || [])
    .filter(item => item.role === 'user' || item.role === 'assistant')
    .map(item => {
      const text = typeof item.content === 'string'
        ? item.content
        : (item.content || []).map(part => part.text || '').join('')
      return text ? { role: item.role, text } : null
    })
    .filter(Boolean)
}

// The actual floating-icon + chat-panel widget — this is the one and only
// place this UI is defined. It's rendered by app/embed/[clientId]/page.jsx
// (what a client's iframe points at) and nowhere else; the demo/ folder
// reaches this exact same code by iframing that same embed route, not by
// importing this component directly. See src/components/README.md.
export default function ChatWidget() {
  const [open, setOpen] = useState(false)
  const [displayMessages, setDisplayMessages] = useState([{ role: 'assistant', text: GREETING }])
  const [inputText, setInputText] = useState('')
  const [loading, setLoading] = useState(false)

  // Backend round-trip state — the server is stateless, so the browser is
  // the source of truth for conversation input, lead progress, and miss count.
  const stateRef = useRef({ input: [], lead: {}, missCount: 0, hitCount: 0 })
  const scrollRef = useRef(null)
  const inputRef = useRef(null)

  // Generated lazily on first message send (not on mount — an idle visitor
  // who never chats shouldn't get a localStorage entry). Persisted so a
  // page refresh or a fresh tab can resume the same conversation via
  // /api/resume, which api-server backs with a saved draft row.
  const conversationIdRef = useRef(null)

  // On mount, check for a conversation ID from a previous visit and try to
  // resume it — best-effort; any failure just means starting fresh, same as
  // any other new visitor.
  useEffect(() => {
    let savedId
    try { savedId = localStorage.getItem(CONVERSATION_ID_KEY) } catch { savedId = null }
    if (!savedId) return

    fetch('/api/resume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationId: savedId }),
    })
      .then(res => res.json())
      .then(data => {
        if (!data.found) return
        conversationIdRef.current = savedId
        stateRef.current = { input: data.input, lead: data.lead, missCount: data.missCount, hitCount: data.hitCount }
        const resumed = extractDisplayMessages(data.input)
        if (resumed.length > 0) setDisplayMessages([{ role: 'assistant', text: GREETING }, ...resumed])
      })
      .catch(() => {})
  }, [])

  // Messages the visitor has sent but that haven't been sent to /api/chat
  // yet — this is the actual queue. Each API call depends on the *previous*
  // response's state (stateRef), so requests can't just fire concurrently or
  // they'd race and corrupt that state. Instead, sendMessage always returns
  // immediately (the visitor can keep typing/sending no matter what), and a
  // single background loop drains this queue one request at a time.
  const queueRef = useRef([])
  const processingRef = useRef(false)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayMessages, loading])

  async function processQueue() {
    processingRef.current = true
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...stateRef.current, message: next, conversationId: conversationIdRef.current }),
        })
        const data = await res.json()

        if (!res.ok) throw new Error(data.error || 'Request failed')

        stateRef.current = { input: data.input, lead: data.lead, missCount: data.missCount, hitCount: data.hitCount }
        setDisplayMessages(prev => [...prev, { role: 'assistant', text: data.reply }])

        // The lead is now durably saved server-side (appointment_leads) —
        // the draft checkpoint was already deleted on the api-server side
        // this same turn (see api/chat/route.js), so drop our own reference
        // to it too rather than keep resuming into a row that no longer exists.
        if (data.lead?._saved) {
          try { localStorage.removeItem(CONVERSATION_ID_KEY) } catch {}
          conversationIdRef.current = null
        }
      } catch {
        setDisplayMessages(prev => [...prev, { role: 'assistant', text: "Sorry, something went wrong — mind trying that again?" }])
      }
    }
    processingRef.current = false
    setLoading(false)
  }

  // Never blocks on whether a request is already in flight — the visitor can
  // type and send at any point, including while the bot is still replying to
  // an earlier message. This only queues the message; processQueue is what
  // actually paces the network calls to the backend, one at a time, in order.
  function sendMessage(text) {
    const trimmed = text.trim()
    if (!trimmed) return

    if (!conversationIdRef.current) {
      const id = crypto.randomUUID()
      conversationIdRef.current = id
      try { localStorage.setItem(CONVERSATION_ID_KEY, id) } catch {}
    }

    setDisplayMessages(prev => [...prev, { role: 'user', text: trimmed }])
    setInputText('')
    queueRef.current.push(trimmed)
    setLoading(true)
    // Clicking "Send" with the mouse moves focus to the button; pull it back
    // to the input immediately so typing the next message never requires a
    // click, regardless of whether Enter or the button triggered this.
    inputRef.current?.focus()

    if (!processingRef.current) processQueue()
  }

  return (
    <>
      {/* Floating chat panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 96,
            right: 24,
            width: 420,
            height: 620,
            maxHeight: 'calc(100vh - 140px)',
            background: SURFACE,
            borderRadius: RADIUS_PANEL,
            boxShadow: '0 20px 50px rgba(28, 43, 74, 0.22)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 1000,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          {/* Header */}
          <div style={{ background: NAVY, color: '#fff', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 16 }}>EcoSolar USA</div>
              <div style={{ fontSize: 13, opacity: 0.75 }}>Usually replies in a few seconds</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 20, cursor: 'pointer', lineHeight: 1, padding: 4 }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '18px 16px 4px', background: SURFACE }}>
            {displayMessages.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.text} />
            ))}
            {loading && <TypingDots />}
            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <div style={{ borderTop: `1px solid ${BORDER}`, padding: 12, display: 'flex', gap: 8, background: SURFACE }}>
            <input
              ref={inputRef}
              value={inputText}
              onChange={e => setInputText(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') sendMessage(inputText) }}
              placeholder="Ask a question…"
              style={{
                flex: 1,
                border: `1px solid ${BORDER}`,
                borderRadius: RADIUS_PILL,
                padding: '12px 18px',
                fontSize: 18,
                outline: 'none',
                background: '#f7f8fa',
                color: TEXT_ON_SURFACE,
              }}
            />
            <button
              onClick={() => sendMessage(inputText)}
              disabled={!inputText.trim()}
              style={{
                background: NAVY,
                color: '#fff',
                border: 'none',
                borderRadius: RADIUS_PILL,
                padding: '12px 22px',
                fontSize: 17,
                fontWeight: 600,
                cursor: !inputText.trim() ? 'not-allowed' : 'pointer',
                opacity: !inputText.trim() ? 0.5 : 1,
              }}
            >
              Send
            </button>
          </div>
        </div>
      )}

      {/* Floating icon */}
      <button
        onClick={() => setOpen(o => !o)}
        aria-label={open ? 'Close chat' : 'Open chat'}
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          width: 58,
          height: 58,
          borderRadius: '50%',
          background: open ? NAVY_DARK : NAVY,
          border: 'none',
          boxShadow: '0 8px 24px rgba(28, 43, 74, 0.35)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
          transition: 'background 0.15s, transform 0.15s',
        }}
      >
        {open ? (
          <span style={{ color: '#fff', fontSize: 26, lineHeight: 1 }}>×</span>
        ) : (
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none">
            <path
              d="M4 5.5C4 4.67 4.67 4 5.5 4h13c.83 0 1.5.67 1.5 1.5v10c0 .83-.67 1.5-1.5 1.5H9l-4 3.5v-3.5H5.5C4.67 17 4 16.33 4 15.5v-10z"
              fill="#fff"
            />
          </svg>
        )}
      </button>
    </>
  )
}
