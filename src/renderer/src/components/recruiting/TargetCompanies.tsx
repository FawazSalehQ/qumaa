import { useEffect, useState } from 'react'
import type { Company, JobTargetCompany, SavedJob } from '@shared/recruiting.js'
import { useI18n } from '../../i18n.js'

const STATUS_LABELS: Record<JobTargetCompany['status'], string> = {
  'to-research': 'To research', researching: 'Researching', mapped: 'Mapped', excluded: 'Excluded'
}

interface Props {
  job: SavedJob
  companies: Company[]
  disabled: boolean
  onDirtyChange: (dirty: boolean) => void
  onSave: (companies: JobTargetCompany[], expectedUpdatedAt: number) => Promise<boolean>
  onOpenCompanies: () => void
}

export default function TargetCompanies({ job, companies, disabled, onDirtyChange, onSave, onOpenCompanies }: Props): React.JSX.Element {
  const { t, formatNumber } = useI18n()
  const [draft, setDraft] = useState<JobTargetCompany[] | null>(null)
  const [revision, setRevision] = useState(job.updatedAt)
  const [selected, setSelected] = useState('')
  const [saving, setSaving] = useState(false)
  useEffect(() => { onDirtyChange(draft !== null); return () => onDirtyChange(false) }, [draft !== null, onDirtyChange])
  const rows = draft ?? job.targetCompanies ?? []
  const available = companies.filter((company) => company.id !== job.companyId && !rows.some((row) => row.companyId === company.id))
  const edit = (): void => { setDraft((job.targetCompanies ?? []).map((row) => ({ ...row }))); setRevision(job.updatedAt); setSelected('') }
  const update = (companyId: string, changes: Partial<JobTargetCompany>): void => setDraft((current) => current?.map((row) => row.companyId === companyId ? { ...row, ...changes } : row) ?? null)
  const save = async (): Promise<void> => {
    if (!draft || disabled || saving) return
    setSaving(true)
    try { if (await onSave(draft, revision)) { setDraft(null); setSelected('') } }
    finally { setSaving(false) }
  }
  return <section className="recruit-target-companies" aria-label={t('Target-company map')}>
    <div className="recruit-section-head"><div><h4>{t('Target companies')} <span className="muted">{formatNumber(rows.length)}</span></h4><p className="hint">{t('Plan which companies to research for this vacancy, the roles to look for, and any outreach exclusions.')}</p></div>{draft === null && <button className="btn sm" disabled={disabled} onClick={edit}>{t('Edit company map')}</button>}</div>
    {draft !== null && <div className="recruit-target-add">
      <label className="recruit-field">{t('Company to research')}<select aria-label={t('Company to research')} value={selected} disabled={disabled || saving || rows.length >= 100} onChange={(event) => setSelected(event.target.value)}><option value="">{t('Choose a company')}</option>{available.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
      <button className="btn sm" disabled={disabled || saving || !available.some((company) => company.id === selected) || rows.length >= 100} onClick={() => { setDraft([...draft, { companyId: selected, status: 'to-research', focusRoles: '', note: '' }]); setSelected('') }}>{t('Add target company')}</button>
      <p className="hint">{t('Create companies in the Companies workspace, then add them here. The hiring company is excluded from this list.')}</p>
    </div>}
    {rows.length === 0 ? <div className="recruit-empty-inline"><p>{t('No target companies mapped yet.')}</p>{draft === null && <button className="recruit-text-button" disabled={disabled} onClick={onOpenCompanies}>{t('Manage companies')}</button>}</div> : <div className="recruit-target-list">{rows.map((row) => {
      const company = companies.find((item) => item.id === row.companyId)
      return <article className={`recruit-target-card ${row.status}`} key={row.companyId} aria-label={company?.name ?? t('Company')}>
        <div className="recruit-section-head"><div><h4><bdi>{company?.name ?? t('Company')}</bdi></h4><p className="hint"><bdi>{[...company?.industry ?? [], ...company?.location ?? []].join(' · ')}</bdi></p></div>{draft !== null ? <button className="recruit-text-button" disabled={disabled || saving} aria-label={t('Remove {company} from map', { company: company?.name ?? '' })} onClick={() => setDraft(draft.filter((item) => item.companyId !== row.companyId))}>{t('Remove')}</button> : <span className="recruit-review-state">{t(STATUS_LABELS[row.status])}</span>}</div>
        {draft !== null ? <fieldset className="recruit-fieldset" disabled={disabled || saving}>
          <div className="recruit-editor-columns"><label className="recruit-field">{t('Research status')}<select aria-label={t('Research status')} value={row.status} onChange={(event) => update(row.companyId, { status: event.target.value as JobTargetCompany['status'] })}>{Object.entries(STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{t(label)}</option>)}</select></label><label className="recruit-field">{t('Target roles')}<input dir="auto" maxLength={1000} value={row.focusRoles} onChange={(event) => update(row.companyId, { focusRoles: event.target.value })} placeholder={t('e.g. Senior drilling engineers')} /></label></div>
          <label className="recruit-field">{t('Research notes')}<textarea aria-label={t('Research notes')} dir="auto" rows={3} maxLength={10000} value={row.note} onChange={(event) => update(row.companyId, { note: event.target.value })} /></label>
        </fieldset> : <>{row.focusRoles && <p><span className="hint">{t('Target roles')}: </span><bdi>{row.focusRoles}</bdi></p>}{row.note && <p dir="auto" className="recruit-prewrap">{row.note}</p>}</>}
        {row.status === 'excluded' && <p className="hint">{t('Excluded from this sourcing plan. Candidate matching is unchanged.')}</p>}
      </article>
    })}</div>}
    {draft !== null && <div className="recruit-actions recruit-editor-footer"><button className="btn primary" disabled={disabled || saving} onClick={() => { void save() }}>{saving ? t('Saving…') : t('Save company map')}</button><button className="btn" disabled={disabled || saving} onClick={() => { setDraft(null); setSelected('') }}>{t('Cancel')}</button></div>}
  </section>
}
