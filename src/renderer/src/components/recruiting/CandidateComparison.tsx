import type { JobWorkspace } from '@shared/recruiting.js'
import { candidateWithProfile, reviewForMatch } from '@shared/recruiting.js'
import type { MatchResult } from '@shared/types.js'
import { ASSESSMENT_LABELS, candidateName, matchProfile, REVIEW_LABELS } from './helpers.js'

export default function CandidateComparison({ workspace, matches, onOpenCandidate, onRemove }: {
  workspace: JobWorkspace
  matches: MatchResult[]
  onOpenCandidate: (match: MatchResult) => void
  onRemove: (recordKey: string) => void
}): React.JSX.Element {
  if (matches.length < 2) return <div className="recruit-empty"><h3>Compare your finalists</h3><p>Select two to four candidates using the Compare checkboxes in Candidates or Shortlist.</p></div>
  return (
    <div className="recruit-comparison-scroll" tabIndex={0} aria-label="Candidate comparison table">
      <table className="recruit-comparison">
        <thead><tr><th scope="col">Criteria</th>{matches.map((match) => <th key={match.resume.recordKey} scope="col">
          <button type="button" className="recruit-name" dir="auto" onClick={() => onOpenCandidate(match)}>{candidateName(match, matchProfile(workspace, match))}</button>
          <div className="recruit-comparison-actions"><span className="hint">Match {Math.round(match.score * 100)}</span><button className="recruit-text-button" type="button" onClick={() => onRemove(match.resume.recordKey)}>Remove</button></div>
        </th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">Review state</th>{matches.map((match) => <td key={match.resume.recordKey}>{REVIEW_LABELS[reviewForMatch(workspace.reviews, workspace.profiles, match)?.status ?? 'unreviewed']}</td>)}</tr>
          <tr><th scope="row">Location / experience</th>{matches.map((match) => {
            const resume = candidateWithProfile(match.resume, matchProfile(workspace, match))
            return <td key={match.resume.recordKey}>{resume.location || 'Location not stated'}<br /><span className="muted">{resume.yearsExperience === null ? 'Experience not stated' : `${resume.yearsExperience} years`}</span></td>
          })}</tr>
          <tr><th scope="row">Availability / notice</th>{matches.map((match) => {
            const profile = matchProfile(workspace, match)
            return <td key={match.resume.recordKey}>{profile?.availability || 'Not confirmed'}<br /><span className="muted">{profile?.noticePeriod || 'Notice not confirmed'}</span></td>
          })}</tr>
          <tr><th scope="row">Expected salary</th>{matches.map((match) => <td key={match.resume.recordKey}>{matchProfile(workspace, match)?.expectedSalary || 'Not confirmed'}</td>)}</tr>
          <tr><th scope="row">Preferred location</th>{matches.map((match) => <td key={match.resume.recordKey}>{matchProfile(workspace, match)?.preferredLocation || 'Not confirmed'}</td>)}</tr>
          <tr><th scope="row">Skills</th>{matches.map((match) => <td key={match.resume.recordKey} dir="auto">{candidateWithProfile(match.resume, matchProfile(workspace, match)).skills.join(', ') || 'Not stated'}</td>)}</tr>
          {workspace.job.criteria.map((criterion) => <tr key={criterion.id}>
            <th scope="row"><span className={`recruit-importance ${criterion.importance}`}>{criterion.importance}</span><div dir="auto">{criterion.text}</div></th>
            {matches.map((match) => {
              const assessment = reviewForMatch(workspace.reviews, workspace.profiles, match)?.assessments.find((item) => item.criterionId === criterion.id)
              const passage = workspace.evidence[match.resume.recordKey]?.find((item) => item.criterionId === criterion.id)?.passage
              return <td key={match.resume.recordKey}>
                <strong className="recruit-assessment-status">{ASSESSMENT_LABELS[assessment?.status ?? 'unreviewed']}</strong>
                {assessment?.note && <p dir="auto">{assessment.note}</p>}
                {passage ? <><span className="recruit-evidence-label">Suggested passage · {passage.section}</span><blockquote dir="auto">{passage.text}</blockquote><button className="recruit-text-button" type="button" onClick={() => onOpenCandidate({ ...match, evidence: [passage, ...match.evidence.filter((item) => item.text !== passage.text)] })}>Read evidence</button></> : <p className="hint">{workspace.evidence[match.resume.recordKey] === undefined ? 'Suggested evidence has not loaded yet.' : 'No suggested passage. Verify with the candidate.'}</p>}
              </td>
            })}
          </tr>)}
          <tr><th scope="row">Job-specific notes</th>{matches.map((match) => <td key={match.resume.recordKey} className="recruit-prewrap" dir="auto">{reviewForMatch(workspace.reviews, workspace.profiles, match)?.note || 'No notes yet'}</td>)}</tr>
          <tr><th scope="row">Profile notes</th>{matches.map((match) => <td key={match.resume.recordKey} className="recruit-prewrap" dir="auto">{matchProfile(workspace, match)?.note || 'No notes yet'}</td>)}</tr>
        </tbody>
      </table>
    </div>
  )
}
