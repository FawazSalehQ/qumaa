/** Local relationship management. No provider calls, messaging or matching changes. */
import { randomUUID } from 'node:crypto'
import type { CandidateProfile, CandidateReview, Company } from '@shared/recruiting.js'
import { candidateWithProfile } from '@shared/recruiting.js'
import type { Activity, Assignment, MergePreview, Person, Screening, TalentOverview, TalentPool } from '@shared/talent.js'
import { peopleInPool } from '@shared/talent.js'
import { getDb, listResumes } from '../db/index.js'
import { currentLanguage } from '../language.js'
import { parseRecruiting, type JobRecord, type RecordKind, type StoredRecord } from './schema.js'
import { putRecord, putRecords, readRecord, readRecords, removeTalentPeople, nowAfter, requireResume } from './storage.js'
import { talentSchemas } from './talent-schema.js'
import { contactConflicts, mergeAssignments, mergePeople, planScreeningQuestions } from './talent-planning.js'

function required<T extends StoredRecord>(kind: RecordKind, id: string): T {
  const value = readRecord<T>(getDb(), kind, id)
  if (!value) throw new Error('This recruiting record no longer exists. Refresh and try again.')
  return value
}
function requireVersion(record: { updatedAt: number }, expected: number | undefined): void {
  if (record.updatedAt !== expected) throw new Error('This recruiting record changed. Refresh before saving your edits.')
}
function readTalent(): TalentOverview {
  return {
    people: readRecords<Person>(getDb(), 'person'), activities: readRecords<Activity>(getDb(), 'activity'),
    assignments: readRecords<Assignment>(getDb(), 'assignment'), pools: readRecords<TalentPool>(getDb(), 'pool'),
    screenings: readRecords<Screening>(getDb(), 'screening')
  }
}
const cleanLabel = (value: string | null | undefined, max = 512): string => (value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max).trim()

/** Lazily gives every existing CV group a stable contact identity. Never guesses a merge. */
export function ensurePeople(): Person[] {
  const database = getDb()
  return database.transaction(() => {
    const people = readRecords<Person>(database, 'person')
    const ownerByKey = new Map(people.flatMap((person) => person.recordKeys.map((key) => [key, person] as const)))
    const resumes = listResumes().sort((a, b) => b.importedAt - a.importedAt)
    const currentKeys = new Set(resumes.map((resume) => resume.recordKey))
    const profiles = readRecords<CandidateProfile>(database, 'profile')
    const profileByKey = new Map(profiles.flatMap((profile) => profile.recordKeys.map((key) => [key, profile] as const)))
    const handled = new Set<string>()
    const pending = new Map<string, Person>()
    for (const resume of resumes) {
      if (handled.has(resume.recordKey)) continue
      const profile = profileByKey.get(resume.recordKey)
      const keys = (profile?.recordKeys ?? [resume.recordKey]).filter((key) => currentKeys.has(key))
      for (const key of keys) handled.add(key)
      const owners = [...new Set(keys.map((key) => ownerByKey.get(key)).filter((person): person is Person => !!person))]
      if (owners.length > 1) throw new Error('Linked CV versions belong to different contacts. Merge the contacts first.')
      let person = owners[0]
      if (person) {
        if (keys.every((key) => person.recordKeys.includes(key))) continue
        person = { ...person, recordKeys: [...new Set([...person.recordKeys, ...keys])], updatedAt: nowAfter(person) }
      } else {
        const candidate = candidateWithProfile(resume, profile)
        const now = Date.now()
        person = {
          id: randomUUID(), name: cleanLabel(candidate.name || resume.fileName) || 'Unnamed candidate', email: cleanLabel(candidate.email), phone: cleanLabel(candidate.phone, 128),
          employer: '', title: '', location: cleanLabel(candidate.location), skills: [...new Set(candidate.skills.map((skill) => cleanLabel(skill, 256)).filter(Boolean))],
          tags: profile?.tags ?? [], availability: cleanLabel(profile?.availability), availabilityConfirmedAt: null,
          sourceUrl: '', note: profile?.note ?? '', recordKeys: keys, origin: 'library', createdAt: now, updatedAt: now
        }
      }
      pending.set(person.id, person)
      for (const key of person.recordKeys) ownerByKey.set(key, person)
    }
    putRecords(database, 'person', [...pending.values()])
    return readRecords<Person>(database, 'person')
  })()
}

/** Called before explicit CV version linking, before any profile or review write. */
export function assertTalentVersionLink(primaryKeys: string[], versionKeys: string[]): void {
  const keys = new Set([...primaryKeys, ...versionKeys])
  const owners = readRecords<Person>(getDb(), 'person').filter((person) => person.recordKeys.some((key) => keys.has(key)))
  if (owners.length > 1) throw new Error('These CVs belong to different contacts. Merge the contacts in the recruiter desk before linking their versions.')
}

export function overview(): TalentOverview {
  ensurePeople()
  const data = readTalent()
  data.people.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
  data.activities.sort((a, b) => b.occurredAt - a.occurredAt)
  data.assignments.sort((a, b) => b.updatedAt - a.updatedAt)
  data.pools.sort((a, b) => a.name.localeCompare(b.name))
  data.screenings.sort((a, b) => b.updatedAt - a.updatedAt)
  return data
}

export function ensurePerson(input: unknown): Person {
  const resume = parseRecruiting(talentSchemas.ensurePerson, input)
  requireResume(getDb(), resume)
  const person = ensurePeople().find((candidate) => candidate.recordKeys.includes(resume.recordKey))
  if (!person) throw new Error('This CV has no contact. Refresh and try again.')
  return person
}

export function savePerson(input: unknown): Person {
  const { id, expectedUpdatedAt, ...fields } = parseRecruiting(talentSchemas.savePerson, input)
  const previous = id ? required<Person>('person', id) : null
  if (previous) requireVersion(previous, expectedUpdatedAt)
  const now = nowAfter(previous ?? undefined)
  const person: Person = { ...fields, id: previous?.id ?? randomUUID(), recordKeys: previous?.recordKeys ?? [], origin: previous?.origin ?? 'prospect', createdAt: previous?.createdAt ?? now, updatedAt: now }
  putRecord(getDb(), 'person', person)
  return person
}

export function deletePerson(input: unknown): void {
  const args = parseRecruiting(talentSchemas.versionedId, input)
  requireVersion(required<Person>('person', args.id), args.expectedUpdatedAt)
  getDb().transaction(() => removeTalentPeople(getDb(), new Set([args.id])))()
}

export function previewMerge(input: unknown): MergePreview {
  const args = parseRecruiting(talentSchemas.previewMerge, input)
  const primary = required<Person>('person', args.primaryId)
  const secondary = required<Person>('person', args.secondaryId)
  const data = readTalent()
  return { primary, secondary, conflicts: contactConflicts(primary, secondary),
    activities: data.activities.filter((item) => item.personId === secondary.id).length,
    assignments: data.assignments.filter((item) => item.personId === secondary.id).length,
    screenings: data.screenings.filter((item) => item.personId === secondary.id).length,
    pools: data.pools.filter((pool) => pool.members.some((member) => member.personId === secondary.id)).length }
}

export function mergeContacts(input: unknown): Person {
  const args = parseRecruiting(talentSchemas.mergeContacts, input)
  const primary = required<Person>('person', args.primaryId)
  const secondary = required<Person>('person', args.secondaryId)
  requireVersion(primary, args.expectedPrimaryUpdatedAt)
  requireVersion(secondary, args.expectedSecondaryUpdatedAt)
  const merged = mergePeople(primary, secondary, Date.now())
  const data = readTalent()
  return getDb().transaction(() => {
    const remove = getDb().prepare('DELETE FROM recruiting_records WHERE kind = ? AND id = ?')
    remove.run('person', secondary.id)
    // A contact can have tens of thousands of history records. Check each
    // kind's storage budget once instead of rescanning the entire DB per row.
    const activities = data.activities.filter((item) => item.personId === secondary.id)
      .map((activity) => ({ ...activity, personId: primary.id, updatedAt: nowAfter(activity) }))
    const assignments: Assignment[] = []
    const primaryAssignments = new Map(data.assignments.filter((item) => item.personId === primary.id).map((item) => [item.jobId, item]))
    for (const assignment of data.assignments.filter((item) => item.personId === secondary.id)) {
      const existing = primaryAssignments.get(assignment.jobId)
      if (existing) {
        const combined = mergeAssignments(existing, assignment, Date.now(), randomUUID())
        remove.run('assignment', assignment.id)
        assignments.push(combined)
      } else assignments.push({ ...assignment, personId: primary.id, updatedAt: nowAfter(assignment) })
    }
    const screenings = data.screenings.filter((item) => item.personId === secondary.id)
      .map((screening) => ({ ...screening, personId: primary.id, updatedAt: nowAfter(screening) }))
    const pools: TalentPool[] = []
    for (const pool of data.pools) {
      const source = pool.members.find((member) => member.personId === secondary.id)
      if (!source) continue
      const existing = pool.members.find((member) => member.personId === primary.id)
      const members = pool.members.filter((member) => member.personId !== secondary.id && member.personId !== primary.id)
      members.push({ personId: primary.id, addedAt: Math.min(source.addedAt, existing?.addedAt ?? source.addedAt) })
      pools.push({ ...pool, members, updatedAt: nowAfter(pool) })
    }
    putRecords(getDb(), 'activity', activities)
    putRecords(getDb(), 'assignment', assignments)
    putRecords(getDb(), 'screening', screenings)
    putRecords(getDb(), 'pool', pools)
    putRecord(getDb(), 'person', merged)
    return merged
  })()
}

export function linkCv(input: unknown): Person {
  const args = parseRecruiting(talentSchemas.linkCv, input)
  requireResume(getDb(), args.resume)
  const primary = required<Person>('person', args.personId)
  requireVersion(primary, args.expectedUpdatedAt)
  // Contact materialisation and merge are one transaction: a failed merge does
  // not leave a newly created identity or partially transferred history.
  return getDb().transaction(() => {
    const secondary = ensurePerson(args.resume)
    if (secondary.id === primary.id) return required<Person>('person', primary.id)
    return mergeContacts({ primaryId: primary.id, secondaryId: secondary.id, expectedPrimaryUpdatedAt: primary.updatedAt, expectedSecondaryUpdatedAt: secondary.updatedAt })
  })()
}

export function saveActivity(input: unknown): Activity {
  const { id, expectedUpdatedAt, ...fields } = parseRecruiting(talentSchemas.saveActivity, input)
  required<Person>('person', fields.personId)
  if (fields.jobId) required<JobRecord>('job', fields.jobId)
  const previous = id ? required<Activity>('activity', id) : null
  if (previous) {
    requireVersion(previous, expectedUpdatedAt)
    if (previous.personId !== fields.personId) throw new Error('Move contact histories by merging contacts, not by changing activity ownership.')
  }
  const now = nowAfter(previous ?? undefined)
  const activity = { ...fields, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now }
  putRecord(getDb(), 'activity', activity)
  return activity
}

export function completeActivity(input: unknown): Activity {
  const args = parseRecruiting(talentSchemas.completeActivity, input)
  const previous = required<Activity>('activity', args.id)
  requireVersion(previous, args.expectedUpdatedAt)
  const now = nowAfter(previous)
  const activity = { ...previous, completedAt: args.completed ? now : null, updatedAt: now }
  putRecord(getDb(), 'activity', activity)
  return activity
}

function deleteRecord(kind: 'assignment' | 'screening' | 'pool', input: unknown): void {
  const args = parseRecruiting(talentSchemas.versionedId, input)
  requireVersion(required<Activity | Assignment | Screening | TalentPool>(kind, args.id), args.expectedUpdatedAt)
  getDb().prepare('DELETE FROM recruiting_records WHERE kind = ? AND id = ?').run(kind, args.id)
}
export function deleteAssignment(input: unknown): void { deleteRecord('assignment', input) }
export function deleteScreening(input: unknown): void { deleteRecord('screening', input) }
export function deletePool(input: unknown): void { deleteRecord('pool', input) }

export function saveAssignment(input: unknown): Assignment {
  const { id, expectedUpdatedAt, ...fields } = parseRecruiting(talentSchemas.saveAssignment, input)
  required<Person>('person', fields.personId)
  required<JobRecord>('job', fields.jobId)
  const previous = id ? required<Assignment>('assignment', id) : null
  if (previous) {
    requireVersion(previous, expectedUpdatedAt)
    if (previous.personId !== fields.personId || previous.jobId !== fields.jobId) throw new Error('An existing assignment cannot move to a different contact or job.')
  } else if (readRecords<Assignment>(getDb(), 'assignment').some((item) => item.personId === fields.personId && item.jobId === fields.jobId)) throw new Error('This contact is already assigned to this job.')
  const now = nowAfter(previous ?? undefined)
  const history = previous?.stageHistory ?? []
  const assignment: Assignment = { ...fields, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now,
    stageHistory: !previous || previous.stage !== fields.stage ? [...history, { id: randomUUID(), stage: fields.stage, at: now }] : history,
    submissions: previous?.submissions ?? [] }
  putRecord(getDb(), 'assignment', assignment)
  return assignment
}

export function addSubmission(input: unknown): Assignment {
  const args = parseRecruiting(talentSchemas.addSubmission, input)
  const previous = required<Assignment>('assignment', args.assignmentId)
  requireVersion(previous, args.expectedUpdatedAt)
  const job = required<JobRecord>('job', previous.jobId)
  const company = job.companyId ? required<Company>('company', job.companyId) : null
  const now = nowAfter(previous)
  const moveStage = ['sourced', 'contacted', 'interested', 'screened'].includes(previous.stage)
  const assignment: Assignment = { ...previous, updatedAt: now,
    stage: moveStage ? 'submitted' : previous.stage,
    stageHistory: moveStage ? [...previous.stageHistory, { id: randomUUID(), stage: 'submitted', at: now }] : previous.stageHistory,
    submissions: [...previous.submissions, { id: randomUUID(), at: args.at, companyId: company?.id ?? null, companyName: company?.name ?? '', recipient: args.recipient, note: args.note, feedback: '' }] }
  putRecord(getDb(), 'assignment', assignment)
  return assignment
}

export function updateSubmission(input: unknown): Assignment {
  const args = parseRecruiting(talentSchemas.updateSubmission, input)
  const previous = required<Assignment>('assignment', args.assignmentId)
  requireVersion(previous, args.expectedUpdatedAt)
  if (!previous.submissions.some((submission) => submission.id === args.submissionId)) throw new Error('This client submission no longer exists.')
  const assignment = { ...previous, updatedAt: nowAfter(previous), submissions: previous.submissions.map((submission) => submission.id === args.submissionId ? { ...submission, feedback: args.feedback } : submission) }
  putRecord(getDb(), 'assignment', assignment)
  return assignment
}

export function generateScreening(input: unknown): Screening {
  const args = parseRecruiting(talentSchemas.generateScreening, input)
  const person = required<Person>('person', args.personId)
  const job = required<JobRecord>('job', args.jobId)
  const profiles = readRecords<CandidateProfile>(getDb(), 'profile').filter((profile) => profile.recordKeys.some((key) => person.recordKeys.includes(key)))
  const keys = new Set([...person.recordKeys, ...profiles.map((profile) => profile.candidateKey)])
  const assessments = readRecords<CandidateReview>(getDb(), 'review').filter((review) => review.jobId === job.id && keys.has(review.candidateKey)).flatMap((review) => review.assessments)
  const now = Date.now()
  const language = currentLanguage()
  const title = language === 'ar' ? `مقابلة أولية: ${job.posting.position || 'الوظيفة'}` : `${job.posting.position || 'Job'} screening`
  const screening: Screening = { id: randomUUID(), personId: person.id, jobId: job.id, title: title.slice(0, 512),
    questions: planScreeningQuestions(job.criteria, assessments, randomUUID, language), heldAt: null, note: '', createdAt: now, updatedAt: now }
  putRecord(getDb(), 'screening', screening)
  return screening
}

export function saveScreening(input: unknown): Screening {
  const { id, expectedUpdatedAt, ...fields } = parseRecruiting(talentSchemas.saveScreening, input)
  const previous = required<Screening>('screening', id)
  requireVersion(previous, expectedUpdatedAt)
  const now = nowAfter(previous)
  const screening: Screening = { ...previous, ...fields, updatedAt: now, questions: fields.questions.map((question) => ({ ...question,
    answeredAt: question.answer.trim() && !question.answeredAt ? now : question.answeredAt })) }
  putRecord(getDb(), 'screening', screening)
  return screening
}

export function savePool(input: unknown): TalentPool {
  const { id, expectedUpdatedAt, personIds, ...fields } = parseRecruiting(talentSchemas.savePool, input)
  const previous = id ? required<TalentPool>('pool', id) : null
  if (previous) requireVersion(previous, expectedUpdatedAt)
  for (const personId of personIds) required<Person>('person', personId)
  const now = nowAfter(previous ?? undefined)
  const sameReviewScope = previous?.mode === fields.mode && (fields.mode === 'manual' || JSON.stringify(previous.filters) === JSON.stringify(fields.filters))
  const pool: TalentPool = { ...fields, id: previous?.id ?? randomUUID(), createdAt: previous?.createdAt ?? now, updatedAt: now, lastReviewedAt: sameReviewScope ? previous.lastReviewedAt : null,
    members: fields.mode === 'manual'
      ? personIds.map((personId) => ({ personId, addedAt: sameReviewScope ? previous.members.find((member) => member.personId === personId)?.addedAt ?? now : now }))
      : sameReviewScope ? previous.members : [] }
  putRecord(getDb(), 'pool', pool)
  return pool
}

export function reviewPool(input: unknown): TalentPool {
  const args = parseRecruiting(talentSchemas.versionedId, input)
  const previous = required<TalentPool>('pool', args.id)
  requireVersion(previous, args.expectedUpdatedAt)
  const reviewedPeople = previous.mode === 'search' ? peopleInPool(previous, ensurePeople(), readRecords<Activity>(getDb(), 'activity')) : null
  const now = nowAfter(previous)
  const pool = { ...previous, members: reviewedPeople ? reviewedPeople.map((person) => ({ personId: person.id, addedAt: now })) : previous.members, lastReviewedAt: now, updatedAt: now }
  putRecord(getDb(), 'pool', pool)
  return pool
}
