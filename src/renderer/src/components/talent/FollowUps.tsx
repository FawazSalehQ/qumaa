import { useEffect, useState } from 'react'
import type { Activity, Assignment, TalentOverview } from '@shared/talent.js'
import type { SavedJob } from '@shared/recruiting.js'
import { useI18n } from '../../i18n.js'
import { jobPostingTitle } from '../../jobPosting.js'
import { localDayBounds } from './helpers.js'
import type { DeskAction, UpdateOverview } from './desk-types.js'

interface Props {
  data: TalentOverview
  jobs: SavedJob[]
  busy: boolean
  run: DeskAction
  update: UpdateOverview
  onOpenPerson: (id: string) => void
  onOpenJob: (id: string) => void
}

type Reminder = { type: 'activity'; item: Activity; dueAt: number } | { type: 'assignment'; item: Assignment; dueAt: number }

export default function FollowUps({ data, jobs, busy, run, update, onOpenPerson, onOpenJob }: Props): React.JSX.Element {
  const { t, formatNumber, formatDate } = useI18n()
  const [now, setNow] = useState(Date.now())
  const [filter, setFilter] = useState<'all' | 'overdue' | 'today' | 'upcoming' | 'completed'>('all')
  useEffect(() => { const interval = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(interval) }, [])
  const { start, end } = localDayBounds(now)
  const pending: Reminder[] = [
    ...data.activities.flatMap((item): Reminder[] => item.dueAt !== null && item.completedAt === null ? [{ type: 'activity', item, dueAt: item.dueAt }] : []),
    ...data.assignments.flatMap((item): Reminder[] => item.dueAt !== null ? [{ type: 'assignment', item, dueAt: item.dueAt }] : [])
  ].sort((a, b) => a.dueAt - b.dueAt)
  const completed: Reminder[] = data.activities.filter((item) => item.dueAt !== null && item.completedAt !== null).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0)).map((item) => ({ type: 'activity', item, dueAt: item.dueAt! }))
  const grouped = { overdue: pending.filter((item) => item.dueAt < start), today: pending.filter((item) => item.dueAt >= start && item.dueAt < end), upcoming: pending.filter((item) => item.dueAt >= end) }
  const visible = filter === 'all' ? pending : filter === 'completed' ? completed : grouped[filter]
  const date = (value: number): string => formatDate(value, { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  const complete = (reminder: Reminder): void => {
    if (busy) return
    if (reminder.type === 'activity') {
      const activity = reminder.item
      void run(() => window.api.talent.completeActivity({ id: activity.id, expectedUpdatedAt: activity.updatedAt, completed: activity.completedAt === null }), (saved) => update((current) => ({ ...current, activities: current.activities.map((item) => item.id === saved.id ? saved : item) })))
    } else {
      const assignment = reminder.item
      void run(() => window.api.talent.saveAssignment({ id: assignment.id, expectedUpdatedAt: assignment.updatedAt, personId: assignment.personId, jobId: assignment.jobId, stage: assignment.stage, nextAction: assignment.nextAction, dueAt: null, note: assignment.note, clientFeedback: assignment.clientFeedback }), (saved) => update((current) => ({ ...current, assignments: current.assignments.map((item) => item.id === saved.id ? saved : item) })))
    }
  }
  return <div>
    <div className="talent-summary" aria-label={t('Follow-up schedule')}>{(['overdue', 'today', 'upcoming'] as const).map((group) => <button type="button" key={group} className={filter === group ? 'selected' : ''} aria-pressed={filter === group} onClick={() => setFilter(group)}><strong>{formatNumber(grouped[group].length)}</strong><span>{t(group === 'overdue' ? 'Overdue' : group === 'today' ? 'Today' : 'Upcoming')}</span></button>)}</div>
    <section className="talent-panel" aria-label={t('Follow-up reminders')}>
      <div className="talent-task-toolbar"><div><h4>{t('Your next conversations')}</h4></div><label><span className="sr-only">{t('Filter follow-ups')}</span><select aria-label={t('Filter follow-ups')} value={filter} onChange={(event) => setFilter(event.target.value as typeof filter)}><option value="all">{t('All pending')}</option><option value="overdue">{t('Overdue')}</option><option value="today">{t('Today')}</option><option value="upcoming">{t('Upcoming')}</option><option value="completed">{t('Completed')}</option></select></label></div>
      {visible.length ? visible.map((reminder) => {
        const person = data.people.find((item) => item.id === reminder.item.personId)
        const jobId = reminder.item.jobId
        const job = jobs.find((item) => item.id === jobId)
        const done = reminder.type === 'activity' && reminder.item.completedAt !== null
        return <article key={`${reminder.type}:${reminder.item.id}`} className={`talent-task ${reminder.dueAt < start && !done ? 'overdue' : ''} ${done ? 'completed' : ''}`}>
          <div><h4><bdi>{reminder.item.nextAction || (reminder.type === 'activity' ? reminder.item.summary : t('Job follow-up'))}</bdi></h4><div className="talent-task-meta"><button type="button" className="talent-text-button" disabled={busy || !person} onClick={() => onOpenPerson(reminder.item.personId)}>{person?.name ?? t('Contact unavailable')}</button><span className="talent-due">{done && reminder.type === 'activity' ? t('Completed {date}', { date: date(reminder.item.completedAt!) }) : t('Due {date}', { date: date(reminder.dueAt) })}</span>{job && <button type="button" className="talent-text-button" disabled={busy} onClick={() => onOpenJob(job.id)}>{jobPostingTitle(job.posting)}</button>}</div>{reminder.type === 'activity' && reminder.item.nextAction && <p className="talent-text" dir="auto">{reminder.item.summary}</p>}</div>
          <div className="talent-actions"><button type="button" className="btn sm" disabled={busy} onClick={() => complete(reminder)}>{t(reminder.type === 'assignment' ? 'Clear reminder' : done ? 'Reopen follow-up' : 'Complete follow-up')}</button>{reminder.type === 'assignment' && <button type="button" className="btn sm" disabled={busy} onClick={() => onOpenJob(reminder.item.jobId)}>{t('Open job')}</button>}</div>
        </article>
      }) : <div className="talent-empty"><h3>{t(filter === 'completed' ? 'No completed follow-ups yet' : 'No follow-ups in this view')}</h3><p>{t('Log an activity with a next action and due date, or set a reminder on a job assignment.')}</p></div>}
    </section>
  </div>
}
