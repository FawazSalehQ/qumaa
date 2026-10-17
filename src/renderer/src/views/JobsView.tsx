import JobCriteriaEditor from '../components/recruiting/JobCriteriaEditor.js'
import RequirementPassages from '../components/recruiting/RequirementPassages.js'
import { criterionImportanceLabel } from '@shared/job-requirements.js'
import { DEFAULT_RERANK_CONFIG, rerankModelLabel } from '@shared/rerank.js'
import { useI18n } from '../i18n.js'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CandidateProfile, Company, JobCriterion, JobPosting, JobStatus, JobTargetCompany, JobWorkspace, ReviewStatus, SavedJob, SaveReviewInput } from '@shared/recruiting.js'
import { candidateWithProfile, reviewForMatch } from '@shared/recruiting.js'
import type { MatchResult, ResumeSummary } from '@shared/types.js'
import type { Toast } from '../components/Toasts.js'
import CandidateComparison from '../components/recruiting/CandidateComparison.js'
import ReviewScorecard from '../components/recruiting/ReviewScorecard.js'
import JobRerank from '../components/recruiting/JobRerank.js'
import JobStatusPanel from '../components/recruiting/JobStatusPanel.js'
import { bidiValue, candidateName, errorMessage, recruitingError, indexWorkspace, isShortlisted, matchProfile, REVIEW_LABELS, shortlistMatches } from '../components/recruiting/helpers.js'
import { emptyJobPosting, hasJobPostingContent, jobPostingTitle } from '../jobPosting.js'
import LocalizedNumberInput from '../components/LocalizedNumberInput.js'
import JobBudgetEditor, { budgetFromDraft, budgetLabel, budgetToDraft, HiringBudgetEditor, hiringBudgetFromDraft, hiringBudgetLabel, hiringBudgetToDraft, type BudgetDraft, type HiringBudgetDraft } from '../components/recruiting/JobBudgetEditor.js'
import TargetCompanies from '../components/recruiting/TargetCompanies.js'
import JobPipeline from '../components/recruiting/JobPipeline.js'
import ClientPack from '../components/recruiting/ClientPack.js'
import LineBadge, { initialsFor, lineToneForKey, stageToneFor, type LineTone } from '../components/LineBadge.js'
import { PIPELINE_LABELS } from '../components/recruiting/JobPipeline.js'
import type { PipelineStage } from '@shared/talent.js'
import { ArrowIcon, CheckIcon, ChevronDownIcon, ChevronUpIcon } from '../components/Icons.js'
import '../recruiting.css'

/** Pipeline stages at or beyond the Contacted stop; sourced and closed do not count as reached. */
const CONTACTED_STAGES: ReadonlySet<PipelineStage> = new Set<PipelineStage>(['contacted', 'interested', 'screened', 'submitted', 'interviewing', 'offer', 'placed'])

interface Props {
  resumes: ResumeSummary[]
  libraryRevision: number
  active?: boolean
  newJobSignal?: number
  companyRevision?: number
  talentRevision?: number
  navigationRequest?: { id: number; companyId?: string; jobId?: string; tab?: 'pipeline' }
  onOpenCompanies: () => void
  onOpenCandidate: (match: MatchResult) => void
  onOpenResume: (resume: ResumeSummary) => void
  onToast: (toasts: Toast[]) => void
}

interface JobDraft {
  mode: 'job' | 'express'
  id?: string
  temporaryId?: string
  posting: JobPosting
  status: JobStatus
  criteria: JobCriterion[]
  companyId?: string | null
  budget?: BudgetDraft
  hiringBudget?: HiringBudgetDraft
}

const JOB_LABELS: Record<JobStatus, string> = { open: 'Open', 'on-hold': 'On hold', filled: 'Filled', archived: 'Archived' }
const PAGE_SIZE = 50
const EMPTY_FILTERS = { query: '', status: '', location: '', years: '', skill: '', tag: '', availability: '' }

const belongsToCompany = (job: SavedJob, filter: string): boolean => filter === 'all' || (filter === 'unassigned' ? !job.companyId : job.companyId === filter)

function lastSelectedJob(): string | null {
  try { return localStorage.getItem('qumaa-selected-job') } catch { return null }
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

export default function JobsView({ resumes, libraryRevision, active = true, newJobSignal = 0, companyRevision = 0, talentRevision = 0, navigationRequest, onOpenCompanies, onOpenCandidate, onOpenResume, onToast }: Props): React.JSX.Element {
  const { t, language, formatNumber, formatDate } = useI18n()
  const dateLabel = (value: number | null): string => value === null ? t('Not matched yet') : formatDate(value, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const postingTitle = (posting: JobPosting): string => hasJobPostingContent(posting) ? jobPostingTitle(posting) : t('Job description')
  const [jobs, setJobs] = useState<SavedJob[]>([])
  const [companies, setCompanies] = useState<Company[]>([])
  const [companyFilter, setCompanyFilter] = useState('all')
  const [targetDirty, setTargetDirty] = useState(false)
  const [pipelineDirty, setPipelineDirty] = useState(false)
  const [packDirty, setPackDirty] = useState(false)
  const [temporaryJob, setTemporaryJob] = useState<SavedJob | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(lastSelectedJob)
  const [workspaceReloadRevision, setWorkspaceReloadRevision] = useState(0)
  const [jobsReloadRevision, setJobsReloadRevision] = useState(0)
  const [workspace, setWorkspace] = useState<JobWorkspace | null>(null)
  const [draft, setDraft] = useState<JobDraft | null>(null)
  const [listLoading, setListLoading] = useState(true)
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [rerankBusy, setRerankBusy] = useState(false)
  const [statusBusy, setStatusBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<'candidates' | 'shortlist' | 'compare' | 'targets' | 'pipeline' | 'pack'>('candidates')
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
  const [stagesByRecord, setStagesByRecord] = useState<Map<string, PipelineStage>>(() => new Map())
  const [stageRevision, setStageRevision] = useState(0)
  const reviewRef = useRef<HTMLDivElement>(null)
  const reviewSnapshot = useRef<MatchResult | null>(null)
  const reviewDirtyRef = useRef(false)
  const mounted = useRef(true)
  const requestId = useRef(0)
  const jobsRequestId = useRef(0)
  const selectedJobId = useRef(selectedId)
  const temporaryJobId = useRef<string | null>(null)
  const recoveringTemporary = useRef(false)
  const rerankReloadPending = useRef(false)
  const creatingJob = useRef(false)
  const lastNewJobSignal = useRef(newJobSignal)
  const lastNavigationRequest = useRef<number | undefined>(undefined)
  const workflowDisabled = Boolean(busy || loading || listLoading || draft || reviewDirty || targetDirty || pipelineDirty || packDirty)
  const rerankDisabled = workflowDisabled || statusBusy
  const locked = rerankDisabled || rerankBusy
  const evidenceKeys = (tab === 'compare' ? compareKeys : reviewKey ? [reviewKey] : []).join('|')

  const rememberTemporary = useCallback((job: SavedJob | null): void => {
    temporaryJobId.current = job?.id ?? null
    setTemporaryJob(job)
  }, [])

  useLayoutEffect(() => { selectedJobId.current = selectedId }, [selectedId])

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; ++requestId.current; ++jobsRequestId.current }
  }, [])

  useEffect(() => {
    let cancelled = false
    void window.api.recruiting.listCompanies().then((list) => {
      if (!cancelled) {
        setCompanies(list)
        setCompanyFilter((current) => current === 'all' || current === 'unassigned' || list.some((company) => company.id === current) ? current : 'all')
      }
    }).catch((failure: unknown) => { if (!cancelled) setError(errorMessage(failure)) })
    return () => { cancelled = true }
  }, [companyRevision, libraryRevision])

  useEffect(() => {
    const request = ++jobsRequestId.current
    let cancelled = false
    void window.api.recruiting.listJobs().then((list) => {
      if (cancelled || request !== jobsRequestId.current) return
      const previous = recoveringTemporary.current ? lastSelectedJob() : null
      recoveringTemporary.current = false
      setJobs(list)
      const eligible = list.filter((job) => belongsToCompany(job, companyFilter))
      setSelectedId((current) => current && (current === temporaryJobId.current || eligible.some((job) => job.id === current)) ? current : creatingJob.current ? null : eligible.find((job) => job.id === previous)?.id ?? eligible[0]?.id ?? null)
    }).catch((failure: unknown) => { if (!cancelled && request === jobsRequestId.current) setError(errorMessage(failure)) })
      .finally(() => { if (!cancelled && request === jobsRequestId.current) setListLoading(false) })
    return () => { cancelled = true }
  }, [libraryRevision, jobsReloadRevision, companyFilter])

  useEffect(() => {
    const request = ++requestId.current
    const refreshingSavedRerank = rerankReloadPending.current
    rerankReloadPending.current = false
    try {
      if (selectedId && selectedId !== temporaryJobId.current) localStorage.setItem('qumaa-selected-job', selectedId)
      else if (!selectedId && !recoveringTemporary.current) localStorage.removeItem('qumaa-selected-job')
    } catch { /* Persisted jobs remain available if local storage is unavailable. */ }
    if (!selectedId) { setWorkspace(null); setLoading(false); return }
    setLoading(true)
    void window.api.recruiting.getJob(selectedId).then((result) => {
      if (!mounted.current || request !== requestId.current) return
      setWorkspace(result)
      if (result.temporary) rememberTemporary(result.job)
      else setJobs((list) => list.map((job) => job.id === result.job.id ? result.job : job))
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
      if (mounted.current && request === requestId.current) {
        const message = errorMessage(failure)
        const clean = message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '')
        if (selectedId === temporaryJobId.current && (clean === 'This temporary search is no longer available.' || clean === 'This saved job no longer exists.')) {
          // Library replacement can clear process memory before the renderer is
          // reset. Remove only a confirmed missing search, keeping editor text.
          recoveringTemporary.current = true
          rememberTemporary(null)
          setWorkspace(null)
          setSelectedId(null)
          setJobs([])
          setReviewKey(null)
          setCompareKeys([])
          setFilters(EMPTY_FILTERS)
          setTab('candidates')
          ++jobsRequestId.current
          setListLoading(true)
          setJobsReloadRevision((revision) => revision + 1)
          setError('This temporary search is no longer available.')
          return
        }
        if (!refreshingSavedRerank) setWorkspace(null)
        setError(message)
      }
    }).finally(() => { if (mounted.current && request === requestId.current) setLoading(false) })
  }, [selectedId, libraryRevision, workspaceReloadRevision, rememberTemporary])

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

  // Where each candidate stands on this job's line, keyed by CV identity. The
  // pipeline tab owns editing; the station board only reads the stage.
  useEffect(() => {
    const jobId = workspace && !workspace.temporary ? workspace.job.id : null
    if (!jobId) { setStagesByRecord(new Map()); return }
    let cancelled = false
    void window.api.talent.overview().then((overview) => {
      if (cancelled) return
      const stageByPerson = new Map(overview.assignments.filter((row) => row.jobId === jobId).map((row) => [row.personId, row.stage] as const))
      const next = new Map<string, PipelineStage>()
      for (const person of overview.people) {
        const stage = stageByPerson.get(person.id)
        if (stage) for (const key of person.recordKeys) next.set(key, stage)
      }
      setStagesByRecord(next)
    }).catch(() => { /* Stages are a convenience; the pipeline tab reports its own errors. */ })
    return () => { cancelled = true }
  }, [workspace?.job.id, workspace?.temporary, talentRevision, libraryRevision, stageRevision])

  const upsertJob = (job: SavedJob): void => {
    // A list fetched before this save must not hide the job or move selection.
    ++jobsRequestId.current
    recoveringTemporary.current = false
    setListLoading(false)
    setJobs((list) => [job, ...list.filter((item) => item.id !== job.id)].sort((a, b) => b.updatedAt - a.updatedAt))
  }
  const rememberWorkspaceJob = (result: JobWorkspace): void => {
    if (result.temporary) rememberTemporary(result.job)
    else upsertJob(result.job)
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

  const filterCompany = (filter: string): void => {
    if (locked || filter === companyFilter) return
    setCompanyFilter(filter)
    const nextId = jobs.find((job) => belongsToCompany(job, filter))?.id ?? null
    setSelectedId(nextId)
    if (nextId !== selectedId) setWorkspace(null)
    setReviewKey(null)
    setCompareKeys([])
    setFilters(EMPTY_FILTERS)
    setTab('candidates')
    setError(null)
  }

  const cancelDraft = (): void => {
    setDraft(null)
    creatingJob.current = false
    if (!selectedId) setSelectedId(jobs.find((job) => belongsToCompany(job, companyFilter))?.id ?? null)
  }

  const createJob = useCallback((): void => {
    if (locked) return
    creatingJob.current = true
    setDraft({ mode: 'job', posting: emptyJobPosting(), status: 'open', criteria: [], companyId: companies.some((company) => company.id === companyFilter) ? companyFilter : null, budget: budgetToDraft() })
    setError(null)
  }, [locked, companyFilter, companies])

  useEffect(() => {
    if (!navigationRequest || navigationRequest.id === lastNavigationRequest.current || locked || !active) return
    lastNavigationRequest.current = navigationRequest.id
    setError(null)
    setCompanyFilter(navigationRequest.companyId ?? 'all')
    if (navigationRequest.jobId) {
      setSelectedId(navigationRequest.jobId)
      setWorkspaceReloadRevision((revision) => revision + 1)
      setTab(navigationRequest.tab ?? 'candidates')
      setReviewKey(null)
      setCompareKeys([])
      setFilters(EMPTY_FILTERS)
    } else {
      creatingJob.current = true
      setSelectedId(null)
      setWorkspace(null)
      setDraft({ mode: 'job', posting: emptyJobPosting(), status: 'open', criteria: [], companyId: navigationRequest.companyId ?? null, budget: budgetToDraft() })
    }
  }, [navigationRequest, locked, active])

  const createExpressSearch = (): void => {
    if (locked) return
    creatingJob.current = true
    setDraft({ mode: 'express', posting: emptyJobPosting(), status: 'open', criteria: [] })
    setError(null)
  }

  useEffect(() => {
    if (newJobSignal === lastNewJobSignal.current) return
    lastNewJobSignal.current = newJobSignal
    // Use the same guard as the button: a menu shortcut must not replace an
    // existing job draft or discard an unsaved candidate review.
    createJob()
  }, [newJobSignal, createJob])

  const saveJob = async (): Promise<void> => {
    if (!draft || draft.mode !== 'job' || draft.temporaryId || busy || !hasJobPostingContent(draft.posting) || !draft.id && jobs.length >= 250) return
    setBusy('save-job')
    setError(null)
    try {
      const job = await window.api.recruiting.saveJob({ ...(draft.id ? { id: draft.id } : {}), posting: draft.posting, status: draft.status, companyId: draft.companyId ?? null, budget: budgetFromDraft(draft.budget ?? budgetToDraft()), hiringBudget: hiringBudgetFromDraft(draft.hiringBudget ?? hiringBudgetToDraft()), criteria: draft.criteria.filter((criterion) => criterion.text.trim()).map((criterion) => ({ ...criterion, text: criterion.text.trim() })) })
      const result = await window.api.recruiting.getJob(job.id)
      if (!mounted.current) return
      upsertJob(job)
      setCompanyFilter((current) => current === 'all' || current === (job.companyId ?? 'unassigned') ? current : 'all')
      setWorkspace(result)
      setSelectedId(job.id)
      setDraft(null)
      creatingJob.current = false
      setReviewKey(null)
      setReviewDirty(false)
      setCompareKeys([])
      setFilters(EMPTY_FILTERS)
      setTab('candidates')
      announce(t('Job saved'))
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const findTemporaryMatches = async (): Promise<void> => {
    if (!draft || draft.mode !== 'express' || draft.id || busy || !hasJobPostingContent(draft.posting) || resumes.length === 0) return
    setBusy('temporary-search')
    setError(null)
    try {
      const result = await window.api.recruiting.searchTemporary({
        posting: draft.posting,
        status: draft.status,
        criteria: draft.criteria.filter((criterion) => criterion.text.trim()).map((criterion) => ({ ...criterion, text: criterion.text.trim() }))
      })
      if (!mounted.current) return
      ++requestId.current
      setLoading(false)
      rememberTemporary(result.job)
      setWorkspace(result)
      setSelectedId(result.job.id)
      setDraft(null)
      creatingJob.current = false
      setReviewKey(null)
      setReviewDirty(false)
      setCompareKeys([])
      setFilters(EMPTY_FILTERS)
      setTab('candidates')
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const saveTemporary = async (): Promise<void> => {
    if (!workspace?.temporary || !workspace.response || locked || workspace.job.stale || jobs.length >= 250) return
    setBusy('save-temporary')
    setError(null)
    try {
      const result = await window.api.recruiting.saveTemporary({ jobId: workspace.job.id, sessionId: workspace.response.sessionId })
      if (!mounted.current) return
      ++requestId.current
      setLoading(false)
      rememberTemporary(null)
      upsertJob(result.job)
      setCompanyFilter((current) => belongsToCompany(result.job, current) ? current : 'all')
      setWorkspace(result)
      setSelectedId(result.job.id)
      announce(t('Job saved'))
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const discardTemporary = async (): Promise<void> => {
    if (!workspace?.temporary || locked) return
    setBusy('discard-temporary')
    setError(null)
    try {
      await window.api.recruiting.discardTemporary(workspace.job.id)
      if (!mounted.current) return
      ++requestId.current
      setLoading(false)
      rememberTemporary(null)
      setWorkspace(null)
      const previous = lastSelectedJob()
      const eligible = jobs.filter((job) => belongsToCompany(job, companyFilter))
      setSelectedId(eligible.find((job) => job.id === previous)?.id ?? eligible[0]?.id ?? null)
      setReviewKey(null)
      setCompareKeys([])
      setFilters(EMPTY_FILTERS)
      setTab('candidates')
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const exportTemporary = async (): Promise<void> => {
    if (!workspace?.temporary || !workspace.response?.results.length || locked || workspace.job.stale) return
    setBusy('export-temporary')
    setError(null)
    try {
      const path = await window.api.recruiting.exportTemporary({ jobId: workspace.job.id, sessionId: workspace.response.sessionId })
      if (path && mounted.current) announce(t('Shortlist saved to {path}', { path: bidiValue(path, language, 'ltr') }))
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
      rememberWorkspaceJob(result)
      setCompareKeys((keys) => keys.filter((key) => result.response?.results.some((match) => match.resume.recordKey === key)))
      setReviewKey(null)
      announce(t('Matches refreshed · {count} candidates', { count: result.response?.results.length ?? 0 }))
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { if (mounted.current) setBusy(null) }
  }

  const saveReview = async (input: SaveReviewInput): Promise<boolean> => {
    if (busy || rerankBusy || workspace?.temporary) return false
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
      const listRequest = ++jobsRequestId.current
      void window.api.recruiting.listJobs().then((list) => {
        if (mounted.current && listRequest === jobsRequestId.current) setJobs(list)
      }).catch(() => { /* The saved review is already reflected in the workspace. */ })
        .finally(() => { if (mounted.current && listRequest === jobsRequestId.current) setListLoading(false) })
      announce(t('Review saved'))
      return true
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); return false }
    finally { if (mounted.current) setBusy(null) }
  }

  const setCandidateStatus = async (match: MatchResult, status: ReviewStatus, order?: number): Promise<void> => {
    if (!workspace || workspace.temporary || locked) return
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

  const addToPipeline = async (match: MatchResult): Promise<void> => {
    if (!workspace || workspace.temporary || locked) return
    setBusy('pipeline'); setError(null)
    try {
      const person = await window.api.talent.ensurePerson({ id: match.resume.id, recordKey: match.resume.recordKey })
      const overview = await window.api.talent.overview()
      if (!overview.assignments.some((row) => row.personId === person.id && row.jobId === workspace.job.id)) {
        await window.api.talent.saveAssignment({ personId: person.id, jobId: workspace.job.id, stage: 'sourced', nextAction: '', dueAt: null, note: '', clientFeedback: '' })
      }
      setTab('pipeline'); setReviewKey(null)
      setStageRevision((value) => value + 1)
    } catch (failure) { setError(errorMessage(failure)) }
    finally { setBusy(null) }
  }

  const exportShortlist = async (format: 'pdf' | 'csv'): Promise<void> => {
    if (!workspace || workspace.temporary || locked) return
    setBusy(`export-${format}`)
    setError(null)
    try {
      const path = await window.api.recruiting.exportShortlist({ jobId: workspace.job.id, format })
      if (path && mounted.current) announce(t('Shortlist saved to {path}', { path: bidiValue(path, language, 'ltr') }))
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
  const filteredJobs = jobs.filter((job) => belongsToCompany(job, companyFilter) && (jobFilter === 'all' || (jobFilter === 'active' ? job.status === 'open' || job.status === 'on-hold' : job.status === jobFilter) || job.id === selectedId))
  const hiringCompany = companies.find((company) => company.id === workspace?.job.companyId)

  const saveTargets = async (targets: JobTargetCompany[], expectedUpdatedAt: number): Promise<boolean> => {
    if (!workspace || workspace.temporary || busy || loading || statusBusy || rerankBusy) return false
    const jobId = workspace.job.id
    setBusy('targets')
    setError(null)
    try {
      const result = await window.api.recruiting.saveTargetCompanies({ jobId, expectedUpdatedAt, companies: targets })
      if (mounted.current) {
        ++requestId.current
        setLoading(false)
        setWorkspace((current) => current?.job.id === jobId ? { ...result, evidence: current.evidence } : current)
        upsertJob(result.job)
        announce(t('Company map saved'))
      }
      return true
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)); return false }
    finally { if (mounted.current) setBusy(null) }
  }
  const activeFilters = Object.values(filters).filter(Boolean).length
  const reviewedCount = allMatches.filter((match) => (lookup?.reviewsByRecord.get(match.resume.recordKey)?.status ?? 'unreviewed') !== 'unreviewed').length
  // A candidate counts as contacted when the recruiter marked the review
  // "Contacted" or the pipeline carries them at or beyond that stop, so the
  // line and the stage pills in the rows can never disagree.
  const contactedCount = workspace ? allMatches.filter((match) => {
    if (reviewForMatch(workspace.reviews, workspace.profiles, match)?.status === 'contacted') return true
    const stage = stagesByRecord.get(match.resume.recordKey)
    return stage !== undefined && CONTACTED_STAGES.has(stage)
  }).length : 0
  const placedCount = allMatches.filter((match) => stagesByRecord.get(match.resume.recordKey) === 'placed').length
  const hiredCount = Math.max(workspace?.job.placement ? 1 : 0, placedCount)
  // The hiring funnel as a line of stops. A stop is reached once anyone is on
  // it; the furthest reached stop is where this vacancy currently stands.
  const funnelStops: Array<{ key: string; label: string; count: number; tone: LineTone; reached: boolean }> = workspace ? [
    { key: 'matched', label: t('Matched candidates'), count: allMatches.length, tone: 'violet', reached: allMatches.length > 0 },
    ...(workspace.temporary ? [] : [
      { key: 'reviewed', label: t('Reviewed'), count: reviewedCount, tone: 'violet' as LineTone, reached: reviewedCount > 0 },
      { key: 'shortlisted', label: t('Shortlisted'), count: shortlist.length, tone: 'green' as LineTone, reached: shortlist.length > 0 },
      { key: 'contacted', label: t('Contacted'), count: contactedCount, tone: 'blue' as LineTone, reached: contactedCount > 0 },
      { key: 'hired', label: t('Hired'), count: hiredCount, tone: 'green' as LineTone, reached: hiredCount > 0 }
    ])
  ] : []
  const currentStop = funnelStops.reduce((current, stop, index) => stop.reached ? index : current, -1)
  const saveFirstHint = t('Save as a job first.')

  const reorder = async (match: MatchResult, direction: -1 | 1): Promise<void> => {
    if (!workspace || workspace.temporary || locked) return
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


  return (
    <div className="recruiting">
      <header className="recruit-page-head">
        <div><h2>{t("Jobs")}</h2></div>
        <div className="recruit-actions recruit-entry-actions">
          <button className="btn recruit-express-button" type="button" disabled={locked} onClick={createExpressSearch}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false"><path d="m13 2-9 12h7l-1 8 10-12h-7l1-8Z" /></svg>
            {t('Express search')}
          </button>
          <button className="btn primary" disabled={locked} onClick={createJob}>{t("+ New job")}</button>
        </div>
      </header>
      {error && <div className="recruit-error" role="alert"><span>{recruitingError(error, t, language)}</span><button type="button" className="recruit-text-button" onClick={() => setError(null)} aria-label={t("Dismiss error")}>{t("Dismiss")}</button></div>}
      {navigationRequest && navigationRequest.id !== lastNavigationRequest.current && (draft || reviewDirty || targetDirty || pipelineDirty || packDirty) && <p className="recruit-notice" role="status">{t('Save or cancel your current work to open the requested company job.')}</p>}
      <div className="recruit-layout">
        <aside className="recruit-job-list" aria-label={t("Saved jobs")}>
          <div className="recruit-company-filter"><label className="recruit-field">{t('Filter by company')}<select aria-label={t('Filter by company')} value={companyFilter} disabled={locked} onChange={(event) => filterCompany(event.target.value)}><option value="all">{t('All companies')}</option><option value="unassigned">{t('No company assigned')}</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label><button className="recruit-text-button" disabled={locked} onClick={onOpenCompanies}>{t('Manage companies')}</button></div>
          {temporaryJob && <button type="button" className={`recruit-job-button recruit-temporary-entry ${selectedId === temporaryJob.id ? 'selected' : ''}`} disabled={locked} aria-label={t('Open express search')} aria-current={selectedId === temporaryJob.id ? 'page' : undefined} onClick={() => selectJob(temporaryJob.id)}>
            <LineBadge tone="violet">{initialsFor(postingTitle(temporaryJob.posting))}</LineBadge>
            <span className="recruit-job-body">
              <span className="recruit-eyebrow">{t('Express search')}</span>
              <span className="recruit-job-title"><bdi>{postingTitle(temporaryJob.posting)}</bdi></span>
            </span>
          </button>}
          <div className="recruit-job-list-head"><span className="recruit-eyebrow">{t("Saved jobs")} <span>{formatNumber(jobs.length)}</span></span><label className="sr-only" htmlFor="job-list-filter">{t("Filter saved jobs")}</label><select id="job-list-filter" value={jobFilter} onChange={(event) => setJobFilter(event.target.value)}><option value="active">{t("Active jobs")}</option><option value="all">{t("All jobs")}</option><option value="open">{t("Open")}</option><option value="on-hold">{t("On hold")}</option><option value="filled">{t("Filled")}</option><option value="archived">{t("Archived")}</option></select></div>
          {listLoading ? <p className="recruit-empty-inline" role="status">{t("Loading jobs…")}</p> : filteredJobs.length === 0 ? <p className="recruit-empty-inline">{jobs.length ? t('No jobs in this view.') : t('No saved jobs yet.')}</p> : <div className="recruit-job-buttons">{filteredJobs.map((job) => <button key={job.id} type="button" className={`recruit-job-button ${job.id === selectedId ? 'selected' : ''}`} aria-current={job.id === selectedId ? 'page' : undefined} disabled={locked} onClick={() => selectJob(job.id)}>
            <LineBadge tone={job.companyId ? lineToneForKey(job.companyId) : 'neutral'}>{initialsFor(postingTitle(job.posting))}</LineBadge>
            <span className="recruit-job-body">
            <span className="recruit-job-title"><bdi>{postingTitle(job.posting)}</bdi></span>
            {job.companyId && <span className="hint" dir="auto">{companies.find((company) => company.id === job.companyId)?.name}</span>}
            <span className="recruit-job-meta"><span className={`recruit-job-state ${job.status}`}>{t(JOB_LABELS[job.status])}</span><span>{t('{count} shortlisted', { count: job.shortlistCount })}</span></span>
            <span className="recruit-job-date">{(() => {
              const event = [...(job.statusHistory ?? [])].reverse().find((item) => item.kind !== 'placement-updated' && item.status === job.status)
              return event ? t('{status} since {date}', { status: t(JOB_LABELS[job.status]), date: formatDate(event.at, { year: 'numeric', month: 'short', day: 'numeric' }) }) : t('Created {date}', { date: formatDate(job.createdAt, { year: 'numeric', month: 'short', day: 'numeric' }) })
            })()}</span>
            {job.newResumeCount > 0 && job.status === 'open' && <span className="recruit-new-cvs">{t(job.newResumeCount === 1 ? '{count} new CV to match' : '{count} new CVs to match', { count: job.newResumeCount })}</span>}
            </span>
          </button>)}</div>}
        </aside>

        <section className="recruit-workspace" aria-label={t("Job workspace")} aria-busy={loading || busy === 'search' || busy === 'temporary-search'}>
          {draft?.mode === 'express' ? <form className="recruit-job-editor recruit-express-editor" aria-label={t('Express search')} onSubmit={(event) => { event.preventDefault(); void findTemporaryMatches() }}>
            <div className="recruit-section-head"><div><h3>{t('Express search')}</h3></div></div>
            <fieldset disabled={Boolean(busy)} className="recruit-fieldset">
              <label className="recruit-field">{t('Job description')}<textarea autoFocus rows={8} dir="auto" maxLength={30000} value={draft.posting.jobDescription} onChange={(event) => updatePosting('jobDescription', event.target.value)} placeholder={t('Paste the job description here…')} /></label>
              <label className="recruit-field">{t('Requirements')}<textarea rows={5} dir="auto" maxLength={30000} value={draft.posting.requirements} onChange={(event) => updatePosting('requirements', event.target.value)} placeholder={t('Paste requirements here (optional)…')} /></label>
              <JobCriteriaEditor posting={draft.posting} criteria={draft.criteria} onChange={(criteria) => setDraft({ ...draft, criteria })} />
              {resumes.length === 0 && <p className="hint">{t('Import CVs from Library, then return here to run your express search.')}</p>}
              <div className="recruit-actions recruit-editor-footer">
                <button className="btn primary" type="submit" disabled={!hasJobPostingContent(draft.posting) || resumes.length === 0}>{busy === 'temporary-search' ? t('Matching…') : t('Find matches')}</button>
                <button className="btn" type="button" onClick={cancelDraft}>{t('Cancel')}</button>
                {temporaryJob && !draft.temporaryId && <span className="hint">{t('Finding matches replaces your current express search.')}</span>}
              </div>
            </fieldset>
          </form> : draft ? <form className="recruit-job-editor" onSubmit={(event) => { event.preventDefault(); void saveJob() }}>
            <div className="recruit-section-head"><div><h3>{draft.id ? t('Edit job') : t('New job')}</h3></div><span className="hint">{t('Saved after you choose Save job')}</span></div>
            <fieldset disabled={Boolean(busy)} className="recruit-fieldset">
              <label className="recruit-field">{t("Position")}<input autoFocus dir="auto" maxLength={512} value={draft.posting.position} onChange={(event) => updatePosting('position', event.target.value)} placeholder={t("e.g. Senior Accountant")} /></label>
              <label className="recruit-field">{t('Hiring company')}<select aria-label={t('Hiring company')} value={draft.companyId ?? ''} onChange={(event) => setDraft({ ...draft, companyId: event.target.value || null })}><option value="">{t('No company assigned')}</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
              {draft.companyId && companies.find((company) => company.id === draft.companyId)?.note && <details className="recruit-company-context"><summary>{t('Company hiring notes')}</summary><p dir="auto" className="recruit-prewrap">{companies.find((company) => company.id === draft.companyId)?.note}</p></details>}
              <JobBudgetEditor value={draft.budget ?? budgetToDraft()} onChange={(budget) => setDraft({ ...draft, budget })} />
              <HiringBudgetEditor value={draft.hiringBudget ?? hiringBudgetToDraft()} onChange={(hiringBudget) => setDraft({ ...draft, hiringBudget })} />
              {draft.id && <p className="hint">{t('Current status: {status}', { status: t(JOB_LABELS[draft.status]) })}</p>}
              <label className="recruit-field">{t("Job description")}<textarea rows={5} dir="auto" maxLength={30000} value={draft.posting.jobDescription} onChange={(event) => updatePosting('jobDescription', event.target.value)} placeholder={t("Describe the role and its responsibilities.")} /></label>
              <div className="recruit-editor-columns"><label className="recruit-field">{t("Requirements")}<textarea rows={4} dir="auto" maxLength={30000} value={draft.posting.requirements} onChange={(event) => updatePosting('requirements', event.target.value)} placeholder={t("Skills and experience, one requirement per line.")} /></label><label className="recruit-field">{t("Education and certifications")}<textarea rows={4} dir="auto" maxLength={30000} value={draft.posting.educationAndCertifications} onChange={(event) => updatePosting('educationAndCertifications', event.target.value)} placeholder={t("Degrees, licenses, or certifications.")} /></label></div>
              <JobCriteriaEditor posting={draft.posting} criteria={draft.criteria} onChange={(criteria) => setDraft({ ...draft, criteria })} />
              <div className="recruit-actions recruit-editor-footer">
                <button className="btn primary" type="submit" disabled={!hasJobPostingContent(draft.posting) || !draft.id && jobs.length >= 250}>{busy === 'save-job' ? t('Saving…') : t('Save job')}</button>
                <button className="btn" type="button" onClick={cancelDraft}>{t('Cancel')}</button>
              </div>
            </fieldset>
          </form> : loading && !workspace ? <div className="recruit-empty" role="status"><h3>{t("Opening your workspace…")}</h3></div> : !workspace ? <div className="recruit-empty"><div className="recruit-empty-symbol" aria-hidden="true"><ArrowIcon size={22} /></div><h3>{t("A workspace for every vacancy")}</h3><button type="button" className="btn primary" disabled={locked} onClick={createJob}>{t("Create your first job")}</button></div> : <>
            <header className="recruit-workspace-head">
              <div><span className={`recruit-job-state ${workspace.temporary ? 'temporary' : workspace.job.status}`}>{workspace.temporary ? t('Express search') : t(JOB_LABELS[workspace.job.status])}</span><div className="recruit-workspace-title"><LineBadge size="lg" tone={workspace.job.companyId ? lineToneForKey(workspace.job.companyId) : workspace.temporary ? 'violet' : 'neutral'}>{initialsFor(postingTitle(workspace.job.posting))}</LineBadge><h3><bdi>{postingTitle(workspace.job.posting)}</bdi></h3></div><p className="hint">{workspace.temporary ? t('Not saved. Available until you quit Qumaa.') : t('{count} evaluation criteria · Last matched {date}', { count: workspace.job.criteria.length, date: dateLabel(workspace.job.lastSearchedAt) })}</p></div>
              <div className="recruit-actions">
                <button className="btn sm" disabled={locked} onClick={() => setDraft({ mode: workspace.temporary ? 'express' : 'job', ...(workspace.temporary ? { temporaryId: workspace.job.id } : { id: workspace.job.id }), posting: { ...workspace.job.posting }, status: workspace.job.status, criteria: workspace.job.criteria.map((criterion) => ({ ...criterion })), companyId: workspace.job.companyId ?? null, budget: budgetToDraft(workspace.job.budget), hiringBudget: hiringBudgetToDraft(workspace.job.hiringBudget) })}>{workspace.temporary ? t('Edit search') : t('Edit job')}</button>
                <button className="btn primary sm" disabled={locked || resumes.length === 0} onClick={() => { void refreshMatches() }}>{busy === 'search' ? t('Matching…') : workspace.response ? t('Refresh matches') : t('Find matches')}</button>
                <JobRerank workspace={workspace} active={active} disabled={rerankDisabled} libraryRevision={libraryRevision} onBusyChange={setRerankBusy} onError={setError} onReranked={(result, sourceSessionId) => {
                  ++requestId.current
                  setWorkspace((current) => current?.job.id === result.job.id && current.response?.sessionId === sourceSessionId ? { ...result, evidence: current.evidence } : current)
                  rememberWorkspaceJob(result)
                }} onSavedAfterInvalidation={(jobId) => {
                  if (!mounted.current || selectedJobId.current !== jobId) return
                  // Reuse the guarded read path without clearing a job draft,
                  // open review, comparison, filters, or manual shortlist order.
                  ++requestId.current
                  rerankReloadPending.current = true
                  setWorkspaceReloadRevision((revision) => revision + 1)
                }} />
              </div>
            </header>
            {!workspace.temporary && <div className="recruit-job-context">
              <div><span className="recruit-eyebrow">{t('Hiring company')}</span><strong dir="auto">{hiringCompany?.name ?? t('No company assigned')}</strong>{hiringCompany && <span className="hint" dir="auto">{[...hiringCompany.industry, ...hiringCompany.location].join(' · ')}</span>}</div>
              <div><span className="recruit-eyebrow">{t('Salary budget')}</span><strong><bdi>{workspace.job.budget ? budgetLabel(workspace.job.budget, formatNumber, t) : t('Not specified')}</bdi></strong></div>
              <div><span className="recruit-eyebrow">{t('Total hiring budget')}</span><strong><bdi>{workspace.job.hiringBudget ? hiringBudgetLabel(workspace.job.hiringBudget, formatNumber, t) : t('Not specified')}</bdi></strong></div>
              {hiringCompany?.note && <details className="recruit-company-context"><summary>{t('Company hiring notes')}</summary><p dir="auto" className="recruit-prewrap">{hiringCompany.note}</p></details>}
            </div>}
            {!workspace.temporary && <JobStatusPanel key={workspace.job.id} workspace={workspace} resumes={resumes} active={active} disabled={workflowDisabled || rerankBusy} libraryRevision={libraryRevision} onBusyChange={setStatusBusy} onOpenResume={onOpenResume} onSaved={(result) => {
              ++requestId.current
              setLoading(false)
              setWorkspace((current) => current?.job.id === result.job.id ? { ...result, evidence: current.evidence } : current)
              upsertJob(result.job)
              announce(t('Status updated'))
            }} />}
            {workspace.temporary && <div className="recruit-notice recruit-temporary-notice">
              <span>{saveFirstHint}</span>
              <div className="recruit-actions">
                <button className="btn primary sm" disabled={locked || workspace.job.stale || !workspace.response || jobs.length >= 250} onClick={() => { void saveTemporary() }}>{busy === 'save-temporary' ? t('Saving…') : t('Save as job')}</button>
                <button className="btn sm" title={t('Export the top three matches before filters.')} disabled={locked || workspace.job.stale || allMatches.length === 0} onClick={() => { void exportTemporary() }}>{busy === 'export-temporary' ? t('Exporting…') : t('Export top 3…')}</button>
                <button className="btn sm" disabled={locked} onClick={() => { void discardTemporary() }}>{t('Discard search')}</button>
              </div>
            </div>}
            {reviewDirty && <div className="recruit-notice" role="status">{t("Save or discard your open review before changing jobs, editing criteria, or refreshing matches.")}</div>}
            {workspace.job.stale && <div className="recruit-notice"><span>{workspace.job.newResumeCount > 0 ? t(workspace.job.newResumeCount === 1 ? '{count} new CV is ready to match against this vacancy.' : '{count} new CVs are ready to match against this vacancy.', { count: workspace.job.newResumeCount }) : t('The posting or library has changed since these matches were saved.')} {workspace.temporary ? t('Refresh matches to update these temporary results before saving or exporting.') : t('Refresh matches to update rankings and suggested evidence. Saved decisions and notes are retained.')}</span></div>}
            {!workspace.job.stale && workspace.job.newResumeCount > 0 && <div className="recruit-notice"><span>{t(workspace.job.newResumeCount === 1 ? '{count} new CV in your library. Refresh matches to rediscover candidates for this job.' : '{count} new CVs in your library. Refresh matches to rediscover candidates for this job.', { count: workspace.job.newResumeCount })}</span></div>}
            <details className="recruit-posting-summary"><summary>{t("View job description and criteria")}</summary><div>{Object.entries({ Description: workspace.job.posting.jobDescription, Requirements: workspace.job.posting.requirements, 'Education and certifications': workspace.job.posting.educationAndCertifications }).filter(([, value]) => value.trim()).map(([label, value]) => <div key={label}><h4>{t(label)}</h4><p dir="auto" className="recruit-prewrap">{value}</p></div>)}{workspace.job.criteria.length > 0 && <><h4>{t("Evaluation criteria")}</h4><ul>{workspace.job.criteria.map((criterion) => <li key={criterion.id}><span className={`recruit-importance ${criterion.importance}`}>{t(criterionImportanceLabel(criterion.importance))}</span> <bdi>{criterion.text}</bdi></li>)}</ul></>}</div></details>
            <div className={`recruit-funnel ${workspace.temporary ? 'recruit-temporary-stats' : ''}`} aria-label={t('Screening progress')}>
              {funnelStops.map((stop, index) => <div key={stop.key} className={`recruit-stop ${stop.reached ? 'reached' : ''} ${index === currentStop ? 'current' : ''}`}><span className={`lb ${stop.reached ? stop.tone : 'neutral'}`}>{stop.key === 'hired' && stop.reached ? <CheckIcon size={12} /> : <strong>{formatNumber(stop.count)}</strong>}</span><span className="recruit-stop-label">{stop.label}</span></div>)}
            </div>
            <div className="recruit-tabs" role="group" aria-label={t('Candidate views')}><button className={tab === 'candidates' ? 'selected' : ''} aria-pressed={tab === 'candidates'} disabled={targetDirty || pipelineDirty || packDirty} onClick={() => setTab('candidates')}>{t('Candidates')} <span>{formatNumber(allMatches.length)}</span></button><button className={tab === 'shortlist' ? 'selected' : ''} aria-pressed={tab === 'shortlist'} disabled={workspace.temporary || targetDirty || pipelineDirty || packDirty} title={workspace.temporary ? saveFirstHint : undefined} onClick={() => setTab('shortlist')}>{t('Shortlist')} <span>{formatNumber(shortlist.length)}</span></button><button className={tab === 'compare' ? 'selected' : ''} aria-pressed={tab === 'compare'} disabled={workspace.temporary || targetDirty || pipelineDirty || packDirty} title={workspace.temporary ? saveFirstHint : undefined} onClick={() => setTab('compare')}>{t('Compare')} <span><bdi>{formatNumber(compareKeys.length)}/{formatNumber(4)}</bdi></span></button>{!workspace.temporary && <button className={tab === 'targets' ? 'selected' : ''} aria-pressed={tab === 'targets'} disabled={reviewDirty || pipelineDirty || packDirty} onClick={() => setTab('targets')}>{t('Target companies')} <span>{formatNumber(workspace.job.targetCompanies?.length ?? 0)}</span></button>}{!workspace.temporary && <><button className={tab === 'pipeline' ? 'selected' : ''} aria-pressed={tab === 'pipeline'} disabled={reviewDirty || targetDirty || packDirty} onClick={() => setTab('pipeline')}>{t('Pipeline')}</button><button className={tab === 'pack' ? 'selected' : ''} aria-pressed={tab === 'pack'} disabled={reviewDirty || targetDirty || pipelineDirty} onClick={() => setTab('pack')}>{t('Client pack')}</button></>}</div>
            {evidenceLoading && <div className="recruit-notice" role="status">{t("Finding suggested passages for your scorecard…")}</div>}
            {evidenceError && <div className="recruit-error" role="alert"><span>{t('Suggested evidence could not be loaded: {error}', { error: recruitingError(evidenceError, t, language) })}</span><button className="btn sm" onClick={() => setEvidenceRetry((value) => value + 1)}>{t("Retry evidence")}</button></div>}
            {tab === 'pipeline' ? <JobPipeline key={workspace.job.id} job={workspace.job} revision={talentRevision + libraryRevision} active={active} disabled={Boolean(busy || loading || listLoading || reviewDirty || rerankBusy || statusBusy)} onDirtyChange={setPipelineDirty} /> : tab === 'pack' ? <ClientPack key={workspace.job.id} jobId={workspace.job.id} active={active} sourceRevision={talentRevision + libraryRevision} disabled={Boolean(busy || loading || listLoading || reviewDirty || rerankBusy || statusBusy)} onDirtyChange={setPackDirty} onToast={announce} /> : tab === 'targets' ? <TargetCompanies key={workspace.job.id} job={workspace.job} companies={companies} disabled={Boolean(busy || loading || listLoading || reviewDirty || rerankBusy || statusBusy)} onDirtyChange={setTargetDirty} onSave={saveTargets} onOpenCompanies={onOpenCompanies} /> : tab === 'compare' ? <CandidateComparison workspace={workspace} matches={comparisonMatches} onOpenCandidate={onOpenCandidate} onRemove={(key) => setCompareKeys((keys) => keys.filter((item) => item !== key))} /> : <>
              <div className="recruit-results-toolbar"><label className="recruit-search"><span className="sr-only">{t("Find candidates")}</span><input dir="auto" value={filters.query} placeholder={t("Search name, contact, skills, or tags…")} onChange={(event) => setFilters({ ...filters, query: event.target.value })} /></label>{!workspace.temporary && <label><span className="sr-only">{t("Filter by review state")}</span><select value={filters.status} onChange={(event) => setFilters({ ...filters, status: event.target.value })}><option value="">{t("All review states")}</option>{Object.entries(REVIEW_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>}<button className="btn sm" aria-expanded={showFilters} aria-controls="recruit-profile-filters" onClick={() => setShowFilters(!showFilters)}>{activeFilters ? t('Filters ({count})', { count: activeFilters }) : t('Filters')}</button></div>
              {showFilters && <div id="recruit-profile-filters" className="recruit-profile-filters"><label className="recruit-field">{t("Location")}<input dir="auto" value={filters.location} placeholder={t("Current or preferred")} onChange={(event) => setFilters({ ...filters, location: event.target.value })} /></label><label className="recruit-field">{t("Min. experience")}<LocalizedNumberInput min={0} max={80} step={0.5} value={filters.years} placeholder={t("Years")} onChangeValue={(years) => setFilters({ ...filters, years })} /></label><label className="recruit-field">{t("Skill")}<input dir="auto" value={filters.skill} placeholder={t("e.g. Excel")} onChange={(event) => setFilters({ ...filters, skill: event.target.value })} /></label><label className="recruit-field">{t("Tag")}<input dir="auto" value={filters.tag} placeholder={t("Recruiter tag")} onChange={(event) => setFilters({ ...filters, tag: event.target.value })} /></label><label className="recruit-field">{t("Availability")}<input dir="auto" value={filters.availability} placeholder={t("e.g. Immediate")} onChange={(event) => setFilters({ ...filters, availability: event.target.value })} /></label><button className="btn sm" disabled={activeFilters === 0} onClick={() => setFilters(EMPTY_FILTERS)}>{t("Clear filters")}</button></div>}
              {tab === 'shortlist' && <div className="recruit-shortlist-toolbar"><p className="hint">{t(activeFilters ? 'Exports include the full shortlist, including candidates hidden by filters.' : 'Exports include the full shortlist.')}{workspace.job.stale && <> {t('Refresh matches before exporting.')}</>}</p><div className="recruit-actions"><button className="btn sm" disabled={locked || shortlist.length === 0 || workspace.job.stale} onClick={() => { void exportShortlist('pdf') }}>{busy === 'export-pdf' ? t('Exporting…') : t('Export PDF')}</button><button className="btn sm" disabled={locked || shortlist.length === 0 || workspace.job.stale} onClick={() => { void exportShortlist('csv') }}>{busy === 'export-csv' ? t('Exporting…') : t('Export CSV')}</button></div></div>}
              {!workspace.response ? <div className="recruit-empty"><h3>{resumes.length ? t('Ready to find your candidates') : t('Your library is empty')}</h3><p>{resumes.length ? t(resumes.length === 1 ? 'Match this job against {count} CV in your library.' : 'Match this job against {count} CVs in your library.', { count: resumes.length }) : t('Import resumes from Library, then return here to find matches.')}</p></div> : visible.length === 0 ? <div className="recruit-empty"><h3>{activeFilters ? t('No candidates match these filters') : tab === 'shortlist' ? t('Build your shortlist') : t('No candidates to show')}</h3><p>{activeFilters ? t('Clear or adjust your filters to see more candidates.') : tab === 'shortlist' ? t('Choose Shortlist on any candidate.') : t('Import CVs and refresh matches to populate this job.')}</p>{activeFilters > 0 && <button className="btn sm" onClick={() => setFilters(EMPTY_FILTERS)}>{t("Clear filters")}</button>}</div> : <>
                <div className="recruit-table-scroll"><table className="recruit-candidate-table"><thead><tr>{!workspace.temporary && <th scope="col" className="recruit-check-cell">{t('Compare')}</th>}{tab === 'shortlist' && <th scope="col">{t('Order')}</th>}<th scope="col">{t('Candidate')}</th><th scope="col">{t('Match')}</th>{!workspace.temporary && <th scope="col">{t('Review · Stage')}</th>}<th scope="col" className="recruit-action-cell"><span className="sr-only">{t('Actions')}</span></th></tr></thead><tbody>{pageMatches.map((match) => {
                  const profile = matchProfile(workspace, match)
                  const resume = candidateWithProfile(match.resume, profile)
                  const review = reviewForMatch(workspace.reviews, workspace.profiles, match)
                  const selected = isShortlisted(review)
                  const shortIndex = shortlist.findIndex((item) => item.resume.recordKey === match.resume.recordKey)
                  const comparisonSelected = compareKeys.includes(match.resume.recordKey)
                  const stage = workspace.temporary ? undefined : stagesByRecord.get(match.resume.recordKey)
                  return <tr key={match.resume.recordKey} className={reviewKey === match.resume.recordKey ? 'reviewing' : ''}>
                    {!workspace.temporary && <td className="recruit-check-cell"><input type="checkbox" aria-label={t('Compare {name}', { name: candidateName(match, profile) })} checked={comparisonSelected} disabled={!comparisonSelected && compareKeys.length >= 4} onChange={(event) => setCompareKeys((keys) => event.target.checked ? [...keys, match.resume.recordKey].slice(0, 4) : keys.filter((key) => key !== match.resume.recordKey))} /></td>}
                    {tab === 'shortlist' && <td><div className="recruit-order"><span>{formatNumber(shortIndex + 1)}</span><button type="button" aria-label={t('Move {name} up', { name: candidateName(match, profile) })} className="btn sm" disabled={locked || shortIndex <= 0} onClick={() => { void reorder(match, -1) }}><ChevronUpIcon /></button><button type="button" aria-label={t('Move {name} down', { name: candidateName(match, profile) })} className="btn sm" disabled={locked || shortIndex === shortlist.length - 1} onClick={() => { void reorder(match, 1) }}><ChevronDownIcon /></button></div></td>}
                    <td><button className="recruit-name" dir="auto" onClick={() => onOpenCandidate(match)}>{candidateName(match, profile)}</button><div className="cell-sub"><bdi>{resume.location || t('Location not stated')}</bdi> · {resume.yearsExperience === null ? t('Experience not stated') : t('{count} years', { count: resume.yearsExperience })}</div><div className="recruit-row-skills" dir="auto">{resume.skills.slice(0, 4).join(' · ')}{resume.skills.length > 4 && ` +${formatNumber(resume.skills.length - 4)}`}</div>{profile && (profile.tags.length > 0 || profile.availability) && <div className="recruit-row-tags">{profile.availability && <span dir="auto">{profile.availability}</span>}{profile.tags.slice(0, 3).map((tag) => <span key={tag} dir="auto">{tag}</span>)}</div>}{match.llmReason && <p className="llm-reason recruit-llm-reason"><span className="tag" dir="ltr">{rerankModelLabel(workspace.response?.rerankConfig?.model ?? DEFAULT_RERANK_CONFIG.model)}</span><bdi>{match.llmReason}</bdi></p>}</td>
                    <td><span className="recruit-score" title={t("Relative match score; review the supporting evidence")}>{formatNumber(Math.round(match.score * 100))}</span></td>
                    {!workspace.temporary && <td><span className={`recruit-review-state ${review?.status ?? 'unreviewed'}`}>{t(REVIEW_LABELS[review?.status ?? 'unreviewed'])}</span>{review?.note && <span className="recruit-note-indicator">{t('Has notes')}</span>}{stage && <span className={`pill recruit-stage-pill ${stageToneFor(stage)}`}>{t(PIPELINE_LABELS[stage])}</span>}</td>}
                    <td className="recruit-action-cell">{workspace.temporary ? <div className="recruit-row-actions"><button className="btn sm" onClick={() => onOpenCandidate(match)}>{t('View details')}</button>{workspace.job.criteria.length > 0 && <button className="btn sm" aria-label={t('Requirement passages for {name}', { name: candidateName(match, profile) })} onClick={() => { reviewSnapshot.current = match; setReviewKey(match.resume.recordKey); requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })) }}>{t('Requirement passages')}</button>}</div> : <div className="recruit-row-actions"><button className="btn sm" aria-label={t('Review {name}', { name: candidateName(match, profile) })} disabled={Boolean(busy || rerankBusy || loading || reviewDirty && reviewKey !== match.resume.recordKey)} onClick={() => { reviewSnapshot.current = match; setReviewKey(match.resume.recordKey); requestAnimationFrame(() => reviewRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })) }}>{t('Review')}<ArrowIcon size={14} /></button><button className={`btn sm ${selected ? '' : 'primary'}`} aria-label={selected ? t('Remove {name} from shortlist', { name: candidateName(match, profile) }) : t('Shortlist {name}', { name: candidateName(match, profile) })} disabled={locked} onClick={() => { void setCandidateStatus(match, selected ? 'maybe' : 'shortlisted') }}>{selected ? t('Remove') : t('Shortlist')}</button>{stage ? <button className="btn sm" aria-label={t('Open pipeline for {name}', { name: candidateName(match, profile) })} disabled={locked} onClick={() => { setReviewKey(null); setTab('pipeline') }}>{t('Open in pipeline')}</button> : <button className="btn sm" aria-label={t('Add {name} to pipeline', { name: candidateName(match, profile) })} disabled={locked} onClick={() => { void addToPipeline(match) }}>{t('Add to pipeline')}</button>}</div>}</td>
                  </tr>
                })}</tbody></table></div>
                <div className="recruit-pagination"><span className="hint">{t(activeFilters > 0 ? '{start}–{end} of {count} candidates after filters · Scores are relative, not eligibility decisions.' : '{start}–{end} of {count} candidates · Scores are relative, not eligibility decisions.', { start: currentPage * PAGE_SIZE + 1, end: Math.min((currentPage + 1) * PAGE_SIZE, visible.length), count: visible.length })}</span><div className="recruit-actions"><button className="btn sm" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>{t("Previous")}</button><span className="hint"><bdi>{formatNumber(currentPage + 1)} / {formatNumber(pageCount)}</bdi></span><button className="btn sm" disabled={currentPage >= pageCount - 1} onClick={() => setPage(currentPage + 1)}>{t("Next")}</button></div></div>
              </>}
              {compareKeys.length > 0 && <div className="recruit-compare-bar"><span>{t('{count} selected for comparison', { count: compareKeys.length })}</span><div className="recruit-actions"><button className="recruit-text-button" onClick={() => setCompareKeys([])}>{t("Clear")}</button><button className="btn sm" disabled={compareKeys.length < 2} onClick={() => setTab('compare')}>{t("Compare candidates")}</button></div></div>}
            </>}
            {workspace.temporary && selectedReview && <div ref={reviewRef}><RequirementPassages workspace={workspace} match={selectedReview} onClose={() => setReviewKey(null)} onOpenCandidate={onOpenCandidate} /></div>}
            {!workspace.temporary && selectedReview && <div ref={reviewRef}><ReviewScorecard key={`${workspace.job.id}:${selectedReview.resume.recordKey}`} workspace={workspace} match={selectedReview} busy={Boolean(busy || rerankBusy || loading)} onSave={saveReview} onClose={() => { setReviewKey(null); setReviewDirty(false) }} onDirty={(dirty) => { reviewDirtyRef.current = dirty; setReviewDirty(dirty) }} onOpenCandidate={onOpenCandidate} /></div>}
          </>}
        </section>
      </div>
    </div>
  )
}
