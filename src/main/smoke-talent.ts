/** DB integration checks run only by the disposable Electron smoke runner. */
import { randomUUID } from 'node:crypto'
import type { PersonFields } from '@shared/talent.js'
import { EMPTY_TALENT_FILTERS, newPoolPeople, peopleInPool } from '@shared/talent.js'
import type { ResumeRef } from '@shared/types.js'
import { closeDbForMaintenance, getDb, listResumes } from './db/index.js'
import * as talent from './recruiting/talent.js'
import { getJob } from './recruiting/index.js'
import { putRecords } from './recruiting/storage.js'

type Check = (label: string, ok: boolean, detail?: string) => void
const fields: PersonFields = { name: 'Prospect without CV', email: 'prospect@example.test', phone: '', employer: 'Fictional Labs', title: 'Platform lead', location: 'Riyadh', skills: ['TypeScript'], tags: ['Leadership'], availability: 'One month', availabilityConfirmedAt: null, sourceUrl: 'https://example.test/prospect', note: 'Private recruiter notes' }
export function talentSnapshot(): string {
  return JSON.stringify(getDb().prepare("SELECT kind,id,data FROM recruiting_records WHERE kind IN ('person','activity','assignment','screening','pool') ORDER BY kind,id").all())
}
const rejected = (operation: () => unknown): boolean => { try { operation(); return false } catch { return true } }

export function smokeTalent(check: Check, jobId: string, linkedCv: ResumeRef): { snapshot: string; prospectId: string; libraryPersonId: string } {
  console.log('\n7a. Recruiter desk, pipelines, submissions and screenings')
  const baseline = JSON.stringify(getJob(jobId).response?.results)
  const libraryPerson = talent.ensurePerson(linkedCv)
  check('groups linked CV versions under one stable contact', libraryPerson.recordKeys.length === 2 && talent.ensurePerson(linkedCv).id === libraryPerson.id)
  const prospect = talent.savePerson(fields)
  check('creates a searchable prospect without requiring a CV', prospect.recordKeys.length === 0 && prospect.origin === 'prospect')
  check('rejects stale contact edits without losing recruiter information', rejected(() => talent.savePerson({ ...fields, id: prospect.id, expectedUpdatedAt: prospect.updatedAt - 1, note: 'stale overwrite' })) && talent.overview().people.find((person) => person.id === prospect.id)?.note === fields.note)
  let activity = talent.saveActivity({ personId: prospect.id, jobId, kind: 'call', occurredAt: Date.now(), summary: 'Screening invitation discussed', outcome: 'Interested', nextAction: 'Confirm screening time', dueAt: Date.now() - 60000, completedAt: null })
  activity = talent.completeActivity({ id: activity.id, expectedUpdatedAt: activity.updatedAt, completed: true })
  check('completes follow-up reminders with a recorded date', activity.completedAt !== null && activity.dueAt !== null)
  activity = talent.completeActivity({ id: activity.id, expectedUpdatedAt: activity.updatedAt, completed: false })
  check('reopens reminders while preserving the original contact history', activity.completedAt === null && activity.outcome === 'Interested' && activity.summary === 'Screening invitation discussed')
  const initial = { personId: prospect.id, jobId, stage: 'sourced' as const, nextAction: '', dueAt: null, note: 'Private pipeline note', clientFeedback: '' }
  let assignment = talent.saveAssignment(initial)
  check('rejects duplicate person/job assignments', rejected(() => talent.saveAssignment(initial)))
  assignment = talent.saveAssignment({ ...initial, id: assignment.id, expectedUpdatedAt: assignment.updatedAt, stage: 'interested', nextAction: 'Arrange interview', dueAt: Date.now() + 86400000 })
  check('records candidate stage changes in chronological history', assignment.stageHistory.map((event) => event.stage).join(',') === 'sourced,interested')
  check('rejects renderer supplied stage history', rejected(() => talent.saveAssignment({ ...initial, id: assignment.id, expectedUpdatedAt: assignment.updatedAt, stageHistory: [] })))
  assignment = talent.addSubmission({ assignmentId: assignment.id, expectedUpdatedAt: assignment.updatedAt, at: Date.now(), recipient: 'Hiring manager', note: 'Sent by recruiter outside Qumaa' })
  check('stores a dated submission against its hiring-company snapshot', assignment.submissions.length === 1 && assignment.submissions[0].companyId === getJob(jobId).job.companyId && assignment.submissions[0].companyName.length > 0)
  assignment = talent.updateSubmission({ assignmentId: assignment.id, expectedUpdatedAt: assignment.updatedAt, submissionId: assignment.submissions[0].id, feedback: 'Invite to interview' })
  check('updates feedback without erasing the submission history', assignment.submissions[0].feedback === 'Invite to interview' && assignment.submissions[0].note === 'Sent by recruiter outside Qumaa')
  let screening = talent.generateScreening({ personId: prospect.id, jobId })
  check('builds screening questions from unassessed job criteria', screening.questions.some((question) => question.criterionId === 'python') && screening.questions.every((question) => !question.answer && question.verification === 'unverified'))
  screening = talent.saveScreening({ id: screening.id, expectedUpdatedAt: screening.updatedAt, title: 'Technical screening', heldAt: Date.now(), note: 'Internal call notes', questions: screening.questions.map((question) => ({ ...question, answer: 'Led a Python delivery team for three years.', answeredAt: Date.now(), verification: 'candidate-stated' as const })) })
  check('retains candidate-stated screening answers separately from verified evidence', screening.questions[0].verification === 'candidate-stated' && getJob(jobId).reviews.every((review) => review.assessments.length === 0))
  let pool = talent.savePool({ name: 'Leadership prospects', note: 'Reusable contact pool', mode: 'manual', filters: EMPTY_TALENT_FILTERS, personIds: [prospect.id, libraryPerson.id] })
  pool = talent.reviewPool({ id: pool.id, expectedUpdatedAt: pool.updatedAt })
  const savedSearch = talent.savePool({ name: 'Riyadh TypeScript', note: '', mode: 'search', filters: { ...EMPTY_TALENT_FILTERS, location: 'Riyadh', skill: 'TypeScript', hasCv: 'no' }, personIds: [] })
  let overview = talent.overview()
  check('saves manual talent pools and their reviewed date', peopleInPool(pool, overview.people, overview.activities).length === 2 && pool.lastReviewedAt !== null)
  check('recomputes saved-search pools from current contact details', peopleInPool(savedSearch, overview.people, overview.activities).some((person) => person.id === prospect.id))
  check('supports rediscovery filters that exclude recently contacted people', !peopleInPool({ ...savedSearch, filters: { ...savedSearch.filters, notContactedSince: Date.now() - 86400000 } }, overview.people, overview.activities).some((person) => person.id === prospect.id))

  const beforeSearchReview = talent.savePerson({ ...fields, name: 'Existing contact joins saved search', location: 'Jeddah' })
  const reviewedSearch = talent.reviewPool({ id: savedSearch.id, expectedUpdatedAt: savedSearch.updatedAt })
  check('saved-search review records exactly which matching people were seen', reviewedSearch.members.some((member) => member.personId === prospect.id) && !reviewedSearch.members.some((member) => member.personId === beforeSearchReview.id))
  const newlyMatching = talent.savePerson({ ...fields, name: beforeSearchReview.name, id: beforeSearchReview.id, expectedUpdatedAt: beforeSearchReview.updatedAt })
  const editedSearch = talent.savePool({ id: reviewedSearch.id, expectedUpdatedAt: reviewedSearch.updatedAt, name: reviewedSearch.name, note: 'Updated pool description', mode: 'search', filters: reviewedSearch.filters, personIds: [] })
  check('existing contacts newly entering a saved search stay new after a descriptive edit', newPoolPeople(editedSearch, [prospect, newlyMatching]).map((person) => person.id).join() === newlyMatching.id && JSON.stringify(editedSearch.members) === JSON.stringify(reviewedSearch.members) && editedSearch.lastReviewedAt === reviewedSearch.lastReviewedAt)
  const changedSearch = talent.savePool({ id: editedSearch.id, expectedUpdatedAt: editedSearch.updatedAt, name: editedSearch.name, note: '', mode: 'search', filters: { ...editedSearch.filters, location: '' }, personIds: [] })
  check('changing saved-search criteria resets its prior review snapshot', changedSearch.lastReviewedAt === null && changedSearch.members.length === 0)
  talent.reviewPool({ id: changedSearch.id, expectedUpdatedAt: changedSearch.updatedAt })
  talent.deletePerson({ id: newlyMatching.id, expectedUpdatedAt: newlyMatching.updatedAt })

  const secondary = talent.savePerson({ ...fields, name: 'Duplicate prospect', email: 'second@example.test', note: 'Secondary information' })
  let secondAssignment = talent.saveAssignment({ ...initial, personId: secondary.id, stage: 'screened' })
  secondAssignment = talent.addSubmission({ assignmentId: secondAssignment.id, expectedUpdatedAt: secondAssignment.updatedAt, at: Date.now(), recipient: 'Second hiring manager', note: 'Second submission' })
  talent.saveActivity({ personId: secondary.id, jobId: null, kind: 'email', occurredAt: Date.now(), summary: 'Second contact history', outcome: '', nextAction: '', dueAt: null, completedAt: null })
  talent.generateScreening({ personId: secondary.id, jobId })
  const preview = talent.previewMerge({ primaryId: prospect.id, secondaryId: secondary.id })
  check('previews identity conflicts before explicitly merging contacts', preview.conflicts.includes('email') && preview.assignments > 0)
  const merged = talent.mergeContacts({ primaryId: prospect.id, secondaryId: secondary.id, expectedPrimaryUpdatedAt: prospect.updatedAt, expectedSecondaryUpdatedAt: secondary.updatedAt })
  overview = talent.overview()
  const mergedAssignment = overview.assignments.find((row) => row.personId === prospect.id && row.jobId === jobId)!
  check('merges duplicate pipelines without dropping either submission or stage history', mergedAssignment.submissions.length === 2 && mergedAssignment.stage === assignment.stage && mergedAssignment.stageHistory.length >= assignment.stageHistory.length + secondAssignment.stageHistory.length)
  check('merges contact history and screenings while preserving conflicting details in notes', overview.activities.filter((row) => row.personId === prospect.id).length === 2 && overview.screenings.filter((row) => row.personId === prospect.id).length === 2 && merged.note.includes('second@example.test') && !overview.people.some((person) => person.id === secondary.id))
  check('rejects unknown contact and job references before creating records', rejected(() => talent.saveAssignment({ ...initial, personId: randomUUID() })) && rejected(() => talent.saveActivity({ personId: prospect.id, jobId: randomUUID(), kind: 'note', occurredAt: Date.now(), summary: 'Unknown job', outcome: '', nextAction: '', dueAt: null, completedAt: null })))

  const otherCv = listResumes().find((resume) => !libraryPerson.recordKeys.includes(resume.recordKey))
  if (!otherCv) throw new Error('The talent link smoke fixture needs a second independent CV.')
  const existingCvPerson = talent.ensurePerson({ id: otherCv.id, recordKey: otherCv.recordKey })
  const linkProspect = talent.savePerson({ ...fields, name: 'Prospect later supplied a CV', note: 'Manual prospect information' })
  const cvActivity = talent.saveActivity({ personId: existingCvPerson.id, jobId: null, kind: 'meeting', occurredAt: Date.now(), summary: 'History recorded before attaching the CV', outcome: '', nextAction: '', dueAt: null, completedAt: null })
  check('rejects stale CV linking without changing either contact', rejected(() => talent.linkCv({ personId: linkProspect.id, expectedUpdatedAt: linkProspect.updatedAt - 1, resume: { id: otherCv.id, recordKey: otherCv.recordKey } })) && talent.overview().people.some((person) => person.id === existingCvPerson.id))
  check('requires explicit contact merging before linking different owners as CV versions', rejected(() => talent.assertTalentVersionLink(libraryPerson.recordKeys, existingCvPerson.recordKeys)))
  const attached = talent.linkCv({ personId: linkProspect.id, expectedUpdatedAt: linkProspect.updatedAt, resume: { id: otherCv.id, recordKey: otherCv.recordKey } })
  const linkedOverview = talent.overview()
  check('attaching a CV preserves the prospect identity, manual fields and earlier contact history', attached.id === linkProspect.id && attached.origin === 'prospect' && attached.name === linkProspect.name && attached.recordKeys.includes(otherCv.recordKey) && attached.note.includes(linkProspect.note) && linkedOverview.activities.find((row) => row.id === cvActivity.id)?.personId === linkProspect.id && !linkedOverview.people.some((person) => person.id === existingCvPerson.id) && talent.ensurePerson({ id: otherCv.id, recordKey: otherCv.recordKey }).id === attached.id)
  check('stale explicit merge previews cannot overwrite a changed contact', rejected(() => talent.mergeContacts({ primaryId: prospect.id, secondaryId: attached.id, expectedPrimaryUpdatedAt: prospect.updatedAt, expectedSecondaryUpdatedAt: attached.updatedAt })))

  const disposable = talent.savePerson({ ...fields, name: 'Disposable prospect' })
  talent.saveActivity({ personId: disposable.id, jobId, kind: 'follow-up', occurredAt: Date.now(), summary: 'Remove this reminder with the prospect', outcome: '', nextAction: 'Call', dueAt: Date.now(), completedAt: null })
  talent.saveAssignment({ ...initial, personId: disposable.id })
  const firstScreening = talent.generateScreening({ personId: disposable.id, jobId })
  const firstAnswered = talent.saveScreening({ id: firstScreening.id, expectedUpdatedAt: firstScreening.updatedAt, title: firstScreening.title, heldAt: Date.now(), note: 'First call retained', questions: firstScreening.questions.map((question) => ({ ...question, answer: 'First call answer', verification: 'candidate-stated', answeredAt: null })) })
  const nextScreening = talent.generateScreening({ personId: disposable.id, jobId })
  check('prepares a separate follow-up screening while preserving earlier answers', nextScreening.id !== firstAnswered.id && nextScreening.questions.every((question) => question.answer === '' && question.verification === 'unverified') && talent.overview().screenings.some((row) => row.id === firstAnswered.id && row.note === 'First call retained' && row.questions[0]?.answer === 'First call answer'))
  const disposablePool = talent.savePool({ name: 'Deletion test', note: '', mode: 'manual', filters: EMPTY_TALENT_FILTERS, personIds: [disposable.id, prospect.id] })
  const resumeCount = listResumes().length
  check('stale contact deletion leaves all related CRM history intact', rejected(() => talent.deletePerson({ id: disposable.id, expectedUpdatedAt: disposable.updatedAt - 1 })) && talent.overview().assignments.some((row) => row.personId === disposable.id))
  talent.deletePerson({ id: disposable.id, expectedUpdatedAt: disposable.updatedAt })
  const deletedOverview = talent.overview()
  const cleanedPool = deletedOverview.pools.find((row) => row.id === disposablePool.id)!
  check('contact deletion cascades only its CRM history and memberships while retaining every CV', !deletedOverview.people.some((person) => person.id === disposable.id) && !deletedOverview.activities.some((row) => row.personId === disposable.id) && !deletedOverview.assignments.some((row) => row.personId === disposable.id) && !deletedOverview.screenings.some((row) => row.personId === disposable.id) && cleanedPool.members.length === 1 && cleanedPool.members[0].personId === prospect.id && listResumes().length === resumeCount)
  talent.deletePool({ id: cleanedPool.id, expectedUpdatedAt: cleanedPool.updatedAt })

  let bulkPrimary = talent.savePerson({ ...fields, name: 'Bulk merge primary', note: 'x'.repeat(20_000) })
  const bulkSecondary = talent.savePerson({ ...fields, name: 'Bulk merge secondary', note: 'Source contact information' })
  const bulkActivity = talent.saveActivity({ personId: bulkSecondary.id, jobId: null, kind: 'note', occurredAt: Date.now(), summary: 'Historical contact record', outcome: '', nextAction: '', dueAt: null, completedAt: null })
  putRecords(getDb(), 'activity', Array.from({ length: 5_000 }, (_, index) => ({ ...bulkActivity, id: randomUUID(), summary: `Historical contact record ${index + 1}` })))
  const beforeFailedMerge = talentSnapshot()
  check('failed large-history merges roll back every contact and history update', rejected(() => talent.mergeContacts({ primaryId: bulkPrimary.id, secondaryId: bulkSecondary.id, expectedPrimaryUpdatedAt: bulkPrimary.updatedAt, expectedSecondaryUpdatedAt: bulkSecondary.updatedAt })) && talentSnapshot() === beforeFailedMerge)
  bulkPrimary = talent.savePerson({ ...fields, name: bulkPrimary.name, note: 'Primary contact information', id: bulkPrimary.id, expectedUpdatedAt: bulkPrimary.updatedAt })
  const bulkMerged = talent.mergeContacts({ primaryId: bulkPrimary.id, secondaryId: bulkSecondary.id, expectedPrimaryUpdatedAt: bulkPrimary.updatedAt, expectedSecondaryUpdatedAt: bulkSecondary.updatedAt })
  const bulkOverview = talent.overview()
  check('merges more than 5,000 history entries without losing identities or content', bulkOverview.activities.filter((row) => row.personId === bulkMerged.id).length === 5_001 && bulkOverview.activities.some((row) => row.id === bulkActivity.id && row.summary === bulkActivity.summary) && !bulkOverview.people.some((person) => person.id === bulkSecondary.id))
  talent.deletePerson({ id: bulkMerged.id, expectedUpdatedAt: bulkMerged.updatedAt })

  // Keep one library-origin record for privacy/pruning checks after restoring.
  talent.saveAssignment({ ...initial, personId: libraryPerson.id })
  talent.generateScreening({ personId: libraryPerson.id, jobId })
  const snapshot = talentSnapshot()
  closeDbForMaintenance()
  check('persists contacts, reminders, pipelines, pools and screenings after database restart', talentSnapshot() === snapshot)
  check('recruiter workflows leave matching scores and ranking evidence unchanged', JSON.stringify(getJob(jobId).response?.results) === baseline)
  return { snapshot, prospectId: prospect.id, libraryPersonId: libraryPerson.id }
}
