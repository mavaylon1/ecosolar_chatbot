'use client'

import { useState, useRef, useEffect } from 'react'
import Bubble from './Bubble.jsx'
import TypingDots from './TypingDots.jsx'
import { NAVY, NAVY_DARK, SURFACE, BORDER, TEXT_ON_SURFACE, RADIUS_PANEL, RADIUS_PILL } from './theme.js'

const GREETING = 'Welcome to EcoSolar USA. Let me know if there are any questions I can answer for you?'
const CONVERSATION_ID_KEY = 'truvala_ecosolar_conversation_id'

// TEST-ONLY: both shown/appended directly, no model involved — see the
// post-confirmation timer below for why the warning specifically is plain
// static text rather than a model-generated reply.
const SESSION_WARNING_TEXT = 'The session will end in 60 seconds if no response is sent.'
const SESSION_ENDED_TEXT = 'Session ended. Feel free to ask more questions here to start a new session.'

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

  // TEST-ONLY: countdowns that (re)start every time the bot finishes
  // replying and stop the moment the visitor sends another message. Scaled-
  // down stand-in for the fuller design in DEPLOYMENT.md item #11 — not
  // that design, just enough to prove the mechanisms work:
  //   - Before lead capture starts: 30s of silence → bot proactively
  //     invites the visitor into lead capture. Hard-triggered, not prompt
  //     engineering — orchestrator.js forces the submit_appointment_info
  //     tool call specifically on this turn, so it can't just be skipped.
  //   - After the visitor confirms their info: two-stage. 60s of silence →
  //     a plain warning message appended directly here, no model involved
  //     at all (nothing for prompt wording to get wrong when the text never
  //     changes). 120s → bot ends the conversation with a polite goodbye
  //     (the model still writes this one line — tone is legitimately its
  //     job), then code deterministically appends SESSION_ENDED_TEXT and
  //     resets stateRef/conversationId/testTimerStartedRef, regardless of
  //     what the model said. Visible chat history is left on screen; only
  //     the backend round-trip state resets, so a later message starts a
  //     genuinely fresh conversation (and can trigger lead capture again)
  //     without the visitor losing their on-screen history.
  //   - In between (lead capture started but not confirmed): no timer —
  //     nudging further would just interrupt the visitor mid-flow.
  //
  // FIXED BUG: this used to fire its own independent fetch() on expiry,
  // completely bypassing the visitor-message queue below — which exists
  // specifically to guarantee requests never run concurrently against the
  // same stateRef. When a countdown expired at nearly the same moment a
  // real message was sent, both fired at once from the same stale prior
  // state, producing two racing, uncoordinated replies (one of them stale/
  // wrong), and the two independently-owned `loading` toggles corrupted the
  // next countdown's timing. Fix: a timer's expiry now pushes into the same
  // queue as real messages (queueTimerTrigger below) instead of calling out
  // on its own — see queueRef's comment for why that queue exists at all.
  const testTimerIntervalRef = useRef(null)
  const testTimerStartedRef = useRef(false) // true once the visitor has sent at least one message this session

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

  // Things waiting to be sent to /api/chat — either a plain string (a real
  // visitor message) or a `{ trigger }` object (a TEST-ONLY timer firing).
  // Each API call depends on the *previous* response's state (stateRef), so
  // requests can't just fire concurrently or they'd race and corrupt that
  // state — this queue is what makes that impossible, for either kind of
  // entry, by construction rather than by hoping two things don't collide.
  // sendMessage/queueTimerTrigger always return immediately (the visitor can
  // keep typing no matter what), and a single background loop drains this
  // queue strictly one entry at a time.
  const queueRef = useRef([])
  const processingRef = useRef(false)

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [displayMessages, loading])

  // TEST-ONLY: the countdowns' actual start/stop logic. Runs whenever
  // `loading` changes — `loading` transitions to `true` the instant the
  // visitor sends a message (stop any running countdown, a reply is now
  // pending) and back to `false` once the bot's reply has come back, at
  // which point this decides which countdown (if any) should now run,
  // based on where the lead currently stands.
  useEffect(() => {
    clearInterval(testTimerIntervalRef.current)

    if (loading || !testTimerStartedRef.current) return

    const lead = stateRef.current.lead || {}
    const leadCaptureStarted = Object.keys(lead).length > 0
    const confirmed = Boolean(lead.identityConfirmed)

    if (confirmed) {
      console.log('[test-timer] starting 120s countdown (timer_goodbye, warning at 60s)')
      let elapsed = 0
      testTimerIntervalRef.current = setInterval(() => {
        elapsed += 1
        if (elapsed === 60) {
          console.log('[test-timer] 60s reached — showing session-ending warning')
          setDisplayMessages(prev => [...prev, { role: 'assistant', text: SESSION_WARNING_TEXT }])
        } else if (elapsed >= 120) {
          clearInterval(testTimerIntervalRef.current)
          console.log('[test-timer] expired — queueing timer_goodbye')
          queueTimerTrigger('timer_goodbye')
        }
      }, 1000)
      return () => clearInterval(testTimerIntervalRef.current)
    }

    if (!leadCaptureStarted) {
      console.log('[test-timer] starting 30s countdown (timer_lead_prompt)')
      let secondsLeft = 30
      testTimerIntervalRef.current = setInterval(() => {
        secondsLeft -= 1
        if (secondsLeft <= 0) {
          clearInterval(testTimerIntervalRef.current)
          console.log('[test-timer] expired — queueing timer_lead_prompt')
          queueTimerTrigger('timer_lead_prompt')
        }
      }, 1000)
      return () => clearInterval(testTimerIntervalRef.current)
    }

    // Lead capture is mid-flow (started, not yet confirmed) — no timer.
  }, [loading])

  async function processQueue() {
    processingRef.current = true
    while (queueRef.current.length > 0) {
      const next = queueRef.current.shift()
      // Two shapes share this queue: a plain string (real visitor message)
      // or a `{ trigger }` object (TEST-ONLY timer firing) — this is exactly
      // what makes the two impossible to race against each other, since
      // both now flow through this single, strictly sequential loop.
      const isTrigger = next !== null && typeof next === 'object' && 'trigger' in next
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...stateRef.current,
            ...(isTrigger ? { trigger: next.trigger } : { message: next }),
            conversationId: conversationIdRef.current,
          }),
        })
        const data = await res.json()

        if (!res.ok) throw new Error(data.error || 'Request failed')

        if (isTrigger) console.log(`[test-timer] ${next.trigger} reply received:`, data.reply)
        stateRef.current = { input: data.input, lead: data.lead, missCount: data.missCount, hitCount: data.hitCount }
        setDisplayMessages(prev => [...prev, { role: 'assistant', text: data.reply }])

        if (isTrigger && next.trigger === 'timer_goodbye') {
          // Deterministic, code-guaranteed session end — not left to the
          // model's reply. Visible chat history stays on screen; only the
          // backend round-trip state resets, so the model has no memory of
          // this conversation if the visitor asks something new, and the
          // countdown mechanism goes fully dormant (testTimerStartedRef)
          // until a real message re-arms it.
          setDisplayMessages(prev => [...prev, { role: 'assistant', text: SESSION_ENDED_TEXT }])
          stateRef.current = { input: [], lead: {}, missCount: 0, hitCount: 0 }
          testTimerStartedRef.current = false
          try { localStorage.removeItem(CONVERSATION_ID_KEY) } catch {}
          conversationIdRef.current = null
        } else if (data.lead?._saved) {
          // The lead is now durably saved server-side (appointment_leads) —
          // the draft checkpoint was already deleted on the api-server side
          // this same turn (see api/chat/route.js), so drop our own reference
          // to it too rather than keep resuming into a row that no longer exists.
          try { localStorage.removeItem(CONVERSATION_ID_KEY) } catch {}
          conversationIdRef.current = null
        }
      } catch (err) {
        // A failed trigger stays silent to the visitor — it's a background
        // nudge they never asked for — but still worth knowing about.
        if (isTrigger) {
          console.log(`[test-timer] ${next.trigger} request failed:`, err.message)
        } else {
          setDisplayMessages(prev => [...prev, { role: 'assistant', text: "Sorry, something went wrong — mind trying that again?" }])
        }
      }
    }
    processingRef.current = false
    setLoading(false)
  }

  // TEST-ONLY: fires when either countdown above reaches 0. Mirrors
  // sendMessage's enqueue-and-return-immediately shape exactly, just with a
  // `{ trigger }` object instead of a string — see orchestrator.js for how
  // the backend turns each trigger name into a specific instruction
  // ('timer_lead_prompt' → proactively invite lead capture, 'timer_goodbye'
  // → end the conversation politely). Routed through the same queue as real
  // visitor messages so the two can never race against stateRef (see
  // queueRef's comment) — this used to fire its own independent fetch(),
  // which was the actual bug.
  function queueTimerTrigger(trigger) {
    queueRef.current.push({ trigger })
    setLoading(true)
    if (!processingRef.current) processQueue()
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

    // TEST-ONLY: marks that the countdown is now eligible to run — the
    // actual start/stop happens in the `loading`-watching effect above,
    // which will see `loading` flip to `true` right below and stop any
    // countdown in progress, then start a fresh one once the reply lands.
    testTimerStartedRef.current = true

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
            bottom: 72,
            right: 18,
            width: 315,
            height: 465,
            maxHeight: 'calc(100vh - 105px)',
            background: SURFACE,
            borderRadius: RADIUS_PANEL,
            boxShadow: '0 15px 38px rgba(28, 43, 74, 0.22)',
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            zIndex: 1000,
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
          }}
        >
          {/* Header */}
          <div style={{ background: NAVY, color: '#fff', padding: '12px 15px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontWeight: 700, fontSize: 12 }}>EcoSolar USA</div>
              <div style={{ fontSize: 10, opacity: 0.75 }}>Usually replies in a few seconds</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="Close chat"
              style={{ background: 'transparent', border: 'none', color: '#fff', fontSize: 15, cursor: 'pointer', lineHeight: 1, padding: 3 }}
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div style={{ flex: 1, overflowY: 'auto', padding: '14px 12px 3px', background: SURFACE }}>
            {displayMessages.map((m, i) => (
              <Bubble key={i} role={m.role} text={m.text} />
            ))}
            {loading && <TypingDots />}
            <div ref={scrollRef} />
          </div>

          {/* Input */}
          <div style={{ borderTop: `1px solid ${BORDER}`, padding: 9, display: 'flex', gap: 6, background: SURFACE }}>
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
                padding: '9px 14px',
                fontSize: 14,
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
                padding: '9px 17px',
                fontSize: 13,
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
          bottom: 18,
          right: 18,
          width: 44,
          height: 44,
          borderRadius: '50%',
          background: open ? NAVY_DARK : NAVY,
          border: 'none',
          boxShadow: '0 6px 18px rgba(28, 43, 74, 0.35)',
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          zIndex: 1001,
          transition: 'background 0.15s, transform 0.15s',
        }}
      >
        {open ? (
          <span style={{ color: '#fff', fontSize: 20, lineHeight: 1 }}>×</span>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
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
