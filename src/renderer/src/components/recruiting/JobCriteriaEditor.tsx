import { useState } from 'react'
import type { JobCriterion, JobPosting } from '@shared/recruiting.js'
import { criterionImportanceLabel, extractJobRequirements } from '@shared/job-requirements.js'
import { useI18n } from '../../i18n.js'

export function CriterionSource({ criterion }: { criterion: JobCriterion }): React.JSX.Element | null {
  const { t } = useI18n()
  if (!criterion.source) return null
  const field = { jobDescription: 'Job description', requirements: 'Requirements', educationAndCertifications: 'Education and certifications' }[criterion.source.field]
  return <details className="recruit-criterion-source"><summary>{t('Original wording · {field}', { field: t(field) })}</summary><blockquote dir="auto">{criterion.source.text}</blockquote><p className="hint">{t('Original wording is retained when you edit this requirement.')}</p></details>
}

export default function JobCriteriaEditor({ posting, criteria, onChange }: { posting: JobPosting; criteria: JobCriterion[]; onChange: (criteria: JobCriterion[]) => void }): React.JSX.Element {
  const { t, formatNumber } = useI18n()
  const [notice, setNotice] = useState<{ added: number; omitted: number } | null>(null)
  const extract = (): void => {
    const result = extractJobRequirements(posting)
    const existing = new Set(criteria.flatMap((criterion) => [criterion.text.trim().toLocaleLowerCase(), criterion.source?.text.trim().replace(/^[-*•▪◦]\s*/u, '').toLocaleLowerCase()].filter((value): value is string => !!value)))
    const additions = result.requirements.filter((requirement) => !existing.has(requirement.text.toLocaleLowerCase()) && !criteria.some((criterion) => criterion.source?.field === requirement.source?.field && criterion.source?.text === requirement.source?.text))
    const accepted = additions.slice(0, 40 - criteria.length)
    onChange([...criteria, ...accepted.map((requirement) => ({ ...requirement, id: crypto.randomUUID() }))])
    setNotice({ added: accepted.length, omitted: result.omitted + additions.length - accepted.length })
  }
  return <section aria-label={t('Evaluation criteria')}>
    <div className="recruit-section-head"><div><h4>{t('Evaluation criteria')} <span className="muted"><bdi>{formatNumber(criteria.length)}/{formatNumber(40)}</bdi></span></h4><p className="hint">{t('Review requirements from the vacancy, correct the wording, and choose their importance. No criterion automatically rejects anyone.')}</p></div></div>
    <div className="recruit-criteria-editor">{criteria.map((criterion, index) => <div key={criterion.id}>
      <div className="recruit-criterion-row"><span className="muted">{formatNumber(index + 1)}</span><input aria-label={t('Criterion {count}', { count: index + 1 })} dir="auto" maxLength={1000} value={criterion.text} placeholder={t('Describe a responsibility, skill, experience, or qualification')} onChange={(event) => onChange(criteria.map((item) => item.id === criterion.id ? { ...item, text: event.target.value } : item))} /><select aria-label={t('Importance of criterion {count}', { count: index + 1 })} value={criterion.importance} onChange={(event) => onChange(criteria.map((item) => item.id === criterion.id ? { ...item, importance: event.target.value as JobCriterion['importance'] } : item))}>{(['unspecified', 'required', 'preferred'] as const).map((importance) => <option key={importance} value={importance}>{t(criterionImportanceLabel(importance))}</option>)}</select><button className="btn sm" type="button" aria-label={t('Remove criterion {count}', { count: index + 1 })} onClick={() => onChange(criteria.filter((item) => item.id !== criterion.id))}>{t('Remove')}</button></div>
      <CriterionSource criterion={criterion} />
    </div>)}</div>
    <div className="recruit-actions"><button className="btn sm" type="button" disabled={criteria.length >= 40} onClick={() => onChange([...criteria, { id: crypto.randomUUID(), text: '', importance: 'unspecified' }])}>{t('+ Add criterion')}</button><button className="btn sm" type="button" disabled={criteria.length >= 40 || ![posting.jobDescription, posting.requirements, posting.educationAndCertifications].some((value) => value.trim())} onClick={extract}>{t('Use requirement lines')}</button></div>
    <p className="hint">{t('Reads the description, requirements, and qualifications. Suggested priorities need your review; unclear priorities remain Unspecified.')}</p>
    {notice && <p role="status" className="hint">{t('Added {count} requirement drafts. Existing edits are retained.', { count: notice.added })}{notice.omitted > 0 && <> {t('{count} requirements were omitted because of length or the 40-item limit. Review the original posting.', { count: notice.omitted })}</>}</p>}
  </section>
}
