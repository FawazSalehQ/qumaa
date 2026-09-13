import { describe, expect, it } from 'vitest'
import { pruneJobPlacements, samePlacementPeople } from '../src/main/recruiting/job-status.js'
import { jobRecordSchema, recruitingSchemas, RECRUITING_LIMITS, type JobRecord } from '../src/main/recruiting/schema.js'

const jobId = 'e48ac3da-1c16-4b85-8267-1dba6515dcae'
const eventId = (index: number) => `e48ac3da-1c16-4b85-8267-${String(index).padStart(12, '0')}`
const keyA = 'a'.repeat(64)
const keyB = 'b'.repeat(64)
const keyC = 'c'.repeat(64)
const placement = {
  hired: { recordKey: keyA, name: 'Hired person' },
  backup2: { recordKey: keyB, name: 'Second person' },
  backup3: { recordKey: keyC, name: 'Third person' }
}
const legacyJob: JobRecord = {
  id: jobId, posting: { position: 'Senior accounting specialist', jobDescription: '', requirements: '', educationAndCertifications: '' },
  status: 'open', criteria: [], createdAt: 1, updatedAt: 5, lastSearchedAt: null
}
const job: JobRecord = {
  ...legacyJob, status: 'archived', placement,
  statusHistory: [
    { id: eventId(1), status: 'open', kind: 'created', at: 1 },
    { id: eventId(2), status: 'filled', kind: 'status-changed', at: 2, placement },
    { id: eventId(3), status: 'archived', kind: 'status-changed', at: 3 }
  ]
}

describe('job status and hiring contracts', () => {
  it('requires a hired CV, sequential distinct backups, and main-owned status metadata', () => {
    const input = { jobId, expectedUpdatedAt: 1, status: 'filled', placement: { hired: { id: 1, recordKey: keyA } } }
    expect(recruitingSchemas.changeJobStatus.safeParse(input).success).toBe(true)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, placement: undefined }).success).toBe(false)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, placement: { ...input.placement, backup3: { id: 3, recordKey: keyC } } }).success).toBe(false)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, placement: { ...input.placement, backup2: input.placement.hired } }).success).toBe(false)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, placement: { ...input.placement, backup2: { id: 2, recordKey: keyB }, backup3: { id: 3, recordKey: keyC } } }).success).toBe(true)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, placement: { ...input.placement, backup4: { id: 4, recordKey: 'd'.repeat(64) } } }).success).toBe(false)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, placement: { hired: { ...input.placement.hired, name: 'Forged name' } } }).success).toBe(false)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, at: 1 }).success).toBe(false)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, expectedUpdatedAt: undefined }).success).toBe(false)
    expect(recruitingSchemas.changeJobStatus.safeParse({ ...input, status: 'archived' }).success).toBe(false)
  })

  it('accepts legacy unknown history and records only known subsequent events', () => {
    expect(jobRecordSchema.parse(legacyJob).statusHistory).toBeUndefined()
    expect(jobRecordSchema.safeParse({ ...legacyJob, status: 'filled' }).success).toBe(true)
    expect(jobRecordSchema.safeParse({ ...legacyJob, status: 'filled', placement, statusHistory: [{ id: eventId(1), kind: 'placement-updated', status: 'filled', at: 5, placement }] }).success).toBe(true)
    expect(jobRecordSchema.safeParse({ ...legacyJob, status: 'archived', statusHistory: [{ id: eventId(1), kind: 'status-changed', status: 'archived', at: 5 }] }).success).toBe(true)
    expect(jobRecordSchema.safeParse(job).success).toBe(true)
  })

  it('rejects contradictory dates, status transitions, hiring snapshots, and unbounded history', () => {
    const history = job.statusHistory!
    expect(jobRecordSchema.safeParse({ ...job, status: 'open' }).success).toBe(false)
    expect(jobRecordSchema.safeParse({ ...job, statusHistory: [{ ...history[0], at: 2 }, ...history.slice(1)] }).success).toBe(false)
    expect(jobRecordSchema.safeParse({ ...job, statusHistory: [...history, { ...history[2], id: eventId(4), at: 6 }] }).success).toBe(false)
    expect(jobRecordSchema.safeParse({ ...job, statusHistory: [...history, { ...history[2], id: eventId(4), at: 4 }] }).success).toBe(false)
    expect(jobRecordSchema.safeParse({ ...job, statusHistory: history.map((event) => ({ ...event, id: eventId(1) })) }).success).toBe(false)
    expect(jobRecordSchema.safeParse({ ...job, statusHistory: history.map((event) => event.status === 'filled' ? { ...event, placement: undefined } : event) }).success).toBe(false)
    expect(jobRecordSchema.safeParse({ ...job, placement: { ...placement, backup3: null } }).success).toBe(false)
    const oversized = Array.from({ length: RECRUITING_LIMITS.statusEvents + 1 }, (_, index) => ({ id: eventId(index), kind: 'status-changed', status: index % 2 ? 'on-hold' : 'open', at: index + 1 }))
    expect(jobRecordSchema.safeParse({ ...legacyJob, updatedAt: 10_000, statusHistory: oversized }).success).toBe(false)
  })

  it('scrubs deleted CV identities in all hiring snapshots while preserving decision dates', () => {
    const removed = pruneJobPlacements(job, new Set([keyB]))
    const tombstone = { recordKey: null, name: null }
    expect(removed.placement).toEqual({ hired: tombstone, backup2: placement.backup2, backup3: tombstone })
    expect(removed.statusHistory![1].placement).toEqual(removed.placement)
    expect(removed.statusHistory!.map(({ id, at, status, kind }) => ({ id, at, status, kind }))).toEqual(job.statusHistory!.map(({ id, at, status, kind }) => ({ id, at, status, kind })))
    expect(JSON.stringify(removed)).not.toContain('Hired person')
    expect(JSON.stringify(removed)).not.toContain('Third person')
    expect(JSON.stringify(removed)).not.toContain(keyA)
    expect(JSON.stringify(removed)).not.toContain(keyC)
    expect(job.placement?.hired.name).toBe('Hired person')
    expect(jobRecordSchema.safeParse(removed).success).toBe(true)
    expect(pruneJobPlacements(removed, new Set([keyB]))).toBe(removed)
    expect(pruneJobPlacements(legacyJob, new Set())).toBe(legacyJob)
  })

  it('cannot retain a removed candidate name beside a tombstone identity', () => {
    const invalidPlacement = { ...placement, hired: { recordKey: null, name: 'Deleted private name' } }
    expect(jobRecordSchema.safeParse({ ...job, placement: invalidPlacement, statusHistory: job.statusHistory!.map((event) => event.placement ? { ...event, placement: invalidPlacement } : event) }).success).toBe(false)
  })

  it('distinguishes removing a deleted backup from keeping its tombstone, but ignores later name corrections', () => {
    expect(samePlacementPeople(placement, { ...placement, hired: { ...placement.hired, name: 'Corrected name' } })).toBe(true)
    expect(samePlacementPeople(placement, { ...placement, backup2: placement.backup3, backup3: placement.backup2 })).toBe(false)
    expect(samePlacementPeople({ ...placement, backup2: { recordKey: null, name: null }, backup3: null }, { ...placement, backup2: null, backup3: null })).toBe(false)
  })
})
