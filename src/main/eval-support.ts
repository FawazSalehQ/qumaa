/** Evaluation-only helpers. No Electron, database, or ranking implementation imports. */
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

export type RelevanceTier = 1 | 2 | 3 | 4

export function isRelevanceTier(value: unknown): value is RelevanceTier {
  return Number.isInteger(value) && typeof value === 'number' && value >= 1 && value <= 4
}

export function evaluationPaths(root: string, env: Record<string, string | undefined>) {
  const path = (key: string, fallback: string) => resolve(root, env[key] || fallback)
  return {
    corpus: path('QUMAA_EVAL_CORPUS', 'eval/corpus'),
    posting: path('QUMAA_EVAL_POSTING', 'eval/posting.txt'),
    results: path('QUMAA_EVAL_RESULTS', 'eval/results'),
    labels: env.QUMAA_EVAL_LABELS ? resolve(root, env.QUMAA_EVAL_LABELS) : undefined
  }
}

/** A manifest is authoritative: it must label every supported file, with no stale entries. */
export function evaluationLabels(
  inputFiles: string[],
  manifest?: unknown,
  ignoreUnlabelled = false
): { files: string[]; labels: Map<string, RelevanceTier>; ignored: number } {
  const files = [...inputFiles].sort()
  if (files.length === 0) throw new Error('No supported resumes in the evaluation corpus.')
  const labels = new Map<string, RelevanceTier>()
  if (manifest !== undefined) {
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
      throw new Error('Evaluation labels must be a JSON object mapping filenames to tiers 1–4.')
    }
    const entries = Object.entries(manifest)
    const fileSet = new Set(files)
    for (const [file, tier] of entries) {
      if (!fileSet.has(file)) throw new Error(`Label references a missing or unsupported file: ${file}`)
      if (!isRelevanceTier(tier)) throw new Error(`Invalid tier for ${file}: expected an integer 1–4.`)
      labels.set(file, tier)
    }
    const missing = files.filter((file) => !labels.has(file))
    if (missing.length) throw new Error(`${missing.length} corpus file(s) missing from evaluation labels.`)
  } else {
    for (const file of files) {
      const match = /^t(\d+)_/i.exec(file)
      if (!match) continue
      const tier = Number(match[1])
      if (!isRelevanceTier(tier)) throw new Error(`Invalid tier prefix in ${file}: expected t1_ through t4_.`)
      labels.set(file, tier)
    }
    const missing = files.length - labels.size
    if (missing && !ignoreUnlabelled) {
      throw new Error(`${missing} file(s) have no tier prefix. Supply QUMAA_EVAL_LABELS or see eval/README.md.`)
    }
  }
  if (![...labels.values()].includes(1)) throw new Error('Evaluation requires at least one tier-1 candidate.')
  return { files: files.filter((file) => labels.has(file)), labels, ignored: files.length - labels.size }
}

const GAIN: Record<RelevanceTier, number> = { 1: 3, 2: 2, 3: 1, 4: 0 }
const dcg = (gains: number[]) => gains.reduce((sum, gain, i) => sum + gain / Math.log2(i + 2), 0)

export function rankingMetrics(rankedTiers: RelevanceTier[], corpusTiers: RelevanceTier[]) {
  const tier1Total = corpusTiers.filter((tier) => tier === 1).length
  if (!tier1Total) throw new Error('Evaluation requires at least one tier-1 candidate.')
  if (!rankedTiers.length) throw new Error('No candidates were ranked.')
  if (rankedTiers.length !== corpusTiers.length || [1, 2, 3, 4].some((tier) =>
    rankedTiers.filter((value) => value === tier).length !== corpusTiers.filter((value) => value === tier).length
  )) throw new Error('Ranking must cover every labelled candidate exactly once.')

  const hits3 = rankedTiers.slice(0, 3).filter((tier) => tier === 1).length
  const hits10 = rankedTiers.slice(0, 10).filter((tier) => tier === 1).length
  const firstTier1 = rankedTiers.findIndex((tier) => tier === 1)
  const reciprocalRank = firstTier1 === -1 ? 0 : 1 / (firstTier1 + 1)
  const ideal = corpusTiers.map((tier) => GAIN[tier]).sort((a, b) => b - a)
  return {
    precisionAt3: hits3 / 3,
    recallAt3: hits3 / tier1Total,
    recallAt10: hits10 / tier1Total,
    top3TargetCoverage: hits3 / Math.min(3, tier1Total),
    reciprocalRank,
    // Retained for existing result consumers; with one posting this is RR, not a multi-query mean.
    mrr: reciprocalRank,
    ndcg10: dcg(rankedTiers.slice(0, 10).map((tier) => GAIN[tier])) / dcg(ideal.slice(0, 10))
  }
}

export const sha256 = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex')

/** Sorting and JSON framing make the digest independent of directory enumeration order. */
export function entriesFingerprint(entries: Array<{ file: string; sha256: string }>): string {
  return sha256(JSON.stringify([...entries].sort((a, b) => a.file < b.file ? -1 : a.file > b.file ? 1 : 0)))
}
