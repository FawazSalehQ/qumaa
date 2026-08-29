import type { MatchResult } from '@shared/types.js'

export interface ModelRankingEntry {
  id: number
  rank: number
  reason: string
}

/**
 * Applies a model ranking to the bounded shortlist without changing retrieval's
 * candidate set. Invalid/duplicate ids are ignored, omitted shortlist entries
 * retain their local order, and candidates outside the model window stay after
 * the reranked window in their original order.
 */
export function mergeRerankedResults(
  results: MatchResult[],
  ranking: ModelRankingEntry[],
  limit: number
): MatchResult[] {
  const shortlist = results.slice(0, limit)
  const seen = new Set<number>()
  const ordered: MatchResult[] = []

  for (const entry of [...ranking].sort((a, b) => a.rank - b.rank)) {
    const original = shortlist[entry.id]
    if (!original || seen.has(entry.id)) continue
    seen.add(entry.id)
    ordered.push({ ...original, llmReason: entry.reason })
  }

  shortlist.forEach((result, index) => {
    if (!seen.has(index)) ordered.push(result)
  })

  return [...ordered, ...results.slice(limit)]
}
