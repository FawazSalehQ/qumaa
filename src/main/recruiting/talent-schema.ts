/** Pure bounded CRM contracts; shared by IPC, persistence and portable restore. */
import { z } from 'zod'

export const TALENT_LIMITS = Object.freeze({ person: 10_000, activity: 50_000, assignment: 25_000, pool: 250, screening: 25_000 })
const text = (max: number) => z.string().max(max).refine((value) => !value.includes('\0'), 'must not contain NUL characters')
const label = (max: number) => text(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'must not contain control characters')
const id = z.string().uuid()
// Date/Intl rendering must be safe even for externally supplied backups.
const time = z.number().int().nonnegative().max(8_640_000_000_000_000)
const hash = z.string().regex(/^[a-f0-9]{64}$/)
const unique = <T>(values: T[]): boolean => new Set(values).size === values.length
const strings = (maxLength: number, count: number) => z.array(label(maxLength).trim().min(1)).max(count).refine(unique, 'values must be unique')
const dates = { createdAt: time, updatedAt: time }
const edit = { id: id.optional(), expectedUpdatedAt: time.optional() }
const editVersion = (value: { id?: string; expectedUpdatedAt?: number }) => !!value.id === (value.expectedUpdatedAt !== undefined)
const timeline = (value: { createdAt: number; updatedAt: number }) => value.updatedAt >= value.createdAt
export const versionedIdSchema = z.strictObject({ id, expectedUpdatedAt: time })
const personFields = {
  name: label(512).trim().min(1), email: label(512), phone: label(128), employer: label(512), title: label(512), location: label(512),
  skills: strings(256, 512), tags: strings(100, 50), availability: label(512), availabilityConfirmedAt: time.nullable(), sourceUrl: label(2_048), note: text(20_000)
}
export const personRecordSchema = z.strictObject({
  id, ...personFields, recordKeys: z.array(hash).max(5_000).refine(unique, 'CV identities must be unique'), origin: z.enum(['prospect', 'library']), ...dates
}).refine(timeline, 'Contact updates cannot precede creation.')
  .refine((value) => value.origin !== 'library' || value.recordKeys.length > 0, 'A library contact needs a CV.')
const activityFields = {
  personId: id, jobId: id.nullable(), kind: z.enum(['call', 'email', 'message', 'meeting', 'note', 'follow-up']), occurredAt: time,
  summary: text(2_000).trim().min(1), outcome: text(10_000), nextAction: text(2_000), dueAt: time.nullable(), completedAt: time.nullable()
}
export const activityRecordSchema = z.strictObject({ id, ...activityFields, ...dates }).refine(timeline)
const stage = z.enum(['sourced', 'contacted', 'interested', 'screened', 'submitted', 'interviewing', 'offer', 'placed', 'closed'])
const assignmentFields = {
  personId: id, jobId: id, stage, nextAction: text(2_000), dueAt: time.nullable(), note: text(20_000), clientFeedback: text(20_000)
}
const stageEvent = z.strictObject({ id, stage, at: time })
const submission = z.strictObject({ id, at: time, companyId: id.nullable(), companyName: label(512), recipient: label(512), note: text(10_000), feedback: text(10_000) })
export const assignmentRecordSchema = z.strictObject({
  id, ...assignmentFields, stageHistory: z.array(stageEvent).min(1).max(1_000), submissions: z.array(submission).max(500), ...dates
}).refine(timeline).superRefine((value, context) => {
  if (!unique(value.stageHistory.map((event) => event.id)) || !unique(value.submissions.map((item) => item.id))) context.addIssue({ code: 'custom', message: 'Pipeline history identities must be unique.' })
  if (value.stageHistory.at(-1)?.stage !== value.stage) context.addIssue({ code: 'custom', message: 'The current pipeline stage must match its history.' })
  if (value.stageHistory.some((event, index) => event.at < value.createdAt || event.at > value.updatedAt || (index > 0 && event.at < value.stageHistory[index - 1].at))) context.addIssue({ code: 'custom', message: 'Pipeline history must follow its timeline.' })
})
export const screeningQuestionSchema = z.strictObject({
  id, criterionId: label(100).min(1).nullable(), question: text(2_000).trim().min(1), answer: text(10_000),
  verification: z.enum(['unverified', 'candidate-stated', 'verified']), answeredAt: time.nullable()
}).refine((value) => value.answer.trim().length > 0 || (value.verification === 'unverified' && value.answeredAt === null), 'An unanswered question cannot be marked verified or dated.')
const screeningFields = {
  title: label(512).trim().min(1), questions: z.array(screeningQuestionSchema).max(100).refine((values) => unique(values.map((value) => value.id)), 'Screening question identities must be unique.'),
  heldAt: time.nullable(), note: text(20_000)
}
export const screeningRecordSchema = z.strictObject({ id, personId: id, jobId: id, ...screeningFields, ...dates }).refine(timeline)
const filters = z.strictObject({
  query: label(512), location: label(512), employer: label(512), skill: label(256), tag: label(100), availability: label(512),
  hasCv: z.enum(['any', 'yes', 'no']), notContactedSince: time.nullable()
})
const poolFields = { name: label(512).trim().min(1), note: text(10_000), mode: z.enum(['manual', 'search']), filters }
export const poolRecordSchema = z.strictObject({
  id, ...poolFields,
  members: z.array(z.strictObject({ personId: id, addedAt: time })).max(TALENT_LIMITS.person).refine((values) => unique(values.map((value) => value.personId)), 'Pool members must be unique.'),
  lastReviewedAt: time.nullable(), ...dates
}).refine(timeline).refine((value) => value.lastReviewedAt === null || value.lastReviewedAt <= value.updatedAt, 'Pool review time cannot follow its update.')

export const talentRecordSchemas = { person: personRecordSchema, activity: activityRecordSchema, assignment: assignmentRecordSchema, pool: poolRecordSchema, screening: screeningRecordSchema }
const resume = z.strictObject({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), recordKey: hash })
export const talentSchemas = {
  versionedId: versionedIdSchema,
  ensurePerson: resume,
  savePerson: z.strictObject({ ...edit, ...personFields }).refine(editVersion, 'Contact edits require the current version.'),
  linkCv: z.strictObject({ personId: id, expectedUpdatedAt: time, resume }),
  previewMerge: z.strictObject({ primaryId: id, secondaryId: id }).refine((value) => value.primaryId !== value.secondaryId, 'Select two different contacts.'),
  mergeContacts: z.strictObject({ primaryId: id, secondaryId: id, expectedPrimaryUpdatedAt: time, expectedSecondaryUpdatedAt: time }).refine((value) => value.primaryId !== value.secondaryId, 'Select two different contacts.'),
  saveActivity: z.strictObject({ ...edit, ...activityFields }).refine(editVersion, 'Activity edits require the current version.'),
  completeActivity: versionedIdSchema.extend({ completed: z.boolean() }),
  saveAssignment: z.strictObject({ ...edit, ...assignmentFields }).refine(editVersion, 'Pipeline edits require the current version.'),
  addSubmission: z.strictObject({ assignmentId: id, expectedUpdatedAt: time, at: time, recipient: label(512), note: text(10_000) }),
  updateSubmission: z.strictObject({ assignmentId: id, expectedUpdatedAt: time, submissionId: id, feedback: text(10_000) }),
  generateScreening: z.strictObject({ personId: id, jobId: id }),
  saveScreening: z.strictObject({ id, expectedUpdatedAt: time, ...screeningFields }),
  savePool: z.strictObject({ ...edit, ...poolFields, personIds: z.array(id).max(TALENT_LIMITS.person).refine(unique, 'Pool members must be unique.') }).refine(editVersion, 'Pool edits require the current version.')
}
