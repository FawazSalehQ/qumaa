import type { CriterionAssessment, JobCriterion } from '@shared/recruiting.js'
import type { Assignment, Person, ScreeningQuestion, TalentOverview } from '@shared/talent.js'

const scalarFields = ['name', 'email', 'phone', 'employer', 'title', 'location', 'availability', 'sourceUrl'] as const
export function contactConflicts(primary: Person, secondary: Person): Array<(typeof scalarFields)[number]> {
  return scalarFields.filter((field) => primary[field].trim() && secondary[field].trim() && primary[field] !== secondary[field])
}

/** Keep both sources recoverable: conflicting secondary values become labelled notes. */
export function mergePeople(primary: Person, secondary: Person, at: number): Person {
  const merged = { ...primary }
  for (const field of scalarFields) if (!merged[field].trim()) merged[field] = secondary[field]
  if (!primary.availability.trim()) merged.availabilityConfirmedAt = secondary.availabilityConfirmedAt
  const conflicts = contactConflicts(primary, secondary).map((field) => `${field}: ${secondary[field]}`)
  const retainedNote = [secondary.note, ...conflicts].filter(Boolean).join('\n')
  merged.note = [primary.note, retainedNote ? `Merged contact: ${secondary.name}\n${retainedNote}` : ''].filter(Boolean).join('\n\n')
  merged.skills = [...new Set([...primary.skills, ...secondary.skills])]
  merged.tags = [...new Set([...primary.tags, ...secondary.tags])]
  merged.recordKeys = [...new Set([...primary.recordKeys, ...secondary.recordKeys])]
  merged.origin = primary.origin === 'prospect' || secondary.origin === 'prospect' ? 'prospect' : 'library'
  merged.createdAt = Math.min(primary.createdAt, secondary.createdAt)
  merged.updatedAt = Math.max(at, primary.updatedAt + 1, secondary.updatedAt + 1)
  return merged
}

function combineHistory<T extends { id: string; at: number }>(left: T[], right: T[]): T[] {
  const byId = new Map(left.map((item) => [item.id, item]))
  for (const item of right) {
    const existing = byId.get(item.id)
    if (existing && JSON.stringify(existing) !== JSON.stringify(item)) throw new Error('The contact histories conflict. Resolve the duplicate history before merging.')
    byId.set(item.id, item)
  }
  return [...byId.values()].sort((a, b) => a.at - b.at || a.id.localeCompare(b.id))
}

export function mergeAssignments(primary: Assignment, secondary: Assignment, at: number, eventId: string): Assignment {
  const updatedAt = Math.max(at, primary.updatedAt + 1, secondary.updatedAt + 1)
  const stageHistory = combineHistory(primary.stageHistory, secondary.stageHistory)
  if (stageHistory.at(-1)?.stage !== primary.stage) stageHistory.push({ id: eventId, stage: primary.stage, at: updatedAt })
  const keepPrimaryFollowUp = Boolean(primary.nextAction) || primary.dueAt !== null
  const sourceAction = secondary.nextAction && secondary.nextAction !== primary.nextAction ? `Merged next action: ${secondary.nextAction}` : ''
  const sourceDue = secondary.dueAt !== null && secondary.dueAt !== primary.dueAt ? `Merged follow-up due: ${new Date(secondary.dueAt).toISOString()}` : ''
  return {
    ...primary, createdAt: Math.min(primary.createdAt, secondary.createdAt), updatedAt, stageHistory,
    submissions: combineHistory(primary.submissions, secondary.submissions),
    note: [primary.note, secondary.note, sourceAction, sourceDue].filter(Boolean).join('\n\n'),
    clientFeedback: [primary.clientFeedback, secondary.clientFeedback].filter(Boolean).join('\n\n'),
    nextAction: keepPrimaryFollowUp ? primary.nextAction : secondary.nextAction,
    dueAt: keepPrimaryFollowUp ? primary.dueAt : secondary.dueAt
  }
}

export function planScreeningQuestions(criteria: JobCriterion[], assessments: CriterionAssessment[], nextId: () => string, language: 'en' | 'ar' = 'en'): ScreeningQuestion[] {
  const prompts = criteria.filter((criterion) => !assessments.some((assessment) => assessment.criterionId === criterion.id && ['confirmed', 'evidence-found'].includes(assessment.status)))
    .map((criterion) => ({ criterionId: criterion.id, question: language === 'ar' ? `صف خبرتك في: ${criterion.text}` : `Describe your experience with: ${criterion.text}` }))
  if (!criteria.length) prompts.push(
    { criterionId: '', question: language === 'ar' ? 'ما العمل الحديث الذي يوضح ملاءمتك لهذه الوظيفة؟' : 'Which recent work best demonstrates your fit for this role?' },
    { criterionId: '', question: language === 'ar' ? 'متى يمكنك بدء العمل وما فترة الإشعار؟' : 'What is your availability and notice period?' },
    { criterionId: '', question: language === 'ar' ? 'ما نطاق الراتب وموقع العمل الذي تبحث عنه؟' : 'What salary range and working location are you seeking?' }
  )
  return prompts.map((prompt) => ({ id: nextId(), criterionId: prompt.criterionId || null, question: prompt.question, answer: '', verification: 'unverified', answeredAt: null }))
}

/** One bounded referential check for startup and untrusted portable files. */
export function assertTalentReferences(data: TalentOverview, jobIds: ReadonlySet<string>, companyIds: ReadonlySet<string>, cvKeys: ReadonlySet<string>): void {
  const people = new Set(data.people.map((person) => person.id))
  const ownedKeys = new Set<string>()
  for (const person of data.people) for (const key of person.recordKeys) {
    if (!cvKeys.has(key)) throw new Error('A contact references an unknown CV.')
    if (ownedKeys.has(key)) throw new Error('A CV belongs to more than one contact.')
    ownedKeys.add(key)
  }
  for (const activity of data.activities) if (!people.has(activity.personId) || (activity.jobId !== null && !jobIds.has(activity.jobId))) throw new Error('An activity references an unknown contact or job.')
  const assigned = new Set<string>()
  for (const assignment of data.assignments) {
    if (!people.has(assignment.personId) || !jobIds.has(assignment.jobId)) throw new Error('A pipeline assignment references an unknown contact or job.')
    const key = `${assignment.personId}:${assignment.jobId}`
    if (assigned.has(key)) throw new Error('A contact is assigned to the same job twice.')
    assigned.add(key)
    if (assignment.submissions.some((submission) => submission.companyId !== null && !companyIds.has(submission.companyId))) throw new Error('A client submission references an unknown company.')
  }
  for (const screening of data.screenings) if (!people.has(screening.personId) || !jobIds.has(screening.jobId)) throw new Error('A screening references an unknown contact or job.')
  for (const pool of data.pools) if (pool.members.some((member) => !people.has(member.personId))) throw new Error('A talent pool references an unknown contact.')
}
