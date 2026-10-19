import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { CandidateProfile, JobPlacementCandidate, JobStatus, JobStatusEvent, JobWorkspace } from '@shared/recruiting.js'
import { candidateWithProfile } from '@shared/recruiting.js'
import { toIsoDateTime } from '@shared/i18n.js'
import type { ResumeRef, ResumeSummary } from '@shared/types.js'
import { useI18n } from '../../i18n.js'
import { errorMessage, isShortlisted, recruitingError, JOB_STATUS_LABELS } from './helpers.js'
import HiringCandidatePicker, { type HiringCandidateOption } from './HiringCandidatePicker.js'
import { CheckIcon } from '../Icons.js'
import DisclosureSummary from '../DisclosureSummary.js'

interface Props {
  workspace: JobWorkspace
  resumes: ResumeSummary[]
  active: boolean
  disabled: boolean
  libraryRevision: number
  onBusyChange: (busy: boolean) => void
  onSaved: (workspace: JobWorkspace) => void
  onOpenResume: (resume: ResumeSummary) => void
}

type SelectedPeople = { hired: string; backup2: string; backup3: string }
const EMPTY_SELECTION: SelectedPeople = { hired: '', backup2: '', backup3: '' }

/** The date of entry into the current state, unaffected by later edits or searches. */
function latestStatusEvent(workspace: JobWorkspace): JobStatusEvent | undefined {
  return [...(workspace.job.statusHistory ?? [])].reverse().find((event) => event.kind !== 'placement-updated' && event.status === workspace.job.status)
}

export default function JobStatusPanel({ workspace, resumes, active, disabled, libraryRevision, onBusyChange, onSaved, onOpenResume }: Props): React.JSX.Element {
  const { t, language, formatDate, formatNumber } = useI18n()
  const { job } = workspace
  const [open, setOpen] = useState(false)
  const [status, setStatus] = useState<JobStatus>(job.status)
  const [selected, setSelected] = useState<SelectedPeople>(EMPTY_SELECTION)
  const [profiles, setProfiles] = useState<CandidateProfile[]>([])
  const [profilesLoading, setProfilesLoading] = useState(false)
  const [profilesError, setProfilesError] = useState<string | null>(null)
  const [profilesRetry, setProfilesRetry] = useState(0)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const expectedUpdatedAt = useRef(job.updatedAt)
  const inFlight = useRef(false)
  const mounted = useRef(true)
  const initializeSelection = useRef(false)
  const titleId = useId()
  const history = job.statusHistory ?? []
  const firstPlacementIndex = history.findIndex((event) => event.placement)
  const currentStatusEvent = latestStatusEvent(workspace)
  const placementEvent = [...history].reverse().find((event) => event.placement)
  const date = (value: number): string => formatDate(value, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; onBusyChange(false) }
  }, [onBusyChange])

  useEffect(() => {
    if (!active && open && !saving) { setOpen(false); onBusyChange(false) }
  }, [active, open, saving, onBusyChange])

  useLayoutEffect(() => {
    if (!open || !dialog.current) return
    const element = dialog.current
    if (!element.open) element.showModal()
    return () => { if (element.open) element.close() }
  }, [open])

  useEffect(() => {
    if (!open) return
    let cancelled = false
    setProfilesLoading(true)
    setProfilesError(null)
    void window.api.recruiting.listProfiles().then((result) => {
      if (cancelled) return
      setProfiles(result)
      if (initializeSelection.current) {
        const personKey = (candidate?: JobPlacementCandidate | null): string => {
          if (!candidate?.recordKey || !resumes.some((resume) => resume.recordKey === candidate.recordKey)) return ''
          return result.find((profile) => profile.recordKeys.includes(candidate.recordKey!))?.candidateKey ?? candidate.recordKey
        }
        const initial = { hired: personKey(job.placement?.hired), backup2: personKey(job.placement?.backup2), backup3: personKey(job.placement?.backup3) }
        // Deletions and newly linked CVs can invalidate an old choice. Present a
        // clean, contiguous selection and require a fresh decision before saving.
        if (initial.backup2 === initial.hired) initial.backup2 = ''
        if (!initial.backup2 || initial.backup3 === initial.hired || initial.backup3 === initial.backup2) initial.backup3 = ''
        setSelected(initial)
        initializeSelection.current = false
      }
    }).catch((failure: unknown) => { if (!cancelled) setProfilesError(errorMessage(failure)) })
      .finally(() => { if (!cancelled) setProfilesLoading(false) })
    return () => { cancelled = true }
  }, [open, libraryRevision, profilesRetry, job.id])

  const options = useMemo((): HiringCandidateOption[] => {
    const byRecord = new Map<string, CandidateProfile>()
    for (const profile of profiles) for (const key of profile.recordKeys) byRecord.set(key, profile)
    const shortlist = new Set(workspace.reviews.filter(isShortlisted).map((review) => review.candidateKey))
    const people = new Map<string, HiringCandidateOption>()
    const preferredRecords = new Set([job.placement?.hired.recordKey, job.placement?.backup2?.recordKey, job.placement?.backup3?.recordKey])
    for (const resume of resumes) {
      const profile = byRecord.get(resume.recordKey)
      const personKey = profile?.candidateKey ?? resume.recordKey
      const existing = people.get(personKey)
      if (existing && (preferredRecords.has(existing.resume.recordKey) || !preferredRecords.has(resume.recordKey) && existing.resume.importedAt >= resume.importedAt)) continue
      const corrected = candidateWithProfile(resume, profile)
      people.set(personKey, { personKey, resume, name: corrected.name || resume.fileName, shortlisted: shortlist.has(personKey) })
    }
    return [...people.values()].sort((a, b) => Number(b.shortlisted) - Number(a.shortlisted) || a.name.localeCompare(b.name, language))
  }, [resumes, profiles, workspace.reviews, job.placement, language])
  const optionsByKey = useMemo(() => new Map(options.map((option) => [option.personKey, option])), [options])
  const selectionValid = Boolean(selected.hired && optionsByKey.has(selected.hired) &&
    (!selected.backup2 || optionsByKey.has(selected.backup2) && selected.backup2 !== selected.hired) &&
    (!selected.backup3 || selected.backup2 && optionsByKey.has(selected.backup3) && selected.backup3 !== selected.hired && selected.backup3 !== selected.backup2))
  const selectionMatchesPlacement = (['hired', 'backup2', 'backup3'] as const).every((slot) => {
    const recorded = job.placement?.[slot]
    const chosen = optionsByKey.get(selected[slot])
    return chosen ? recorded?.recordKey === chosen.resume.recordKey : !recorded
  })
  const changed = status !== job.status || status === 'filled' && !selectionMatchesPlacement

  const close = (): void => {
    if (inFlight.current) return
    setOpen(false)
    onBusyChange(false)
    requestAnimationFrame(() => { if (active) trigger.current?.focus() })
  }
  const start = (): void => {
    if (!active || disabled || open) return
    expectedUpdatedAt.current = job.updatedAt
    setStatus(job.status)
    setSelected(EMPTY_SELECTION)
    initializeSelection.current = true
    setError(null)
    setProfilesError(null)
    setProfilesLoading(true)
    setOpen(true)
    onBusyChange(true)
  }
  const save = async (): Promise<void> => {
    if (inFlight.current || !changed || status === 'filled' && (!selectionValid || profilesLoading || profilesError)) return
    inFlight.current = true
    setSaving(true)
    setError(null)
    const ref = (key: string): ResumeRef => {
      const resume = optionsByKey.get(key)!.resume
      return { id: resume.id, recordKey: resume.recordKey }
    }
    try {
      const result = await window.api.recruiting.changeJobStatus({
        jobId: job.id,
        expectedUpdatedAt: expectedUpdatedAt.current,
        status,
        ...(status === 'filled' ? { placement: { hired: ref(selected.hired), ...(selected.backup2 ? { backup2: ref(selected.backup2) } : {}), ...(selected.backup3 ? { backup3: ref(selected.backup3) } : {}) } } : {})
      })
      if (!mounted.current) return
      onSaved(result)
      setOpen(false)
      onBusyChange(false)
      requestAnimationFrame(() => { if (active) trigger.current?.focus() })
    } catch (failure) { if (mounted.current) setError(errorMessage(failure)) }
    finally { inFlight.current = false; if (mounted.current) setSaving(false) }
  }

  const candidateLabel = (candidate: JobPlacementCandidate): string => candidate.name || resumes.find((resume) => resume.recordKey === candidate.recordKey)?.fileName || t('Selected CV removed')
  const placementCard = (candidate: JobPlacementCandidate, rank: number): React.JSX.Element => {
    const resume = resumes.find((item) => item.recordKey === candidate.recordKey)
    return <article className={`recruit-hiring-card ${rank === 1 ? 'hired' : ''}`} key={rank} aria-label={t(rank === 1 ? 'Hired candidate' : rank === 2 ? 'Backup #2' : 'Backup #3')}>
      <div className="recruit-hiring-card-label"><span aria-hidden="true">{rank === 1 ? <CheckIcon size={12} /> : formatNumber(rank)}</span><span>{t(rank === 1 ? 'Hired' : rank === 2 ? 'Backup #2' : 'Backup #3')}</span></div>
      <strong><bdi>{candidateLabel(candidate)}</bdi></strong>
      {resume ? <><p className="hint"><bdi>{resume.fileName}</bdi></p><button className="recruit-text-button" type="button" disabled={disabled || open} onClick={() => onOpenResume(resume)}>{t('View CV')}</button></> : <p className="hint">{t('CV no longer in library')}</p>}
    </article>
  }

  return <section className="recruit-job-status-panel" aria-label={t('Job status')}>
    <div className="recruit-status-overview">
      <div><h4>{t('Current status: {status}', { status: t(JOB_STATUS_LABELS[job.status]) })}</h4><div className="recruit-status-dates">
        <span>{t('Created {date}', { date: date(job.createdAt) })}</span>
        {currentStatusEvent && <span>{t('{status} since {date}', { status: t(JOB_STATUS_LABELS[job.status]), date: date(currentStatusEvent.at) })}</span>}
      </div></div>
      <button ref={trigger} className="btn sm" type="button" disabled={disabled || open} onClick={start}>{t('Change status')}</button>
    </div>
    {job.placement ? <div className="recruit-hiring-evidence">
      <h4>{t(job.status === 'filled' ? 'Hiring outcome' : 'Last hiring outcome')}</h4>
      <p className="hint">{placementEvent && <>{t('Recorded {date}', { date: date(placementEvent.at) })} · </>}{t('Names reflect the hiring decision when it was recorded.')}</p>
      <div className="recruit-hiring-cards">{placementCard(job.placement.hired, 1)}{job.placement.backup2 && placementCard(job.placement.backup2, 2)}{job.placement.backup3 && placementCard(job.placement.backup3, 3)}</div>
      {job.status === 'filled' && <button className="recruit-text-button" type="button" disabled={disabled || open} onClick={start}>{t('Edit hiring details')}</button>}
    </div> : job.status === 'filled' && <div className="recruit-hiring-evidence"><p className="hint">{t('Hiring details have not been recorded for this job.')}</p><button className="recruit-text-button" type="button" disabled={disabled || open} onClick={start}>{t('Add hiring details')}</button></div>}
    <details className="disclosure inline recruit-status-history"><DisclosureSummary>{t('Status history')}</DisclosureSummary>
      {!history.some((event) => event.kind === 'created') && <p className="hint">{t('Earlier status changes were not recorded.')}</p>}
      <ol>{[...history].reverse().map((event, reversedIndex) => {
        const previous = history[history.length - reversedIndex - 2]
        const earlierPlacement = firstPlacementIndex >= 0 && firstPlacementIndex < history.length - reversedIndex - 1
        const label = event.kind === 'created' ? t('Created as {status}', { status: t(JOB_STATUS_LABELS[event.status]) }) : event.kind === 'placement-updated' ? t(earlierPlacement ? 'Hiring details updated' : 'Hiring details recorded') : previous ? t('{from} → {to}', { from: t(JOB_STATUS_LABELS[previous.status]), to: t(JOB_STATUS_LABELS[event.status]) }) : t('Changed to {status}', { status: t(JOB_STATUS_LABELS[event.status]) })
        return <li key={event.id}><div className="recruit-history-event"><span>{label}</span><time dateTime={toIsoDateTime(event.at)}>{date(event.at)}</time></div>{event.placement && <p className="hint"><bdi>{t('Hired: {name}', { name: candidateLabel(event.placement.hired) })}</bdi>{event.placement.backup2 && <> · <bdi>{t('Backup #2: {name}', { name: candidateLabel(event.placement.backup2) })}</bdi></>}{event.placement.backup3 && <> · <bdi>{t('Backup #3: {name}', { name: candidateLabel(event.placement.backup3) })}</bdi></>}</p>}</li>
      })}</ol>
    </details>
    {open && <dialog ref={dialog} className="recruit-status-dialog" aria-labelledby={titleId} onCancel={(event) => { event.preventDefault(); close() }}>
      <form onSubmit={(event) => { event.preventDefault(); void save() }}>
        <h3 id={titleId}>{t('Change status')}</h3>
        <fieldset className="recruit-fieldset" disabled={saving}>
          <label className="recruit-field">{t('Job status')}<select autoFocus value={status} onChange={(event) => { setStatus(event.target.value as JobStatus); setError(null) }}>{Object.entries(JOB_STATUS_LABELS).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label>
          {status === 'filled' && <div className="recruit-status-choices">
            <p className="hint">{t('Choose the hired candidate. You can also record up to two backup candidates, in order.')}</p>
            {profilesLoading && <p className="hint" role="status">{t('Loading candidate profiles…')}</p>}
            {profilesError ? <div className="recruit-error" role="alert"><span>{recruitingError(profilesError, t, language)}</span><button type="button" className="btn sm" onClick={() => setProfilesRetry((value) => value + 1)}>{t('Retry candidates')}</button></div> : <>
              <HiringCandidatePicker label={t('Hired candidate')} value={selected.hired} options={options} excluded={[selected.backup2, selected.backup3]} disabled={profilesLoading} onChange={(hired) => setSelected((current) => ({ ...current, hired }))} />
              <HiringCandidatePicker label={t('Backup #2')} value={selected.backup2} options={options} excluded={[selected.hired, selected.backup3]} optional disabled={profilesLoading} onChange={(backup2) => setSelected((current) => ({ ...current, backup2, backup3: backup2 ? current.backup3 : '' }))} />
              <HiringCandidatePicker label={t('Backup #3')} value={selected.backup3} options={options} excluded={[selected.hired, selected.backup2]} optional disabled={profilesLoading || !selected.backup2} onChange={(backup3) => setSelected((current) => ({ ...current, backup3 }))} />
              {!selected.backup2 && <p className="hint">{t('Choose backup #2 before backup #3.')}</p>}
              {!profilesLoading && resumes.length === 0 && <p className="hint">{t('Import the candidate’s CV in Library before recording the hire.')}</p>}
            </>}
          </div>}
        </fieldset>
        {error && <div className="recruit-error" role="alert">{recruitingError(error, t, language)}</div>}
        <div className="recruit-status-dialog-footer"><button className="btn" type="button" disabled={saving} onClick={close}>{t('Cancel')}</button><button className="btn primary" type="submit" disabled={saving || !changed || status === 'filled' && (!selectionValid || profilesLoading || Boolean(profilesError))}>{t(saving ? 'Saving…' : 'Save status')}</button></div>
      </form>
    </dialog>}
  </section>
}
