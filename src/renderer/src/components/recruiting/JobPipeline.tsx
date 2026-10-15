import { useEffect, useState } from 'react'
import type { SavedJob } from '@shared/recruiting.js'
import type { Assignment, PipelineStage, Screening, TalentOverview } from '@shared/talent.js'
import { errorMessage, recruitingError } from './helpers.js'
import { useI18n } from '../../i18n.js'
import TalentConfirm from '../talent/TalentConfirm.js'
import LineBadge, { stageToneFor } from '../LineBadge.js'
import './pipeline.css'

export const PIPELINE_LABELS: Record<PipelineStage, string> = { sourced: 'Sourced', contacted: 'Contacted', interested: 'Interested', screened: 'Screened', submitted: 'Submitted', interviewing: 'Interviewing', offer: 'Offer', placed: 'Placed', closed: 'Closed' }
const VERIFICATION = { unverified: 'Unverified', 'candidate-stated': 'Candidate stated', verified: 'Verified' }
const dateInput = (at: number | null): string => {
  if (at === null) return ''
  const shifted = new Date(at - new Date(at).getTimezoneOffset() * 60000)
  return Number.isFinite(shifted.getTime()) ? shifted.toISOString().slice(0, 16) : ''
}
const dateValue = (value: string): number | null => value ? new Date(value).getTime() : null

interface Props {
  job: SavedJob
  revision: number
  active: boolean
  disabled: boolean
  onDirtyChange: (value: boolean) => void
}

export default function JobPipeline({ job, revision, active, disabled, onDirtyChange }: Props): React.JSX.Element {
  const { t, language, formatDate, formatNumber } = useI18n()
  const [data, setData] = useState<TalentOverview | null>(null)
  const [selectedId, setSelectedId] = useState('')
  const [personId, setPersonId] = useState('')
  const [filter, setFilter] = useState('all')
  const [draft, setDraft] = useState<Assignment | null>(null)
  const [kitDraft, setKitDraft] = useState<Screening | null>(null)
  const [newKitId, setNewKitId] = useState<string | null>(null)
  const [deletingKit, setDeletingKit] = useState<Screening | null>(null)
  const [submission, setSubmission] = useState<{ at: string; recipient: string; note: string } | null>(null)
  const [feedback, setFeedback] = useState<{ id: string; value: string } | null>(null)
  const [removing, setRemoving] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const dirty = Boolean(draft || kitDraft || submission || feedback || removing || deletingKit)
  const locked = disabled || busy
  const rows = data?.assignments.filter((row) => row.jobId === job.id) ?? []
  const selected = rows.find((row) => row.id === selectedId)
  const person = data?.people.find((item) => item.id === selected?.personId)
  const kits = data?.screenings.filter((kit) => kit.personId === selected?.personId && kit.jobId === job.id) ?? []
  const available = data?.people.filter((item) => !rows.some((row) => row.personId === item.id)) ?? []
  const showDate = (at: number): string => formatDate(at, { dateStyle: 'medium', timeStyle: 'short' })

  useEffect(() => { onDirtyChange(dirty || busy); return () => onDirtyChange(false) }, [dirty, busy, onDirtyChange])
  useEffect(() => {
    if (!active || dirty) return
    let cancelled = false
    void window.api.talent.overview().then((value) => {
      if (cancelled) return
      setData(value)
      setSelectedId((id) => value.assignments.some((row) => row.jobId === job.id && row.id === id) ? id : value.assignments.find((row) => row.jobId === job.id)?.id ?? '')
    }).catch((failure: unknown) => { if (!cancelled) setError(recruitingError(errorMessage(failure), t, language)) })
    return () => { cancelled = true }
  }, [job.id, revision, active, reload, dirty])

  const run = async (operation: () => Promise<unknown>): Promise<void> => {
    if (locked) return
    setBusy(true); setError(null)
    try { await operation(); setReload((value) => value + 1) }
    catch (failure) { setError(recruitingError(errorMessage(failure), t, language)) }
    finally { setBusy(false) }
  }
  const update = (row: Assignment): void => setData((current) => current && { ...current, assignments: [...current.assignments.filter((item) => item.id !== row.id), row] })
  const add = (): void => { void run(async () => {
    const row = await window.api.talent.saveAssignment({ personId, jobId: job.id, stage: 'sourced', nextAction: '', dueAt: null, note: '', clientFeedback: '' })
    update(row); setSelectedId(row.id); setPersonId('')
  }) }
  const save = (): void => { if (draft) void run(async () => {
    update(await window.api.talent.saveAssignment({ id: draft.id, expectedUpdatedAt: draft.updatedAt, personId: draft.personId, jobId: draft.jobId, stage: draft.stage, nextAction: draft.nextAction, dueAt: draft.dueAt, note: draft.note, clientFeedback: draft.clientFeedback }))
    setDraft(null)
  }) }
  const saveKit = (): void => { if (kitDraft) void run(async () => {
    await window.api.talent.saveScreening({ id: kitDraft.id, expectedUpdatedAt: kitDraft.updatedAt, title: kitDraft.title, questions: kitDraft.questions, heldAt: kitDraft.heldAt, note: kitDraft.note }); setKitDraft(null); setNewKitId(null)
  }) }
  const prepareKit = (): void => { if (person) void run(async () => {
    const kit = await window.api.talent.generateScreening({ personId: person.id, jobId: job.id })
    setData((value) => value && { ...value, screenings: [...value.screenings.filter((item) => item.id !== kit.id), kit] })
    // Explicit preparation creates a fresh kit. Existing kits enter through Edit.
    setNewKitId(kit.id)
    setKitDraft(kit)
  }) }
  const cancelKit = (): void => {
    if (!kitDraft || locked) return
    if (newKitId !== kitDraft.id) { setKitDraft(null); setNewKitId(null); return }
    void run(async () => {
      await window.api.talent.deleteScreening({ id: kitDraft.id, expectedUpdatedAt: kitDraft.updatedAt })
      setData((current) => current && { ...current, screenings: current.screenings.filter((item) => item.id !== kitDraft.id) })
      setKitDraft(null); setNewKitId(null)
    })
  }
  const questionChange = (id: string, change: Partial<Screening['questions'][number]>): void => setKitDraft((kit) => kit && ({ ...kit, questions: kit.questions.map((question) => question.id === id ? { ...question, ...change } : question) }))

  return <section className="job-pipeline" aria-label={t('Job pipeline')}>
    <div className="recruit-section-head"><div><h3>{t('Candidate pipeline')}</h3><p className="hint">{t('Track outreach, interviews and placements for this job, including prospects without a CV.')}</p></div></div>
    {error && <div className="recruit-error" role="alert">{error}<button className="btn sm" disabled={busy} onClick={() => { setError(null); setReload((value) => value + 1) }}>{t('Retry')}</button></div>}
    {dirty && <p className="recruit-notice" role="status">{t('Save or cancel your pipeline changes before switching candidates or jobs.')}</p>}
    <div className="pipeline-add"><label className="recruit-field">{t('Person to add')}<select aria-label={t('Person to add')} value={personId} disabled={locked || dirty} onChange={(event) => setPersonId(event.target.value)}><option value="">{t('Choose a person')}</option>{available.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><button className="btn sm primary" disabled={locked || dirty || !personId} onClick={add}>{t('Add to pipeline')}</button><p className="hint">{t('Create prospects and manage contact details in Recruiter desk.')}</p></div>
    <div className="pipeline-stage-counts" aria-label={t('Pipeline stages')}><button className={filter === 'all' ? 'selected' : ''} disabled={dirty || busy} onClick={() => setFilter('all')}>{t('All stages')} <strong>{formatNumber(rows.length)}</strong></button>{Object.entries(PIPELINE_LABELS).map(([stage, label], index) => <button key={stage} className={filter === stage ? 'selected' : ''} disabled={dirty || busy} onClick={() => setFilter(stage)}><LineBadge size="sm" tone={stageToneFor(stage as PipelineStage)}>{formatNumber(index + 1)}</LineBadge>{t(label)} <strong>{formatNumber(rows.filter((row) => row.stage === stage).length)}</strong></button>)}</div>
    {!data ? <p className="hint">{t('Loading…')}</p> : <div className="pipeline-layout">
      <div className="pipeline-people" aria-label={t('People in this pipeline')}>{rows.filter((row) => filter === 'all' || row.stage === filter).map((row) => {
        const contact = data.people.find((item) => item.id === row.personId)
        const age = Math.max(0, Math.floor((Date.now() - (row.stageHistory.at(-1)?.at ?? row.createdAt)) / 86400000))
        return <button className={row.id === selectedId ? 'selected' : ''} aria-pressed={row.id === selectedId} disabled={dirty || locked} key={row.id} onClick={() => { setSelectedId(row.id); setError(null) }}><LineBadge size="sm" tone={stageToneFor(row.stage)}>{formatNumber(Object.keys(PIPELINE_LABELS).indexOf(row.stage) + 1)}</LineBadge><strong><bdi>{contact?.name}</bdi></strong><span>{t(PIPELINE_LABELS[row.stage])} · {t('{count} days in stage', { count: age })}</span>{row.nextAction && <span><bdi>{row.nextAction}</bdi></span>}{row.dueAt !== null && <span className={row.dueAt < Date.now() ? 'pipeline-overdue' : ''}>{t('Due {date}', { date: showDate(row.dueAt) })}</span>}</button>
      })}{rows.filter((row) => filter === 'all' || row.stage === filter).length === 0 && <p className="hint">{t('No people in this stage.')}</p>}</div>
      {selected && person ? <article className="pipeline-detail" aria-label={t('Pipeline details')}>
        <div className="recruit-section-head"><div><h3><bdi>{person.name}</bdi></h3><p className="hint"><bdi>{[person.title, person.employer, person.location].filter(Boolean).join(' · ')}</bdi></p></div><span className={`recruit-review-state ${stageToneFor(selected.stage)}`}>{t(PIPELINE_LABELS[selected.stage])}</span></div>
        {!draft ? <><dl className="pipeline-facts"><dt>{t('Next action')}</dt><dd dir="auto">{selected.nextAction || '—'}</dd><dt>{t('Follow-up due')}</dt><dd>{selected.dueAt === null ? '—' : showDate(selected.dueAt)}</dd><dt>{t('Client feedback')}</dt><dd dir="auto">{selected.clientFeedback || '—'}</dd><dt>{t('Internal pipeline notes')}</dt><dd className="recruit-prewrap" dir="auto">{selected.note || '—'}</dd></dl><div className="recruit-actions"><button className="btn sm" disabled={locked || dirty} onClick={() => setDraft({ ...selected })}>{t('Edit pipeline')}</button><button className="btn sm" disabled={locked || dirty} onClick={() => setRemoving(true)}>{t('Remove from pipeline')}</button></div></> : <form onSubmit={(event) => { event.preventDefault(); save() }}><fieldset className="recruit-fieldset" disabled={locked}>
          <div className="recruit-editor-columns"><label className="recruit-field">{t('Candidate stage')}<select aria-label={t('Candidate stage')} value={draft.stage} onChange={(event) => setDraft({ ...draft, stage: event.target.value as PipelineStage })}>{Object.entries(PIPELINE_LABELS).map(([stage, label]) => <option key={stage} value={stage}>{t(label)}</option>)}</select></label><label className="recruit-field">{t('Follow-up due')}<input aria-label={t('Follow-up due')} type="datetime-local" value={dateInput(draft.dueAt)} onChange={(event) => setDraft({ ...draft, dueAt: dateValue(event.target.value) })} /></label></div>
          <label className="recruit-field">{t('Next action')}<input aria-label={t('Next action')} dir="auto" maxLength={2000} value={draft.nextAction} onChange={(event) => setDraft({ ...draft, nextAction: event.target.value })} /></label>
          <label className="recruit-field">{t('Client feedback')}<textarea aria-label={t('Client feedback')} dir="auto" rows={3} maxLength={10000} value={draft.clientFeedback} onChange={(event) => setDraft({ ...draft, clientFeedback: event.target.value })} /></label>
          <label className="recruit-field">{t('Internal pipeline notes')}<textarea aria-label={t('Internal pipeline notes')} dir="auto" rows={3} maxLength={10000} value={draft.note} onChange={(event) => setDraft({ ...draft, note: event.target.value })} /></label>
          <div className="recruit-actions"><button className="btn primary" type="submit">{t('Save pipeline')}</button><button className="btn" type="button" onClick={() => setDraft(null)}>{t('Cancel')}</button></div>
        </fieldset></form>}
        {removing && <div className="recruit-notice" role="alert"><p>{t('Remove this person from this job and delete their pipeline and submission history? Their contact and screening records will remain.')}</p><div className="recruit-actions"><button className="btn danger" disabled={locked} onClick={() => { void run(async () => { await window.api.talent.deleteAssignment({ id: selected.id, expectedUpdatedAt: selected.updatedAt }); setRemoving(false); setSelectedId('') }) }}>{t('Confirm removal')}</button><button className="btn" disabled={busy} onClick={() => setRemoving(false)}>{t('Cancel')}</button></div></div>}
        <details className="pipeline-history"><summary>{t('Stage history')}</summary><ol>{selected.stageHistory.map((event) => <li key={event.id}>{t(PIPELINE_LABELS[event.stage])} · {showDate(event.at)}</li>)}</ol></details>
        <section className="pipeline-submissions" aria-label={t('Client submissions')}><div className="recruit-section-head"><div><h4>{t('Client submissions')}</h4><p className="hint">{t('Log a submission you have sent yourself. Nothing is sent from this workspace.')}</p></div><button className="btn sm" disabled={locked || dirty} onClick={() => setSubmission({ at: dateInput(Date.now()), recipient: '', note: '' })}>{t('Log submission')}</button></div>
          {submission && <form onSubmit={(event) => { event.preventDefault(); void run(async () => { update(await window.api.talent.addSubmission({ assignmentId: selected.id, expectedUpdatedAt: selected.updatedAt, at: dateValue(submission.at)!, recipient: submission.recipient, note: submission.note })); setSubmission(null) }) }}><fieldset className="recruit-fieldset" disabled={locked}><label className="recruit-field">{t('Submitted at')}<input aria-label={t('Submitted at')} required type="datetime-local" value={submission.at} onChange={(event) => setSubmission({ ...submission, at: event.target.value })} /></label><label className="recruit-field">{t('Recipient')}<input aria-label={t('Recipient')} dir="auto" required maxLength={500} value={submission.recipient} onChange={(event) => setSubmission({ ...submission, recipient: event.target.value })} /></label><label className="recruit-field">{t('Submission notes')}<textarea aria-label={t('Submission notes')} dir="auto" rows={3} maxLength={10000} value={submission.note} onChange={(event) => setSubmission({ ...submission, note: event.target.value })} /></label><div className="recruit-actions"><button className="btn primary" type="submit">{t('Save submission')}</button><button className="btn" type="button" onClick={() => setSubmission(null)}>{t('Cancel')}</button></div></fieldset></form>}
          {selected.submissions.length === 0 && !submission && <p className="hint">{t('No submissions logged yet.')}</p>}
          {selected.submissions.map((entry) => <article className="pipeline-entry" key={entry.id}><strong dir="auto">{entry.recipient}</strong><p className="hint"><bdi>{entry.companyName}</bdi> · {showDate(entry.at)}</p>{entry.note && <p className="recruit-prewrap" dir="auto">{entry.note}</p>}{feedback?.id === entry.id ? <form onSubmit={(event) => { event.preventDefault(); void run(async () => { update(await window.api.talent.updateSubmission({ assignmentId: selected.id, expectedUpdatedAt: selected.updatedAt, submissionId: entry.id, feedback: feedback.value })); setFeedback(null) }) }}><label className="recruit-field">{t('Submission feedback')}<textarea aria-label={t('Submission feedback')} disabled={locked} dir="auto" rows={3} maxLength={10000} value={feedback.value} onChange={(event) => setFeedback({ ...feedback, value: event.target.value })} /></label><div className="recruit-actions"><button type="submit" className="btn primary sm" disabled={locked}>{t('Save feedback')}</button><button type="button" className="btn sm" disabled={busy} onClick={() => setFeedback(null)}>{t('Cancel')}</button></div></form> : <><p dir="auto" className="recruit-prewrap">{entry.feedback || t('Awaiting feedback')}</p><button className="btn sm" disabled={locked || dirty} onClick={() => setFeedback({ id: entry.id, value: entry.feedback })}>{t('Record feedback')}</button></>}</article>)}
        </section>
        <section className="pipeline-screenings" aria-label={t('Screening-call kits')}><div className="recruit-section-head"><div><h4>{t('Screening-call kits')}</h4><p className="hint">{t('Prepare questions from the job criteria, capture answers and record how each answer was verified.')}</p></div><button className="btn sm" disabled={locked || dirty} onClick={prepareKit}>{t('Prepare screening kit')}</button></div>
          {kitDraft ? <form onSubmit={(event) => { event.preventDefault(); saveKit() }}><fieldset className="recruit-fieldset" disabled={locked}><label className="recruit-field">{t('Screening title')}<input aria-label={t('Screening title')} dir="auto" required maxLength={300} value={kitDraft.title} onChange={(event) => setKitDraft({ ...kitDraft, title: event.target.value })} /></label><label className="recruit-field">{t('Call held at')}<input aria-label={t('Call held at')} type="datetime-local" value={dateInput(kitDraft.heldAt)} onChange={(event) => setKitDraft({ ...kitDraft, heldAt: dateValue(event.target.value) })} /></label>{kitDraft.questions.map((question, index) => <div className="pipeline-question" key={question.id}><label className="recruit-field">{t('Question {count}', { count: index + 1 })}<textarea aria-label={t('Question {count}', { count: index + 1 })} dir="auto" rows={2} maxLength={2000} required value={question.question} onChange={(event) => questionChange(question.id, { question: event.target.value, verification: 'unverified' })} /></label><label className="recruit-field">{t('Answer {count}', { count: index + 1 })}<textarea aria-label={t('Answer {count}', { count: index + 1 })} dir="auto" rows={3} maxLength={10000} value={question.answer} onChange={(event) => questionChange(question.id, { answer: event.target.value, answeredAt: event.target.value.trim() ? Date.now() : null, verification: 'unverified' })} /></label><label className="recruit-field">{t('Verification {count}', { count: index + 1 })}<select aria-label={t('Verification {count}', { count: index + 1 })} value={question.verification} disabled={!question.answer.trim()} onChange={(event) => questionChange(question.id, { verification: event.target.value as typeof question.verification })}>{Object.entries(VERIFICATION).map(([value, label]) => <option key={value} value={value}>{t(label)}</option>)}</select></label><button className="recruit-text-button" type="button" onClick={() => setKitDraft({ ...kitDraft, questions: kitDraft.questions.filter((item) => item.id !== question.id) })}>{t('Remove question')}</button></div>)}<button className="btn sm" type="button" disabled={kitDraft.questions.length >= 100} onClick={() => setKitDraft({ ...kitDraft, questions: [...kitDraft.questions, { id: crypto.randomUUID(), criterionId: null, question: '', answer: '', verification: 'unverified', answeredAt: null }] })}>{t('Add question')}</button><label className="recruit-field">{t('Internal screening notes')}<textarea aria-label={t('Internal screening notes')} dir="auto" rows={3} maxLength={10000} value={kitDraft.note} onChange={(event) => setKitDraft({ ...kitDraft, note: event.target.value })} /></label><div className="recruit-actions"><button className="btn primary" type="submit">{t('Save screening')}</button><button className="btn" type="button" onClick={cancelKit}>{t('Cancel')}</button></div></fieldset></form> : kits.map((kit) => <details className="pipeline-entry" key={kit.id}><summary><bdi>{kit.title}</bdi> · {showDate(kit.heldAt ?? kit.createdAt)}</summary><ol>{kit.questions.map((question) => <li className="pipeline-question" key={question.id}><strong dir="auto">{question.question}</strong><p dir="auto" className="recruit-prewrap">{question.answer || t('Not answered')}</p><span className="hint">{t(VERIFICATION[question.verification])}{question.answeredAt && ` · ${showDate(question.answeredAt)}`}</span></li>)}</ol>{kit.note && <p className="recruit-prewrap" dir="auto">{kit.note}</p>}<div className="recruit-actions"><button className="btn sm" disabled={locked || dirty} onClick={() => { setNewKitId(null); setKitDraft({ ...kit, questions: kit.questions.map((question) => ({ ...question })) }) }}>{t('Edit screening')}</button><button className="btn sm danger" disabled={locked || dirty} onClick={() => setDeletingKit(kit)}>{t('Delete screening')}</button></div></details>)}
          {!kits.length && !kitDraft && <p className="hint">{t('No screenings prepared yet.')}</p>}
        </section>
      </article> : <p className="hint">{t('Add a person to start tracking this job.')}</p>}
    </div>}
    {deletingKit && <TalentConfirm title={t('Delete this screening?')} confirmLabel={t('Delete screening')} destructive busy={busy} onCancel={() => setDeletingKit(null)} onConfirm={() => { void run(async () => {
      await window.api.talent.deleteScreening({ id: deletingKit.id, expectedUpdatedAt: deletingKit.updatedAt })
      setData((current) => current && { ...current, screenings: current.screenings.filter((kit) => kit.id !== deletingKit.id) })
      setDeletingKit(null)
    }) }}><p>{t('This permanently deletes this screening and its answers. The contact and job assignment are retained.')}</p><p><strong><bdi>{deletingKit.title}</bdi></strong></p></TalentConfirm>}
  </section>
}
