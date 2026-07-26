// Run manually whenever the docs in src/data/docs/ change: `npm run ingest`
// Reads the markdown docs, splits them into one chunk per heading, embeds
// each chunk with OpenAI, and writes the result to src/data/embeddings/faq-embeddings.json.
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { EMBEDDING_MODEL } from '../lib/config.js'

const ROOT = path.dirname(fileURLToPath(import.meta.url)) + '/..'

function loadEnvLocal() {
  // .env.local lives at the repo root, one level above src/.
  const envPath = path.join(ROOT, '..', '.env.local')
  if (!fs.existsSync(envPath)) return
  for (const line of fs.readFileSync(envPath, 'utf-8').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq === -1) continue
    const key = trimmed.slice(0, eq).trim()
    const value = trimmed.slice(eq + 1).trim()
    if (!(key in process.env)) process.env[key] = value
  }
}

loadEnvLocal()

const DOCS_DIR = path.join(ROOT, 'data', 'docs')
const OUTPUT_PATH = path.join(ROOT, 'data', 'embeddings', 'faq-embeddings.json')

function chunkMarkdown(source, text) {
  // Split on "## " headings — each doc file is already organized as one
  // heading per FAQ or per section, so this is a near-free operation.
  const sections = text.split(/\n(?=## )/).map(s => s.trim()).filter(Boolean)
  return sections
    .filter(s => s.startsWith('## '))
    .map(section => {
      const firstNewline = section.indexOf('\n')
      const heading = section.slice(3, firstNewline === -1 ? undefined : firstNewline).trim()
      const body = firstNewline === -1 ? '' : section.slice(firstNewline + 1).trim()
      return { source, heading, text: `${heading}\n${body}` }
    })
}

async function embedBatch(texts) {
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
  })
  if (!res.ok) {
    const errBody = await res.text()
    throw new Error(`Embeddings request failed (${res.status}): ${errBody}`)
  }
  const data = await res.json()
  // data.data is returned in the same order as the input array
  return data.data.map(d => d.embedding)
}

async function main() {
  if (!process.env.OPENAI_API_KEY) {
    console.error('OPENAI_API_KEY not set — check .env.local at the repo root')
    process.exit(1)
  }

  const files = fs.readdirSync(DOCS_DIR).filter(f => f.endsWith('.md'))
  let chunks = []
  for (const file of files) {
    const text = fs.readFileSync(path.join(DOCS_DIR, file), 'utf-8')
    chunks = chunks.concat(chunkMarkdown(file, text))
  }

  console.log(`Chunked ${files.length} doc(s) into ${chunks.length} chunks. Embedding...`)

  const embeddings = await embedBatch(chunks.map(c => c.text))

  const output = chunks.map((chunk, i) => ({
    id: `${chunk.source}#${i}`,
    source: chunk.source,
    heading: chunk.heading,
    text: chunk.text,
    embedding: embeddings[i],
  }))

  fs.mkdirSync(path.dirname(OUTPUT_PATH), { recursive: true })
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2))

  console.log(`Wrote ${output.length} embedded chunks to ${path.relative(ROOT, OUTPUT_PATH)}`)
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
