import { describe, expect, it } from 'vitest'
import type { MatchResult, SearchResponse } from '../src/shared/types.js'
import {
  displayedResult,
  initialMatchSession,
  matchSessionReducer,
  type MatchSession
} from '../src/renderer/src/matchSession.js'
import type { JobPosting } from '../src/renderer/src/jobPosting.js'

function candidate(id: number): MatchResult {
  return {
    resume: {
      id,
      fileName: `${id}.txt`,
      filePath: '',
      fileType: 'txt',
      importedAt: id,
      name: `Candidate ${id}`,
      email: null,
      phone: null,
      location: null,
      yearsExperience: null,
      educationLevel: null,
      skills: [],
      likelyScanned: false
    },
    score: 0.5,
    breakdown: { semantic: 0.5, lexical: 0.5, skills: 0.5 },
    matchedSkills: [],
    missingSkills: [],
    evidence: []
  }
}

function response(...ids: number[]): SearchResponse {
  return {
    results: ids.map(candidate),
    requiredSkills: ['typescript'],
    totalCandidates: ids.length,
    elapsedMs: 12
  }
}

function posting(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    position: 'Original position',
    jobDescription: 'Original description',
    requirements: 'Original requirements',
    educationAndCertifications: 'Original education',
    ...overrides
  }
}

function searched(value = posting()): MatchSession {
  const started = matchSessionReducer(initialMatchSession(), {
    type: 'search-started',
    requestId: 1,
    posting: value
  })
  return matchSessionReducer(started, {
    type: 'search-succeeded',
    requestId: 1,
    response: response(1, 2, 3)
  })
}

describe('matchSessionReducer', () => {
  it('keeps edits separate from the posting that produced displayed results', () => {
    const result = searched()
    const editing = matchSessionReducer(result, { type: 'edit-started' })
    const changed = matchSessionReducer(editing, {
      type: 'draft-field-changed',
      field: 'requirements',
      value: 'Unsubmitted revision'
    })

    expect(changed.draftPosting.requirements).toBe('Unsubmitted revision')
    expect(changed.result?.posting).toEqual(posting())
    expect(changed.editing).toBe(true)
    expect(displayedResult(changed)).toBeNull()

    const cancelled = matchSessionReducer(changed, { type: 'edit-cancelled' })
    expect(cancelled.draftPosting).toEqual(posting())
    expect(cancelled.editing).toBe(false)
    expect(displayedResult(cancelled)?.posting).toEqual(posting())
  })

  it('ignores a late search after reset or after a newer request starts', () => {
    const first = matchSessionReducer(initialMatchSession(), {
      type: 'search-started',
      requestId: 1,
      posting: posting({ position: 'First' })
    })
    const second = matchSessionReducer(first, {
      type: 'search-started',
      requestId: 2,
      posting: posting({ position: 'Second' })
    })
    const lateFirst = matchSessionReducer(second, {
      type: 'search-succeeded',
      requestId: 1,
      response: response(1)
    })

    expect(lateFirst).toBe(second)
    expect(lateFirst.pendingSearch?.requestId).toBe(2)

    const reset = matchSessionReducer(second, { type: 'reset' })
    const afterReset = matchSessionReducer(reset, {
      type: 'search-succeeded',
      requestId: 2,
      response: response(2)
    })
    expect(afterReset).toEqual(initialMatchSession())
  })

  it('accepts reranking only for the result revision that launched it', () => {
    const local = searched()
    const pending = matchSessionReducer(local, {
      type: 'rerank-started',
      requestId: 2,
      resultKey: 1
    })
    const invalidated = matchSessionReducer(pending, { type: 'results-invalidated' })
    const late = matchSessionReducer(invalidated, {
      type: 'rerank-succeeded',
      requestId: 2,
      results: response(3, 2, 1).results
    })

    expect(late).toBe(invalidated)
    expect(late.result).toBeNull()
  })

  it('makes a reranked ordering a new revision and rejects an older export completion', () => {
    const local = searched()
    const pending = matchSessionReducer(local, {
      type: 'rerank-started',
      requestId: 2,
      resultKey: 1
    })
    const reranked = matchSessionReducer(pending, {
      type: 'rerank-succeeded',
      requestId: 2,
      results: response(3, 2, 1).results
    })

    expect(reranked.result?.key).toBe(2)
    expect(reranked.result?.posting).toEqual(posting())
    expect(reranked.result?.reranked).toBe(true)

    const staleExport = matchSessionReducer(reranked, {
      type: 'export-succeeded',
      resultKey: 1,
      path: '/tmp/old.pdf'
    })
    expect(staleExport).toBe(reranked)
    expect(staleExport.exported).toBeNull()
  })

  it('invalidates cards and pending work while preserving the draft for a fresh search', () => {
    const draft = posting({ position: 'Keep this position' })
    const local = searched(draft)
    const invalidated = matchSessionReducer(local, { type: 'results-invalidated' })

    expect(invalidated.result).toBeNull()
    expect(invalidated.pendingSearch).toBeNull()
    expect(invalidated.pendingRerank).toBeNull()
    expect(invalidated.exported).toBeNull()
    expect(invalidated.draftPosting).toEqual(draft)
    expect(invalidated.editing).toBe(true)
  })

  it('copies postings at async and result boundaries so later edits cannot leak', () => {
    const submitted = posting()
    const started = matchSessionReducer(initialMatchSession(), {
      type: 'search-started',
      requestId: 1,
      posting: submitted
    })

    submitted.position = 'Mutated outside the reducer'
    expect(started.pendingSearch?.posting.position).toBe('Original position')

    const changed = matchSessionReducer(started, {
      type: 'draft-field-changed',
      field: 'educationAndCertifications',
      value: 'Unsaved education edit'
    })
    const completed = matchSessionReducer(changed, {
      type: 'search-succeeded',
      requestId: 1,
      response: response(1)
    })

    expect(completed.result?.posting).toEqual(posting())
    expect(completed.draftPosting).toEqual(posting())
    expect(completed.result?.posting).not.toBe(completed.draftPosting)
  })
})
