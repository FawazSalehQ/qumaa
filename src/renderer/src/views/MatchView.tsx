import { useEffect, useLayoutEffect, useReducer, useRef, useState } from 'react'
import { useI18n } from '../i18n.js'
import { displayError } from '@shared/i18n.js'
import type { ClaudeRerankPreview, MatchResult } from '@shared/types.js'
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

interface PendingClaudeConsent {
  sessionId: string
  resultKey: number
  preview: ClaudeRerankPreview
  approvalToken: string
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
  const { t, formatNumber, language } = useI18n()
  const [session, dispatch] = useReducer(matchSessionReducer, undefined, initialMatchSession)
  // Off unless the user has both stored a key and switched reranking on.
  const [rerankAvailable, setRerankAvailable] = useState(false)
  const [previewingRerank, setPreviewingRerank] = useState(false)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [pendingConsent, setPendingConsent] = useState<PendingClaudeConsent | null>(null)
  const positionRef = useRef<HTMLInputElement>(null)
  const rerankButtonRef = useRef<HTMLButtonElement>(null)
  const consentDialogRef = useRef<HTMLElement>(null)
  const consentCancelRef = useRef<HTMLButtonElement>(null)
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

  const executeRerank = async (request: {
    sessionId: string
    resultKey: number
    approvalToken?: string
  }): Promise<void> => {
    const requestId = ++nextRequestId.current
    dispatch({ type: 'rerank-started', requestId, resultKey: request.resultKey })
    try {
      const ordered = await window.api.search.rerank({
        sessionId: request.sessionId,
        approvalToken: request.approvalToken
      })
      dispatch({ type: 'rerank-succeeded', requestId, results: ordered })
    } catch (err) {
      dispatch({ type: 'rerank-failed', requestId, message: errorMessage(err, 'Reranking failed') })
    }
  }

  const runRerank = async (): Promise<void> => {
    const source = session.result
    if (!source || session.editing || reranking || previewingRerank) return
    const request = {
      sessionId: source.response.sessionId,
      resultKey: source.key
    }

    setPreviewError(null)
    setPreviewingRerank(true)
    try {
      const review = await window.api.search.previewRerank(request)
      if (review.consentRequired) {
        setPendingConsent({
          ...request,
          preview: review.preview,
          approvalToken: review.approvalToken
        })
      } else {
        await executeRerank({ ...request, approvalToken: review.approvalToken })
      }
    } catch (error) {
      setPreviewError(errorMessage(error, 'Could not prepare the Claude request'))
    } finally {
      setPreviewingRerank(false)
    }
  }

  useEffect(() => {
    if (!pendingConsent) return
    const previousFocus = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : rerankButtonRef.current
    const dialog = consentDialogRef.current

    const focusable = (): HTMLElement[] =>
      dialog
        ? Array.from(
            dialog.querySelectorAll<HTMLElement>(
              'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
            )
          )
        : []

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setPendingConsent(null)
        requestAnimationFrame(() => rerankButtonRef.current?.focus())
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) {
        event.preventDefault()
        dialog?.focus()
        return
      }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    const keepFocusInside = (event: FocusEvent): void => {
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) {
        consentCancelRef.current?.focus()
      }
    }

    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', keepFocusInside)
    consentCancelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', keepFocusInside)
      previousFocus?.focus()
    }
  }, [pendingConsent])

  useLayoutEffect(() => {
    if (resetSignal === 0) return
    setPendingConsent(null)
    setPreviewError(null)
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
    setPendingConsent(null)
    setPreviewError(null)
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
          <h2>{t('Match')}</h2>
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
          <QumaaMark size={16} />
          <span className="posting-title" dir="auto">
            {jobPostingTitle(snapshot.posting)}
          </span>
          <span className="muted">
            {t(snapshot.response.requiredSkills.length === 1 ? '{count} skill detected' : '{count} skills detected', { count: formatNumber(snapshot.response.requiredSkills.length) })}
          </span>
          <span className="spacer" />
          <span className="posting-edit">{t('Edit')}</span>
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
              <label htmlFor="match-position">{t('Position')}</label>
              <input
                ref={positionRef}
                id="match-position"
                type="text"
                dir="auto"
                value={posting.position}
                placeholder={t('e.g. Senior Accountant')}
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
              <label htmlFor="match-description">{t('Job Description')}</label>
              <textarea
                id="match-description"
                rows={6}
                dir="auto"
                value={posting.jobDescription}
                placeholder={t('Describe the role and its responsibilities')}
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
              <label htmlFor="match-requirements">{t('Requirements')}</label>
              <textarea
                id="match-requirements"
                rows={5}
                dir="auto"
                value={posting.requirements}
                placeholder={t('List required skills and experience, one item per line')}
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
              <label htmlFor="match-education">{t('Education and Certifications')}</label>
              <textarea
                id="match-education"
                rows={4}
                dir="auto"
                value={posting.educationAndCertifications}
                placeholder={t('List required degrees, licenses, and certifications')}
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
              {t(busy ? 'Searching…' : 'Find matches')}
            </button>
            {session.result && (
              <button
                type="button"
                className="btn"
                onClick={() => dispatch({ type: 'edit-cancelled' })}
              >
                {t('Cancel')}
              </button>
            )}
            <span className="muted">
              {resumeCount === 0
                ? t('Import some resumes first by dragging them anywhere onto this window.')
                : t(resumeCount === 1 ? 'Searching {count} resume · {shortcut}' : 'Searching {count} resumes · {shortcut}', { count: formatNumber(resumeCount), shortcut: window.api.platform === 'darwin' ? '⌘↵' : 'Ctrl+Enter' })}
            </span>
          </div>
        </form>
      )}

      {(session.error || previewError) && (
        <div className="card error-card" role="alert">
          {displayError(language, session.error ?? previewError, 'Search failed')}
        </div>
      )}

      {res && snapshot && (
        <div className="results">
          <div className="row results-head">
            <h3>{t('Top {count}', { count: formatNumber(top.length) })}</h3>
            <span className="spacer" />
            <span className="muted">
              {t('{count} scored in {duration} ms', { count: formatNumber(res.totalCandidates), duration: formatNumber(res.elapsedMs) })}
            </span>
            {rerankAvailable && !snapshot.reranked && (
              <button
                ref={rerankButtonRef}
                className="btn sm"
                onClick={runRerank}
                disabled={reranking || previewingRerank || top.length < 2}
                title={t("Sends the posting fields and the top candidates' matching passages to Anthropic")}
              >
                {t(reranking
                  ? 'Reranking…'
                  : previewingRerank
                    ? 'Preparing preview…'
                    : 'Rerank with Claude')}
              </button>
            )}
            {snapshot.reranked && <span className="muted">{t('Reordered by Claude')}</span>}
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
              {t('Export shortlist…')}
            </button>
          </div>

          {res.requiredSkills.length > 0 && (
            <div className="detected">
              <span className="muted">{t('Requirements')}</span>
              <div className="chips">
                {res.requiredSkills.map((s) => (
                  <span key={s} className="chip">
                    <bdi>{s}</bdi>
                  </span>
                ))}
              </div>
            </div>
          )}

          {top.length === 0 ? (
            <div className="empty">{t('No resumes yet')}</div>
          ) : (
            <div className="podium">
              {top.map((m, i) => (
                <CandidateCard
                  key={`${m.resume.id}:${m.resume.recordKey}`}
                  match={m}
                  rank={i + 1}
                  onOpen={() => onOpenCandidate(m)}
                />
              ))}
            </div>
          )}

          {session.exported && (
            <p className="hint">{t('Saved to')} <bdi dir="ltr">{session.exported}</bdi></p>
          )}

          {rest.length > 0 && (
            <details className="rest">
              <summary>{t('Show the other {count} ranked candidates', { count: formatNumber(rest.length) })}</summary>
              <table>
                <thead>
                  <tr>
                    <th style={{ width: 44 }}>#</th>
                    <th>{t('Candidate')}</th>
                    <th>{t('Matched skills')}</th>
                    <th className="num" style={{ width: 76 }}>
                      {t('Score')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rest.map((m, i) => (
                    <tr
                      key={`${m.resume.id}:${m.resume.recordKey}`}
                      className="clickable"
                      onClick={() => onOpenCandidate(m)}
                    >
                      <td className="muted num">{formatNumber(i + 4)}</td>
                      <td>
                        <div className="cell-title" dir="auto">{m.resume.name ?? m.resume.fileName}</div>
                        <div className="cell-sub" dir="auto">{m.resume.fileName}</div>
                      </td>
                      <td className="muted">
                        {m.matchedSkills.length ? m.matchedSkills.slice(0, 6).map((skill, index) => <span key={skill}>{index > 0 && ', '}<bdi>{skill}</bdi></span>) : t('none')}
                        {m.matchedSkills.length > 6 && ` +${formatNumber(m.matchedSkills.length - 6)}`}
                      </td>
                      <td className="num strong">{formatNumber(Math.round(m.score * 100))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </details>
          )}
        </div>
      )}

      {pendingConsent && (
        <div className="consent-backdrop">
          <section
            ref={consentDialogRef}
            className="consent-dialog card"
            role="dialog"
            tabIndex={-1}
            aria-modal="true"
            aria-labelledby="claude-consent-title"
          >
            <h3 id="claude-consent-title">{t('Review data sent to Anthropic')}</h3>
            <p>
              {t('Claude reranking sends this posting and redacted evidence for {count} candidates to Anthropic using {model}. Qumaa redacts detected names, contact details, locations, filenames, and local paths. Years of experience, education, and matched or missing skills are included. Your API key is never part of the request body. Review the complete payload below before continuing.', { count: formatNumber(pendingConsent.preview.candidateCount), model: pendingConsent.preview.model })}
            </p>
            <h4>{t('Exact outbound request')}</h4>
            <pre className="consent-payload" dir="ltr">
              {JSON.stringify(pendingConsent.preview.requestBody, null, 2)}
            </pre>
            <div className="row consent-actions">
              <span className="muted">
                {t('Standard matching remains local. This approval is remembered until the data policy changes.')}
              </span>
              <span className="spacer" />
              <button
                ref={consentCancelRef}
                className="btn"
                onClick={() => {
                  setPendingConsent(null)
                  requestAnimationFrame(() => rerankButtonRef.current?.focus())
                }}
              >
                {t('Cancel')}
              </button>
              <button
                className="btn primary"
                onClick={() => {
                  const request = pendingConsent
                  setPendingConsent(null)
                  void executeRerank({
                    sessionId: request.sessionId,
                    resultKey: request.resultKey,
                    approvalToken: request.approvalToken
                  })
                }}
              >
                {t('Approve and send')}
              </button>
            </div>
          </section>
        </div>
      )}
    </>
  )
}
