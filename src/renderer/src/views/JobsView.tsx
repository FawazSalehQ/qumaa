import { useEffect, useMemo, useRef, useState } from 'react'
import type { CandidateProfile, JobCriterion, JobPosting, JobStatus, JobWorkspace, ReviewStatus, SavedJob, SaveReviewInput } from '@shared/recruiting.js'
import { candidateWithProfile, reviewForMatch } from '@shared/recruiting.js'
import type { MatchResult, ResumeSummary } from '@shared/types.js'
import type { Toast } from '../components/Toasts.js'
import CandidateComparison from '../components/recruiting/CandidateComparison.js'
import ReviewScorecard from '../components/recruiting/ReviewScorecard.js'
import { candidateName, errorMessage, indexWorkspace, isShortlisted, matchProfile, REVIEW_LABELS, shortlistMatches } from '../components/recruiting/helpers.js'
import { emptyJobPosting, hasJobPostingContent, jobPostingTitle } from '../jobPosting.js'
import '../recruiting.css'

interface Props {
  resumes: ResumeSummary[]
  libraryRevision: number
  onOpenCandidate: (match: MatchResult) => void
  onToast: (toasts: Toast[]) => void
}

interface JobDraft {
  id?: string
  posting: JobPosting
  status: JobStatus
  criteria: JobCriterion[]
}

const JOB_LABELS: Record<JobStatus, string> = { open: 'Open', 'on-hold': 'On hold', filled: 'Filled', archived: 'Archived' }
const PAGE_SIZE = 50
const EMPTY_FILTERS = { query: '', status: '', location: '', years: '', skill: '', tag: '', availability: '' }

function lastSelectedJob(): string | null {
  try { return localStorage.getItem('qumaa-selected-job') } catch { return null }
}

function dateLabel(value: number | null): string {
  return value === null ? 'Not matched yet' : new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(value)
}

function matchesFilters(match: MatchResult, profile: CandidateProfile | undefined, reviewStatus: ReviewStatus, filters: typeof EMPTY_FILTERS): boolean {
  const resume = candidateWithProfile(match.resume, profile)
  const includes = (value: string, query: string): boolean => value.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())
  const searchable = [resume.name, resume.email, resume.phone, resume.fileName, ...resume.skills, ...(profile?.tags ?? [])].filter(Boolean).join(' ')
  if (filters.query && !includes(searchable, filters.query)) return false
  if (filters.status && reviewStatus !== filters.status) return false
  if (filters.location && !includes(`${resume.location ?? ''} ${profile?.preferredLocation ?? ''}`, filters.location)) return false
  if (filters.years && (resume.yearsExperience === null || resume.yearsExperience < Number(filters.years))) return false
  if (filters.skill && !includes(resume.skills.join(' '), filters.skill)) return false
  if (filters.tag && !includes(profile?.tags.join(' ') ?? '', filters.tag)) return false
  if (filters.availability && !includes(profile?.availability ?? '', filters.availability)) return false
  return true
}

export default function JobsView({ resumes, libraryRevision, onOpenCandidate, onToast }: Props): React.JSX.Element {
  const [jobs, setJobs] = useState<SavedJob[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(lastSelectedJob)
  const [workspace, setWorkspace] = useState<JobWorkspace | null>(null)
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'candidates' | 'shortlist' | 'compare'>('candidates')
  const [jobFilter, setJobFilter] = useState('active')
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(0)
  const [compareKeys, setCompareKeys] = useState<string[]>([])
  const [reviewKey, setReviewKey] = useState<string | null>(null)
  const [reviewDirty, setReviewDirty] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [evidenceLoading, setEvidenceLoading] = useState(false)
  const [evidenceError, setEvidenceError] = useState<string | null>(null)
  const [evidenceRetry, setEvidenceRetry] = useState(0)
  const reviewRef = useRef<HTMLDivElement>(null)
  const reviewSnapshot = useRef<MatchResult | null>(null)
  const reviewDirtyRef = useRef(false)
  const mounted = useRef(true)
  const requestId = useRef(0)
  const creatingJob = useRef(false)
  const locked = Boolean(busy || loading || listLoading || draft || reviewDirty)
  const evidenceKeys = (tab === 'compare' ? compareKeys : reviewKey ? [reviewKey] : []).join('|')

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; ++requestId.current }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.recruiting.listJobs().then((list) => {
      if (cancelled) return
      setJobs(list)
      setSelectedId((current) => current && list.some((job) => job.id === current) ? current : creatingJob.current ? null : list[0]?.id ?? null)
    }).catch((failure: unknown) => { if (!cancelled) setError(errorMessage(failure)) })
      .finally(() => { if (!cancelled) setListLoading(false) })
    return () => { cancelled = true }
  }, [libraryRevision])

  useEffect(() => {
    const request = ++requestId.current
    try {
      if (selectedId) localStorage.setItem('qumaa-selected-job', selectedId)
      else localStorage.removeItem('qumaa-selected-job')
    } catch { /* Persisted jobs remain available if local storage is unavailable. */ }
    if (!selectedId) { setWorkspace(null); setLoading(false); return }
    setLoading(true)
    void window.api.recruiting.getJob(selectedId).then((result) => {
      if (!mounted.current || request !== requestId.current) return
      setWorkspace(result)
      setJobs((list) => list.map((job) => job.id === result.job.id ? result.job : job))
      const availableKeys = new Set(result.response?.results.map((match) => match.resume.recordKey) ?? [])
      setCompareKeys((keys) => keys.filter((key) => availableKeys.has(key)))
      setReviewKey((key) => {
        if (availableKeys.has(key ?? '')) return key
        // Linking versions can replace the displayed result. Keep an unsaved
        // review on its original CV while that CV still exists in the library.
        if (key && reviewDirtyRef.current && resumes.some((resume) => resume.recordKey === key)) return key
        return null
      })
    }).catch((failure: unknown) => {
      if (mounted.current && request === requestId.current) { setWorkspace(null); setError(errorMessage(failure)) }
    }).finally(() => { if (mounted.current && request === requestId.current) setLoading(false) })
  }, [selectedId, libraryRevision])

  useEffect(() => { setPage(0) }, [filters, tab, workspace?.response])
  useEffect(() => { if (!reviewKey) setReviewDirty(false) }, [reviewKey])
  useEffect(() => { reviewDirtyRef.current = reviewDirty }, [reviewDirty])

  useEffect(() => {
    let cancelled = false
    setEvidenceError(null)
    const records = evidenceKeys.split('|').filter(Boolean).flatMap((key) => {
      const match = workspace?.response?.results.find((item) => item.resume.recordKey === key) ?? (reviewSnapshot.current?.resume.recordKey === key ? reviewSnapshot.current : undefined)
      return match && workspace?.evidence[key] === undefined ? [{ id: match.resume.id, recordKey: key }] : []
    })
    if (!workspace || records.length === 0 || loading) { setEvidenceLoading(false); return }
    const id = workspace.job.id
    setEvidenceLoading(true)
    void window.api.recruiting.getEvidence({ jobId: id, resumes: records }).then((evidence) => {
      if (cancelled) return
      setWorkspace((current) => current?.job.id === id ? { ...current, evidence: { ...current.evidence, ...evidence } } : current)
    }).catch((failure: unknown) => { if (!cancelled) setEvidenceError(errorMessage(failure)) })
      .finally(() => { if (!cancelled) setEvidenceLoading(false) })
    return () => { cancelled = true }
  }, [evidenceKeys, workspace?.job.id, workspace?.response?.sessionId, workspace?.evidence, loading, libraryRevision, evidenceRetry])

  const upsertJob = (job: SavedJob): void => {
    setJobs((list) => [job, ...list.filter((item) => item.id !== job.id)].sort((a, b) => b.updatedAt - a.updatedAt))
  }
  const announce = (message: string): void => onToast([{ id: crypto.randomUUID(), kind: 'success', message }])
  const selectJob = (id: string): void => {
    if (locked || selectedId === id) return
    setError(null)
    setSelectedId(id)
    setWorkspace(null)
    setReviewKey(null)
    setReviewDirty(false)
    setCompareKeys([])
    setFilters(EMPTY_FILTERS)
    setTab('candidates')
  }

  const createJob = (): void => {
    if (locked) return
    creatingJob.current = true
    setDraft({ posting: emptyJobPosting(), status: 'open', criteria: [] })
    setError(null)
  }

  const saveJob = async (): Promise<void> => {
    if (!draft || busy || !hasJobPostingContent(draft.posting)) return
    setBusy('save-job')
    setError(null)
    try {
      const job = await window.api.recruiting.saveJob({ ...draft, criteria: draft.criteria.filter((criterion) => criterion.text.trim()).map((criterion) => ({ ...criterion, text: criterion.text.trim() })) })
      const result = await window.api.recruiting.getJob(job.id)
      if (!mounted.current) return
      upsertJob(job)
      setWorkspace(result)
      setSelectedId(job.id)
      setDraft(null)
      creatingJob.current = false
      setReviewKey(null)
      setReviewDirty(false)
      setCompareKeys([])
      setFilters(EMPTY_FILTERS)
      setTab('candidates')
      announce('Job saved')
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const refreshMatches = async (): Promise<void> => {
    if (!workspace || locked || resumes.length === 0) return
    const id = workspace.job.id
    setBusy('search')
    setError(null)
    try {
      const result = await window.api.recruiting.searchJob(id)
      if (!mounted.current) return
      // Invalidate a slower getJob response started before this refresh.
      ++requestId.current
      setLoading(false)
      setWorkspace(result)
      upsertJob(result.job)
      setCompareKeys((keys) => keys.filter((key) => result.response?.results.some((match) => match.resume.recordKey === key)))
      setReviewKey(null)
      announce(`Matches refreshed · ${result.response?.results.length ?? 0} candidates`)
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const saveReview = async (input: SaveReviewInput): Promise<boolean> => {
    if (busy) return false
    setBusy('review')
    setError(null)
    try {
      const review = await window.api.recruiting.saveReview(input)
      if (!mounted.current) return true
      setWorkspace((current) => {
        if (!current || current.job.id !== input.jobId) return current
        const reviews = [...current.reviews.filter((item) => item.candidateKey !== review.candidateKey), review]
        return { ...current, reviews, job: { ...current.job, shortlistCount: reviews.filter(isShortlisted).length } }
      })
      void window.api.recruiting.listJobs().then((list) => { if (mounted.current) setJobs(list) }).catch(() => { /* The saved review is already reflected in the workspace. */ })
      announce('Review saved')
      return true
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); return false }
    finally { if (mounted.current) setBusy(null) }
  }

  const setCandidateStatus = async (match: MatchResult, status: ReviewStatus, order?: number): Promise<void> => {
    if (!workspace || locked) return
    const review = reviewForMatch(workspace.reviews, workspace.profiles, match)
    const saved = await saveReview({
      jobId: workspace.job.id,
      resume: { id: match.resume.id, recordKey: match.resume.recordKey },
      status,
      note: review?.note ?? '',
      order: order ?? review?.order ?? Math.max(0, ...workspace.reviews.map((item) => item.order)) + 1024,
      assessments: review?.assessments ?? []
    })
    if (saved && reviewKey === match.resume.recordKey) setReviewKey(null)
  }

  const exportShortlist = async (format: 'pdf' | 'csv'): Promise<void> => {
    if (!workspace || locked) return
    setBusy(`export-${format}`)
    setError(null)
    try {
      const path = await window.api.recruiting.exportShortlist({ jobId: workspace.job.id, format })
      if (path && mounted.current) announce(`Shortlist saved to ${path}`)
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const lookup = useMemo(() => workspace ? indexWorkspace(workspace) : null, [workspace?.profiles, workspace?.reviews])
  const allMatches = workspace?.response?.results ?? []
  const shortlist = useMemo(() => workspace ? shortlistMatches(workspace) : [], [workspace])
  const visible = useMemo(() => {
    if (!workspace) return []
    const source = tab === 'shortlist' ? shortlist : workspace.response?.results ?? []
    return source.filter((match) => matchesFilters(match, lookup?.profilesByRecord.get(match.resume.recordKey), lookup?.reviewsByRecord.get(match.resume.recordKey)?.status ?? 'unreviewed', filters))
  }, [workspace, shortlist, tab, filters, lookup])
  const pageCount = Math.max(1, Math.ceil(visible.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount - 1)
  const pageMatches = visible.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)
  const selectedReview = allMatches.find((match) => match.resume.recordKey === reviewKey) ?? (reviewDirty && reviewSnapshot.current?.resume.recordKey === reviewKey ? reviewSnapshot.current : undefined)
  const comparisonMatches = compareKeys.flatMap((key) => {
    const match = allMatches.find((item) => item.resume.recordKey === key)
    return match ? [match] : []
  })
  const filteredJobs = jobs.filter((job) => jobFilter === 'all' || (jobFilter === 'active' ? job.status === 'open' || job.status === 'on-hold' : job.status === jobFilter) || job.id === selectedId)
  const activeFilters = Object.values(filters).filter(Boolean).length

  const reorder = async (match: MatchResult, direction: -1 | 1): Promise<void> => {
    if (!workspace || locked) return
    const index = shortlist.findIndex((item) => item.resume.recordKey === match.resume.recordKey)
    const target = index + direction
    if (target < 0 || target >= shortlist.length) return
    const reordered = [...shortlist]
    ;[reordered[index], reordered[target]] = [reordered[target], reordered[index]]
    const jobId = workspace.job.id
    setBusy('reorder')
    setError(null)
    try {
      await window.api.recruiting.reorderShortlist({ jobId, resumes: reordered.map((item) => ({ id: item.resume.id, recordKey: item.resume.recordKey })) })
      const result = await window.api.recruiting.getJob(jobId)
      if (mounted.current) {
        setWorkspace((current) => current?.job.id === jobId ? { ...result, evidence: current.evidence } : current)
        upsertJob(result.job)
      }
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const updatePosting = (field: keyof JobPosting, value: string): void => setDraft((current) => current ? { ...current, posting: { ...current.posting, [field]: value } } : current)
  const addCriterion = (): void => setDraft((current) => current && current.criteria.length < 40 ? { ...current, criteria: [...current.criteria, { id: crypto.randomUUID(), text: '', importance: 'required' }] } : current)
  const seedCriteria = (): void => setDraft((current) => {
    if (!current) return current
    const existing = new Set(current.criteria.map((criterion) => criterion.text.trim().toLocaleLowerCase()))
    const lines = `${current.posting.requirements}\n${current.posting.educationAndCertifications}`.split('\n').map((line) => line.replace(/^\s*(?:[-*•]\s+|\d+[.)]\s+)/u, '').trim()).filter(Boolean)
    const added: JobCriterion[] = []
    for (const text of lines) {
      if (existing.has(text.toLocaleLowerCase())) continue
      existing.add(text.toLocaleLowerCase())
      added.push({ id: crypto.randomUUID(), text: text.slice(0, 1000), importance: 'required' })
    }
    return { ...current, criteria: [...current.criteria, ...added].slice(0, 40) }
  })

  return (
    <div className="recruiting">
      <header className="recruit-page-head">
        <div><p className="recruit-eyebrow">Your hiring desk</p><h2>Jobs</h2><p className="hint">Keep every vacancy, candidate decision, and shortlist together.</p></div>
        <button className="btn primary" disabled={locked || jobs.length >= 250} onClick={createJob}>+ New job</button>
      </header>
      {error && <div className="recruit-error" role="alert"><span>{error}</span><button type="button" className="recruit-text-button" onClick={() => setError(null)} aria-label="Dismiss error">Dismiss</button></div>}
      <div className="recruit-layout">
        <aside className="recruit-job-list" aria-label="Saved jobs">
          <div className="recruit-job-list-head"><span className="recruit-eyebrow">Saved jobs <span>{jobs.length}</span></span><label className="sr-only" htmlFor="job-list-filter">Filter saved jobs</label><select id="job-list-filter" value={jobFilter} onChange={(event) => setJobFilter(event.target.value)}><option value="active">Active jobs</option><option value="all">All jobs</option><option value="open">Open</option><option value="on-hold">On hold</option><option value="filled">Filled</option><option value="archived">Archived</option></select></div>
          {listLoading ? <p className="recruit-empty-inline" role="status">Loading jobs…</p> : filteredJobs.length === 0 ? <p className="recruit-empty-inline">{jobs.length ? 'No jobs in this view.' : 'Your saved vacancies will appear here.'}</p> : <div className="recruit-job-buttons">{filteredJobs.map((job) => <button key={job.id} type="button" className={`recruit-job-button ${job.id === selectedId ? 'selected' : ''}`} aria-current={job.id === selectedId ? 'page' : undefined} disabled={locked} onClick={() => selectJob(job.id)}>
            <span className="recruit-job-title" dir="auto">{jobPostingTitle(job.posting)}</span>
            <span className="recruit-job-meta"><span className={`recruit-job-state ${job.status}`}>{JOB_LABELS[job.status]}</span><span>{job.shortlistCount} shortlisted</span></span>
            {job.newResumeCount > 0 && job.status === 'open' && <span className="recruit-new-cvs">{job.newResumeCount} new CV{job.newResumeCount === 1 ? '' : 's'} to match</span>}
          </button>)}</div>}
          <p className="recruit-local-note"><span aria-hidden="true">◉</span> Saved locally on this device</p>
        </aside>

        <section className="recruit-workspace" aria-label="Job workspace" aria-busy={loading || busy === 'search'}>
          {draft ? <form className="recruit-job-editor" onSubmit={(event) => { event.preventDefault(); void saveJob() }}>
            <div className="recruit-section-head"><div><p className="recruit-eyebrow">{draft.id ? 'Job settings' : 'Start a vacancy'}</p><h3>{draft.id ? 'Edit job' : 'New job'}</h3></div><span className="hint">Saved after you choose Save job</span></div>
            <fieldset disabled={Boolean(busy)} className="recruit-fieldset">
              <div className="recruit-editor-top"><label className="recruit-field">Position<input autoFocus dir="auto" maxLength={512} value={draft.posting.position} onChange={(event) => updatePosting('position', event.target.value)} placeholder="e.g. Senior Accountant" /></label><label className="recruit-field">Job status<select value={draft.status} onChange={(event) => setDraft({ ...draft, status: event.target.value as JobStatus })}>{Object.entries(JOB_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
              <label className="recruit-field">Job description<textarea rows={5} dir="auto" maxLength={30000} value={draft.posting.jobDescription} onChange={(event) => updatePosting('jobDescription', event.target.value)} placeholder="Describe the role and its responsibilities." /></label>
              <div className="recruit-editor-columns"><label className="recruit-field">Requirements<textarea rows={4} dir="auto" maxLength={30000} value={draft.posting.requirements} onChange={(event) => updatePosting('requirements', event.target.value)} placeholder="Skills and experience, one requirement per line." /></label><label className="recruit-field">Education and certifications<textarea rows={4} dir="auto" maxLength={30000} value={draft.posting.educationAndCertifications} onChange={(event) => updatePosting('educationAndCertifications', event.target.value)} placeholder="Degrees, licenses, or certifications." /></label></div>
              <div className="recruit-section-head"><div><h4>Evaluation criteria <span className="muted">{draft.criteria.length}/40</span></h4><p className="hint">Use the same scorecard for each candidate. Required criteria do not automatically reject anyone.</p></div></div>
              <div className="recruit-criteria-editor">{draft.criteria.map((criterion, index) => <div className="recruit-criterion-row" key={criterion.id}><span className="muted">{index + 1}</span><input aria-label={`Criterion ${index + 1}`} dir="auto" maxLength={1000} value={criterion.text} placeholder="e.g. Managed a multi-site restaurant team" onChange={(event) => setDraft({ ...draft, criteria: draft.criteria.map((item) => item.id === criterion.id ? { ...item, text: event.target.value } : item) })} /><select aria-label={`Importance of criterion ${index + 1}`} value={criterion.importance} onChange={(event) => setDraft({ ...draft, criteria: draft.criteria.map((item) => item.id === criterion.id ? { ...item, importance: event.target.value as 'required' | 'preferred' } : item) })}><option value="required">Required</option><option value="preferred">Preferred</option></select><button className="btn sm" type="button" aria-label={`Remove criterion ${index + 1}`} onClick={() => setDraft({ ...draft, criteria: draft.criteria.filter((item) => item.id !== criterion.id) })}>Remove</button></div>)}</div>
              <div className="recruit-actions"><button className="btn sm" type="button" disabled={draft.criteria.length >= 40} onClick={addCriterion}>+ Add criterion</button><button className="btn sm" type="button" disabled={draft.criteria.length >= 40 || !(draft.posting.requirements.trim() || draft.posting.educationAndCertifications.trim())} onClick={seedCriteria}>Use requirement lines</button></div>
              <div className="recruit-actions recruit-editor-footer"><button className="btn primary" type="submit" disabled={!hasJobPostingContent(draft.posting)}>{busy === 'save-job' ? 'Saving…' : 'Save job'}</button><button className="btn" type="button" onClick={() => { setDraft(null); creatingJob.current = false }}>Cancel</button><span className="hint">Matching can be refreshed after saving.</span></div>
            </fieldset>
          </form> : loading && !workspace ? <div className="recruit-empty" role="status"><h3>Opening your workspace…</h3></div> : !workspace ? <div className="recruit-empty"><div className="recruit-empty-symbol" aria-hidden="true">↗</div><h3>A workspace for every vacancy</h3><p>Save a job, match your CV library, and build a shortlist with your own reviews and evidence.</p><button type="button" className="btn primary" disabled={locked} onClick={createJob}>Create your first job</button></div> : <>
            <header className="recruit-workspace-head"><div><span className={`recruit-job-state ${workspace.job.status}`}>{JOB_LABELS[workspace.job.status]}</span><h3 dir="auto">{jobPostingTitle(workspace.job.posting)}</h3><p className="hint">{workspace.job.criteria.length} evaluation criteria · Last matched {dateLabel(workspace.job.lastSearchedAt)}</p></div><div className="recruit-actions"><button className="btn sm" disabled={locked} onClick={() => setDraft({ id: workspace.job.id, posting: { ...workspace.job.posting }, status: workspace.job.status, criteria: workspace.job.criteria.map((criterion) => ({ ...criterion })) })}>Edit job</button><button className="btn primary sm" disabled={locked || resumes.length === 0} onClick={() => { void refreshMatches() }}>{busy === 'search' ? 'Matching…' : workspace.response ? 'Refresh matches' : 'Find matches'}</button></div></header>
            {reviewDirty && <div className="recruit-notice" role="status">Save or discard your open review before changing jobs, editing criteria, or refreshing matches.</div>}
            {workspace.job.stale && <div className="recruit-notice"><span>{workspace.job.newResumeCount > 0 ? `${workspace.job.newResumeCount} new CV${workspace.job.newResumeCount === 1 ? ' is' : 's are'} ready to match against this vacancy.` : 'The posting or library has changed since these matches were saved.'} Refresh matches to update rankings and suggested evidence. Saved decisions and notes are retained.</span></div>}
            {!workspace.job.stale && workspace.job.newResumeCount > 0 && <div className="recruit-notice"><span>{workspace.job.newResumeCount} new CV{workspace.job.newResumeCount === 1 ? '' : 's'} in your library. Refresh matches to rediscover candidates for this job.</span></div>}
            <details className="recruit-posting-summary"><summary>View job description and criteria</summary><div>{Object.entries({ Description: workspace.job.posting.jobDescription, Requirements: workspace.job.posting.requirements, 'Education and certifications': workspace.job.posting.educationAndCertifications }).filter(([, value]) => value.trim()).map(([label, value]) => <div key={label}><h4>{label}</h4><p dir="auto" className="recruit-prewrap">{value}</p></div>)}{workspace.job.criteria.length > 0 && <><h4>Evaluation criteria</h4><ul>{workspace.job.criteria.map((criterion) => <li key={criterion.id} dir="auto"><span className={`recruit-importance ${criterion.importance}`}>{criterion.importance}</span> {criterion.text}</li>)}</ul></>}</div></details>
            <div className="recruit-stats" aria-label="Screening progress"><div><strong>{allMatches.length}</strong><span>Matched candidates</span></div><div><strong>{allMatches.filter((match) => (lookup?.reviewsByRecord.get(match.resume.recordKey)?.status ?? 'unreviewed') !== 'unreviewed').length}</strong><span>Reviewed</span></div><div><strong>{shortlist.length}</strong><span>Shortlisted / contacted</span></div></div>
            <div className="recruit-tabs" role="group" aria-label="Candidate views"><button className={tab === 'candidates' ? 'selected' : ''} aria-pressed={tab === 'candidates'} onClick={() => setTab('candidates')}>Candidates <span>{allMatches.length}</span></button><button className={tab === 'shortlist' ? 'selected' : ''} aria-pressed={tab === 'shortlist'} onClick={() => setTab('shortlist')}>Shortlist <span>{shortlist.length}</span></button><button className={tab === 'compare' ? 'selected' : ''} aria-pressed={tab === 'compare'} onClick={() => setTab('compare')}>Compare <span>{compareKeys.length}/4</span></button></div>
            {evidenceLoading && <div className="recruit-notice" role="status">Finding suggested passages for your scorecard…</div>}
            {evidenceError && <div className="recruit-error" role="alert"><span>Suggested evidence could not be loaded: {evidenceError}</span><button className="btn sm" onClick={() => setEvidenceRetry((value) => value + 1)}>Retry evidence</button></div>}
            {tab === 'compare' ? <CandidateComparison workspace={workspace} matches={comparisonMatches} onOpenCandidate={onOpenCandidate} onRemove={(key) => setCompareKeys((keys) => keys.filter((item) => item !== key))} /> : <>
              <div className="recruit-results-toolbar"><label className="recruit-search"><span className="sr-only">Find candidates</span><input value={filters.query} placeholder="Search name, contact, skills, or tags…" onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label><label><span className="sr-only">Filter by review state</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">All review states</option>{Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><button className="btn sm" aria-expanded={showFilters} aria-controls="recruit-profile-filters" onClick={() => setShowFilters(!showFilters)}>Filters{activeFilters ? ` (${activeFilters})` : ''}</button></div>
              {showFilters && <div id="recruit-profile-filters" className="recruit-profile-filters"><label className="recruit-field">Location<input value={filters.location} placeholder="Current or preferred" onChange={(event) => setFilters({ ...filters, location: event.target.value })} /></label><label className="recruit-field">Min. experience<input type="number" min="0" max="80" step="0.5" value={filters.years} placeholder="Years" onChange={(event) => setFilters({ ...filters, years: event.target.value })} /></label><label className="recruit-field">Skill<input value={filters.skill} placeholder="e.g. Excel" onChange={(event) => setFilters({ ...filters, skill: event.target.value })} /></label><label className="recruit-field">Tag<input value={filters.tag} placeholder="Recruiter tag" onChange={(event) => setFilters({ ...filters, tag: event.target.value })} /></label><label className="recruit-field">Availability<input value={filters.availability} placeholder="e.g. Immediate" onChange={(event) => setFilters({ ...filters, availability: event.target.value })} /></label><button className="btn sm" disabled={activeFilters === 0} onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button><p className="hint">Filters use CV details and recruiter corrections. Update screening information in a candidate’s profile.</p></div>}
              {tab === 'shortlist' && <div className="recruit-shortlist-toolbar"><p className="hint">Your selection and order. Contacted candidates stay on the shortlist. Exports include the full shortlist{activeFilters ? ', including candidates hidden by filters' : ''}.{workspace.job.stale && ' Refresh matches before exporting.'}</p><div className="recruit-actions"><button className="btn sm" disabled={locked || shortlist.length === 0 || workspace.job.stale} onClick={() => { void exportShortlist('pdf') }}>{busy === 'export-pdf' ? 'Exporting…' : 'Export PDF'}</button><button className="btn sm" disabled={locked || shortlist.length === 0 || workspace.job.stale} onClick={() => { void exportShortlist('csv') }}>{busy === 'export-csv' ? 'Exporting…' : 'Export CSV'}</button></div></div>}
              {!workspace.response ? <div className="recruit-empty"><h3>{resumes.length ? 'Ready to find your candidates' : 'Your library is empty'}</h3><p>{resumes.length ? `Match this job against ${resumes.length} CV${resumes.length === 1 ? '' : 's'} in your local library. Your progress is saved as you review.` : 'Import resumes from Library, then return here to find matches.'}</p></div> : visible.length === 0 ? <div className="recruit-empty"><h3>{activeFilters ? 'No candidates match these filters' : tab === 'shortlist' ? 'Build your shortlist' : 'No candidates to show'}</h3><p>{activeFilters ? 'Clear or adjust your filters to see more candidates.' : tab === 'shortlist' ? 'Choose Shortlist on any candidate. Add screening notes, compare your finalists, and export the selection.' : 'Import CVs and refresh matches to populate this job.'}</p>{activeFilters > 0 && <button className="btn sm" onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>}</div> : <>
                <div className="recruit-table-scroll"><table className="recruit-candidate-table"><thead><tr><th scope="col" className="recruit-check-cell">Compare</th>{tab === 'shortlist' && <th scope="col">Order</th>}<th scope="col">Candidate</th><th scope="col">Match</th><th scope="col">Review</th><th scope="col" className="recruit-action-cell"><span className="sr-only">Actions</span></th></tr></thead><tbody>{pageMatches.map((match) => {
                  const profile = matchProfile(workspace, match)
                  const resume = candidateWithProfile(match.resume, profile)
                  const review = reviewForMatch(workspace.reviews, workspace.profiles, match)
                  const selected = isShortlisted(review)
                  const shortIndex = shortlist.findIndex((item) => item.resume.recordKey === match.resume.recordKey)
                  const comparisonSelected = compareKeys.includes(match.resume.recordKey)
                  return <tr key={match.resume.recordKey} className={reviewKey === match.resume.recordKey ? 'reviewing' : ''}>
                    <td className="recruit-check-cell"><input type="checkbox" aria-label={`Compare ${candidateName(match, profile)}`} checked={comparisonSelected} disabled={!comparisonSelected && compareKeys.length >= 4} onChange={(event) => setCompareKeys((keys) => event.target.checked ? [...keys, match.resume.recordKey].slice(0, 4) : keys.filter((key) => key !== match.resume.recordKey))} /></td>
                    {tab === 'shortlist' && <td><div className="recruit-order"><span>{shortIndex + 1}</span><button type="button" aria-label={`Move ${candidateName(match, profile)} up`} className="btn sm" disabled={locked || shortIndex <= 0} onClick={() => { void reorder(match, -1) }}>↑</button><button type="button" aria-label={`Move ${candidateName(match, profile)} down`} className="btn sm" disabled={locked || shortIndex === shortlist.length - 1} onClick={() => { void reorder(match, 1) }}>↓</button></div></td>}
                    <td><button className="recruit-name" dir="auto" onClick={() => onOpenCandidate(match)}>{candidateName(match, profile)}</button><div className="cell-sub" dir="auto">{resume.location || 'Location not stated'} · {resume.yearsExperience === null ? 'Experience not stated' : `${resume.yearsExperience} years`}</div><div className="recruit-row-skills" dir="auto">{resume.skills.slice(0, 4).join(' · ')}{resume.skills.length > 4 && ` +${resume.skills.length - 4}`}</div>{profile && (profile.tags.length > 0 || profile.availability) && <div className="recruit-row-tags">{profile.availability && <span>{profile.availability}</span>}{profile.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}</div>}</td>
                    <td><span className="recruit-score" title="Relative match score; review the supporting evidence">{Math.round(match.score * 100)}</span></td>
                    <td><span className={`recruit-review-state ${review?.status ?? 'unreviewed'}`}>{REVIEW_LABELS[review?.status ?? 'unreviewed']}</span>{review?.note && <span className="recruit-note-indicator">Has notes</span>}</td>
                    <td className="recruit-action-cell"><div className="recruit-row-actions"><button className="btn sm" aria-label={`Review ${candidateName(match, profile)}`} disabled={Boolean(busy || loading || reviewDirty && reviewKey !== match.resume.recordKey)} onClick={() => { reviewSnapshot.current = match; setReviewKey(match.resume.recordKey); requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })) }}>Review</button><button className={`btn sm ${selected ? '' : 'primary'}`} aria-label={selected ? `Remove ${candidateName(match, profile)} from shortlist` : `Shortlist ${candidateName(match, profile)}`} disabled={locked} onClick={() => { void setCandidateStatus(match, selected ? 'maybe' : 'shortlisted') }}>{selected ? 'Remove' : 'Shortlist'}</button></div></td>
                  </tr>
                })}</tbody></table></div>
                <div className="recruit-pagination"><span className="hint">{currentPage * PAGE_SIZE + 1}–{Math.min((currentPage + 1) * PAGE_SIZE, visible.length)} of {visible.length} candidates{activeFilters > 0 ? ' after filters' : ''} · Scores are relative, not eligibility decisions.</span><div className="recruit-actions"><button className="btn sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><span className="hint">{currentPage + 1} / {pageCount}</span><button className="btn sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
              </>}
              {compareKeys.length > 0 && <div className="recruit-compare-bar"><span>{compareKeys.length} selected for comparison</span><div className="recruit-actions"><button className="recruit-text-button" onClick={() => setCompareKeys([])}>Clear</button><button className="btn sm" disabled={compareKeys.length < 2} onClick={() => setTab('compare')}>Compare candidates</button></div></div>}
            </>}
            {selectedReview && <div ref={reviewRef}><ReviewScorecard key={`${workspace.job.id}:${selectedReview.resume.recordKey}`} workspace={workspace} match={selectedReview} busy={Boolean(busy || loading)} onSave={saveReview} onClose={() => { setReviewKey(null); setReviewDirty(false) }} onDirty={(dirty) => { reviewDirtyRef.current = dirty; setReviewDirty(dirty) }} onOpenCandidate={onOpenCandidate} /></div>}
          </>}
        </section>
      </div>
    </div>
  )
}
