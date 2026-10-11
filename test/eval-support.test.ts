import { describe, expect, it } from 'vitest'
import { resolve } from 'node:path'
import { entriesFingerprint, evaluationLabels, evaluationPaths, rankingMetrics } from '../src/main/eval-support'

describe('evaluation labels and inputs', () => {
  it('accepts complete neutral filenames without exposing relevance to ranking', () => {
    const result = evaluationLabels(['C02.md', 'C01.md'], { 'C01.md': 1, 'C02.md': 4 })
    expect(result.files).toEqual(['C01.md', 'C02.md'])
    expect([...result.labels.entries()]).toEqual([['C01.md', 1], ['C02.md', 4]])
    expect(result.ignored).toBe(0)
  })

  it('rejects incomplete or stale manifests even when ignoring unlabelled files', () => {
    expect(() => evaluationLabels(['C01.md', 'C02.md'], { 'C01.md': 1 }, true)).toThrow('missing from')
    expect(() => evaluationLabels(['C01.md'], { 'C01.md': 1, 'C02.md': 2 })).toThrow('missing or unsupported')
  })

  it.each([0, 5, -1, 1.5, '1', null])('rejects invalid manifest tier %s', (tier) => {
    expect(() => evaluationLabels(['C01.md'], { 'C01.md': tier })).toThrow('Invalid tier')
  })

  it('rejects invalid filename tiers and unusable corpora', () => {
    expect(() => evaluationLabels(['t1_a.md', 't5_b.md'])).toThrow('Invalid tier')
    expect(() => evaluationLabels(['t1_a.md', 't10_b.md'], undefined, true)).toThrow('Invalid tier')
    expect(() => evaluationLabels([])).toThrow('No supported resumes')
    expect(() => evaluationLabels(['C01.md'], null)).toThrow('JSON object')
    expect(() => evaluationLabels(['t2_a.md'])).toThrow('tier-1')
    expect(() => evaluationLabels(['C01.md'], undefined, true)).toThrow('tier-1')
  })

  it('requires explicit opt-in to ignore unlabelled files in legacy filename mode', () => {
    expect(() => evaluationLabels(['t1_a.md', 'extra.md'])).toThrow('no tier prefix')
    expect(evaluationLabels(['t1_a.md', 'extra.md'], undefined, true)).toMatchObject({
      files: ['t1_a.md'], ignored: 1
    })
  })

  it('preserves default paths and resolves overrides relative to the repo', () => {
    const root = resolve('test-eval-root')
    const posting = resolve('test-eval-external', 'job.txt')
    expect(evaluationPaths(root, {})).toEqual({
      corpus: resolve(root, 'eval/corpus'), posting: resolve(root, 'eval/posting.txt'),
      results: resolve(root, 'eval/results'), labels: undefined
    })
    expect(evaluationPaths(root, {
      QUMAA_EVAL_CORPUS: 'pilot/corpus', QUMAA_EVAL_POSTING: posting,
      QUMAA_EVAL_RESULTS: 'pilot/results', QUMAA_EVAL_LABELS: 'pilot/labels.json'
    })).toEqual({
      corpus: resolve(root, 'pilot/corpus'), posting,
      results: resolve(root, 'pilot/results'), labels: resolve(root, 'pilot/labels.json')
    })
  })
})

describe('ranking quality metrics', () => {
  it('distinguishes standard recall from top-three target coverage with eight relevant candidates', () => {
    const ranked = [1, 2, 1, 1, 3, 4, 3, 1, 3, 1, 1, 3, 1, 4, 1] as const
    const result = rankingMetrics([...ranked], [...ranked])
    expect(result.precisionAt3).toBeCloseTo(2 / 3)
    expect(result.recallAt3).toBe(2 / 8)
    expect(result.recallAt10).toBe(5 / 8)
    expect(result.top3TargetCoverage).toBeCloseTo(2 / 3)
    expect(result.reciprocalRank).toBe(1)
    expect(result.mrr).toBe(result.reciprocalRank)
    expect(result.ndcg10).toBeGreaterThan(0)
    expect(result.ndcg10).toBeLessThan(1)
  })

  it('handles fewer than three relevant candidates and uses linear graded NDCG', () => {
    const result = rankingMetrics([1, 2, 3, 4], [4, 1, 3, 2])
    expect(result.precisionAt3).toBeCloseTo(1 / 3)
    expect(result.recallAt3).toBe(1)
    expect(result.top3TargetCoverage).toBe(1)
    expect(result.ndcg10).toBe(1)
    expect(rankingMetrics([4, 1], [1, 4]).reciprocalRank).toBe(0.5)
  })

  it('does not publish success metrics after missing or mismatched ranked candidates', () => {
    expect(() => rankingMetrics([], [1])).toThrow('No candidates')
    expect(() => rankingMetrics([1], [1, 2])).toThrow('every labelled candidate')
    expect(() => rankingMetrics([1, 4], [1, 2])).toThrow('every labelled candidate')
    expect(() => rankingMetrics([2], [2])).toThrow('tier-1')
  })
})

it('fingerprints file bytes independently of input ordering, while detecting changes', () => {
  const entries = [{ file: 'C01.md', sha256: 'a' }, { file: 'C02.md', sha256: 'b' }]
  expect(entriesFingerprint(entries)).toBe(entriesFingerprint([...entries].reverse()))
  expect(entriesFingerprint(entries)).not.toBe(entriesFingerprint([{ file: 'C01.md', sha256: 'changed' }, entries[1]]))
})
