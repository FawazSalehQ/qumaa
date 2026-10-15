import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { Company, JobStatus, SavedJob } from '@shared/recruiting.js'
import type { Toast } from '../components/Toasts.js'
import CompanyDetailInput, { type CompanyDetailInputHandle } from '../components/CompanyDetailInput.js'
import { budgetLabel, hiringBudgetLabel } from '../components/recruiting/JobBudgetEditor.js'
import { errorMessage, recruitingError } from '../components/recruiting/helpers.js'
import { jobPostingTitle } from '../jobPosting.js'
import { useI18n } from '../i18n.js'
import '../companies.css'
import HiringBudgets from '../components/companies/HiringBudgets.js'
import LineBadge, { initialsFor, lineToneForKey } from '../components/LineBadge.js'

interface Props {
  onChanged: () => void
  onNavigationLockChange: (locked: boolean) => void
  onNewJob: (companyId: string) => void
  onOpenJob: (jobId: string) => void
  onToast: (toasts: Toast[]) => void
}

const JOB_LABELS: Record<JobStatus, string> = { open: 'Open', 'on-hold': 'On hold', filled: 'Filled', archived: 'Archived' }
const DETAIL_FIELDS = ['industry', 'location', 'contactName', 'contactEmail'] as const
type DetailField = typeof DETAIL_FIELDS[number]
type CompanyDraft = Omit<Company, 'id' | 'createdAt' | 'updatedAt'> & { id?: string }

function emptyCompany(): CompanyDraft {
  return { name: '', industry: [], location: [], website: '', contactName: [], contactEmail: [], note: '' }
}

function companyDraft(company: Company): CompanyDraft {
  return {
    id: company.id, name: company.name, industry: company.industry, location: company.location,
    website: company.website, contactName: company.contactName, contactEmail: company.contactEmail, note: company.note
  }
}

function CompanyValues({ values, email = false }: { values: string[]; email?: boolean }): React.JSX.Element {
  const { t } = useI18n()
  return values.length ? <ul className="company-detail-values">{values.map((value, index) => <li key={`${index}-${value}`}><bdi dir={email ? 'ltr' : 'auto'}>{value}</bdi></li>)}</ul> : <>{t('Not recorded')}</>
}

function CompanySymbol(): React.JSX.Element {
  return <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="M3 21h18M5 21V4h9v17M14 9h5v12M8 7h3M8 11h3M8 15h3M9 21v-3M17 12v1M17 16v1" /></svg>
}

export default function CompaniesView({ onChanged, onNavigationLockChange, onNewJob, onOpenJob, onToast }: Props): React.JSX.Element {
  const { t, language, locale, formatNumber, formatDate } = useI18n()
  const [companies, setCompanies] = useState<Company[]>([])
  const [jobs, setJobs] = useState<SavedJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [draft, setDraft] = useState<CompanyDraft | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [loadFailed, setLoadFailed] = useState(false)
  const [reloadRevision, setReloadRevision] = useState(0)
  const savingRef = useRef(false)
  const mounted = useRef(false)
  const nameInput = useRef<HTMLInputElement>(null)
  const formHeading = useRef<HTMLHeadingElement>(null)
  const detailInputs = useRef<Partial<Record<DetailField, CompanyDetailInputHandle | null>>>({})
  const [budgetEditing, setBudgetEditing] = useState(false)
  const locked = draft !== null || saving || budgetEditing

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  // The directory unmounts when a different tab opens. Make explicit Save or
  // Cancel the only way out of an editor, including native menu shortcuts.
  useLayoutEffect(() => {
    onNavigationLockChange(locked)
    return () => onNavigationLockChange(false)
  }, [locked, onNavigationLockChange])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setLoadFailed(false)
    setError(null)
    void Promise.all([window.api.recruiting.listCompanies(), window.api.recruiting.listJobs()]).then(([nextCompanies, nextJobs]) => {
      if (cancelled) return
      setCompanies(nextCompanies)
      setJobs(nextJobs)
      setSelectedId((current) => nextCompanies.some((company) => company.id === current) ? current : null)
    }).catch((failure: unknown) => {
      if (!cancelled) { setError(errorMessage(failure)); setLoadFailed(true) }
    }).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [reloadRevision])

  useEffect(() => {
    if (draft) nameInput.current?.focus()
  }, [draft?.id, draft !== null])

  const jobsByCompany = useMemo(() => {
    const grouped = new Map<string, SavedJob[]>()
    for (const job of jobs) {
      if (!job.companyId) continue
      const companyJobs = grouped.get(job.companyId) ?? []
      companyJobs.push(job)
      grouped.set(job.companyId, companyJobs)
    }
    return grouped
  }, [jobs])
  const filtered = useMemo(() => {
    const filter = query.trim().toLocaleLowerCase(locale)
    return companies.filter((company) => !filter || [company.name, ...company.industry, ...company.location, ...company.contactName, ...company.contactEmail]
      .some((value) => value.toLocaleLowerCase(locale).includes(filter)))
      .sort((a, b) => a.name.localeCompare(b.name, locale) || a.id.localeCompare(b.id))
  }, [companies, query, locale])
  const selected = companies.find((company) => company.id === selectedId) ?? null
  const companyJobs = selected ? jobsByCompany.get(selected.id) ?? [] : []
  const activeJobs = companyJobs.filter((job) => job.status === 'open' || job.status === 'on-hold').length

  const beginCreate = (): void => {
    if (locked || loading || loadFailed) return
    setError(null)
    setDraft(emptyCompany())
  }
  const beginEdit = (): void => {
    if (locked || !selected) return
    setError(null)
    setDraft(companyDraft(selected))
  }
  const cancelEdit = (): void => {
    if (savingRef.current) return
    setDraft(null)
    setError(null)
  }
  const changeField = (field: 'name' | 'website' | 'note', value: string): void => {
    if (savingRef.current) return
    setDraft((current) => current ? { ...current, [field]: value } : null)
  }
  const changeDetails = (field: DetailField, values: string[]): void => {
    if (savingRef.current) return
    setDraft((current) => current ? { ...current, [field]: values } : null)
  }
  const saveCompany = async (): Promise<void> => {
    if (!draft || savingRef.current || !draft.name.trim()) return
    const submitted = { ...draft }
    for (const field of DETAIL_FIELDS) {
      const values = detailInputs.current[field]?.valuesForSave()
      if (!values) return
      submitted[field] = values
    }
    savingRef.current = true
    setSaving(true)
    setError(null)
    try {
      const company = await window.api.recruiting.saveCompany({
        ...submitted, name: draft.name.trim(), website: draft.website.trim(), note: draft.note.trim()
      })
      onChanged()
      if (!mounted.current) return
      setCompanies((current) => [...current.filter((item) => item.id !== company.id), company])
      setSelectedId(company.id)
      setQuery('')
      setDraft(null)
      onToast([{ id: crypto.randomUUID(), kind: 'success', message: t('Company saved') }])
    } catch (failure: unknown) {
      if (mounted.current) {
        setError(errorMessage(failure))
        formHeading.current?.focus()
      }
    } finally {
      savingRef.current = false
      if (mounted.current) setSaving(false)
    }
  }

  return <div className="companies">
    <header className="company-page-head">
      <div><h2>{t('Companies')}</h2><p className="hint">{t('Keep company context, contacts, and hiring assignments together.')}</p></div>
      <button type="button" className="btn primary" disabled={locked || loading || loadFailed} onClick={beginCreate}>{t('+ New company')}</button>
    </header>
    {error && <div className="company-error" role="alert"><span>{recruitingError(error, t, language)}</span>{loadFailed && <button type="button" className="btn sm" onClick={() => setReloadRevision((revision) => revision + 1)}>{t('Retry')}</button>}</div>}
    <div className="company-layout">
      <aside className="company-directory" aria-label={t('Company directory')}>
        <div className="company-directory-head">
          <p className="company-eyebrow">{t('All companies')}<span>{formatNumber(companies.length)}</span></p>
          <label className="sr-only" htmlFor="company-filter">{t('Filter companies')}</label>
          <input id="company-filter" type="search" dir="auto" placeholder={t('Search companies…')} value={query} onChange={(event) => setQuery(event.target.value)} />
        </div>
        {loading ? <p className="company-inline-empty" role="status">{t('Loading companies…')}</p>
          : loadFailed ? <p className="company-inline-empty">{t('Your company directory could not be loaded.')}</p>
          : filtered.length === 0 ? <p className="company-inline-empty">{companies.length ? t('No companies match your search.') : t('Your saved companies will appear here.')}</p>
          : <div className="company-list">{filtered.map((company) => {
            const count = jobsByCompany.get(company.id)?.length ?? 0
            return <button type="button" key={company.id} className={`company-list-item ${selectedId === company.id && !draft ? 'selected' : ''}`} disabled={locked} aria-label={t('Open company {name}', { name: company.name })} aria-current={selectedId === company.id && !draft ? 'page' : undefined} onClick={() => { setSelectedId(company.id); setError(null) }}>
              <LineBadge tone={lineToneForKey(company.id)}>{initialsFor(company.name)}</LineBadge>
              <span className="company-list-body">
              <span className="company-list-name"><bdi>{company.name}</bdi></span>
              {(company.industry.length > 0 || company.location.length > 0) && <span className="company-list-context"><bdi>{[...company.industry, ...company.location].join(' · ')}</bdi></span>}
              <span className="company-list-meta">{t(count === 1 ? '{count} job' : '{count} jobs', { count })}</span>
              </span>
            </button>
          })}</div>}
        <p className="company-local-note"><span aria-hidden="true">◉</span>{t('Saved locally on this device')}</p>
      </aside>

      <section className="company-workspace" aria-label={draft ? t(draft.id ? 'Edit company' : 'New company') : selected?.name || t('Company overview')} aria-busy={loading || saving}>
        {draft ? <form className="company-editor" onSubmit={(event) => { event.preventDefault(); void saveCompany() }}>
          <div className="company-editor-head"><h3 ref={formHeading} tabIndex={-1}>{t(draft.id ? 'Edit company' : 'New company')}</h3><p className="hint">{t('Only a company name is required. Add context as your relationship develops.')}</p><p className="hint">{t('Type a detail and select Add, or press Enter. Use × to remove an entry.')}</p></div>
          <fieldset className="company-form-fields" disabled={saving}>
            <legend className="sr-only">{t('Company details')}</legend>
            <label className="company-field company-field-wide">{t('Company name')}<input ref={nameInput} name="companyName" required maxLength={512} dir="auto" value={draft.name} onChange={(event) => changeField('name', event.target.value)} autoComplete="off" /></label>
            <CompanyDetailInput ref={(handle) => { detailInputs.current.industry = handle }} name="industry" label="Industry" values={draft.industry} onChange={(values) => changeDetails('industry', values)} />
            <CompanyDetailInput ref={(handle) => { detailInputs.current.location = handle }} name="location" label="Location" values={draft.location} onChange={(values) => changeDetails('location', values)} />
            <label className="company-field company-field-wide">{t('Website')}<input name="website" maxLength={2_048} dir="ltr" inputMode="url" placeholder="example.com" value={draft.website} onChange={(event) => changeField('website', event.target.value)} /></label>
            <CompanyDetailInput ref={(handle) => { detailInputs.current.contactName = handle }} name="contactName" label="Contact name" values={draft.contactName} onChange={(values) => changeDetails('contactName', values)} />
            <CompanyDetailInput ref={(handle) => { detailInputs.current.contactEmail = handle }} name="contactEmail" label="Contact email" values={draft.contactEmail} email onChange={(values) => changeDetails('contactEmail', values)} />
            <label className="company-field company-field-wide">{t('Company notes')}<textarea name="note" aria-label={t('Company notes')} rows={5} maxLength={10_000} dir="auto" placeholder={t('Hiring context, relationship history, or useful research…')} value={draft.note} onChange={(event) => changeField('note', event.target.value)} /></label>
          </fieldset>
          <p className="company-edit-notice" role="status">{t('Save or cancel company details before leaving this page.')}</p>
          <div className="company-form-actions"><button type="submit" className="btn primary" disabled={saving || !draft.name.trim()}>{t(saving ? 'Saving company…' : draft.id ? 'Save company' : 'Create company')}</button><button type="button" className="btn" disabled={saving} onClick={cancelEdit}>{t('Cancel')}</button></div>
        </form> : loading ? <div className="company-empty" role="status"><p>{t('Loading companies…')}</p></div> : selected ? <>
          <header className="company-detail-head">
            <div className="company-identity"><LineBadge size="lg" tone={lineToneForKey(selected.id)}>{initialsFor(selected.name)}</LineBadge><div><h3><bdi>{selected.name}</bdi></h3>{(selected.industry.length > 0 || selected.location.length > 0) && <p className="hint" dir="auto">{[...selected.industry, ...selected.location].join(' · ')}</p>}</div></div>
            <button type="button" className="btn sm" disabled={locked} onClick={beginEdit}>{t('Edit company')}</button>
          </header>
          <dl className="company-stats"><div><dt>{t('Active jobs')}</dt><dd>{formatNumber(activeJobs)}</dd></div><div><dt>{t('Filled jobs')}</dt><dd>{formatNumber(companyJobs.filter((job) => job.status === 'filled').length)}</dd></div><div><dt>{t('All jobs')}</dt><dd>{formatNumber(companyJobs.length)}</dd></div></dl>
          <section className="company-context" aria-labelledby="company-context-title">
            <h4 id="company-context-title">{t('Company details')}</h4>
            <dl className="company-details">
              <div><dt>{t('Industry')}</dt><dd><CompanyValues values={selected.industry} /></dd></div>
              <div><dt>{t('Location')}</dt><dd><CompanyValues values={selected.location} /></dd></div>
              <div><dt>{t('Contact name')}</dt><dd><CompanyValues values={selected.contactName} /></dd></div>
              <div><dt>{t('Contact email')}</dt><dd><CompanyValues values={selected.contactEmail} email /></dd></div>
              <div className="company-field-wide"><dt>{t('Website')}</dt><dd><bdi dir="ltr">{selected.website || t('Not recorded')}</bdi></dd></div>
            </dl>
            {selected.note && <div className="company-notes"><h4>{t('Company notes')}</h4><p dir="auto">{selected.note}</p></div>}
            <p className="company-updated">{t('Company updated {date}', { date: formatDate(selected.updatedAt, { year: 'numeric', month: 'short', day: 'numeric' }) })}</p>
          </section>
          <HiringBudgets key={selected.id} companyId={selected.id} jobs={companyJobs} onLockChange={setBudgetEditing} />
          <section className="company-jobs" aria-labelledby="company-jobs-title">
            <header className="company-section-head"><div><h4 id="company-jobs-title">{t('Jobs at this company')}</h4><p className="hint">{t('Each job keeps its own budget, candidates, and hiring progress.')}</p></div><button type="button" className="btn primary sm" disabled={locked} onClick={() => onNewJob(selected.id)}>{t('+ New job for company')}</button></header>
            {companyJobs.length === 0 ? <div className="company-jobs-empty"><p>{t('No jobs at this company yet.')}</p><p className="hint">{t('Create the first assignment, or attach an existing job from its editor.')}</p></div>
              : <div className="company-job-list">{companyJobs.map((job) => <button type="button" key={job.id} className="company-job" disabled={locked} aria-label={t('Open job {title}', { title: jobPostingTitle(job.posting) })} onClick={() => onOpenJob(job.id)}>
                <div><strong><bdi>{jobPostingTitle(job.posting)}</bdi></strong>
                  {job.budget && <span className="company-job-budget"><span>{t('Salary budget')}: </span><bdi>{budgetLabel(job.budget, formatNumber, t)}</bdi></span>}
                  {job.hiringBudget && <span className="company-job-budget"><span>{t('Total hiring budget')}: </span><bdi>{hiringBudgetLabel(job.hiringBudget, formatNumber, t)}</bdi></span>}
                  {!job.budget && !job.hiringBudget && <span className="company-job-budget">{t('Budget not set')}</span>}
                </div>
                <div className="company-job-progress"><span className={`company-job-status ${job.status}`}>{t(JOB_LABELS[job.status])}</span><span>{t('{count} shortlisted', { count: job.shortlistCount })}</span></div>
                <span className="company-job-open" aria-hidden="true">{t('Open job')}<svg className="directional-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M3 8h10M9 4l4 4-4 4" /></svg></span>
              </button>)}</div>}
          </section>
        </> : <div className="company-empty"><span className="company-symbol"><CompanySymbol /></span><h3>{t(companies.length ? 'Choose a company' : 'Start with a company')}</h3><p>{t(companies.length ? 'Open a company to see its contacts, context, and jobs.' : 'Build a directory of clients and target employers, then organize jobs under each client.')}</p>{!companies.length && !loadFailed && <button type="button" className="btn primary" onClick={beginCreate}>{t('Create your first company')}</button>}</div>}
      </section>
    </div>
  </div>
}
