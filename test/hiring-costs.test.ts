import { describe, expect, it } from 'vitest'
import {
  calculateHiringCosts, DEFAULT_GOSI_MAXIMUM_WAGE_HALALA, DEFAULT_GOSI_MINIMUM_WAGE_HALALA,
  GOSI_NEW_RATE_SCHEDULE, gosiRatesForDate, hiringCostInputsSchema, HIRING_COST_LIMITS_VERSION,
  HIRING_COST_RULES_VERSION, parseHiringCostInputs, type AvailableHiringForecast,
  type AvailableHiringMonth, type HiringCostInputs, type HiringCostResult
} from '../src/shared/hiring-costs.js'

// Fictional fixtures are explicit user-entered data, never application salary defaults.
function inputs(): HiringCostInputs {
  return {
    eligibleSaudiPrivateSector: true,
    salary: { mode: 'components', basicHalala: 1_000_000, housingHalala: 250_000, combinedHalala: 1_250_000, basicPercentBps: 7_500, housingPercentBps: 2_500, transportHalala: 100_000 },
    scheme: 'compare', selectedMonth: '2026-06', periodStart: '2026-01', periodEnd: '2026-12',
    employmentStartMonth: '2026-01', serviceMonthsAtStart: 0, headcount: 1, approvedBudgetHalala: null,
    gosi: { minimumWageHalala: DEFAULT_GOSI_MINIMUM_WAGE_HALALA, maximumWageHalala: DEFAULT_GOSI_MAXIMUM_WAGE_HALALA, limitNote: '', registeredWageHalala: null, registeredWageNote: '' },
    eos: { includeBasic: true, includeHousing: true, includeTransport: true }, notes: ''
  }
}
function month(result: HiringCostResult, scheme: 'existing' | 'new' = 'existing'): AvailableHiringMonth {
  const value = result.selectedMonth.scenarios.find((item) => item.scheme === scheme)
  if (!value?.available) throw new Error(`Expected an available ${scheme} month`)
  return value
}
function forecast(result: HiringCostResult, scheme: 'existing' | 'new' = 'existing'): AvailableHiringForecast {
  const value = result.forecast.scenarios.find((item) => item.scheme === scheme)
  if (!value?.available) throw new Error(`Expected an available ${scheme} forecast`)
  return value
}
function tinyInputs(basicHalala: number): HiringCostInputs {
  const value = inputs()
  value.salary.basicHalala = basicHalala
  value.salary.housingHalala = 0
  value.salary.transportHalala = 0
  value.gosi.minimumWageHalala = 0
  value.gosi.limitNote = 'Synthetic arithmetic fixture with an explicitly configured zero floor.'
  return value
}

describe('shared hiring-cost input validation', () => {
  it('requires explicit eligible category, salary components and all assumptions without salary defaults', () => {
    expect(parseHiringCostInputs(inputs())).toEqual(inputs())
    for (const key of ['eligibleSaudiPrivateSector', 'salary', 'scheme', 'headcount', 'serviceMonthsAtStart', 'gosi', 'eos'] as const) {
      const value = { ...inputs() } as Record<string, unknown>
      delete value[key]
      expect(hiringCostInputsSchema.safeParse(value).success, key).toBe(false)
    }
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), eligibleSaudiPrivateSector: false }).success).toBe(false)
    const missingBasic = { ...inputs().salary } as Record<string, unknown>
    delete missingBasic.basicHalala
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), salary: missingBasic }).success).toBe(false)
  })

  it('rejects noninteger, negative, nonfinite and excessive monetary values at the boundary', () => {
    for (const invalid of [-1, 0.1, NaN, Infinity, -Infinity, 100_000_001, '100']) {
      const value = inputs()
      expect(hiringCostInputsSchema.safeParse({ ...value, salary: { ...value.salary, basicHalala: invalid } }).success, String(invalid)).toBe(false)
    }
    for (const invalid of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity]) {
      expect(hiringCostInputsSchema.safeParse({ ...inputs(), approvedBudgetHalala: invalid }).success).toBe(false)
    }
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), approvedBudgetHalala: 0 }).success).toBe(true)
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), approvedBudgetHalala: Number.MAX_SAFE_INTEGER }).success).toBe(true)
  })

  it('requires valid bounded whole-month periods while allowing prior employer service dates', () => {
    for (const invalid of ['2026-00', '2026-13', '2026-1', '2026-01-01', '2023-12', '2101-01', 'bad']) {
      expect(hiringCostInputsSchema.safeParse({ ...inputs(), selectedMonth: invalid }).success, invalid).toBe(false)
    }
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), employmentStartMonth: '1990-01' }).success).toBe(true)
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), periodStart: '2026-03', periodEnd: '2026-02' }).success).toBe(false)
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), periodStart: '2026-01', periodEnd: '2035-12' }).success).toBe(true)
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), periodStart: '2026-01', periodEnd: '2036-01' }).success).toBe(false)
    for (const invalid of [0, -1, 0.5, 10_001, Infinity]) expect(hiringCostInputsSchema.safeParse({ ...inputs(), headcount: invalid }).success).toBe(false)
    for (const invalid of [-1, 1.5, 1_201]) expect(hiringCostInputsSchema.safeParse({ ...inputs(), serviceMonthsAtStart: invalid }).success).toBe(false)
  })

  it('requires percentages to total exactly 100% and bounds derived combined components', () => {
    const value = inputs()
    value.salary.mode = 'combined'
    value.salary.housingPercentBps = 2_499
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
    value.salary.housingPercentBps = 2_500
    value.salary.basicPercentBps = 7_500.5
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
    value.salary.basicPercentBps = 7_500
    value.salary.combinedHalala = 200_000_000
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
    value.salary.basicPercentBps = value.salary.housingPercentBps = 5_000
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(true)
  })

  it('validates the contribution-wage minimum without silently increasing wage', () => {
    const value = inputs()
    value.salary.basicHalala = 149_999
    value.salary.housingHalala = 0
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
    expect(() => calculateHiringCosts(value)).toThrow()
    value.salary.basicHalala = 150_000
    expect(calculateHiringCosts(value).salary.gosiWageHalala).toBe(150_000)
    value.gosi.minimumWageHalala = 200_000
    value.gosi.maximumWageHalala = 100_000
    value.gosi.limitNote = 'Invalid reversed limits.'
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
  })

  it('requires notes for changed statutory limits and verified registered-wage overrides', () => {
    const value = inputs()
    value.gosi.maximumWageHalala = 4_000_000
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
    value.gosi.limitNote = 'Verified configured planning limit.'
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(true)
    value.gosi.registeredWageHalala = 200_000
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
    value.gosi.registeredWageNote = 'Verified against registration record.'
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(true)
    value.gosi.registeredWageHalala = 149_999
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
    value.gosi.registeredWageHalala = 4_000_001
    expect(hiringCostInputsSchema.safeParse(value).success).toBe(false)
  })

  it('rejects unmodelled costs and forged output fields instead of silently retaining them', () => {
    for (const extra of [{ medicalInsuranceHalala: 50_000 }, { calculatedTotal: 1 }, { currency: 'USD' }]) {
      expect(hiringCostInputsSchema.safeParse({ ...inputs(), ...extra }).success).toBe(false)
    }
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), salary: { ...inputs().salary, medicalInsuranceHalala: 1 } }).success).toBe(false)
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), notes: 'x'.repeat(10_001) }).success).toBe(false)
    expect(hiringCostInputsSchema.safeParse({ ...inputs(), gosi: { ...inputs().gosi, limitNote: 'a\0b' } }).success).toBe(false)
  })
})

describe('effective-dated GOSI rates', () => {
  const transitions = [
    ['2024-07-02', '2024-07-03', null, 975, 1_175],
    ['2025-06-30', '2025-07-01', 975, 1_025, 1_225],
    ['2026-06-30', '2026-07-01', 1_025, 1_075, 1_275],
    ['2027-06-30', '2027-07-01', 1_075, 1_125, 1_325],
    ['2028-06-30', '2028-07-01', 1_125, 1_175, 1_375]
  ] as const

  it.each(transitions)('changes only at the exact %s → %s boundary', (before, after, previousEmployee, employee, employer) => {
    const previous = gosiRatesForDate('new', before)
    if (previousEmployee === null) expect(previous).toBeNull()
    else expect(previous?.employeeTotalBps).toBe(previousEmployee)
    const next = gosiRatesForDate('new', after)!
    expect(next).toMatchObject({ effectiveDate: after, employeeTotalBps: employee, employerTotalBps: employer, employeeSanedBps: 75, employerSanedBps: 75, occupationalHazardsBps: 200 })
    expect(next.employeePensionBps + next.employeeSanedBps).toBe(next.employeeTotalBps)
    expect(next.employerPensionBps + next.employerSanedBps + next.occupationalHazardsBps).toBe(next.employerTotalBps)
  })

  it('keeps existing-scheme classification and rates independent of a new employment date', () => {
    const value = inputs()
    value.scheme = 'existing'
    value.employmentStartMonth = '2028-07'
    value.selectedMonth = '2028-07'
    value.periodStart = value.periodEnd = '2028-07'
    const result = calculateHiringCosts(value)
    expect(result.selectedMonth.scenarios).toHaveLength(1)
    expect(month(result).rates).toMatchObject({ scheme: 'existing', employeeTotalBps: 975, employerTotalBps: 1_175, effectiveDate: '2022-01-01' })
    expect(forecast(result).scheme).toBe('existing')
  })

  it('dates the existing preset to the SANED reduction and does not invent earlier historical rates', () => {
    expect(gosiRatesForDate('existing', '2021-12-31')).toBeNull()
    expect(gosiRatesForDate('existing', '2022-01-01')).toMatchObject({
      effectiveDate: '2022-01-01', employeeTotalBps: 975, employerTotalBps: 1_175,
      employeeSanedBps: 75, employerSanedBps: 75
    })
    expect(gosiRatesForDate('existing', '2030-01-01')?.effectiveDate).toBe('2022-01-01')
  })

  it('does not mutate the central schedule and retains the last scheduled rate in future budgets', () => {
    expect(GOSI_NEW_RATE_SCHEDULE.map((entry) => entry.effectiveDate)).toEqual(transitions.map((entry) => entry[1]))
    const returned = gosiRatesForDate('new', '2030-01-01')!
    expect(returned).toMatchObject({ effectiveDate: '2028-07-01', employeeTotalBps: 1_175, employerTotalBps: 1_375 })
    returned.employeeTotalBps = 0
    expect(gosiRatesForDate('new', '2030-01-01')?.employeeTotalBps).toBe(1_175)
    for (const invalid of ['2026-02-30', '2026-13-01', '2026-07', '2026-7-1', 'not-a-date']) {
      expect(() => gosiRatesForDate('new', invalid)).toThrow()
    }
    expect(gosiRatesForDate('new', '2028-02-29')).not.toBeNull()
  })

  it('marks July 2024 new-scheme months unavailable without inventing selected or forecast totals', () => {
    const value = inputs()
    value.selectedMonth = '2024-07'
    value.periodStart = '2024-06'
    value.periodEnd = '2024-08'
    value.employmentStartMonth = '2024-06'
    const result = calculateHiringCosts(value)
    expect(result.selectedMonth.scenarios[0].available).toBe(true)
    expect(result.selectedMonth.scenarios[1]).toEqual({ available: false, scheme: 'new', month: '2024-07', reason: 'new-scheme-not-effective' })
    const newForecast = result.forecast.scenarios[1]
    expect(newForecast.available).toBe(false)
    expect(newForecast).not.toHaveProperty('totalHalala')
    expect(newForecast).not.toHaveProperty('budgetVarianceHalala')
    expect(newForecast.months.map((row) => row.active && row.available)).toEqual([false, false, true])
    expect(result.assumptions.join(' ')).toContain('August 2024')
  })

  it('does not reject earlier inactive months when a new-scheme hire starts in August 2024', () => {
    const value = inputs()
    value.scheme = 'new'
    value.selectedMonth = '2024-08'
    value.periodStart = '2024-01'
    value.periodEnd = '2024-08'
    value.employmentStartMonth = '2024-08'
    const result = calculateHiringCosts(value)
    expect(result.forecast.activeMonths).toBe(1)
    expect(forecast(result, 'new').months.slice(0, 7)).toEqual(Array.from({ length: 7 }, (_, index) => ({ month: `2024-0${index + 1}`, active: false })))
    expect(forecast(result, 'new').perPersonTotalHalala).toBe(month(result, 'new').employerCostHalala)
  })
})

describe('salary bases and decimal-safe monthly costs', () => {
  it('separates gross, GOSI and EOS bases and reconciles take-home plus employee deductions', () => {
    const result = calculateHiringCosts(inputs())
    expect(result.salary).toMatchObject({ basicHalala: 1_000_000, housingHalala: 250_000, transportHalala: 100_000, grossHalala: 1_350_000, gosiBaseHalala: 1_250_000, gosiWageHalala: 1_250_000, eosWageHalala: 1_350_000 })
    expect(month(result)).toMatchObject({ employeeGosiHalala: 121_875, takeHomeHalala: 1_228_125, employerGosiHalala: 146_875, eosProvisionHalala: 56_250, employerCostHalala: 1_553_125 })
    for (const scheme of ['existing', 'new'] as const) {
      const row = month(result, scheme)
      expect(row.takeHomeHalala + row.employeeGosiHalala).toBe(result.salary.grossHalala)
      expect(row.employerCostHalala).toBe(result.salary.grossHalala + row.employerGosiHalala + row.eosProvisionHalala)
    }
    expect(result.assumptions.join(' ')).toContain('before any other employee deductions')
  })

  it('treats the 75/25 preset as percentages of combined basic plus housing', () => {
    const value = inputs()
    value.salary.mode = 'combined'
    value.salary.combinedHalala = 1_200_000
    const result = calculateHiringCosts(value)
    expect(result.salary).toMatchObject({ basicHalala: 900_000, housingHalala: 300_000, grossHalala: 1_300_000 })
    expect(result.salary.housingHalala).not.toBe(result.salary.basicHalala / 4)
    expect(result.assumptions.join(' ')).toContain('not a statutory requirement')
    value.salary.basicPercentBps = 8_000
    value.salary.housingPercentBps = 2_000
    expect(calculateHiringCosts(value).salary).toMatchObject({ basicHalala: 960_000, housingHalala: 240_000 })
  })

  it('caps only GOSI, retaining uncapped gross and adjustable EOS wages', () => {
    const value = inputs()
    value.salary.basicHalala = 5_000_000
    value.salary.housingHalala = 1_000_000
    value.salary.transportHalala = 300_000
    const result = calculateHiringCosts(value)
    expect(result.salary).toMatchObject({ grossHalala: 6_300_000, gosiBaseHalala: 6_000_000, gosiWageHalala: 4_500_000, eosWageHalala: 6_300_000, gosiCeilingApplied: true })
    expect(month(result).employeeGosiHalala).toBe(438_750)
    expect(month(result).eosProvisionHalala).toBe(262_500)
    value.eos.includeTransport = false
    const adjusted = calculateHiringCosts(value)
    expect(adjusted.salary.eosWageHalala).toBe(6_000_000)
    expect(adjusted.salary.grossHalala).toBe(result.salary.grossHalala)
    expect(adjusted.salary.gosiWageHalala).toBe(result.salary.gosiWageHalala)
  })

  it('lets transport affect gross and EOS without changing any GOSI amount', () => {
    const value = inputs()
    const before = calculateHiringCosts(value)
    value.salary.transportHalala += 24_000
    const after = calculateHiringCosts(value)
    expect(after.salary.grossHalala - before.salary.grossHalala).toBe(24_000)
    expect(after.salary.eosWageHalala - before.salary.eosWageHalala).toBe(24_000)
    for (const scheme of ['existing', 'new'] as const) {
      expect(month(after, scheme).employeeGosiHalala).toBe(month(before, scheme).employeeGosiHalala)
      expect(month(after, scheme).employerGosiHalala).toBe(month(before, scheme).employerGosiHalala)
      expect(month(after, scheme).eosProvisionHalala - month(before, scheme).eosProvisionHalala).toBe(1_000)
      expect(month(after, scheme).employerCostHalala - month(before, scheme).employerCostHalala).toBe(25_000)
    }
  })

  it('honors a documented registered wage without changing gross salary or EOS wage', () => {
    const value = inputs()
    value.salary.basicHalala = 100_000
    value.salary.housingHalala = 0
    value.gosi.registeredWageHalala = 200_000
    value.gosi.registeredWageNote = 'Verified registered wage, subject to special rules.'
    const result = calculateHiringCosts(value)
    expect(result.salary).toMatchObject({ grossHalala: 200_000, gosiBaseHalala: 100_000, gosiWageHalala: 200_000, eosWageHalala: 200_000, gosiWageSource: 'registered', gosiCeilingApplied: false })
    expect(month(result).employeeGosiHalala).toBe(19_500)
    expect(result.assumptions.join(' ')).toContain(value.gosi.registeredWageNote)
  })

  it('rounds exact half-halala ties up and gives the combined split a reconciled residual', () => {
    const value = tinyInputs(200)
    expect(month(calculateHiringCosts(value))).toMatchObject({ employeeGosiHalala: 20, employerGosiHalala: 24, eosProvisionHalala: 8, employerCostHalala: 232 })
    value.salary.basicHalala = 12
    expect(month(calculateHiringCosts(value)).eosProvisionHalala).toBe(1)
    value.salary.mode = 'combined'
    value.salary.combinedHalala = 1
    value.salary.basicPercentBps = value.salary.housingPercentBps = 5_000
    const split = calculateHiringCosts(value).salary
    expect(split.basicHalala).toBe(1)
    expect(split.housingHalala).toBe(0)
    expect(split.basicHalala + split.housingHalala).toBe(1)
  })

  it('rounds monthly line totals per person before summing and multiplying headcount', () => {
    const value = tinyInputs(200)
    value.scheme = 'existing'
    value.headcount = 3
    value.periodStart = '2026-01'
    value.periodEnd = '2026-02'
    const result = calculateHiringCosts(value)
    expect(month(result).headcountEmployerCostHalala).toBe(696)
    expect(forecast(result).perPersonTotalHalala).toBe(464)
    expect(forecast(result).totalHalala).toBe(1_392)
    expect(month(result).annualizedHeadcountEmployerCostHalala).toBe(8_352)
  })
})

describe('actual forecast periods, service and planned headcount', () => {
  it('sums July changes month by month instead of multiplying June by twelve', () => {
    const result = calculateHiringCosts(inputs())
    const annual = forecast(result, 'new')
    const june = annual.months[5]
    const july = annual.months[6]
    expect(june).toMatchObject({ month: '2026-06', rates: { employeeTotalBps: 1_025, employerTotalBps: 1_225 }, employerCostHalala: 1_559_375 })
    expect(july).toMatchObject({ month: '2026-07', rates: { employeeTotalBps: 1_075, employerTotalBps: 1_275 }, employerCostHalala: 1_565_625 })
    expect(annual.perPersonTotalHalala).toBe(6 * 1_559_375 + 6 * 1_565_625)
    expect(month(result, 'new').annualizedEmployerCostHalala).toBe(12 * 1_559_375)
    expect(annual.perPersonTotalHalala).not.toBe(month(result, 'new').annualizedEmployerCostHalala)
    expect(forecast(result).perPersonTotalHalala).toBe(month(result).annualizedEmployerCostHalala)
  })

  it('excludes pre-employment months and compares the approved budget against planned headcount', () => {
    const value = inputs()
    value.employmentStartMonth = '2026-07'
    value.headcount = 4
    value.approvedBudgetHalala = 50_000_000
    const result = calculateHiringCosts(value)
    expect(result.forecast.activeMonths).toBe(6)
    expect(forecast(result, 'new').months.slice(0, 6).every((row) => !row.active)).toBe(true)
    expect(forecast(result, 'new').perPersonTotalHalala).toBe(6 * 1_565_625)
    expect(forecast(result, 'new').totalHalala).toBe(4 * 6 * 1_565_625)
    expect(forecast(result, 'new').budgetVarianceHalala).toBe(50_000_000 - 4 * 6 * 1_565_625)
    value.approvedBudgetHalala = 0
    expect(forecast(calculateHiringCosts(value), 'new').budgetVarianceHalala).toBe(-4 * 6 * 1_565_625)
  })

  it('returns zero period cost when employment begins after the budget ends', () => {
    const value = inputs()
    value.employmentStartMonth = '2027-01'
    value.approvedBudgetHalala = 123_456
    const result = calculateHiringCosts(value)
    expect(result.forecast.activeMonths).toBe(0)
    for (const scheme of ['existing', 'new'] as const) {
      expect(forecast(result, scheme)).toMatchObject({ perPersonTotalHalala: 0, totalHalala: 0, budgetVarianceHalala: 123_456 })
      expect(month(result, scheme).employerCostHalala).toBeGreaterThan(0)
    }
  })

  it('switches EOS at sixty elapsed service months while independently applying July GOSI changes', () => {
    const value = inputs()
    value.periodStart = value.employmentStartMonth = '2026-06'
    value.periodEnd = '2026-07'
    value.serviceMonthsAtStart = 59
    const result = calculateHiringCosts(value)
    expect(month(result).eosDivisor).toBe(24)
    expect(forecast(result).months[0]).toMatchObject({ serviceMonths: 59, eosDivisor: 24, eosProvisionHalala: 56_250 })
    expect(forecast(result).months[1]).toMatchObject({ serviceMonths: 60, eosDivisor: 12, eosProvisionHalala: 112_500 })
    expect(forecast(result, 'new').perPersonTotalHalala).toBe(1_559_375 + 1_565_625 + 56_250)
    value.selectedMonth = '2026-07'
    expect(month(calculateHiringCosts(value)).annualizedEmployerCostHalala).toBe((1_553_125 + 56_250) * 12)
  })

  it('counts service before the forecast and handles every EOS component toggle independently', () => {
    const value = inputs()
    value.employmentStartMonth = '2021-07'
    value.periodStart = '2026-06'
    value.periodEnd = '2026-07'
    expect(forecast(calculateHiringCosts(value)).months).toMatchObject([{ serviceMonths: 59, eosDivisor: 24 }, { serviceMonths: 60, eosDivisor: 12 }])
    value.eos = { includeBasic: false, includeHousing: false, includeTransport: true }
    let result = calculateHiringCosts(value)
    expect(result.salary.eosWageHalala).toBe(100_000)
    expect(month(result).eosProvisionHalala).toBe(4_167)
    value.eos.includeTransport = false
    result = calculateHiringCosts(value)
    expect(result.salary.eosWageHalala).toBe(0)
    expect(month(result).eosProvisionHalala).toBe(0)
    expect(month(result).employeeGosiHalala).toBe(121_875)
  })

  it('remains exact at maximum component, headcount and forecast bounds', () => {
    const value = inputs()
    value.salary.basicHalala = value.salary.housingHalala = value.salary.transportHalala = 100_000_000
    value.headcount = 10_000
    value.periodStart = value.employmentStartMonth = value.selectedMonth = '2030-01'
    value.periodEnd = '2039-12'
    value.serviceMonthsAtStart = 60
    value.gosi.maximumWageHalala = 200_000_000
    value.gosi.limitNote = 'Explicit maximum-bound synthetic calculation.'
    const result = calculateHiringCosts(value)
    expect(result.forecast.activeMonths).toBe(120)
    expect(month(result, 'new').employerCostHalala).toBe(352_500_000)
    expect(forecast(result, 'new').totalHalala).toBe(423_000_000_000_000)
    expect(Number.isSafeInteger(forecast(result, 'new').totalHalala)).toBe(true)
  })

  it('is deterministic, leaves inputs untouched and emits portable versioned assumptions without medical costs', () => {
    const value = inputs()
    value.notes = 'Vacancy-specific planning notes.'
    const before = structuredClone(value)
    const first = calculateHiringCosts(value)
    const second = calculateHiringCosts(value)
    expect(value).toEqual(before)
    expect(first).toEqual(second)
    expect(first.rulesVersion).toBe(HIRING_COST_RULES_VERSION)
    expect(first.limitsVersion).toBe(HIRING_COST_LIMITS_VERSION)
    expect(JSON.parse(JSON.stringify(first))).toEqual(first)
    expect(first.inputs.notes).toBe(value.notes)
    expect(first.assumptions.join(' ')).toContain('excludes medical insurance')
    expect(first.assumptions.join(' ')).toContain('not an employee deduction, immediate payment or exact final settlement')
    for (const row of first.selectedMonth.scenarios) {
      expect(row).not.toHaveProperty('medicalInsuranceHalala')
      expect(row).not.toHaveProperty('otherCostHalala')
    }
  })
})
