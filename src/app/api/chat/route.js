import { after } from 'next/server'
import { runTurn, TurnFailedError } from '../../../lib/orchestrator.js'
import {
  validateApiServerKey,
  reportTokenUsage,
  saveDraft,
  deleteDraft,
  reserveDailyBudget,
  settleDailyBudget,
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

    // Layer 8 (SECURITY.md): cheapest possible rejection, checked before any
    // other work — a no-op when api-server isn't configured (apiServer.js).
    // Layer 7's budget check used to run here too (concurrently, via
    // Promise.all) but now happens later, right before runTurn() — see the
    // reserveDailyBudget() call below for why.
    if (await rateLimitExceeded()) {
      return Response.json({ error: 'Too many requests. Please wait a moment and try again.' }, { status: 429 })
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

    // Layer 7 (SECURITY.md): atomically reserve this turn's worst-case cost
    // against today's shared budget before doing any actual OpenAI work —
    // checked here rather than up at the top with Layer 8, since layers
    // 2/4/5 above already filter out most rejections for free; this one
    // costs a real database round-trip, so it only runs for requests that
    // would otherwise actually reach OpenAI. See apiServer.js's
    // reserveDailyBudget() for why this replaced a plain read-only check.
    if (!(await reserveDailyBudget())) {
      return Response.json(
        { error: 'We will return tomorrow to answer any of your questions.' },
        { status: 503 },
      )
    }

    const wasSaved = Boolean(lead._saved)
    let tokensUsed = 0
    let result
    try {
      ;({ tokensUsed, ...result } = await runTurn({ input, lead, missCount, hitCount, userMessage: message, keyData: validation.keyData, trigger }))
    } catch (err) {
      // A TurnFailedError carries whatever tokensUsed the turn had already
      // accumulated from earlier, successfully-paid-for rounds before the
      // failure (see orchestrator.js) — recovered here so the finally
      // block below settles/reports the real partial cost instead of
      // silently losing it. Re-thrown so the outer catch still logs it and
      // returns the normal 500.
      if (err instanceof TurnFailedError) tokensUsed = err.tokensUsed
      throw err
    } finally {
      // Settles the reservation above back down to the turn's real cost,
      // and reports that same real cost to api-server's per-key usage
      // tracking — both must run whether runTurn() succeeded, failed
      // cleanly, or failed partway through (see the catch above), or a
      // failed turn would either leak its reservation permanently or lose
      // track of real spend it already incurred. Scheduled via Next's
      // after() rather than left as a bare unawaited call — never blocks
      // the reply, but unlike a plain fire-and-forget promise, is actually
      // guaranteed to run: Vercel is free to freeze this function the
      // instant the response is sent, which can silently kill an
      // in-flight, un-awaited request before it completes.
      after(async () => {
        await settleDailyBudget(tokensUsed)
        await reportTokenUsage(validation.keyData, tokensUsed)
      })
    }

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
