import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { TalentOverview } from '@shared/talent.js'
import type { SavedJob } from '@shared/recruiting.js'
import type { ResumeSummary } from '@shared/types.js'
import { displayError } from '@shared/i18n.js'
import { useI18n } from '../i18n.js'
import PeopleDesk from '../components/talent/PeopleDesk.js'
import FollowUps from '../components/talent/FollowUps.js'
import TalentPools from '../components/talent/TalentPools.js'
import type { DeskAction, UpdateOverview } from '../components/talent/desk-types.js'
import '../talent.css'

interface Props {
  resumes: ResumeSummary[]
  libraryRevision: number
  onChanged: () => void
  onNavigationLockChange: (locked: boolean) => void
  onOpenJob: (jobId: string) => void
  onOpenResume: (resume: ResumeSummary) => void
}

export default function TalentView({ resumes, libraryRevision, onChanged, onNavigationLockChange, onOpenJob, onOpenResume }: Props): React.JSX.Element {
  const { t, language, formatNumber } = useI18n()
  const [tab, setTab] = useState<'follow-ups' | 'people' | 'pools'>('follow-ups')
  const [data, setData] = useState<TalentOverview | null>(null)
  const [jobs, setJobs] = useState<SavedJob[]>([])
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null)
  const [createPerson, setCreatePerson] = useState(false)
  const [refreshing, setRefreshing] = useState(true)
  const [mutating, setMutating] = useState(false)
  const [childLocked, setChildLocked] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const mounted = useRef(false)
  const inFlight = useRef(false)
  const request = useRef(0)
  const busy = refreshing || mutating
  const locked = childLocked || mutating || createPerson

  useEffect(() => { mounted.current = true; return () => { mounted.current = false; ++request.current } }, [])
  useLayoutEffect(() => { onNavigationLockChange(locked); return () => onNavigationLockChange(false) }, [locked, onNavigationLockChange])

  const refresh = useCallback(async (): Promise<void> => {
    const current = ++request.current
    setRefreshing(true)
    try {
      const [overview, nextJobs] = await Promise.all([window.api.talent.overview(), window.api.recruiting.listJobs()])
      if (!mounted.current || current !== request.current) return
      setData(overview)
      setJobs(nextJobs)
    } finally { if (mounted.current && current === request.current) setRefreshing(false) }
  }, [])

  useEffect(() => {
    void refresh().catch((failure: unknown) => {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'Could not load the recruiter desk.')
    })
  }, [libraryRevision, refresh])

  const update: UpdateOverview = useCallback((change) => setData((current) => current ? change(current) : current), [])
  const run: DeskAction = async (work, apply, changed = true) => {
    if (inFlight.current) return false
    inFlight.current = true
    ++request.current
    setRefreshing(false)
    setMutating(true)
    setError(null)
    try {
      const result = await work()
      if (!mounted.current) return true
      apply(result)
      if (changed) {
        onChanged()
        try { await refresh() } catch (failure) { if (mounted.current) setError(failure instanceof Error ? failure.message : 'The change was saved. Refresh the desk to see the latest records.') }
      }
      return true
    } catch (failure) {
      if (mounted.current) setError(failure instanceof Error ? failure.message : 'The operation could not be completed. Please try again.')
      return false
    } finally {
      inFlight.current = false
      if (mounted.current) setMutating(false)
    }
  }
  const openPerson = (id: string): void => { if (locked || busy) return; setSelectedPerson(id); setTab('people') }
  const handledCreate = useCallback(() => setCreatePerson(false), [])
  const pending = (data?.activities.filter((activity) => activity.dueAt !== null && activity.completedAt === null).length ?? 0) + (data?.assignments.filter((assignment) => assignment.dueAt !== null).length ?? 0)
  const errorText = error && language === 'ar' && /Invalid (?:talent|recruiting) data/.test(error) ? t('The recruiter data is invalid. Check the fields and try again.') : error ? displayError(language, error, 'Could not load the recruiter desk.') : ''

  return <div className="talent">
    <header className="talent-page-head"><div><p className="talent-eyebrow">{t('Relationships that move hiring forward')}</p><h2>{t('Recruiter desk')}</h2><p className="hint">{t('Plan conversations, remember prospects, and keep your talent pools current.')}</p></div><div className="talent-actions"><button type="button" className="btn sm" disabled={locked || busy} onClick={() => { setError(null); void refresh().catch((failure) => setError(String(failure))) }}>{t('Refresh desk')}</button><button type="button" className="btn primary" disabled={locked || busy || !data} onClick={() => { setTab('people'); setCreatePerson(true) }}>{t('+ New prospect')}</button></div></header>
    {error && <div className="talent-error" role="alert"><span>{errorText}</span><button type="button" className="btn sm" disabled={mutating} onClick={() => setError(null)}>{t('Dismiss')}</button></div>}
    <div className="talent-tabs" role="group" aria-label={t('Recruiter desk views')}><button type="button" className={tab === 'follow-ups' ? 'selected' : ''} aria-pressed={tab === 'follow-ups'} disabled={locked} onClick={() => setTab('follow-ups')}>{t('Follow-ups')}<span>{formatNumber(pending)}</span></button><button type="button" className={tab === 'people' ? 'selected' : ''} aria-pressed={tab === 'people'} disabled={locked} onClick={() => setTab('people')}>{t('People')}<span>{formatNumber(data?.people.length ?? 0)}</span></button><button type="button" className={tab === 'pools' ? 'selected' : ''} aria-pressed={tab === 'pools'} disabled={locked} onClick={() => setTab('pools')}>{t('Talent pools')}<span>{formatNumber(data?.pools.length ?? 0)}</span></button></div>
    {!data ? <div className="talent-panel talent-empty" role="status"><h3>{t(refreshing ? 'Loading your recruiter desk…' : 'Recruiter desk unavailable')}</h3>{!refreshing && <button type="button" className="btn" onClick={() => { setError(null); void refresh().catch((failure) => setError(String(failure))) }}>{t('Retry')}</button>}</div>
      : tab === 'follow-ups' ? <FollowUps data={data} jobs={jobs} busy={busy} run={run} update={update} onOpenPerson={openPerson} onOpenJob={onOpenJob} />
      : tab === 'people' ? <PeopleDesk data={data} jobs={jobs} resumes={resumes} selectedId={selectedPerson} onSelect={setSelectedPerson} createPerson={createPerson} onCreateHandled={handledCreate} busy={busy} run={run} update={update} onLock={setChildLocked} onOpenJob={onOpenJob} onOpenResume={onOpenResume} />
      : <TalentPools data={data} busy={busy} run={run} update={update} onLock={setChildLocked} onOpenPerson={openPerson} />}
  </div>
}
