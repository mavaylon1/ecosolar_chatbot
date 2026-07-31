import { CHAT_MODEL } from './config.js'

// The Responses-API `input` array is heterogeneous: plain user turns are
// `{ role: 'user', content: 'string' }` (see orchestrator.js's runTurn),
// assistant turns echoed back from a prior `output` are
// `{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }`,
// and tool-call bookkeeping items (function_call/function_call_output) have
// no role at all and are skipped here — only human-readable turns matter
// for a summary.
function extractTranscriptText(input) {
  return (input || [])
    .filter(item => item.role === 'user' || item.role === 'assistant')
    .map(item => {
      const text = typeof item.content === 'string'
        ? item.content
        : (item.content || []).map(part => part.text || '').join('')
      return text ? `${item.role}: ${text}` : null
    })
    .filter(Boolean)
    .join('\n')
}

// A separate OpenAI call from the normal chat turns (DEPLOYMENT.md item #10) —
// produces a short summary for a human consultant to scan before following up
// with a saved lead. Throws on failure so the caller can fall back to saving
// the lead without a summary rather than losing the lead entirely.
export async function summarizeConversation(transcript) {
  const text = extractTranscriptText(transcript)
  if (!text.trim()) return null

  const res = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: CHAT_MODEL,
      instructions:
        'Summarize this customer-service conversation in 2-4 sentences for a ' +
        'solar sales consultant about to follow up with this lead. Focus on ' +
        'what the visitor is interested in, any concerns they raised, and ' +
        'anything notable for the follow-up call. Plain text, no headers or ' +
        'bullet points.',
      input: text,
    }),
    signal: AbortSignal.timeout(20_000),
  })

  if (!res.ok) {
    throw new Error(`OpenAI summarize failed: ${res.status} ${await res.text()}`)
  }

  const data = await res.json()
  const messageItem = (data.output || []).find(item => item.type === 'message')
  const parts = messageItem?.content || []
  const summary = parts.filter(p => p.type === 'output_text').map(p => p.text).join('').trim()
  return summary || null
}
