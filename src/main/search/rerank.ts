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
import { z } from 'zod'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import type { MatchResult } from '@shared/types.js'
import { mergeRerankedResults } from './rerankOrder.js'

/** Reranking more than this wastes tokens; retrieval is reliable at the top. */
export const RERANK_LIMIT = 15

/** Trimmed so a single long CV cannot dominate the request. */
const CHARS_PER_CANDIDATE = 2500

const RankingSchema = z.object({
  ranking: z
    .array(
      z.object({
        id: z.number().describe('The candidate id exactly as given in the input'),
        rank: z.number().describe('1 is the best fit'),
        reason: z
          .string()
          .describe(
            'One sentence, at most 25 words, citing concrete evidence from this candidate'
          )
      })
    )
    .describe('Every candidate supplied, reordered best first')
})

export interface RerankedResult extends MatchResult {
  /** Present only on results the model actually reordered. */
  llmReason?: string
}

function candidateBlock(m: MatchResult, id: number): string {
  const r = m.resume
  const facts = [
    r.name ? `Name: ${r.name}` : null,
    r.yearsExperience !== null ? `Years of experience: ${r.yearsExperience}` : null,
    r.educationLevel ? `Education: ${r.educationLevel}` : null,
    m.matchedSkills.length ? `Skills present: ${m.matchedSkills.join(', ')}` : null,
    m.missingSkills.length ? `Skills not found: ${m.missingSkills.join(', ')}` : null
  ]
    .filter(Boolean)
    .join('\n')

  const passages = m.evidence
    .map((e) => `- (${e.section}) ${e.text}`)
    .join('\n')
    .slice(0, CHARS_PER_CANDIDATE)

  return `<candidate id="${id}">\n${facts}\n\nPassages from their CV:\n${passages}\n</candidate>`
}

const SYSTEM = `You rerank a shortlist of candidates against a job posting.

The shortlist was produced by semantic search, which is good at topic similarity
and bad at judgement. Your value is the judgement: seniority implied by scope and
ownership, whether stated experience is actually relevant to the posting, and
whether a missing keyword genuinely matters.

Rules:
- Rank every candidate you are given. Do not add, drop, or invent candidates.
- Judge only from the passages provided. If something is not evidenced, treat it
  as absent rather than assuming it.
- Give each candidate one sentence of at most 25 words citing concrete evidence.
- Do not reward confident writing. Reward demonstrated scope and relevance.`

export interface RerankOptions {
  apiKey: string
  jobDescription: string
  results: MatchResult[]
}

/**
 * Returns the complete local result list with the shortlist window reordered;
 * entries the model ranked carry its reason.
 *
 * Throws on API failure so the caller can fall back to the local ranking and
 * tell the user, rather than silently presenting an unranked list as ranked.
 */
export async function rerank(opts: RerankOptions): Promise<RerankedResult[]> {
  const shortlist = opts.results.slice(0, RERANK_LIMIT)
  if (shortlist.length <= 1) return opts.results

  const client = new Anthropic({ apiKey: opts.apiKey })

  const response = await client.messages.parse({
    model: 'claude-sonnet-5',
    max_tokens: 8000,
    system: SYSTEM,
    thinking: { type: 'adaptive' },
    output_config: { format: zodOutputFormat(RankingSchema) },
    messages: [
      {
        role: 'user',
        content: `<posting>\n${opts.jobDescription}\n</posting>\n\n${shortlist
          .map((m, i) => candidateBlock(m, i))
          .join('\n\n')}`
      }
    ]
  })

  const parsed = response.parsed_output
  if (!parsed) throw new Error('The model did not return a usable ranking.')

  // Retrieval owns membership. Claude may reorder only the bounded window;
  // every local result beyond it must remain available in the UI.
  return mergeRerankedResults(opts.results, parsed.ranking, RERANK_LIMIT)
}
