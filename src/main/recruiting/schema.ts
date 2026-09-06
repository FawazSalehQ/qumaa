/** Bounded, strict contracts shared by IPC, local records, and portable restore. */
import { z } from 'zod'

export const RECRUITING_LIMITS = Object.freeze({
  jobs: 250,
  profiles: 5_000,
  reviews: 50_000,
  snapshots: 250,
  totalBytes: 128 * 1024 * 1024,
  recordBytes: 8 * 1024 * 1024
})

const text = (max: number) => z.string().max(max).refine((value) => !value.includes('\0'), 'must not contain NUL characters')
const label = (max: number) => text(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'must not contain control characters')
const recordKey = z.string().regex(/^[a-f0-9]{64}$/)
const jobId = z.string().uuid()
const timestamp = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER)
const resume = z.strictObject({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), recordKey })
const unique = <T>(values: T[]) => new Set(values).size === values.length
const status = z.enum(['unreviewed', 'maybe', 'shortlisted', 'contacted', 'not-proceeding'])
const jobStatus = z.enum(['open', 'on-hold', 'filled', 'archived'])
const assessment = z.strictObject({
  criterionId: label(100).min(1),
  status: z.enum(['unreviewed', 'evidence-found', 'needs-clarification', 'not-stated', 'confirmed']),
  note: text(10_000)
})
const assessments = z.array(assessment).max(40).refine((values) => unique(values.map((value) => value.criterionId)), 'criterion IDs must be unique')
const criteria = z.array(z.strictObject({
  id: label(100).min(1),
  text: text(1_000).trim().min(1),
  importance: z.enum(['required', 'preferred'])
})).max(40).refine((values) => unique(values.map((value) => value.id)), 'criterion IDs must be unique')
const posting = z.strictObject({
  position: label(512),
  jobDescription: text(30_000),
  requirements: text(30_000),
  educationAndCertifications: text(30_000)
}).refine((value) => Object.values(value).some((part) => part.trim().length > 0), 'a job needs a title or description')

const profileFields = {
  name: label(512).nullable(),
  email: label(512).nullable(),
  phone: label(128).nullable(),
  location: label(512).nullable(),
  yearsExperience: z.number().finite().min(0).max(100).nullable(),
  educationLevel: z.enum(['phd', 'masters', 'bachelors', 'associate']).nullable(),
  skills: z.array(label(256).min(1)).max(512).nullable(),
  expectedSalary: label(512),
  noticePeriod: label(512),
  availability: label(512),
  preferredLocation: label(512),
  tags: z.array(label(100).min(1)).max(50),
  note: text(10_000)
}
const reviewFields = {
  status,
  note: text(10_000),
  order: z.number().finite().min(-1e9).max(1e9),
  assessments
}

export const recruitingSchemas = {
  jobId,
  saveJob: z.strictObject({ id: jobId.optional(), posting, status: jobStatus, criteria }),
  saveReview: z.strictObject({ jobId, resume, ...reviewFields }),
  saveProfile: z.strictObject({ resume, ...profileFields }),
  linkVersions: z.strictObject({ primary: resume, version: resume }),
  unlinkVersion: z.strictObject({ resume }),
  evidence: z.strictObject({ jobId, resumes: z.array(resume).min(1).max(4).refine((values) => unique(values.map((value) => value.recordKey)), 'CV identities must be unique') }),
  reorderShortlist: z.strictObject({ jobId, resumes: z.array(resume).min(1).max(5_000).refine((values) => unique(values.map((value) => value.recordKey)), 'CV identities must be unique') }),
  exportShortlist: z.strictObject({ jobId, format: z.enum(['pdf', 'csv']) })
}

export const jobRecordSchema = z.strictObject({
  id: jobId,
  posting,
  status: jobStatus,
  criteria,
  createdAt: timestamp,
  updatedAt: timestamp,
  lastSearchedAt: timestamp.nullable()
})
export const profileRecordSchema = z.strictObject({
  candidateKey: recordKey,
  recordKeys: z.array(recordKey).min(1).max(5_000).refine(unique, 'resume identities must be unique'),
  ...profileFields,
  updatedAt: timestamp
}).refine((profile) => profile.recordKeys.includes(profile.candidateKey), 'candidate identity must belong to its CV versions')
export const reviewRecordSchema = z.strictObject({ jobId, candidateKey: recordKey, ...reviewFields, updatedAt: timestamp })
const score = z.number().finite().min(0).max(1)
export const snapshotRecordSchema = z.strictObject({
  jobId,
  libraryFingerprint: recordKey,
  postingFingerprint: recordKey,
  modelFingerprint: recordKey,
  searchedAt: timestamp,
  libraryKeys: z.array(recordKey).max(5_000).refine(unique, 'resume identities must be unique'),
  requiredSkills: z.array(label(256)).max(512),
  elapsedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  results: z.array(z.strictObject({
    recordKey,
    score,
    breakdown: z.strictObject({ semantic: score, lexical: score, skills: score }),
    matchedSkills: z.array(label(256)).max(512),
    missingSkills: z.array(label(256)).max(512),
    // Evidence is stored by passage identity, never as another copy of CV text.
    evidence: z.array(z.strictObject({ ordinal: z.number().int().min(0).max(511), similarity: z.number().finite().min(-1).max(1) })).max(100)
  })).max(5_000).refine((values) => unique(values.map((value) => value.recordKey)), 'candidate results must be unique')
})

export const recordSchemas = { job: jobRecordSchema, profile: profileRecordSchema, review: reviewRecordSchema, snapshot: snapshotRecordSchema }
export type RecordKind = keyof typeof recordSchemas
export type JobRecord = z.infer<typeof jobRecordSchema>
export type SnapshotRecord = z.infer<typeof snapshotRecordSchema>
export type StoredRecord = z.infer<(typeof recordSchemas)[RecordKind]>

/** Errors expose field names and validation messages without echoing private values. */
export function parseRecruiting<T>(schema: z.ZodType<T>, value: unknown): T {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`Invalid recruiting data${issue.path.length ? ` at ${issue.path.join('.')}` : ''}: ${issue.message}`)
}

export function recordId(kind: RecordKind, value: StoredRecord): string {
  if (kind === 'job') return (value as JobRecord).id
  if (kind === 'snapshot') return (value as SnapshotRecord).jobId
  if (kind === 'review') {
    const review = value as z.infer<typeof reviewRecordSchema>
    return `${review.jobId}:${review.candidateKey}`
  }
  return (value as z.infer<typeof profileRecordSchema>).candidateKey
}
