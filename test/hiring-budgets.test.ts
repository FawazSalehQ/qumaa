import { describe, expect, it } from 'vitest'
import { calculateHiringCosts, HIRING_COST_RULES_VERSION, type HiringCostInputs } from '../src/shared/hiring-costs.js'
import { hiringBudgetCsv } from '../src/main/export/hiring-budget-csv.js'
import { assertHiringBudgetReferences, hiringBudgetRecordSchema, hiringBudgetSchemas } from '../src/main/recruiting/hiring-budget-schema.js'
import { recordId, RECORD_LIMITS } from '../src/main/recruiting/schema.js'

const companyId = 'ea37bf97-8061-47c3-ae65-9dc80b384c45'
const jobId = '7922caa8-1946-4b39-930d-195e05db47b0'
const inputs: HiringCostInputs = {
  eligibleSaudiPrivateSector: true,
  salary: { mode: 'components', basicHalala: 1_500_000, housingHalala: 500_000, combinedHalala: 0, basicPercentBps: 7500, housingPercentBps: 2500, transportHalala: 100_000 },
  scheme: 'compare', selectedMonth: '2026-07', periodStart: '2026-06', periodEnd: '2026-07', employmentStartMonth: '2026-06', serviceMonthsAtStart: 59, headcount: 2, approvedBudgetHalala: 1,
  gosi: { minimumWageHalala: 150_000, maximumWageHalala: 4_500_000, limitNote: '', registeredWageHalala: null, registeredWageNote: '' },
  eos: { includeBasic: true, includeHousing: true, includeTransport: true }, notes: '=HYPERLINK("https://example.test")\nPrivate note'
}
const input = { companyId, jobId, name: 'موازنة الفريق', inputs }
const plan = { ...input, id: '9a54b53f-b718-4eeb-84cc-f714e02577f5', calculationVersion: HIRING_COST_RULES_VERSION, createdAt: 1, updatedAt: 2 }

describe('saved company hiring budgets', () => {
  it('keeps calculations out of renderer writes and requires matching edit versions', () => {
    expect(hiringBudgetSchemas.save.parse(input)).toEqual(input)
    expect(hiringBudgetSchemas.save.parse({ ...input, id: plan.id, expectedUpdatedAt: 2 })).toMatchObject(input)
    for (const change of [{ id: plan.id }, { expectedUpdatedAt: 2 }, { calculationVersion: plan.calculationVersion }, { total: 100 }, { name: '  ' }, { name: 'x\ny' }, { name: 'x'.repeat(513) }]) {
      expect(hiringBudgetSchemas.save.safeParse({ ...input, ...change }).success).toBe(false)
    }
    expect(hiringBudgetSchemas.version.safeParse({ id: plan.id, expectedUpdatedAt: 8.64e15 + 1 }).success).toBe(false)
  })

  it('validates stored versions, times and all calculation inputs before restoration', () => {
    const stored = hiringBudgetRecordSchema.parse(plan)
    expect(recordId('hiringBudget', stored)).toBe(plan.id)
    expect(RECORD_LIMITS.hiringBudget).toBe(1000)
    for (const change of [{ calculationVersion: 'future-engine' }, { updatedAt: 0 }, { createdAt: 8.64e15 + 1 }, { inputs: { ...inputs, headcount: 0 } }, { inputs: { ...inputs, periodEnd: '2025-01' } }]) {
      expect(hiringBudgetRecordSchema.safeParse({ ...plan, ...change }).success).toBe(false)
    }
  })

  it('requires existing companies and matching job ownership while allowing company-only plans', () => {
    const companies = new Set([companyId])
    const jobs = new Map([[jobId, { companyId }]])
    expect(() => assertHiringBudgetReferences(plan, companies, jobs)).not.toThrow()
    expect(() => assertHiringBudgetReferences({ ...plan, jobId: null }, companies, new Map())).not.toThrow()
    expect(() => assertHiringBudgetReferences(plan, new Set(), jobs)).toThrow('unknown company')
    expect(() => assertHiringBudgetReferences(plan, companies, new Map())).toThrow('must belong')
    expect(() => assertHiringBudgetReferences(plan, companies, new Map([[jobId, { companyId: 'another-company' }]]))).toThrow('must belong')
  })
})

describe('auditable hiring budget CSV', () => {
  it('exports exact engine money, effective dates, forecast rows and original assumptions', () => {
    const result = calculateHiringCosts(inputs)
    const csv = hiringBudgetCsv(plan, 'Acme', 'Engineer', 'en')
    expect(csv.startsWith('\ufeff"Field","Value","Unit"\r\n')).toBe(true)
    expect(csv).toContain('"Salary / Gross salary","21000.00","SAR"')
    expect(csv).toContain('"10.75","%"')
    expect(csv).toContain('2026-07-01')
    expect(csv).toContain('Annualized per-person cost at constant month assumptions')
    expect(csv).toContain('Actual budget-period forecast / Scenarios / 2 / Monthly forecast / 2 / Monthly employer cost per person')
    expect(csv).toContain('"-') // generated negative numeric variance remains a numeric value
    expect(csv).toContain(result.assumptions[0])
    expect(csv).toContain('"Inputs / Approved budget for headcount and period","0.01","SAR"')
  })

  it('escapes quoted/formula content and localizes Arabic labels and assumptions', () => {
    const csv = hiringBudgetCsv({ ...plan, name: '  +SUM(1,2)' }, '@Acme', '\t=1+1', 'ar')
    expect(csv).toContain('"الحقل","القيمة","الوحدة"')
    expect(csv).toContain('"\'  +SUM(1,2)"')
    expect(csv).toContain('"\'@Acme"')
    expect(csv).toContain('"\'\t=1+1"')
    expect(csv).toContain('"\'=HYPERLINK(""https://example.test"")\nPrivate note"')
    expect(csv).toContain('"21000.00","ريال سعودي"')
    expect(csv).toContain('النظام الجديد')
    expect(csv).toContain('تستبعد تكلفة التوظيف المقدرة التأمين الطبي')
    expect(csv).not.toContain('Amounts are integer halalas')
  })

  it('preserves exact upper-bound approved budget halalas and refuses unsupported calculation versions', () => {
    const csv = hiringBudgetCsv({ ...plan, inputs: { ...inputs, approvedBudgetHalala: Number.MAX_SAFE_INTEGER } }, 'Acme', '', 'en')
    expect(csv).toContain('"90071992547409.91","SAR"')
    expect(() => hiringBudgetCsv({ ...plan, calculationVersion: 'old-unhandled' }, '', '', 'en')).toThrow('Unsupported')
  })
})
