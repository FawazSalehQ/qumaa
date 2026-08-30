import type { MatchResult, SearchResponse } from '@shared/types.js'
import { emptyJobPosting, type JobPosting, type JobPostingField } from './jobPosting.js'

export interface ResultSnapshot {
  /** Changes after every accepted search or rerank. */
  key: number
  /** Immutable posting used to produce this response. */
  posting: JobPosting
  response: SearchResponse
  reranked: boolean
}

export interface MatchSession {
  /** Editable fields; never used for an existing result's rerank or export. */
  draftPosting: JobPosting
  result: ResultSnapshot | null
  editing: boolean
  exported: string | null
  error: string | null
  pendingSearch: { requestId: number; posting: JobPosting } | null
  pendingRerank: { requestId: number; resultKey: number } | null
}

export type MatchSessionAction =
  | { type: 'draft-field-changed'; field: JobPostingField; value: string }
  | { type: 'edit-started' }
  | { type: 'edit-cancelled' }
  | { type: 'search-started'; requestId: number; posting: JobPosting }
  | { type: 'search-succeeded'; requestId: number; response: SearchResponse }
  | { type: 'search-failed'; requestId: number; message: string }
  | { type: 'rerank-started'; requestId: number; resultKey: number }
  | { type: 'rerank-succeeded'; requestId: number; results: MatchResult[] }
  | { type: 'rerank-failed'; requestId: number; message: string }
  | { type: 'export-succeeded'; resultKey: number; path: string }
  | { type: 'export-failed'; resultKey: number; message: string }
  | { type: 'results-invalidated' }
  | { type: 'reset' }

export function initialMatchSession(): MatchSession {
  return {
    draftPosting: emptyJobPosting(),
    result: null,
    editing: true,
    exported: null,
    error: null,
    pendingSearch: null,
    pendingRerank: null
  }
}

/** Old cards stay available for Cancel, but are never shown beside a draft. */
export function displayedResult(state: MatchSession): ResultSnapshot | null {
  return state.editing ? null : state.result
}

/**
 * Pure state machine for posting/result consistency. Async completions carry the
 * request or result revision that launched them; mismatches are stale and are
 * deliberately ignored.
 */
export function matchSessionReducer(
  state: MatchSession,
  action: MatchSessionAction
): MatchSession {
  switch (action.type) {
    case 'draft-field-changed':
      return {
        ...state,
        draftPosting: { ...state.draftPosting, [action.field]: action.value }
      }

    case 'edit-started':
      if (!state.result) return state
      return {
        ...state,
        draftPosting: { ...state.result.posting },
        editing: true,
        error: null,
        pendingRerank: null
      }

    case 'edit-cancelled':
      if (!state.result) return state
      return {
        ...state,
        draftPosting: { ...state.result.posting },
        editing: false,
        error: null,
        pendingSearch: null,
        pendingRerank: null
      }

    case 'search-started': {
      const posting = { ...action.posting }
      return {
        ...state,
        error: null,
        pendingSearch: { requestId: action.requestId, posting },
        pendingRerank: null
      }
    }

    case 'search-succeeded': {
      const pending = state.pendingSearch
      if (!pending || pending.requestId !== action.requestId) return state
      return {
        ...state,
        draftPosting: { ...pending.posting },
        result: {
          key: action.requestId,
          posting: { ...pending.posting },
          response: action.response,
          reranked: false
        },
        editing: false,
        exported: null,
        error: null,
        pendingSearch: null,
        pendingRerank: null
      }
    }

    case 'search-failed':
      if (state.pendingSearch?.requestId !== action.requestId) return state
      return { ...state, pendingSearch: null, error: action.message }

    case 'rerank-started':
      if (!state.result || state.result.key !== action.resultKey) return state
      return {
        ...state,
        error: null,
        pendingRerank: { requestId: action.requestId, resultKey: action.resultKey }
      }

    case 'rerank-succeeded': {
      const pending = state.pendingRerank
      if (
        !pending ||
        pending.requestId !== action.requestId ||
        !state.result ||
        state.result.key !== pending.resultKey
      ) {
        return state
      }
      return {
        ...state,
        result: {
          ...state.result,
          // A rerank is a new visible ordering. Giving it a new key prevents an
          // earlier PDF export from attaching its path to this ordering.
          key: action.requestId,
          response: { ...state.result.response, results: action.results },
          reranked: true
        },
        exported: null,
        pendingRerank: null
      }
    }

    case 'rerank-failed':
      if (state.pendingRerank?.requestId !== action.requestId) return state
      return { ...state, pendingRerank: null, error: action.message }

    case 'export-succeeded':
      if (!state.result || state.result.key !== action.resultKey) return state
      return { ...state, exported: action.path }

    case 'export-failed':
      if (!state.result || state.result.key !== action.resultKey) return state
      return { ...state, error: action.message }

    case 'results-invalidated':
      return {
        ...state,
        result: null,
        editing: true,
        exported: null,
        error: null,
        pendingSearch: null,
        pendingRerank: null
      }

    case 'reset':
      return initialMatchSession()
  }
}
