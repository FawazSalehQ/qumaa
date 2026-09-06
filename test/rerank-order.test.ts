import { describe, expect, it } from 'vitest'
import type { MatchResult } from '../src/shared/types.js'
import { mergeRerankedResults } from '../src/main/search/rerankOrder.js'

function candidate(id: number): MatchResult {
  return {
    resume: {
      id,
      recordKey: id.toString(16).padStart(64, '0'),
      fileName: `candidate-${id}.pdf`,
      filePath: `/resumes/candidate-${id}.pdf`,
      importedAt: id,
      name: `Candidate ${id}`,
      email: null,
      phone: null,
      location: null,
      yearsExperience: null,
      educationLevel: null,
      skills: []
    },
    score: 1 - id / 100,
    breakdown: { semantic: 0.8, lexical: 0.5, skills: 1 },
    matchedSkills: [],
    missingSkills: [],
    evidence: []
  }
}

describe('mergeRerankedResults', () => {
  it('reranks only the model window and preserves every result after it', () => {
    const results = Array.from({ length: 20 }, (_, id) => candidate(id))
    const ranking = Array.from({ length: 15 }, (_, rank) => ({
      id: 14 - rank,
      rank: rank + 1,
      reason: `Reason ${14 - rank}`
    }))

    const merged = mergeRerankedResults(results, ranking, 15)

    expect(merged.map((result) => result.resume.id)).toEqual([
      14, 13, 12, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 15, 16, 17, 18, 19
    ])
    expect(merged).toHaveLength(results.length)
    expect(new Set(merged.map((result) => result.resume.id)).size).toBe(results.length)
    expect(merged[15]).toBe(results[15])
  })

  it('ignores invented and duplicate ids, then appends omitted originals locally ranked', () => {
    const results = Array.from({ length: 6 }, (_, id) => candidate(id))
    const merged = mergeRerankedResults(
      results,
      [
        { id: 2, rank: 1, reason: 'Evidence for two' },
        { id: 2, rank: 2, reason: 'Duplicate' },
        { id: 99, rank: 3, reason: 'Invented' }
      ],
      4
    )

    expect(merged.map((result) => result.resume.id)).toEqual([2, 0, 1, 3, 4, 5])
    expect(merged[0].llmReason).toBe('Evidence for two')
    expect(merged.slice(1).every((result) => result.llmReason === undefined)).toBe(true)
  })
})
