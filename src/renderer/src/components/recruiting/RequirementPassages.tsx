import type { JobWorkspace } from '@shared/recruiting.js'
import type { MatchResult } from '@shared/types.js'
import { criterionImportanceLabel } from '@shared/job-requirements.js'
import { useI18n } from '../../i18n.js'
import { CriterionSource } from './JobCriteriaEditor.js'

/** Express searches inspect source evidence without creating recruiter reviews. */
export default function RequirementPassages({ workspace, match, onClose, onOpenCandidate }: { workspace: JobWorkspace; match: MatchResult; onClose: () => void; onOpenCandidate: (match: MatchResult) => void }): React.JSX.Element {
  const { t } = useI18n()
  const evidence = workspace.evidence[match.resume.recordKey]
  return <section aria-label={t('Requirement passages')}>
    <div className="recruit-section-head"><h4>{t('Requirement passages')} · <bdi>{match.resume.name ?? match.resume.fileName}</bdi></h4><button type="button" className="btn sm" onClick={onClose}>{t('Close passages')}</button></div>
    <p className="hint">{t('This express search is read-only. Save as job to record assessments.')}</p>
    <div className="recruit-scorecard">{workspace.job.criteria.map((criterion) => {
      const passage = evidence?.find((entry) => entry.criterionId === criterion.id)?.passage
      return <article key={criterion.id} className="recruit-criterion-review"><div className="recruit-criterion-title"><span className={`recruit-importance ${criterion.importance}`}>{t(criterionImportanceLabel(criterion.importance))}</span><strong dir="auto">{criterion.text}</strong></div><CriterionSource criterion={criterion} />
        {!evidence ? <p className="hint">{t('Finding suggested passages for your scorecard…')}</p> : passage ? <div className="recruit-passage"><span className="recruit-evidence-label">{t('Nearest passage · {section} · Review needed', { section: t(passage.section) })}</span><blockquote dir="auto">{passage.text}</blockquote><button type="button" className="recruit-text-button" onClick={() => onOpenCandidate({ ...match, evidence: [passage, ...match.evidence.filter((item) => item.text !== passage.text)] })}>{t('Read with candidate evidence')}</button></div> : <p className="hint">{t('No indexed passage is available. Check the original CV or follow up with the candidate.')}</p>}
      </article>
    })}</div>
  </section>
}
