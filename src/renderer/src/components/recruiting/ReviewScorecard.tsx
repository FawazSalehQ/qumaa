import { useLayoutEffect, useRef, useState } from 'react'
import type { AssessmentStatus, CandidateReview, CriterionAssessment, JobWorkspace, ReviewStatus, SaveReviewInput } from '@shared/recruiting.js'
import { reviewForMatch } from '@shared/recruiting.js'
import type { MatchResult } from '@shared/types.js'
import { ASSESSMENT_LABELS, candidateName, matchProfile, REVIEW_LABELS } from './helpers.js'

interface Props {
  workspace: JobWorkspace
  match: MatchResult
  busy: boolean
  onSave: (input: SaveReviewInput) => Promise<boolean>
  onClose: () => void
  onDirty: (dirty: boolean) => void
  onOpenCandidate: (match: MatchResult) => void
}

type ReviewDraft = Pick<CandidateReview, 'status' | 'note' | 'assessments'>

function reviewDraft(review?: CandidateReview): ReviewDraft {
  return {
    status: review?.status ?? 'unreviewed',
    note: review?.note ?? '',
    assessments: review?.assessments.map((assessment) => ({ ...assessment })) ?? []
  }
}

export default function ReviewScorecard({ workspace, match, busy, onSave, onClose, onDirty, onOpenCandidate }: Props): React.JSX.Element {
  const review = reviewForMatch(workspace.reviews, workspace.profiles, match)
  const [draft, setDraft] = useState<ReviewDraft>(() => reviewDraft(review))
  const [dirty, setDirty] = useState(false)
  const [externalChange, setExternalChange] = useState(false)
  const [confirmDiscard, setConfirmDiscard] = useState(false)
  const profile = matchProfile(workspace, match)
  const suggestions = workspace.evidence[match.resume.recordKey] ?? []
  const evidenceLoading = workspace.evidence[match.resume.recordKey] === undefined
  const savedVersion = JSON.stringify(review ?? null)
  const lastSavedVersion = useRef(savedVersion)

  // Linking CV versions can transfer a previously saved review while this
  // scorecard stays mounted. Never let an older draft erase that history.
  useLayoutEffect(() => {
    if (savedVersion === lastSavedVersion.current) return
    lastSavedVersion.current = savedVersion
    const latest = reviewDraft(review)
    if (!dirty || JSON.stringify(draft) === JSON.stringify(latest)) {
      setDraft(latest)
      setDirty(false)
      onDirty(false)
      setExternalChange(false)
    } else {
      setExternalChange(true)
    }
  }, [savedVersion, review, dirty, draft, onDirty])

  const change = (patch: Partial<typeof draft>): void => {
    setDraft((current) => ({ ...current, ...patch }))
    setDirty(true)
    onDirty(true)
  }
  const changeAssessment = (criterionId: string, patch: Partial<CriterionAssessment>): void => {
    const current = draft.assessments.find((assessment) => assessment.criterionId === criterionId)
    const updated = { criterionId, status: 'unreviewed' as AssessmentStatus, note: '', ...current, ...patch }
    change({ assessments: [...draft.assessments.filter((assessment) => assessment.criterionId !== criterionId), updated] })
  }

  return (
    <section className="recruit-review" aria-labelledby="review-title">
      <div className="recruit-section-head">
        <div>
          <p className="recruit-eyebrow">Job-specific review</p>
          <h3 id="review-title" dir="auto">{candidateName(match, profile)}</h3>
          <p className="hint" dir="auto">Reviewing CV: {match.resume.fileName}</p>
        </div>
        <button className="btn sm" type="button" disabled={busy} onClick={() => {
          if (dirty) setConfirmDiscard(true)
          else onClose()
        }}>Close review</button>
      </div>
      <form onSubmit={(event) => {
        event.preventDefault()
        if (externalChange || busy || !dirty) return
        void onSave({
          jobId: workspace.job.id,
          resume: { id: match.resume.id, recordKey: match.resume.recordKey },
          ...draft,
          order: review?.order ?? Math.max(0, ...workspace.reviews.map((item) => item.order)) + 1024
        }).then((saved) => {
          if (!saved) return
          setDirty(false)
          onDirty(false)
          setConfirmDiscard(false)
        })
      }}>
        <fieldset disabled={busy} className="recruit-fieldset">
          {externalChange && <div className="recruit-notice" role="alert">
            <div>
              <strong>This candidate’s saved review changed.</strong>
              <p>Your unsaved draft is still below. Load the saved review, or check the saved details before choosing to replace them with this draft.</p>
              <details>
                <summary>View the saved review</summary>
                <p>Review state: {REVIEW_LABELS[review?.status ?? 'unreviewed']}</p>
                <p className="recruit-prewrap" dir="auto">{review?.note || 'No saved notes.'}</p>
                {review?.assessments.map((assessment) => (
                  <p key={assessment.criterionId} className="recruit-prewrap" dir="auto">
                    {workspace.job.criteria.find((criterion) => criterion.id === assessment.criterionId)?.text ?? 'Requirement'}: {ASSESSMENT_LABELS[assessment.status]}
                    {assessment.note ? ` — ${assessment.note}` : ''}
                  </p>
                ))}
              </details>
            </div>
            <button className="btn sm" type="button" onClick={() => {
              setDraft(reviewDraft(review))
              setDirty(false)
              onDirty(false)
              setExternalChange(false)
              setConfirmDiscard(false)
            }}>Load saved review</button>
            <button className="btn sm" type="button" onClick={() => setExternalChange(false)}>Keep my draft</button>
          </div>}
          <div className="recruit-review-fields">
            <label className="recruit-field">Review state
              <select value={draft.status} onChange={(event) => change({ status: event.target.value as ReviewStatus })}>
                {Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="recruit-field">{draft.status === 'not-proceeding' ? 'Decision reason and notes' : 'Screening notes / recommendation'}
              <textarea rows={3} dir="auto" maxLength={10000} value={draft.note} onChange={(event) => change({ note: event.target.value })} placeholder="Record the conversation, follow-up questions, or recommendation for this job." />
            </label>
          </div>
          <div className="recruit-section-head">
            <div>
              <h4>Requirements scorecard</h4>
              <p className="hint">Suggested passages need your review. Missing information is a follow-up question, not a rejection.</p>
            </div>
            <button className="btn sm" type="button" onClick={() => onOpenCandidate(match)}>Open candidate profile</button>
          </div>
          {workspace.job.criteria.length === 0 && <p className="recruit-empty-inline">Add criteria in Edit job to assess every candidate consistently.</p>}
          <div className="recruit-scorecard">
            {workspace.job.criteria.map((criterion) => {
              const assessment = draft.assessments.find((item) => item.criterionId === criterion.id)
              const passage = suggestions.find((item) => item.criterionId === criterion.id)?.passage
              return (
                <article key={criterion.id} className="recruit-criterion-review">
                  <div className="recruit-criterion-title">
                    <span className={`recruit-importance ${criterion.importance}`}>{criterion.importance}</span>
                    <strong dir="auto">{criterion.text}</strong>
                  </div>
                  {passage ? <div className="recruit-passage">
                    <span className="recruit-evidence-label">Suggested passage · {passage.section}</span>
                    <blockquote dir="auto">{passage.text}</blockquote>
                    <button type="button" className="recruit-text-button" onClick={() => onOpenCandidate({ ...match, evidence: [passage, ...match.evidence.filter((item) => item.text !== passage.text)] })}>Read with candidate evidence</button>
                  </div> : <p className="hint">{evidenceLoading ? 'Suggested evidence has not loaded yet.' : 'No suggested passage found. Check the full CV or ask the candidate.'}</p>}
                  <div className="recruit-assessment-fields">
                    <label className="recruit-field">Assessment
                      <select aria-label={`Assessment: ${criterion.text}`} value={assessment?.status ?? 'unreviewed'} onChange={(event) => changeAssessment(criterion.id, { status: event.target.value as AssessmentStatus })}>
                        {Object.entries(ASSESSMENT_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                      </select>
                    </label>
                    <label className="recruit-field">Evidence or follow-up note
                      <input aria-label={`Evidence note: ${criterion.text}`} dir="auto" maxLength={4000} value={assessment?.note ?? ''} onChange={(event) => changeAssessment(criterion.id, { note: event.target.value })} placeholder="What supports this assessment?" />
                    </label>
                  </div>
                </article>
              )
            })}
          </div>
          <div className="recruit-actions">
            <button className="btn primary" type="submit" disabled={!dirty || externalChange}>{busy ? 'Saving…' : 'Save review'}</button>
            <span className="hint" role="status">{dirty ? 'Unsaved review changes' : review ? 'Review saved on this device' : 'No review saved yet'}</span>
          </div>
          {confirmDiscard && <div className="recruit-notice" role="alert">
            <span>This review has unsaved changes.</span>
            <button className="btn sm" type="button" onClick={() => setConfirmDiscard(false)}>Keep editing</button>
            <button className="btn sm" type="button" onClick={() => { onDirty(false); onClose() }}>Discard changes</button>
          </div>}
        </fieldset>
      </form>
    </section>
  )
}
