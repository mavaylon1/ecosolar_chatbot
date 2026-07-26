import fs from 'node:fs'
import path from 'node:path'
import { EMBEDDING_MODEL, RAG_TOP_K, RAG_SIMILARITY_THRESHOLD } from '../config.js'

const EMBEDDINGS_PATH = path.join(process.cwd(), 'src', 'data', 'embeddings', 'faq-embeddings.json')

let chunksCache = null

function loadChunks() {
  if (!chunksCache) {
    chunksCache = JSON.parse(fs.readFileSync(EMBEDDINGS_PATH, 'utf-8'))
  }
  return chunksCache
}

// OpenAI's embeddings are pre-normalized to length 1, so a plain dot product
// is equivalent to cosine similarity — no need for the extra magnitude division.
function dotProduct(a, b) {
  let sum = 0
  for (let i = 0; i < a.length; i++) sum += a[i] * b[i]
  return sum
}

async function embedQuery(query) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: query }),
  })
  if (!res.ok) {
    throw new Error(`Embeddings request failed: ${res.status} ${await res.text()}`)
  }
  const data = await res.json()
  return data.data[0].embedding
}

// Returns the top matching doc chunks for a query, or an empty array if
// nothing clears the similarity threshold. See src/lib/rag/README.md for how
// the threshold was calibrated.
export async function searchCompanyDocs(query) {
  const chunks = loadChunks()
  const queryEmbedding = await embedQuery(query)

  const scored = chunks
    .map(chunk => ({ ...chunk, score: dotProduct(queryEmbedding, chunk.embedding) }))
    .sort((a, b) => b.score - a.score)

  // Logged regardless of threshold so a near-miss (or a false positive that
  // barely clears it) is visible after the fact, not just what got returned.
  const top = scored.slice(0, 6).map(c => `${c.score.toFixed(4)}${c.score >= RAG_SIMILARITY_THRESHOLD ? '*' : ''} ${c.heading}`)
  console.log(`[rag/search] "${query}" (threshold ${RAG_SIMILARITY_THRESHOLD}, * = cleared it):\n  ${top.join('\n  ')}`)

  return scored
    .filter(c => c.score >= RAG_SIMILARITY_THRESHOLD)
    .slice(0, RAG_TOP_K)
    .map(({ heading, text, score, source }) => ({ heading, text, score, source }))
}
