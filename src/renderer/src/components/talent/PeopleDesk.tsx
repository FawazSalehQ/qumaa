import { useEffect, useLayoutEffect, useMemo, useState } from 'react'
import type { Activity, MergePreview, Person, TalentOverview } from '@shared/talent.js'
import { EMPTY_TALENT_FILTERS, matchesTalentFilters } from '@shared/talent.js'
import type { SavedJob } from '@shared/recruiting.js'
import type { ResumeSummary } from '@shared/types.js'
import { useI18n } from '../../i18n.js'
import { jobPostingTitle } from '../../jobPosting.js'
import PersonEditor from './PersonEditor.js'
import ActivityEditor from './ActivityEditor.js'
import TalentConfirm from './TalentConfirm.js'
import { ACTIVITY_LABELS, STAGE_LABELS, type DeskAction, type UpdateOverview } from './desk-types.js'

interface Props {
  data: TalentOverview
  jobs: SavedJob[]
  resumes: ResumeSummary[]
  selectedId: string | null
  onSelect: (id: string) => void
  createPerson: boolean
  onCreateHandled: () => void
  busy: boolean
  run: DeskAction
  update: UpdateOverview
  onLock: (locked: boolean) => void
  onOpenJob: (id: string) => void
  onOpenResume: (resume: ResumeSummary) => void
}

type Confirmation = { kind: 'merge'; preview: MergePreview } | { kind: 'link'; resume: ResumeSummary; preview?: MergePreview } | { kind: 'delete'; person: Person }

export default function PeopleDesk({ data, jobs, resumes, selectedId, onSelect, createPerson, onCreateHandled, busy, run, update, onLock, onOpenJob, onOpenResume }: Props): React.JSX.Element {
  const { t, formatNumber, formatDate } = useI18n()
  const [query, setQuery] = useState('')
  const [hasCv, setHasCv] = useState<'any' | 'yes' | 'no'>('any')
  const [limit, setLimit] = useState(100)
  const [editor, setEditor] = useState<'person' | 'activity' | 'link' | 'merge' | null>(null)
  const [newPerson, setNewPerson] = useState(false)
  const [editingPerson, setEditingPerson] = useState<Person | undefined>()
  const [editingActivity, setEditingActivity] = useState<Activity | undefined>()
  const [identityQuery, setIdentityQuery] = useState('')
  const [identitySelection, setIdentitySelection] = useState('')
  const [confirmation, setConfirmation] = useState<Confirmation | null>(null)
  const [assignmentJob, setAssignmentJob] = useState('')
  const selected = data.people.find((person) => person.id === selectedId)
  const editing = editor !== null || confirmation !== null
  const locked = editing || busy
  useLayoutEffect(() => { onLock(editing); return () => onLock(false) }, [editing, onLock])
  useEffect(() => {
    if (!createPerson) return
    setNewPerson(true)
    setEditingPerson(undefined)
    setEditor('person')
    onCreateHandled()
  }, [createPerson, onCreateHandled])
  useEffect(() => { setLimit(100) }, [query, hasCv])
  const filtered = useMemo(() => data.people.filter((person) => matchesTalentFilters(person, { ...EMPTY_TALENT_FILTERS, query, hasCv }, data.activities))
    .sort((a, b) => a.name.localeCompare(b.name)), [data.people, data.activities, query, hasCv])
  const activities = selected ? data.activities.filter((activity) => activity.personId === selected.id).sort((a, b) => b.occurredAt - a.occurredAt) : []
  const assignments = selected ? data.assignments.filter((assignment) => assignment.personId === selected.id).sort((a, b) => b.updatedAt - a.updatedAt) : []
  const availableJobs = jobs.filter((job) => !assignments.some((assignment) => assignment.jobId === job.id))
  const linkedResumes = selected ? resumes.filter((resume) => selected.recordKeys.includes(resume.recordKey)) : []
  const identityMatches = (value: string): boolean => value.toLocaleLowerCase().includes(identityQuery.trim().toLocaleLowerCase())
  const linkOptions = resumes.filter((resume) => !selected?.recordKeys.includes(resume.recordKey) && identityMatches(`${resume.name ?? ''} ${resume.fileName} ${resume.email ?? ''}`))
  const mergeOptions = data.people.filter((person) => person.id !== selected?.id && identityMatches(`${person.name} ${person.employer} ${person.email}`))
  const date = (value: number): string => formatDate(value, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const openEditor = (kind: typeof editor): void => { if (locked) return; setEditor(kind); setIdentityQuery(''); setIdentitySelection(''); setEditingActivity(undefined); setEditingPerson(selected); setNewPerson(false) }
  const closeEditor = (): void => { if (busy) return; setEditor(null); setEditingActivity(undefined); setIdentitySelection('') }
  const updateActivity = (activity: Activity): void => update((current) => ({ ...current, activities: [activity, ...current.activities.filter((item) => item.id !== activity.id)] }))

  const previewIdentity = async (): Promise<void> => {
    if (!selected || busy) return
    if (editor === 'merge') {
      const secondary = data.people.find((person) => person.id === identitySelection && person.id !== selected.id)
      if (!secondary) return
      await run(() => window.api.talent.previewMerge({ primaryId: selected.id, secondaryId: secondary.id }), (preview) => setConfirmation({ kind: 'merge', preview }), false)
    } else if (editor === 'link') {
      const resume = resumes.find((item) => item.recordKey === identitySelection && !selected.recordKeys.includes(item.recordKey))
      if (!resume) return
      const owner = data.people.find((person) => person.recordKeys.includes(resume.recordKey))
      if (owner && owner.id !== selected.id) await run(() => window.api.talent.previewMerge({ primaryId: selected.id, secondaryId: owner.id }), (preview) => setConfirmation({ kind: 'link', resume, preview }), false)
      else setConfirmation({ kind: 'link', resume })
    }
  }

  const confirmIdentity = async (): Promise<void> => {
    if (!confirmation || busy || !selected) return
    if (confirmation.kind === 'delete') {
      const person = confirmation.person
      await run(() => window.api.talent.deletePerson({ id: person.id, expectedUpdatedAt: person.updatedAt }), () => {
        update((current) => ({ ...current, people: current.people.filter((item) => item.id !== person.id), activities: current.activities.filter((item) => item.personId !== person.id), assignments: current.assignments.filter((item) => item.personId !== person.id) }))
        setConfirmation(null)
        setEditor(null)
      })
      return
    }
    const apply = (person: Person): void => {
      const secondaryId = confirmation.preview?.secondary.id
      update((current) => ({ ...current, people: [person, ...current.people.filter((item) => item.id !== person.id && item.id !== secondaryId)] }))
      onSelect(person.id)
      setEditor(null)
      setConfirmation(null)
    }
    if (confirmation.kind === 'merge') {
      const { primary, secondary } = confirmation.preview
      await run(() => window.api.talent.mergeContacts({ primaryId: primary.id, secondaryId: secondary.id, expectedPrimaryUpdatedAt: primary.updatedAt, expectedSecondaryUpdatedAt: secondary.updatedAt }), apply)
    } else {
      const { resume, preview } = confirmation
      await run(() => window.api.talent.linkCv({ personId: selected.id, expectedUpdatedAt: preview?.primary.updatedAt ?? selected.updatedAt, resume: { id: resume.id, recordKey: resume.recordKey } }), apply)
    }
  }

  return <div className="talent-layout">
    <aside className="talent-directory" aria-label={t('People directory')}>
      <div className="talent-directory-head"><p className="talent-eyebrow">{t('People')}<span>{formatNumber(data.people.length)}</span></p><div className="talent-directory-filters">
        <label className="sr-only" htmlFor="talent-people-search">{t('Search people')}</label><input id="talent-people-search" type="search" dir="auto" placeholder={t('Search name, employer, skills…')} value={query} onChange={(event) => setQuery(event.target.value)} />
        <label className="sr-only" htmlFor="talent-cv-filter">{t('Filter people by CV')}</label><select id="talent-cv-filter" value={hasCv} onChange={(event) => setHasCv(event.target.value as typeof hasCv)}><option value="any">{t('All people')}</option><option value="yes">{t('With a CV')}</option><option value="no">{t('Without a CV')}</option></select>
      </div></div>
      {filtered.length ? <div className="talent-list">{filtered.slice(0, limit).map((person) => <button type="button" key={person.id} className={`talent-list-item ${person.id === selectedId ? 'selected' : ''}`} aria-label={t('Open contact {name}', { name: person.name })} aria-current={person.id === selectedId ? 'page' : undefined} disabled={locked} onClick={() => { onSelect(person.id); setAssignmentJob('') }}><strong><bdi>{person.name}</bdi></strong><span><bdi>{[person.title, person.employer].filter(Boolean).join(' · ') || person.location || t('Details not recorded')}</bdi></span><span className="talent-list-meta"><span>{t(person.recordKeys.length ? 'CV linked' : 'Prospect')}</span>{person.availability && <span dir="auto">{person.availability}</span>}</span></button>)}{filtered.length > limit && <p className="talent-inline-empty"><button type="button" className="talent-text-button" onClick={() => setLimit((value) => value + 100)}>{t('Show more people')}</button></p>}</div> : <p className="talent-inline-empty">{t('No people match this view.')}</p>}
    </aside>

    <section className="talent-panel" aria-label={t('Contact workspace')}>
      {editor === 'person' ? <PersonEditor key={newPerson ? 'new' : editingPerson?.id} person={newPerson ? undefined : editingPerson} busy={busy} onCancel={closeEditor} onSave={(input) => run(() => window.api.talent.savePerson(input), (person) => {
        update((current) => ({ ...current, people: [person, ...current.people.filter((item) => item.id !== person.id)] }))
        onSelect(person.id); setEditor(null); setQuery(''); setHasCv('any')
      })} /> : editor === 'activity' && selected ? <ActivityEditor key={editingActivity?.id ?? 'new'} personId={selected.id} activity={editingActivity} jobs={jobs} busy={busy} onCancel={closeEditor} onSave={(input) => run(() => window.api.talent.saveActivity(input), (activity) => { updateActivity(activity); setEditor(null) })} /> : selected ? <>
        <header className="talent-panel-head"><div><span className={`pill ${selected.recordKeys.length ? 'green' : 'blue'}`}>{t(selected.recordKeys.length ? 'CV linked' : 'Prospect')}</span><h3><bdi>{selected.name}</bdi></h3><p className="hint"><bdi>{[selected.title, selected.employer, selected.location].filter(Boolean).join(' · ')}</bdi></p></div><div className="talent-actions"><button type="button" className="btn sm" disabled={locked} onClick={() => openEditor('person')}>{t('Edit contact')}</button><button type="button" className="btn primary sm" disabled={locked} onClick={() => openEditor('activity')}>{t('Log activity')}</button></div></header>
        {editor === 'link' || editor === 'merge' ? <div className="talent-panel-body"><h4>{t(editor === 'link' ? 'Link a CV to this person' : 'Merge duplicate contacts')}</h4>
          <div className="talent-form-grid"><label className="talent-field talent-wide">{t(editor === 'link' ? 'Find a CV' : 'Find another contact')}<input aria-label={t(editor === 'link' ? 'Find a CV' : 'Find another contact')} dir="auto" value={identityQuery} disabled={busy} onChange={(event) => { setIdentityQuery(event.target.value); setIdentitySelection('') }} /></label>
            <label className="talent-field talent-wide">{t(editor === 'link' ? 'CV to link' : 'Contact to merge')}<select aria-label={t(editor === 'link' ? 'CV to link' : 'Contact to merge')} value={identitySelection} disabled={busy} onChange={(event) => setIdentitySelection(event.target.value)}><option value="">{t('Choose a record')}</option>{editor === 'link' ? linkOptions.map((resume) => <option key={resume.recordKey} value={resume.recordKey}>{resume.name || resume.fileName} · {resume.fileName}</option>) : mergeOptions.map((person) => <option key={person.id} value={person.id}>{person.name}{person.employer ? ` · ${person.employer}` : ''}</option>)}</select></label>
            <div className="talent-actions talent-wide"><button type="button" className="btn primary" disabled={busy || !identitySelection} onClick={() => { void previewIdentity() }}>{t('Review combination')}</button><button type="button" className="btn" disabled={busy} onClick={closeEditor}>{t('Cancel')}</button></div>
          </div>
        </div> : <>
          <section className="talent-panel-body"><h4>{t('Contact details')}</h4><dl className="talent-details">
            <div><dt>{t('Email')}</dt><dd><bdi dir="ltr">{selected.email || t('Not recorded')}</bdi></dd></div><div><dt>{t('Phone')}</dt><dd><bdi dir="ltr">{selected.phone || t('Not recorded')}</bdi></dd></div>
            <div><dt>{t('Availability')}</dt><dd dir="auto">{selected.availability || t('Not confirmed')}</dd></div><div><dt>{t('Availability last confirmed')}</dt><dd>{selected.availabilityConfirmedAt === null ? t('Not confirmed') : formatDate(selected.availabilityConfirmedAt, { year: 'numeric', month: 'short', day: 'numeric' })}</dd></div>
            {selected.sourceUrl && <div className="talent-wide"><dt>{t('Source link')}</dt><dd><bdi dir="ltr">{selected.sourceUrl}</bdi></dd></div>}
            {!!selected.skills.length && <div className="talent-wide"><dt>{t('Contact skills')}</dt><dd dir="auto">{selected.skills.join(' · ')}</dd></div>}
            {!!selected.tags.length && <div className="talent-wide"><dt>{t('Contact tags')}</dt><dd className="talent-tags">{selected.tags.map((tag) => <bdi className="talent-tag" key={tag}>{tag}</bdi>)}</dd></div>}
          </dl>{selected.note && <p className="talent-text" dir="auto">{selected.note}</p>}</section>
          <section className="talent-panel-body"><div className="talent-section-head"><h4>{t('CVs and identity')}</h4><div className="talent-actions"><button type="button" className="btn sm" disabled={busy} onClick={() => openEditor('link')}>{t('Link CV')}</button><button type="button" className="btn sm" disabled={busy || data.people.length < 2} onClick={() => openEditor('merge')}>{t('Merge contacts')}</button></div></div>
            {linkedResumes.length ? <div className="talent-history">{linkedResumes.map((resume) => <div className="talent-assignment" key={resume.recordKey}><strong dir="auto">{resume.fileName}</strong><button type="button" className="btn sm" disabled={busy} onClick={() => onOpenResume(resume)}>{t('View CV')}</button></div>)}</div> : <p className="hint">{t('No CV linked.')}</p>}
          </section>
          <section className="talent-panel-body"><div className="talent-section-head"><h4>{t('Job history')}</h4><span className="hint">{t('{count} assignments', { count: assignments.length })}</span></div>
            {!!availableJobs.length && <form className="talent-inline-form" onSubmit={(event) => { event.preventDefault(); if (!assignmentJob || busy) return; void run(() => window.api.talent.saveAssignment({ personId: selected.id, jobId: assignmentJob, stage: 'sourced', nextAction: '', dueAt: null, note: '', clientFeedback: '' }), (assignment) => { update((current) => ({ ...current, assignments: [assignment, ...current.assignments.filter((item) => item.id !== assignment.id)] })); setAssignmentJob('') }) }}><label className="talent-field">{t('Add to job')}<select aria-label={t('Add to job')} value={assignmentJob} disabled={busy} onChange={(event) => setAssignmentJob(event.target.value)}><option value="">{t('Choose a job')}</option>{availableJobs.map((job) => <option key={job.id} value={job.id}>{jobPostingTitle(job.posting)}</option>)}</select></label><button type="submit" className="btn sm" disabled={busy || !assignmentJob}>{t('Create assignment')}</button></form>}
            {assignments.length ? assignments.map((assignment) => <article className="talent-assignment" key={assignment.id}><div><strong dir="auto">{jobPostingTitle(jobs.find((job) => job.id === assignment.jobId)?.posting ?? { position: t('Job'), jobDescription: '', requirements: '', educationAndCertifications: '' })}</strong><p className="hint">{t(STAGE_LABELS[assignment.stage])} · {t('{count} submissions', { count: assignment.submissions.length })}</p>{assignment.nextAction && <p className="hint" dir="auto">{assignment.nextAction}</p>}</div><button type="button" className="btn sm" disabled={busy} onClick={() => onOpenJob(assignment.jobId)}>{t('Open job')}</button></article>) : <p className="hint">{t('No job assignments yet.')}</p>}
          </section>
          <section className="talent-panel-body"><div className="talent-section-head"><h4>{t('Relationship history')}</h4><button type="button" className="btn sm" disabled={busy} onClick={() => openEditor('activity')}>{t('Log activity')}</button></div>
            {activities.length ? <div className="talent-history">{activities.map((activity) => <article className="talent-history-item" key={activity.id} aria-label={t('{kind} on {date}', { kind: t(ACTIVITY_LABELS[activity.kind]), date: date(activity.occurredAt) })}><div className="talent-history-head"><strong>{t(ACTIVITY_LABELS[activity.kind])}</strong><span>{date(activity.occurredAt)}</span></div><p className="talent-text" dir="auto">{activity.summary}</p>{activity.outcome && <p className="talent-text"><span className="muted">{t('Outcome')}: </span><bdi>{activity.outcome}</bdi></p>}{activity.nextAction && <p className="talent-text"><span className="muted">{t('Next action')}: </span><bdi>{activity.nextAction}</bdi></p>}{activity.dueAt !== null && <p className="hint">{activity.completedAt !== null ? t('Completed {date}', { date: date(activity.completedAt) }) : t('Due {date}', { date: date(activity.dueAt) })}</p>}{activity.jobId && <p className="hint"><button type="button" className="talent-text-button" disabled={busy} onClick={() => onOpenJob(activity.jobId!)}>{jobPostingTitle(jobs.find((job) => job.id === activity.jobId)?.posting ?? { position: t('Related job'), jobDescription: '', requirements: '', educationAndCertifications: '' })}</button></p>}<div className="talent-actions talent-form-actions"><button type="button" className="btn sm" disabled={busy} onClick={() => { setEditingActivity(activity); setEditor('activity') }}>{t('Edit activity')}</button>{activity.dueAt !== null && <button type="button" className="btn sm" disabled={busy} onClick={() => { void run(() => window.api.talent.completeActivity({ id: activity.id, expectedUpdatedAt: activity.updatedAt, completed: activity.completedAt === null }), updateActivity) }}>{t(activity.completedAt === null ? 'Complete follow-up' : 'Reopen follow-up')}</button>}</div></article>)}</div> : <p className="hint">{t('No conversations recorded yet.')}</p>}
            {selected.origin === 'prospect' && selected.recordKeys.length === 0 && <div className="talent-danger-zone"><button type="button" className="talent-text-button" disabled={busy} onClick={() => setConfirmation({ kind: 'delete', person: selected })}>{t('Delete prospect')}</button></div>}
          </section>
        </>}
      </> : <div className="talent-empty"><h3>{t('A workspace for every relationship')}</h3><p>{t('Select a person.')}</p></div>}
    </section>

    {confirmation && <TalentConfirm title={t(confirmation.kind === 'delete' ? 'Delete this prospect?' : confirmation.kind === 'link' ? 'Confirm CV link' : 'Confirm contact merge')} confirmLabel={t(confirmation.kind === 'delete' ? 'Delete prospect and history' : confirmation.kind === 'link' ? 'Link CV and preserve history' : 'Merge and preserve history')} destructive={confirmation.kind === 'delete'} busy={busy} onCancel={() => setConfirmation(null)} onConfirm={() => { void confirmIdentity() }}>
      {confirmation.kind === 'delete' ? <><p>{t('This removes {name}, their activities, job assignments, screening records, and pool memberships.', { name: confirmation.person.name })}</p><p>{t('This deletion cannot be undone.')}</p></> : <>
        <dl className="talent-details"><div><dt>{t('Keep contact')}</dt><dd dir="auto">{selected?.name}</dd></div><div><dt>{t(confirmation.kind === 'link' ? 'CV to link' : 'Combine with')}</dt><dd dir="auto">{confirmation.kind === 'link' ? confirmation.resume.fileName : confirmation.preview.secondary.name}</dd></div></dl>
        <p>{t('The kept contact’s existing details take priority. Blank fields are filled, skills and tags are combined, and conflicting details are retained in notes.')}</p>
        {confirmation.preview && <><p>{t('Preserves {activities} activities, {assignments} assignments, {screenings} screenings, and {pools} pool memberships.', { activities: confirmation.preview.activities, assignments: confirmation.preview.assignments, screenings: confirmation.preview.screenings, pools: confirmation.preview.pools })}</p>{!!confirmation.preview.conflicts.length && <p>{t('Different details will be added to the contact notes.')}</p>}</>}
      </>}
    </TalentConfirm>}
  </div>
}
