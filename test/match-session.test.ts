import { describe, expect, it } from 'vitest'
import type { MatchResult, SearchResponse } from '../src/shared/types.js'
import {
  displayedResult,
  initialMatchSession,
  matchSessionReducer,
  type MatchSession
} from '../src/renderer/src/matchSession.js'

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

function searched(posting = 'Original posting'): MatchSession {
  const started = matchSessionReducer(initialMatchSession(), {
    type: 'search-started',
    requestId: 1,
    posting
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
      type: 'draft-changed',
      posting: 'Unsubmitted revision'
    })

    expect(changed.draftPosting).toBe('Unsubmitted revision')
    expect(changed.result?.posting).toBe('Original posting')
    expect(changed.editing).toBe(true)
    expect(displayedResult(changed)).toBeNull()

    const cancelled = matchSessionReducer(changed, { type: 'edit-cancelled' })
    expect(cancelled.draftPosting).toBe('Original posting')
    expect(cancelled.editing).toBe(false)
    expect(displayedResult(cancelled)?.posting).toBe('Original posting')
  })

  it('ignores a late search after reset or after a newer request starts', () => {
    const first = matchSessionReducer(initialMatchSession(), {
      type: 'search-started',
      requestId: 1,
      posting: 'First'
    })
    const second = matchSessionReducer(first, {
      type: 'search-started',
      requestId: 2,
      posting: 'Second'
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
    expect(reranked.result?.posting).toBe('Original posting')
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
    const local = searched('Keep this posting')
    const invalidated = matchSessionReducer(local, { type: 'results-invalidated' })

    expect(invalidated.result).toBeNull()
    expect(invalidated.pendingSearch).toBeNull()
    expect(invalidated.pendingRerank).toBeNull()
    expect(invalidated.exported).toBeNull()
    expect(invalidated.draftPosting).toBe('Keep this posting')
    expect(invalidated.editing).toBe(true)
  })
})
