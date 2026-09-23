import { validateApiServerKey, getDraft } from '../../../lib/apiServer.js'
import { isAllowedOrigin } from '../../../lib/origin.js'

// Called on mount by ChatWidget if it finds a conversation ID in
// localStorage from a previous visit — rehydrates the round-tripped state
// (input/lead/missCount/hitCount) so a page refresh or a gap in
// connectivity doesn't lose an in-progress lead-capture flow. Always
// best-effort: any failure here just means the conversation starts fresh,
// same as a first-time visitor — never a hard error the widget has to
// handle specially.
export async function POST(request) {
  try {
    if (!isAllowedOrigin(request)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    const { conversationId } = await request.json()
    if (!conversationId || typeof conversationId !== 'string') {
      return Response.json({ found: false })
    }

    const validation = await validateApiServerKey()
    if (!validation.ok) {
      return Response.json({ found: false })
    }

    const state = await getDraft(validation.keyData, conversationId)
    if (!state) return Response.json({ found: false })

    return Response.json({ found: true, ...state })
  } catch (err) {
    console.error('[api/resume] error:', err)
    return Response.json({ found: false })
  }
}
