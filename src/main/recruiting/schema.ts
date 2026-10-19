/** Bounded, strict contracts shared by IPC, local records, and portable restore. */
import { z } from 'zod'
import { isRerankConfig, type RerankConfig, RERANK_PROVIDERS } from '@shared/rerank.js'
import { COMPANY_DETAIL_LIMIT, normalizeCompanyDetailKey, type JobTargetCompany } from '@shared/recruiting.js'
import { talentRecordSchemas, TALENT_LIMITS } from './talent-schema.js'
import { hiringBudgetRecordSchema } from './hiring-budget-schema.js'
import { DATABASE_LIMITS } from '../db/limits.js'

export const RECRUITING_LIMITS = Object.freeze({
  jobs: 250,
  companies: 1_000,
  hiringBudgets: 1_000,
  targetCompanies: 100,
  profiles: 5_000,
  reviews: 50_000,
  snapshots: 250,
  statusEvents: 1_000,
  totalBytes: 128 * 1024 * 1024,
  recordBytes: 8 * 1024 * 1024
})

const text = (max: number) => z.string().max(max).refine((value) => !value.includes('\0'), 'must not contain NUL characters')
const label = (max: number) => text(max).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'must not contain control characters')
const recordKey = z.string().regex(/^[a-f0-9]{64}$/)
const jobId = z.string().uuid()
const timestamp = z.number().int().nonnegative().max(8.64e15)
const resume = z.strictObject({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), recordKey })
const unique = <T>(values: T[]) => new Set(values).size === values.length
const status = z.enum(['unreviewed', 'maybe', 'shortlisted', 'contacted', 'not-proceeding'])
const jobStatus = z.enum(['open', 'on-hold', 'filled', 'archived'])
const placementInput = z.strictObject({ hired: resume, backup2: resume.optional(), backup3: resume.optional() })
  .refine((value) => !value.backup3 || !!value.backup2, 'Backup #3 requires backup #2.')
  .refine((value) => unique([value.hired, value.backup2, value.backup3].filter((candidate) => candidate !== undefined).map((candidate) => candidate.recordKey)), 'Choose a different candidate for each hiring slot.')
const placementCandidate = z.strictObject({ recordKey: recordKey.nullable(), name: label(512).min(1).nullable() })
  .refine((value) => (value.recordKey === null) === (value.name === null), 'Removed CVs must not retain candidate names or identities.')
export const jobPlacementSchema = z.strictObject({
  hired: placementCandidate,
  backup2: placementCandidate.nullable(),
  backup3: placementCandidate.nullable()
}).refine((value) => !value.backup3 || !!value.backup2, 'Backup #3 requires backup #2.')
  .refine((value) => unique([value.hired, value.backup2, value.backup3].flatMap((candidate) => candidate?.recordKey ? [candidate.recordKey] : [])), 'Hiring slots must reference distinct CVs.')
const statusEvent = z.strictObject({
  id: jobId,
  status: jobStatus,
  at: timestamp,
  kind: z.enum(['created', 'status-changed', 'placement-updated']),
  placement: jobPlacementSchema.optional()
}).superRefine((value, context) => {
  if ((value.status === 'filled') !== !!value.placement) context.addIssue({ code: 'custom', message: 'Filled events must record a hiring decision; other statuses cannot include one.' })
  if (value.kind === 'placement-updated' && value.status !== 'filled') context.addIssue({ code: 'custom', message: 'Hiring details can only be updated while a job is filled.' })
  if (value.kind === 'created' && value.status !== 'open') context.addIssue({ code: 'custom', message: 'New jobs must start open.' })
})
const assessment = z.strictObject({
  criterionId: label(100).min(1),
  status: z.enum(['unreviewed', 'evidence-found', 'needs-clarification', 'not-stated', 'confirmed', 'contradicted']),
  note: text(10_000)
})
const assessments = z.array(assessment).max(40).refine((values) => unique(values.map((value) => value.criterionId)), 'criterion IDs must be unique')
const criteria = z.array(z.strictObject({
  id: label(100).min(1),
  text: text(1_000).trim().min(1),
  importance: z.enum(['required', 'preferred', 'unspecified']),
  source: z.strictObject({
    field: z.enum(['jobDescription', 'requirements', 'educationAndCertifications']),
    text: text(30_000).min(1)
  }).optional()
})).max(40).refine((values) => unique(values.map((value) => value.id)), 'criterion IDs must be unique')
const posting = z.strictObject({
  position: label(512),
  jobDescription: text(30_000),
  requirements: text(30_000),
  educationAndCertifications: text(30_000)
}).refine((value) => Object.values(value).some((part) => part.trim().length > 0), 'a job needs a title or description')

/** Preserve each legacy string intact: commas and slashes can be meaningful data. */
const companyDetails = z.union([
  label(512).transform((value) => value.trim() ? [value.trim()] : []),
  z.array(label(512).trim().min(1)).max(COMPANY_DETAIL_LIMIT)
    .refine((values) => unique(values.map(normalizeCompanyDetailKey)), 'Company details must be unique.')
])
const companyFields = {
  name: label(512).trim().min(1),
  industry: companyDetails,
  location: companyDetails,
  website: label(2_048),
  contactName: companyDetails,
  contactEmail: companyDetails,
  note: text(10_000)
}
const amount = z.number().finite().min(0).max(1e9)
  .refine((value) => Number(value.toFixed(2)) === value, 'Budget amounts can have at most two decimal places.')
export const jobBudgetSchema = z.strictObject({
  min: amount,
  max: amount,
  currency: z.string().regex(/^[A-Z]{3}$/),
  period: z.enum(['monthly', 'annual', 'hourly'])
}).refine((value) => value.min <= value.max, 'The minimum budget cannot exceed the maximum.')
export const jobHiringBudgetSchema = z.strictObject({
  min: amount,
  max: amount,
  currency: z.string().regex(/^[A-Z]{3}$/)
}).refine((value) => value.min <= value.max, 'The minimum budget cannot exceed the maximum.')
const targetCompanies = z.array(z.strictObject({
  companyId: jobId,
  status: z.enum(['to-research', 'researching', 'mapped', 'excluded']),
  focusRoles: text(2_000),
  note: text(10_000)
})).max(RECRUITING_LIMITS.targetCompanies)
  .refine((values) => unique(values.map((value) => value.companyId)), 'Target companies must be unique.')
const jobCompanyFields = {
  companyId: jobId.nullable().optional(),
  budget: jobBudgetSchema.nullable().optional(),
  hiringBudget: jobHiringBudgetSchema.nullable().optional(),
  targetCompanies: targetCompanies.optional()
}

/** Validate after merging edits, and after reading all company records on restore. */
export function assertJobCompanyReferences(
  job: { companyId?: string | null; targetCompanies?: JobTargetCompany[] },
  companyIds: ReadonlySet<string>
): void {
  if (job.companyId && !companyIds.has(job.companyId)) throw new Error('This job references an unknown company.')
  for (const target of job.targetCompanies ?? []) {
    if (!companyIds.has(target.companyId)) throw new Error('A target company no longer exists.')
    if (target.companyId === job.companyId) throw new Error('The hiring company cannot be a target company for the same job.')
  }
}

const profileFields = {
  name: label(512).nullable(),
  email: label(512).nullable(),
  phone: label(128).nullable(),
  location: label(512).nullable(),
  yearsExperience: z.number().finite().min(0).max(DATABASE_LIMITS.yearsExperience).nullable(),
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
  saveCompany: z.strictObject({ id: jobId.optional(), ...companyFields }),
  saveTargetCompanies: z.strictObject({ jobId, expectedUpdatedAt: timestamp, companies: targetCompanies }),
  rerankPreview: z.strictObject({ jobId, sessionId: z.string().uuid() }),
  rerank: z.strictObject({ jobId, sessionId: z.string().uuid(), approvalToken: z.string().uuid() }),
  saveJob: z.strictObject({ id: jobId.optional(), posting, status: jobStatus, criteria, ...jobCompanyFields }),
  changeJobStatus: z.strictObject({ jobId, expectedUpdatedAt: timestamp, status: jobStatus, placement: placementInput.optional() })
    .refine((value) => value.status !== 'filled' || !!value.placement, 'Select the hired candidate before marking this job filled.')
    .refine((value) => value.status === 'filled' || !value.placement, 'Hiring details can only be changed when marking a job filled.'),
  temporarySearch: z.strictObject({ posting, status: jobStatus, criteria, ...jobCompanyFields }),
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
  ...jobCompanyFields,
  posting,
  status: jobStatus,
  criteria,
  createdAt: timestamp,
  updatedAt: timestamp,
  lastSearchedAt: timestamp.nullable(),
  statusHistory: z.array(statusEvent).max(RECRUITING_LIMITS.statusEvents).optional(),
  placement: jobPlacementSchema.optional()
}).superRefine((job, context) => {
  if (job.companyId && job.targetCompanies?.some((target) => target.companyId === job.companyId)) {
    context.addIssue({ code: 'custom', message: 'The hiring company cannot be a target company for the same job.' })
  }
  const history = job.statusHistory ?? []
  if (!unique(history.map((event) => event.id))) context.addIssue({ code: 'custom', message: 'Status event identities must be unique.' })
  for (const [index, event] of history.entries()) {
    const previous = history[index - 1]
    if (event.at < job.createdAt || event.at > job.updatedAt || (previous && event.at <= previous.at)) {
      context.addIssue({ code: 'custom', message: 'Status event timestamps must follow the job timeline.' })
    }
    if (event.kind === 'created' && (index !== 0 || event.at !== job.createdAt)) context.addIssue({ code: 'custom', message: 'Creation must be the first event and match the saved job date.' })
    if (previous && (event.kind === 'status-changed' ? event.status === previous.status : event.status !== previous.status)) {
      context.addIssue({ code: 'custom', message: 'Status events must describe actual transitions.' })
    }
  }
  if (history.length && history[history.length - 1].status !== job.status) context.addIssue({ code: 'custom', message: 'Current job status must match its latest event.' })
  const latestPlacement = history.findLast((event) => event.placement)?.placement
  if (JSON.stringify(latestPlacement) !== JSON.stringify(job.placement)) context.addIssue({ code: 'custom', message: 'Current hiring details must match the latest recorded decision.' })
})
export const companyRecordSchema = z.strictObject({
  id: jobId,
  ...companyFields,
  createdAt: timestamp,
  updatedAt: timestamp
}).refine((value) => value.updatedAt >= value.createdAt, 'Company updates cannot precede creation.')
export const profileRecordSchema = z.strictObject({
  candidateKey: recordKey,
  recordKeys: z.array(recordKey).min(1).max(5_000).refine(unique, 'resume identities must be unique'),
  ...profileFields,
  updatedAt: timestamp
}).refine((profile) => profile.recordKeys.includes(profile.candidateKey), 'candidate identity must belong to its CV versions')
export const reviewRecordSchema = z.strictObject({ jobId, candidateKey: recordKey, ...reviewFields, updatedAt: timestamp })
const score = z.number().finite().min(0).max(1)
const rerankConfig = z.strictObject({
  provider: z.enum(RERANK_PROVIDERS),
  model: z.string().min(1).max(128),
  authMode: z.enum(['api-key', 'chatgpt']).optional()
}).refine(isRerankConfig, 'The selected model must belong to its provider.')
  .transform((value): RerankConfig => value as RerankConfig)
export const snapshotRecordSchema = z.strictObject({
  jobId,
  libraryFingerprint: recordKey,
  postingFingerprint: recordKey,
  modelFingerprint: recordKey,
  searchedAt: timestamp,
  libraryKeys: z.array(recordKey).max(5_000).refine(unique, 'resume identities must be unique'),
  requiredSkills: z.array(label(256)).max(512),
  elapsedMs: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  rerankConfig: rerankConfig.optional(),
  // Source ranking stays intact; only this bounded display order comes from Claude.
  rerank: z.array(z.strictObject({ recordKey, reason: text(300).optional() })).min(2).max(15)
    .refine((values) => unique(values.map((value) => value.recordKey)), 'reranked candidates must be unique').optional(),
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

export const recordSchemas = { hiringBudget: hiringBudgetRecordSchema, company: companyRecordSchema, job: jobRecordSchema, profile: profileRecordSchema, review: reviewRecordSchema, snapshot: snapshotRecordSchema, ...talentRecordSchemas }
export type RecordKind = keyof typeof recordSchemas
export const RECORD_LIMITS: Readonly<Record<RecordKind, number>> = Object.freeze({
  hiringBudget: RECRUITING_LIMITS.hiringBudgets, company: RECRUITING_LIMITS.companies, job: RECRUITING_LIMITS.jobs, review: RECRUITING_LIMITS.reviews,
  profile: RECRUITING_LIMITS.profiles, snapshot: RECRUITING_LIMITS.snapshots, ...TALENT_LIMITS
})
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
  if (Object.hasOwn(talentRecordSchemas, kind)) return (value as { id: string }).id
  if (kind === 'hiringBudget') return (value as { id: string }).id
  if (kind === 'company') return (value as z.infer<typeof companyRecordSchema>).id
  if (kind === 'job') return (value as JobRecord).id
  if (kind === 'snapshot') return (value as SnapshotRecord).jobId
  if (kind === 'review') {
    const review = value as z.infer<typeof reviewRecordSchema>
    return `${review.jobId}:${review.candidateKey}`
  }
  return (value as z.infer<typeof profileRecordSchema>).candidateKey
}
