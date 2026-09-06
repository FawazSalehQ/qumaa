/**
 * Optional LLM rerank over the local shortlist.
 *
 * This is the one feature that breaks the app's offline guarantee: the candidate
 * passages and the posting are sent to Anthropic. It is therefore off unless the
 * user supplies an API key and explicitly enables it, and the UI says plainly
 * what leaves the machine.
 *
 * Retrieval still decides who is considered. The model only reorders a shortlist
 * the local engine already produced, so a failure here degrades to the local
 * ranking rather than to nothing.
 */
import Anthropic from '@anthropic-ai/sdk'
import type { MatchResult } from '@shared/types.js'
import { mergeRerankedResults } from './rerankOrder.js'
import {
  prepareClaudeRerank,
  requestCandidateIndex,
  RERANK_LIMIT
} from './rerankPrivacy.js'

interface RerankOptions {
  apiKey: string
  jobDescription: string
  results: MatchResult[]
}

// These are deliberately explicit rather than SDK defaults. A process-level
// ANTHROPIC_BASE_URL or ANTHROPIC_LOG setting must never redirect a user's key
// or cause approved candidate evidence to be written to diagnostic logs.
const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com'
const ANTHROPIC_CLIENT_POLICY = {
  baseURL: ANTHROPIC_API_BASE_URL,
  logLevel: 'off' as const,
  fetchOptions: { redirect: 'error' as const }
}

/**
 * Returns the complete local result list with the shortlist window reordered;
 * entries the model ranked carry its reason.
 *
 * Throws on API failure so the caller can fall back to the local ranking and
 * tell the user, rather than silently presenting an unranked list as ranked.
 */
export async function rerank(opts: RerankOptions): Promise<MatchResult[]> {
  const shortlist = opts.results.slice(0, RERANK_LIMIT)
  if (shortlist.length <= 1) return opts.results

  const client = new Anthropic({ apiKey: opts.apiKey, ...ANTHROPIC_CLIENT_POLICY })
  const { sdkRequest } = prepareClaudeRerank(opts.jobDescription, opts.results)
  const response = await client.messages.parse(sdkRequest)

  const parsed = response.parsed_output
  if (!parsed) throw new Error('The model did not return a usable ranking.')

  // Retrieval owns membership. Claude may reorder only the bounded window;
  // every local result beyond it must remain available in the UI.
  const localRanking = parsed.ranking.flatMap((entry) => {
    const index = requestCandidateIndex(entry.id)
    return index === null ? [] : [{ ...entry, id: index }]
  })
  return mergeRerankedResults(opts.results, localRanking, RERANK_LIMIT)
}
