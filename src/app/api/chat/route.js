import { after } from 'next/server'
import { runTurn } from '../../../lib/orchestrator.js'
import { validateApiServerKey, reportTokenUsage, saveDraft, deleteDraft } from '../../../lib/apiServer.js'
import { isAllowedOrigin } from '../../../lib/origin.js'

export async function POST(request) {
  try {
    if (!isAllowedOrigin(request)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Gate every OpenAI call behind api-server, the same handshake
    // widget-server already uses for its own OpenAI usage (see
    // DEPLOYMENT.md item #12) — no valid key, no chat. A no-op locally when
    // API_SERVER_URL isn't configured (see apiServer.js).
    const validation = await validateApiServerKey()
    if (!validation.ok) {
      return Response.json({ error: validation.error }, { status: validation.status })
    }

    const body = await request.json()
    const { input = [], lead = {}, missCount = 0, hitCount = 0, message, conversationId, trigger } = body

    // `trigger` lets the client fire a turn with no real visitor message —
    // currently only 'timer_test', a TEST-ONLY 5-second inactivity timer
    // that proactively prompts lead capture (see ChatWidget.jsx). Real
    // visitor messages still require `message`; a trigger call doesn't.
    if (!trigger && (!message || typeof message !== 'string')) {
      return Response.json({ error: 'message is required' }, { status: 400 })
    }

    const wasSaved = Boolean(lead._saved)
    const { tokensUsed, ...result } = await runTurn({ input, lead, missCount, hitCount, userMessage: message, keyData: validation.keyData, trigger })

    // Scheduled via Next's after() rather than left as a bare unawaited
    // call — never blocks the reply, but unlike a plain fire-and-forget
    // promise, is actually guaranteed to run: Vercel is free to freeze this
    // function the instant the response is sent, which can silently kill an
    // in-flight, un-awaited request before it completes. after() keeps the
    // invocation alive for exactly this work.
    after(async () => {
      await reportTokenUsage(validation.keyData, tokensUsed)
    })

    // Mid-conversation checkpoint: while the lead isn't saved yet, keep the
    // draft current after every turn so a refresh or dropped connection can
    // resume from here (see api/resume/route.js). The instant it becomes
    // saved, delete the draft once (on the transition turn only) —
    // appointment_leads is the durable record now.
    if (conversationId && typeof conversationId === 'string') {
      if (result.lead?._saved) {
        if (!wasSaved) {
          after(async () => { await deleteDraft(validation.keyData, conversationId) })
        }
      } else {
        after(async () => {
          await saveDraft(validation.keyData, conversationId, {
            input: result.input, lead: result.lead, missCount: result.missCount, hitCount: result.hitCount,
          })
        })
      }
    }

    return Response.json(result)
  } catch (err) {
    console.error('[api/chat] error:', err)
    return Response.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
