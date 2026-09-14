// Rough token-count estimate (characters / 4) for enforcing the abuse-
// protection caps in SECURITY.md. This app has no tokenizer dependency —
// an estimate is precise enough for a cap check; it doesn't need to match
// OpenAI's actual billed count exactly, just stay in the right ballpark
// and err conservative (rounding up).
export function estimateTokens(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value ?? '')
  return Math.ceil(text.length / 4)
}
