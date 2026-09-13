import { after } from 'next/server'
import { runTurn } from '../../../lib/orchestrator.js'
import {
  validateApiServerKey,
  reportTokenUsage,
  saveDraft,
  deleteDraft,
  dailyBudgetExceeded,
  addToDailyBudget,
  rateLimitExceeded,
} from '../../../lib/apiServer.js'
import { isAllowedOrigin } from '../../../lib/origin.js'
import { estimateTokens } from '../../../lib/tokenEstimate.js'
import {
  MAX_MESSAGE_TOKENS,
  MAX_INPUT_TOKENS,
  FIXED_CALL_OVERHEAD_TOKENS,
  MAX_CONVERSATION_TURNS,
} from '../../../lib/config.js'

// A capped turn still needs to shape-match a normal successful reply so the
// widget renders it as an ordinary chat message — no widget-side changes
// needed to show any of SECURITY.md's caps tripping. See SECURITY.md's
// "what a visitor sees when a cap trips" note.
function cappedReply(replyText, input, lead, missCount, hitCount) {
  return Response.json({ reply: replyText, input, lead, missCount, hitCount })
}

export async function POST(request) {
  try {
    if (!isAllowedOrigin(request)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    // Layers 7-8 (SECURITY.md): cheapest possible rejections, checked before
    // any other work — no-ops when api-server isn't configured (apiServer.js).
    // Independent api-server calls, run concurrently rather than
    // back-to-back so a configured deployment doesn't pay two sequential
    // round-trips on every single request.
    const [isRateLimited, isBudgetExceeded] = await Promise.all([rateLimitExceeded(), dailyBudgetExceeded()])
    if (isRateLimited) {
      return Response.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 })
    }
    if (isBudgetExceeded) {
      return Response.json(
        { error: "We've reached today's chat capacity. Please try again tomorrow, or contact us directly." },
        { status: 503 },
      )
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

    // Layer 2: reject an oversized visitor message before spending
    // anything on it — cheapest of the per-request checks.
    if (message && estimateTokens(message) > MAX_MESSAGE_TOKENS) {
      return cappedReply(
        "That message is a bit long for this chat — could you break it into a shorter question?",
        input, lead, missCount, hitCount,
      )
    }

    // Layer 4: the client-supplied `input` (resent conversation history) is
    // otherwise fully trusted — bound its size, alongside the fixed
    // prompt/tool-schema overhead every call also carries, so a forged,
    // oversized history can't be submitted in a single request. Includes
    // the new message's own size too — orchestrator.js appends it to
    // `input` before the actual OpenAI call, so leaving it out here let the
    // real first-call input exceed MAX_INPUT_TOKENS by up to a message's
    // worth even when each check passed individually.
    if (estimateTokens(input) + estimateTokens(message || '') + FIXED_CALL_OVERHEAD_TOKENS > MAX_INPUT_TOKENS) {
      return cappedReply(
        "This conversation has grown too large to continue — let's start a fresh chat.",
        input, lead, missCount, hitCount,
      )
    }

    // Layer 5: hard per-conversation turn limit, enforced server-side — the
    // widget's own send-pacing (ChatWidget.jsx's queue) is UX, not
    // enforcement, since nothing requires a request to come from the widget.
    // Excludes orchestrator.js's TEST-ONLY inactivity-timer triggers, which
    // are appended to `input` with role: 'user' too (see
    // TEST_TRIGGER_INSTRUCTIONS in orchestrator.js) even though the visitor
    // didn't actually say anything — counting those would let a genuinely
    // idle visitor's session hit the cap purely from bot-initiated nudges.
    const turnsSoFar = input.filter(
      item => item.role === 'user' && !String(item.content).startsWith('[TEST TRIGGER'),
    ).length
    if (turnsSoFar >= MAX_CONVERSATION_TURNS) {
      return cappedReply(
        "We've covered a lot in this chat! For anything else, a consultant would be happy to help directly.",
        input, lead, missCount, hitCount,
      )
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
      // Layer 7: the actual (not estimated) tokens this turn used, added
      // atomically to today's shared total — see apiServer.js.
      await addToDailyBudget(tokensUsed)
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
