import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import type { MatchResult } from '@shared/types.js'
import CandidateCard from '../components/CandidateCard.js'
import { QumaaMark } from '../components/Brand.js'
import {
  formatJobPosting,
  hasJobPostingContent,
  jobPostingTitle
} from '../jobPosting.js'
import { displayedResult, initialMatchSession, matchSessionReducer } from '../matchSession.js'

interface Props {
  resumeCount: number
  onOpenCandidate: (m: MatchResult) => void
  /** Bumped by the New Search menu command to reset this view. */
  resetSignal: number
  /** Bumped whenever resumes or their search index may have changed. */
  libraryRevision: number
}

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback
}

export default function MatchView({
  resumeCount,
  onOpenCandidate,
  resetSignal,
  libraryRevision
}: Props): React.JSX.Element {
  const [session, dispatch] = useReducer(matchSessionReducer, undefined, initialMatchSession)
  // Off unless the user has both stored a key and switched reranking on.
  const [rerankAvailable, setRerankAvailable] = useState(false)
  const positionRef = useRef<HTMLInputElement>(null)
  const nextRequestId = useRef(0)
  const previousLibraryRevision = useRef(libraryRevision)

  const posting = session.draftPosting
  const canSearch = hasJobPostingContent(posting)
  const busy = session.pendingSearch !== null
  const reranking = session.pendingRerank !== null
  // Results stay stored while the user edits so Cancel can restore them, but
  // they are hidden until the immutable posting snapshot is visible again.
  const snapshot = displayedResult(session)
  const res = snapshot?.response ?? null

  useEffect(() => {
    window.api.settings.get().then((s) => setRerankAvailable(s.hasApiKey && s.rerankEnabled))
  }, [])

  const runRerank = async (): Promise<void> => {
    const source = session.result
    if (!source || session.editing || reranking) return
    const requestId = ++nextRequestId.current
    dispatch({ type: 'rerank-started', requestId, resultKey: source.key })
    try {
      const ordered = await window.api.search.rerank({
        jobDescription: formatJobPosting(source.posting),
        results: source.response.results
      })
      dispatch({ type: 'rerank-succeeded', requestId, results: ordered })
    } catch (err) {
      dispatch({ type: 'rerank-failed', requestId, message: errorMessage(err, 'Reranking failed') })
    }
  }

  useLayoutEffect(() => {
    if (resetSignal === 0) return
    dispatch({ type: 'reset' })
    const frame = requestAnimationFrame(() => positionRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [resetSignal])

  // A result is a snapshot of both the library and its vector index. Revoke it
  // before paint when either changes; completions from older async work then no-op
  // because the reducer no longer holds their request ids.
  useLayoutEffect(() => {
    if (previousLibraryRevision.current === libraryRevision) return
    previousLibraryRevision.current = libraryRevision
    dispatch({ type: 'results-invalidated' })
  }, [libraryRevision])

  const run = async (): Promise<void> => {
    // resumeCount is checked here too, not just on the button: the Cmd+Enter
    // shortcut would otherwise run a search the disabled button forbids.
    if (!canSearch || busy || resumeCount === 0) return
    const requestId = ++nextRequestId.current
    const submittedPosting = { ...posting }
    dispatch({ type: 'search-started', requestId, posting: submittedPosting })
    try {
      const response = await window.api.search.run(formatJobPosting(submittedPosting))
      dispatch({ type: 'search-succeeded', requestId, response })
    } catch (err) {
      dispatch({ type: 'search-failed', requestId, message: errorMessage(err, 'Search failed') })
    }
  }

  const top = res?.results.slice(0, 3) ?? []
  const rest = res?.results.slice(3) ?? []

  return (
    <>
      {!snapshot && (
        <header className="view-head">
          <h2>Match</h2>
        </header>
      )}

      {snapshot ? (
        <button
          className="posting-bar"
          onClick={() => {
            dispatch({ type: 'edit-started' })
            requestAnimationFrame(() => positionRef.current?.focus())
          }}
        >
          <QumaaMark size={16} tone="color" />
          <span className="posting-title" dir="auto">
            {jobPostingTitle(snapshot.posting)}
          </span>
          <span className="muted">
            {snapshot.response.requiredSkills.length} skill
            {snapshot.response.requiredSkills.length === 1 ? '' : 's'} detected
          </span>
          <span className="spacer" />
          <span className="posting-edit">Edit</span>
        </button>
      ) : (
        <form
          className="posting-form"
          onSubmit={(e) => {
            e.preventDefault()
            void run()
          }}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
              e.preventDefault()
              void run()
            }
          }}
        >
          <fieldset className="posting-fields" disabled={busy}>
            <div className="posting-field">
              <label htmlFor="match-position">Position</label>
              <input
                ref={positionRef}
                id="match-position"
                type="text"
                dir="auto"
                value={posting.position}
                placeholder="e.g. Senior Accountant"
                onChange={(e) =>
                  dispatch({
                    type: 'draft-field-changed',
                    field: 'position',
                    value: e.target.value
                  })
                }
              />
            </div>

            <div className="posting-field">
              <label htmlFor="match-description">Job Description</label>
              <textarea
                id="match-description"
                rows={6}
                dir="auto"
                value={posting.jobDescription}
                placeholder="Describe the role and its responsibilities"
                onChange={(e) =>
                  dispatch({
                    type: 'draft-field-changed',
                    field: 'jobDescription',
                    value: e.target.value
                  })
                }
              />
            </div>

            <div className="posting-field">
              <label htmlFor="match-requirements">Requirements</label>
              <textarea
                id="match-requirements"
                rows={5}
                dir="auto"
                value={posting.requirements}
                placeholder="List required skills and experience, one item per line"
                onChange={(e) =>
                  dispatch({
                    type: 'draft-field-changed',
                    field: 'requirements',
                    value: e.target.value
                  })
                }
              />
            </div>

            <div className="posting-field">
              <label htmlFor="match-education">Education and Certifications</label>
              <textarea
                id="match-education"
                rows={4}
                dir="auto"
                value={posting.educationAndCertifications}
                placeholder="List required degrees, licenses, and certifications"
                onChange={(e) =>
                  dispatch({
                    type: 'draft-field-changed',
                    field: 'educationAndCertifications',
                    value: e.target.value
                  })
                }
              />
            </div>
          </fieldset>

          <div className="row toolbar">
            <button
              type="submit"
              className="btn primary"
              disabled={busy || !canSearch || resumeCount === 0}
            >
              {busy ? 'Searching…' : 'Find matches'}
            </button>
            {session.result && (
              <button
                type="button"
                className="btn"
                onClick={() => dispatch({ type: 'edit-cancelled' })}
              >
                Cancel
              </button>
            )}
            <span className="muted">
              {resumeCount === 0
                ? 'Import some resumes first by dragging them anywhere onto this window.'
                : `Searching ${resumeCount} resume${resumeCount === 1 ? '' : 's'} · ${
                    window.api.platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter'
                  }`}
            </span>
          </div>
        </form>
      )}

      {session.error && (
        <div className="card error-card" role="alert">
          {session.error}
        </div>
      )}

      {res && snapshot && (
        <div className="results">
          <div className="row results-head">
            <h3>Top {top.length}</h3>
            <span className="spacer" />
            <span className="muted">
              {res.totalCandidates} scored in {res.elapsedMs} ms
            </span>
            {rerankAvailable && !snapshot.reranked && (
              <button
                className="btn sm"
                onClick={runRerank}
                disabled={reranking || top.length === 0}
                title="Sends the posting fields and the top candidates' matching passages to Anthropic"
              >
                {reranking ? 'Reranking…' : 'Rerank with Claude'}
              </button>
            )}
            {snapshot.reranked && <span className="muted">Reordered by Claude</span>}
            <button
              className="btn sm"
              disabled={top.length === 0}
              onClick={async () => {
                const source = snapshot
                try {
                  const path = await window.api.search.exportPdf({
                    jobTitle: jobPostingTitle(source.posting),
                    requiredSkills: source.response.requiredSkills,
                    results: source.response.results.slice(0, 3)
                  })
                  if (path) {
                    dispatch({ type: 'export-succeeded', resultKey: source.key, path })
                  }
                } catch (err) {
                  dispatch({
                    type: 'export-failed',
                    resultKey: source.key,
                    message: errorMessage(err, 'Export failed')
                  })
                }
              }}
            >
              Export shortlist…
            </button>
          </div>

          {res.requiredSkills.length > 0 && (
            <div className="detected">
              <span className="muted">Requirements</span>
              <div className="chips">
                {res.requiredSkills.map((s) => (
                  <span key={s} className="chip">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {top.length === 0 ? (
            <div className="empty">No resumes yet</div>
          ) : (
            <div className="podium">
              {top.map((m, i) => (
                <CandidateCard
                  key={m.resume.id}
                  match={m}
                  rank={i + 1}
                  onOpen={() => onOpenCandidate(m)}
                />
              ))}
            </div>
          )}

          {session.exported && (
            <p className="hint">Saved to {session.exported}</p>
          )}

          {rest.length > 0 && (
            <details className="rest">
              <summary>Show the other {rest.length} ranked candidates</summary>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>Candidate</th>
                    <th>Matched skills</th>
                    <th className="num" style={{ width: 76 }}>
                      Score
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((m, i) => (
                    <tr key={m.resume.id} className="clickable" onClick={() => onOpenCandidate(m)}>
                      <td className="muted num">{i + 4}</td>
                      <td>
                        <div className="cell-title">{m.resume.name ?? m.resume.fileName}</div>
                        <div className="cell-sub">{m.resume.fileName}</div>
                      </td>
                      <td className="muted">
                        {m.matchedSkills.slice(0, 6).join(', ') || 'none'}
                        {m.matchedSkills.length > 6 && ` +${m.matchedSkills.length - 6}`}
                      </td>
                      <td className="num strong">{Math.round(m.score * 100)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}
    </>
  )
}
