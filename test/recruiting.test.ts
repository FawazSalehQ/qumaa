import { describe, expect, it } from 'vitest'
import { deduplicateVersions, emptyProfile, isShortlisted, mergeProfiles, mergeReviews, passageExcerpt, postingText, suggestCriterionEvidence } from '../src/main/recruiting/planning.js'
import { profileRecordSchema, recruitingSchemas, snapshotRecordSchema } from '../src/main/recruiting/schema.js'
import type { CandidateReview } from '../src/shared/recruiting.js'
import type { MatchResult } from '../src/shared/types.js'

const keyA = 'a'.repeat(64)
const keyB = 'b'.repeat(64)
const jobId = 'e48ac3da-1c16-4b85-8267-1dba6515dcae'
const review = (key: string): CandidateReview => ({ jobId, candidateKey: key, status: 'unreviewed', note: '', order: 0, assessments: [], updatedAt: 1 })
function match(recordKey: string, importedAt: number, score: number): MatchResult {
  return { resume: { id: importedAt, recordKey, importedAt, fileName: 'candidate.md', filePath: '', name: null, email: null, phone: null, location: null, yearsExperience: null, educationLevel: null, skills: [] }, score, breakdown: { semantic: score, lexical: 0, skills: 0 }, matchedSkills: [], missingSkills: [], evidence: [] }
}

describe('recruiter workflow rules', () => {
  it('keeps contacted people on the selected shortlist', () => {
    expect(isShortlisted('shortlisted')).toBe(true)
    expect(isShortlisted('contacted')).toBe(true)
    expect(isShortlisted('maybe')).toBe(false)
  })

  it('uses every confirmed job criterion in the matching text without adding eligibility rules', () => {
    expect(postingText({ position: ' Engineer ', jobDescription: '', requirements: 'Python', educationAndCertifications: '' }, [{ id: 'one', text: 'Kubernetes', importance: 'preferred' }])).toBe('Engineer\n\nPython\n\nKubernetes')
  })

  it('represents explicitly linked CVs by the newest version even when its score is lower', () => {
    const old = match(keyA, 1, 0.9)
    const latest = match(keyB, 2, 0.2)
    const other = match('c'.repeat(64), 3, 0.5)
    const grouped = { ...emptyProfile(keyA), recordKeys: [keyA, keyB] }
    expect(deduplicateVersions([old, other, latest], [grouped])).toEqual([other, latest])
    expect(deduplicateVersions([old, latest], [])).toHaveLength(2)
  })

  it('merges compatible recruiter edits and tags without losing either version', () => {
    const primary = { ...emptyProfile(keyA), name: 'Aisha', tags: ['referral'] }
    const version = { ...emptyProfile(keyB), note: 'Available next month', tags: ['referral', 'senior'] }
    expect(mergeProfiles(primary, version)).toMatchObject({ candidateKey: keyA, recordKeys: [keyA, keyB], name: 'Aisha', note: 'Available next month', tags: ['referral', 'senior'] })
    expect(() => mergeProfiles({ ...primary, yearsExperience: 0 }, { ...version, yearsExperience: 4 })).toThrow('yearsExperience')
    expect(() => mergeProfiles({ ...primary, note: 'First note' }, version)).toThrow('note')
    expect(() => mergeProfiles({ ...primary, skills: [] }, { ...version, skills: ['Python'] })).toThrow('skills')
  })

  it('retains compatible review decisions and requirement notes during version linking', () => {
    const left = { ...review(keyA), note: 'Call Monday', assessments: [{ criterionId: 'python', status: 'unreviewed' as const, note: 'Ask about scale' }] }
    const right = { ...review(keyB), status: 'shortlisted' as const, assessments: [{ criterionId: 'python', status: 'confirmed' as const, note: '' }] }
    expect(mergeReviews(left, right)).toMatchObject({ candidateKey: keyA, status: 'shortlisted', note: 'Call Monday', assessments: [{ criterionId: 'python', status: 'confirmed', note: 'Ask about scale' }] })
    expect(() => mergeReviews({ ...left, status: 'not-proceeding' }, right)).toThrow('different decisions')
    expect(() => mergeReviews({ ...left, note: 'Conflicting' }, { ...right, note: 'Another' })).toThrow('different notes')
  })

  it('suggests real requirement passages without inventing evidence for absent terms', () => {
    const actual = 'Built Python APIs and operated Kubernetes clusters for retail payments.'
    const evidence = suggestCriterionEvidence([{ id: 'a', text: 'Python and Kubernetes experience', importance: 'required' }, { id: 'b', text: 'CPA certification', importance: 'preferred' }], [{ section: 'experience', text: actual }])
    expect(evidence[0]).toMatchObject({ criterionId: 'a', passage: { section: 'experience', text: actual, similarity: 1 } })
    expect(evidence[1]).toEqual({ criterionId: 'b', passage: null })
    expect(suggestCriterionEvidence([{ id: 'a', text: 'years of experience', importance: 'required' }], [{ section: 'summary', text: 'Many years of experience' }])[0].passage).toBeNull()
  })

  it('supports Arabic term overlap and prefers work evidence over a matching summary', () => {
    const actual = 'خبرة في إدارة المطاعم وتدريب فرق العمل'
    expect(suggestCriterionEvidence([{ id: 'a', text: 'إدارة المطاعم', importance: 'required' }], [{ section: 'summary', text: 'إدارة المطاعم' }, { section: 'experience', text: actual }])[0].passage?.text).toBe(actual)
  })

  it('bounds long evidence using original-text offsets and intact Unicode', () => {
    const text = `${'مُقدمة '.repeat(1_000)}إدارة المطاعم ${'بنجاح '.repeat(1_000)}`
    const excerpt = passageExcerpt(text, 'إدارة المطاعم')
    expect(excerpt).toContain('إدارة المطاعم')
    expect(excerpt.length).toBeLessThanOrEqual(1_500)
    expect(text).toContain(excerpt)
    const emojiBoundary = `${'x'.repeat(1_499)}😀rest`
    expect(passageExcerpt(emojiBoundary, 'missing')).toBe('x'.repeat(1_499))
  })
})

describe('recruiting trust boundary', () => {
  const posting = { position: 'Engineer', jobDescription: '', requirements: '', educationAndCertifications: '' }
  it('rejects duplicate requirements, oversized notes, forged fields, and stale numeric-only CV references', () => {
    const criterion = { id: 'one', text: 'Python', importance: 'required' }
    expect(recruitingSchemas.saveJob.safeParse({ posting, status: 'open', criteria: [criterion, criterion] }).success).toBe(false)
    const valid = { jobId, resume: { id: 1, recordKey: keyA }, status: 'maybe', note: '', order: -0.5, assessments: [] }
    expect(recruitingSchemas.saveReview.safeParse(valid).success).toBe(true)
    expect(recruitingSchemas.saveReview.safeParse({ ...valid, note: 'x'.repeat(10_001) }).success).toBe(false)
    expect(recruitingSchemas.saveReview.safeParse({ ...valid, resume: { id: 1 } }).success).toBe(false)
    expect(recruitingSchemas.saveReview.safeParse({ ...valid, llmReason: 'forged' }).success).toBe(false)
    expect(recruitingSchemas.saveReview.safeParse({ ...valid, order: Infinity }).success).toBe(false)
  })

  it('validates separate profile provenance and explicit unique CV groups', () => {
    expect(profileRecordSchema.safeParse(emptyProfile(keyA)).success).toBe(true)
    expect(profileRecordSchema.safeParse({ ...emptyProfile(keyA), recordKeys: [keyA, keyA] }).success).toBe(false)
    expect(profileRecordSchema.safeParse({ ...emptyProfile(keyA), recordKeys: [keyB] }).success).toBe(false)
    expect(profileRecordSchema.safeParse({ ...emptyProfile(keyA), filePath: '/tmp/forged' }).success).toBe(false)
    expect(profileRecordSchema.safeParse({ ...emptyProfile(keyA), name: 'A\0B' }).success).toBe(false)
  })

  it('stores only candidate hashes and canonical passage references in snapshots', () => {
    const result = { recordKey: keyA, score: 0.5, breakdown: { semantic: 0.5, lexical: 0, skills: 0 }, matchedSkills: [], missingSkills: [], evidence: [{ ordinal: 0, similarity: 0.5 }] }
    const snapshot = { jobId, libraryFingerprint: keyA, postingFingerprint: keyA, modelFingerprint: keyA, searchedAt: 1, libraryKeys: [keyA], requiredSkills: [], elapsedMs: 1, results: [result] }
    expect(snapshotRecordSchema.safeParse(snapshot).success).toBe(true)
    expect(snapshotRecordSchema.safeParse({ ...snapshot, results: [{ ...result, resume: { filePath: '/tmp/private' } }] }).success).toBe(false)
    expect(snapshotRecordSchema.safeParse({ ...snapshot, results: [{ ...result, evidence: [{ ordinal: 0, similarity: 0.5, text: 'Forged evidence' }] }] }).success).toBe(false)
    expect(snapshotRecordSchema.safeParse({ ...snapshot, results: [result, result] }).success).toBe(false)
  })
})
