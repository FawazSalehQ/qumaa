import { describe, expect, it } from 'vitest'
import { COMPANY_DETAIL_LIMIT, normalizeCompanyDetailKey } from '../src/shared/recruiting.js'
import {
  assertJobCompanyReferences,
  companyRecordSchema,
  jobBudgetSchema,
  jobHiringBudgetSchema,
  jobRecordSchema,
  recruitingSchemas,
  recordId,
  RECRUITING_LIMITS
} from '../src/main/recruiting/schema.js'

const clientId = '42a27691-487b-4e0c-9c6b-78f8fdd04140'
const targetId = '76c907c0-e1b7-4742-9f3e-3f617273da9a'
const jobId = 'e48ac3da-1c16-4b85-8267-1dba6515dcae'
const company = { name: 'شركة طاقة', industry: 'Energy', location: 'الدمام', website: 'example.com', contactName: 'أحمد', contactEmail: 'recruiter@example.com', note: 'Call next month.\nNew assignment.' }
const budget = { min: 15_000.25, max: 25_000.75, currency: 'SAR', period: 'monthly' as const }
const hiringBudget = { min: 50_000, max: 75_000, currency: 'SAR' }
const target = { companyId: targetId, status: 'to-research' as const, focusRoles: 'Drilling engineers', note: 'Map the regional team.' }
const input = { posting: { position: 'Engineer', jobDescription: '', requirements: '', educationAndCertifications: '' }, status: 'open' as const, criteria: [] }
const job = { ...input, id: jobId, createdAt: 1, updatedAt: 2, lastSearchedAt: null }

describe('companies and job budgets', () => {
  it('normalizes legacy company details without splitting meaningful delimiters', () => {
    const legacy = { ...company, industry: '  Energy, Construction / Consulting  ', location: 'Riyadh, Saudi Arabia', contactName: 'أحمد / مدير التوظيف', contactEmail: 'first@example.com; second@example.com' }
    expect(recruitingSchemas.saveCompany.parse(legacy)).toEqual({ ...legacy,
      industry: ['Energy, Construction / Consulting'], location: ['Riyadh, Saudi Arabia'],
      contactName: ['أحمد / مدير التوظيف'], contactEmail: ['first@example.com; second@example.com'] })
    expect(recruitingSchemas.saveCompany.parse({ ...company, industry: '', location: '   ', contactName: '', contactEmail: '' })).toMatchObject({ industry: [], location: [], contactName: [], contactEmail: [] })
  })

  it('accepts ordered multiple details while preserving arbitrary industries, names and legacy email text', () => {
    const details = { ...company, industry: ['  Arts and Culture ', 'Mining'], location: ['الرياض', 'Jeddah, Saudi Arabia'], contactName: ['أحمد', 'Mary O’Neil'], contactEmail: ['Hiring team <hr@example.com>', 'مكتب الموارد البشرية'] }
    const normalized = recruitingSchemas.saveCompany.parse(details)
    expect(normalized).toEqual({ ...details, industry: ['Arts and Culture', 'Mining'] })
    const stored = companyRecordSchema.parse({ ...normalized, id: clientId, createdAt: 1, updatedAt: 2 })
    expect(companyRecordSchema.parse(stored)).toEqual(stored)
    expect(stored.id).toBe(clientId)
    expect(stored.createdAt).toBe(1)
  })

  it('rejects empty, controlled, duplicate or oversized array entries in every company detail field', () => {
    const atLimit = Array.from({ length: COMPANY_DETAIL_LIMIT }, (_, index) => `Detail ${index}`)
    for (const field of ['industry', 'location', 'contactName', 'contactEmail'] as const) {
      expect(recruitingSchemas.saveCompany.safeParse({ ...company, [field]: atLimit }).success).toBe(true)
      expect(recruitingSchemas.saveCompany.safeParse({ ...company, [field]: [] }).success).toBe(true)
      expect(recruitingSchemas.saveCompany.safeParse({ ...company, [field]: ['x'.repeat(512)] }).success).toBe(true)
      for (const invalid of [
        [...atLimit, 'One too many'], [''], ['   '], ['a\0b'], ['a\nb'], ['x'.repeat(513)],
        ['Energy', ' energy '], ['Ｃｏｎｓｕｌｔｉｎｇ', 'consulting'], ['Café', 'Cafe\u0301'],
        ['أحمد', 'أحمد'], [42], null
      ]) expect(recruitingSchemas.saveCompany.safeParse({ ...company, [field]: invalid }).success).toBe(false)
    }
    expect(normalizeCompanyDetailKey('  ＥＮＥＲＧＹ  ')).toBe('energy')
  })

  it('reads legacy persisted company strings as arrays without changing identities or dates', () => {
    const legacy = { ...company, id: clientId, createdAt: 1, updatedAt: 2 }
    expect(companyRecordSchema.parse(legacy)).toEqual({ ...legacy, industry: [company.industry], location: [company.location], contactName: [company.contactName], contactEmail: [company.contactEmail] })
    expect(legacy.industry).toBe('Energy')
  })

  it('accepts bilingual company details and keeps immutable identity/times out of IPC edits', () => {
    expect(recruitingSchemas.saveCompany.parse({ ...company, name: '  شركة طاقة  ' }).name).toBe(company.name)
    const stored = companyRecordSchema.parse({ ...company, id: clientId, createdAt: 1, updatedAt: 2 })
    expect(recordId('company', stored)).toBe(clientId)
    expect(recruitingSchemas.saveCompany.safeParse(stored).success).toBe(false)
    expect(companyRecordSchema.safeParse({ ...stored, updatedAt: 0 }).success).toBe(false)
  })

  it('rejects blank names, oversized values, unknown fields, and embedded controls', () => {
    for (const change of [
      { name: '  ' }, { name: 'x'.repeat(513) }, { name: 'Company\nName' },
      { website: 'x'.repeat(2_049) }, { contactEmail: 'a\0b' },
      { note: 'x'.repeat(10_001) }, { note: 'a\0b' }, { apiKey: 'secret' }
    ]) expect(recruitingSchemas.saveCompany.safeParse({ ...company, ...change }).success).toBe(false)
  })

  it('accepts exact money ranges including zero, fractional cents-safe values, and the upper bound', () => {
    expect(jobBudgetSchema.parse(budget)).toEqual(budget)
    for (const value of [0, 0.01, 0.29, 19.99, 999_999_999.99, 1e9]) {
      expect(jobBudgetSchema.safeParse({ ...budget, min: value, max: value }).success).toBe(true)
    }
    for (const period of ['monthly', 'annual', 'hourly']) {
      expect(jobBudgetSchema.safeParse({ ...budget, period }).success).toBe(true)
    }
  })

  it('rejects reversed, non-finite, negative, excessive, or over-precise money ranges', () => {
    for (const change of [
      { min: budget.max + 1 }, { min: -0.01 }, { min: Infinity }, { max: NaN },
      { max: 1e9 + 0.01 }, { min: 0.001 }, { max: 999_999_999.999 },
      { currency: 'sar' }, { currency: 'USDT' }, { currency: 'SＲR' },
      { period: 'weekly' }, { total: 1 }, { min: '15000' }
    ]) expect(jobBudgetSchema.safeParse({ ...budget, ...change }).success).toBe(false)
  })

  it('keeps total hiring budgets independent of salary periods and enforces the same money bounds', () => {
    expect(jobHiringBudgetSchema.parse(hiringBudget)).toEqual(hiringBudget)
    for (const value of [0, 0.01, 0.29, 999_999_999.99, 1e9]) {
      expect(jobHiringBudgetSchema.safeParse({ min: value, max: value, currency: 'USD' }).success).toBe(true)
    }
    for (const change of [
      { min: 75_001 }, { min: -0.01 }, { min: Infinity }, { max: NaN },
      { max: 1e9 + 0.01 }, { min: 0.001 }, { max: 999_999_999.999 },
      { currency: 'sar' }, { currency: 'USDT' }, { currency: 'SＲR' },
      { period: 'monthly' }, { min: '50000' }
    ]) expect(jobHiringBudgetSchema.safeParse({ ...hiringBudget, ...change }).success).toBe(false)
    expect(recruitingSchemas.saveJob.parse({ ...input, hiringBudget }).budget).toBeUndefined()
    expect(recruitingSchemas.saveJob.parse({ ...input, budget }).hiringBudget).toBeUndefined()
  })

  it('reads legacy jobs without inventing company or budget metadata and permits explicit clearing', () => {
    expect(jobRecordSchema.parse(job)).toEqual(job)
    expect(recruitingSchemas.saveJob.parse(input)).toEqual(input)
    const cleared = { ...input, companyId: null, budget: null, hiringBudget: null, targetCompanies: [] }
    expect(recruitingSchemas.saveJob.parse(cleared)).toEqual(cleared)
    const enriched = { ...input, companyId: clientId, budget, hiringBudget, targetCompanies: [target] }
    expect(recruitingSchemas.temporarySearch.parse(enriched)).toEqual(enriched)
    expect(jobRecordSchema.parse({ ...job, ...enriched }).budget).toEqual(budget)
    expect(jobRecordSchema.parse({ ...job, ...enriched }).hiringBudget).toEqual(hiringBudget)
  })
})

describe('target company map trust boundary', () => {
  const change = { jobId, expectedUpdatedAt: 2, companies: [target] }

  it('requires a specific job version and a unique bounded map with valid progress states', () => {
    expect(recruitingSchemas.saveTargetCompanies.parse(change)).toEqual(change)
    for (const status of ['to-research', 'researching', 'mapped', 'excluded']) {
      expect(recruitingSchemas.saveTargetCompanies.safeParse({ ...change, companies: [{ ...target, status }] }).success).toBe(true)
    }
    for (const edited of [
      { ...change, expectedUpdatedAt: undefined }, { ...change, expectedUpdatedAt: -1 },
      { ...change, companies: [target, target] }, { ...change, companies: [{ ...target, status: 'contacted' }] },
      { ...change, companies: [{ ...target, companyId: 'not-a-company-id' }] },
      { ...change, companies: [{ ...target, focusRoles: 'x'.repeat(2_001) }] },
      { ...change, companies: [{ ...target, note: 'x'.repeat(10_001) }] },
      { ...change, companies: [{ ...target, hidden: true }] }
    ]) expect(recruitingSchemas.saveTargetCompanies.safeParse(edited).success).toBe(false)
    const targets = Array.from({ length: RECRUITING_LIMITS.targetCompanies }, (_, index) => ({
      ...target, companyId: `42a27691-487b-4e0c-9c6b-${index.toString().padStart(12, '0')}`
    }))
    expect(recruitingSchemas.saveTargetCompanies.safeParse({ ...change, companies: targets }).success).toBe(true)
    expect(recruitingSchemas.saveTargetCompanies.safeParse({ ...change, companies: [...targets, target] }).success).toBe(false)
  })

  it('rejects a dangling client or target reference when saving or restoring', () => {
    expect(() => assertJobCompanyReferences({ companyId: clientId, targetCompanies: [target] }, new Set([clientId, targetId]))).not.toThrow()
    expect(() => assertJobCompanyReferences({}, new Set())).not.toThrow()
    expect(() => assertJobCompanyReferences({ companyId: clientId }, new Set())).toThrow('unknown company')
    expect(() => assertJobCompanyReferences({ targetCompanies: [target] }, new Set([clientId]))).toThrow('target company')
  })

  it('rejects the hiring company in its own map, including forged persisted records', () => {
    expect(() => assertJobCompanyReferences({ companyId: targetId, targetCompanies: [target] }, new Set([targetId]))).toThrow('hiring company')
    expect(jobRecordSchema.safeParse({ ...job, companyId: targetId, targetCompanies: [target] }).success).toBe(false)
  })
})
