import { useI18n } from '../../i18n.js'
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
  const { t } = useI18n()
  if (matches.length < 2) return <div className="recruit-empty"><h3>{t("Compare your finalists")}</h3><p>{t("Select two to four candidates using the Compare checkboxes in Candidates or Shortlist.")}</p></div>
  return (
    <div className="recruit-comparison-scroll" tabIndex={0} aria-label={t("Candidate comparison table")}>
      <table className="recruit-comparison">
        <thead><tr><th scope="col">{t("Criteria")}</th>{matches.map((match) => <th key={match.resume.recordKey} scope="col">
          <button type="button" className="recruit-name" dir="auto" onClick={() => onOpenCandidate(match)}>{candidateName(match, matchProfile(workspace, match))}</button>
          <div className="recruit-comparison-actions"><span className="hint">{t('Match {score}', { score: Math.round(match.score * 100) })}</span><button className="recruit-text-button" type="button" onClick={() => onRemove(match.resume.recordKey)}>{t("Remove")}</button></div>
        </th>)}</tr></thead>
        <tbody>
          <tr><th scope="row">{t("Review state")}</th>{matches.map((match) => <td key={match.resume.recordKey}>{t(REVIEW_LABELS[reviewForMatch(workspace.reviews, workspace.profiles, match)?.status ?? 'unreviewed'])}</td>)}</tr>
          <tr><th scope="row">{t("Location / experience")}</th>{matches.map((match) => {
            const resume = candidateWithProfile(match.resume, matchProfile(workspace, match))
            return <td key={match.resume.recordKey}><bdi>{resume.location || t('Location not stated')}</bdi><br /><span className="muted">{resume.yearsExperience === null ? t('Experience not stated') : t('{count} years', { count: resume.yearsExperience })}</span></td>
          })}</tr>
          <tr><th scope="row">{t("Availability / notice")}</th>{matches.map((match) => {
            const profile = matchProfile(workspace, match)
            return <td key={match.resume.recordKey}><bdi>{profile?.availability || t('Not confirmed')}</bdi><br /><bdi className="muted">{profile?.noticePeriod || t('Notice not confirmed')}</bdi></td>
          })}</tr>
          <tr><th scope="row">{t("Expected salary")}</th>{matches.map((match) => <td key={match.resume.recordKey} dir="auto">{matchProfile(workspace, match)?.expectedSalary || t('Not confirmed')}</td>)}</tr>
          <tr><th scope="row">{t("Preferred location")}</th>{matches.map((match) => <td key={match.resume.recordKey} dir="auto">{matchProfile(workspace, match)?.preferredLocation || t('Not confirmed')}</td>)}</tr>
          <tr><th scope="row">{t("Skills")}</th>{matches.map((match) => <td key={match.resume.recordKey} dir="auto">{candidateWithProfile(match.resume, matchProfile(workspace, match)).skills.join(', ') || t('Not stated')}</td>)}</tr>
          {workspace.job.criteria.map((criterion) => <tr key={criterion.id}>
            <th scope="row"><span className={`recruit-importance ${criterion.importance}`}>{t(criterion.importance === 'required' ? 'Required' : 'Preferred')}</span><div dir="auto">{criterion.text}</div></th>
            {matches.map((match) => {
              const assessment = reviewForMatch(workspace.reviews, workspace.profiles, match)?.assessments.find((item) => item.criterionId === criterion.id)
              const passage = workspace.evidence[match.resume.recordKey]?.find((item) => item.criterionId === criterion.id)?.passage
              return <td key={match.resume.recordKey}>
                <strong className="recruit-assessment-status">{t(ASSESSMENT_LABELS[assessment?.status ?? 'unreviewed'])}</strong>
                {assessment?.note && <p dir="auto">{assessment.note}</p>}
                {passage ? <><span className="recruit-evidence-label">{t('Suggested passage · {section}', { section: t(passage.section) })}</span><blockquote dir="auto">{passage.text}</blockquote><button className="recruit-text-button" type="button" onClick={() => onOpenCandidate({ ...match, evidence: [passage, ...match.evidence.filter((item) => item.text !== passage.text)] })}>{t("Read evidence")}</button></> : <p className="hint">{workspace.evidence[match.resume.recordKey] === undefined ? t('Suggested evidence has not loaded yet.') : t('No suggested passage. Verify with the candidate.')}</p>}
              </td>
            })}
          </tr>)}
          <tr><th scope="row">{t("Job-specific notes")}</th>{matches.map((match) => <td key={match.resume.recordKey} className="recruit-prewrap" dir="auto">{reviewForMatch(workspace.reviews, workspace.profiles, match)?.note || t('No notes yet')}</td>)}</tr>
          <tr><th scope="row">{t("Profile notes")}</th>{matches.map((match) => <td key={match.resume.recordKey} className="recruit-prewrap" dir="auto">{matchProfile(workspace, match)?.note || t('No notes yet')}</td>)}</tr>
        </tbody>
      </table>
    </div>
  )
}
