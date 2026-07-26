import { SEARCH_DOCS_TOOL_DEF, executeSearchDocs } from './searchDocs.js'
import { SUBMIT_APPOINTMENT_INFO_TOOL_DEF, executeLeadCapture } from './leadCapture.js'

export const TOOL_DEFS = [SEARCH_DOCS_TOOL_DEF, SUBMIT_APPOINTMENT_INFO_TOOL_DEF]

// Executes one tool call and returns { resultText, nextState }.
// `state` is { lead, missCount, hitCount } — round-tripped from the client each turn.
// Dispatches by name to the two tool implementations, which live in their own
// files — see README.md in this folder for what each one owns.
export async function executeTool(name, args, state) {
  if (name === 'search_company_docs') return executeSearchDocs(args, state)
  if (name === 'submit_appointment_info') return executeLeadCapture(args, state)
  throw new Error(`Unknown tool: ${name}`)
}
