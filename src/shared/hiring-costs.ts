import { z } from 'zod'
import { translate, type Language } from './i18n.js'

/** All public money values are integer halalas; all rates are integer basis points. */
export const HIRING_COST_RULES_VERSION = 'saudi-hiring-costs-2024-2028-v1'
export const HIRING_COST_LIMITS_VERSION = 'saudi-gosi-wage-limits-v1'
export const DEFAULT_GOSI_MINIMUM_WAGE_HALALA = 150_000
export const DEFAULT_GOSI_MAXIMUM_WAGE_HALALA = 4_500_000
export const MAX_SALARY_COMPONENT_HALALA = 100_000_000
export const MAX_HIRING_HEADCOUNT = 10_000
export const MAX_FORECAST_MONTHS = 120

export type GosiScheme = 'existing' | 'new'
export interface HiringCostInputs {
  eligibleSaudiPrivateSector: true
  salary: {
    mode: 'components' | 'combined'
    basicHalala: number
    housingHalala: number
    combinedHalala: number
    basicPercentBps: number
    housingPercentBps: number
    transportHalala: number
  }
  scheme: GosiScheme | 'compare'
  selectedMonth: string
  periodStart: string
  periodEnd: string
  employmentStartMonth: string
  serviceMonthsAtStart: number
  headcount: number
  approvedBudgetHalala: number | null
  gosi: {
    minimumWageHalala: number
    maximumWageHalala: number
    limitNote: string
    registeredWageHalala: number | null
    registeredWageNote: string
  }
  eos: { includeBasic: boolean; includeHousing: boolean; includeTransport: boolean }
  notes: string
}

export interface GosiRates {
  scheme: GosiScheme
  /** Start of the selected published rate; earlier historical schedules are not modeled. */
  effectiveDate: string | null
  employeePensionBps: number
  employeeSanedBps: number
  employeeTotalBps: number
  employerPensionBps: number
  employerSanedBps: number
  occupationalHazardsBps: number
  employerTotalBps: number
}

export interface HiringSalaryBreakdown {
  basicHalala: number
  housingHalala: number
  transportHalala: number
  grossHalala: number
  gosiBaseHalala: number
  gosiWageHalala: number
  eosWageHalala: number
  gosiWageSource: 'salary' | 'registered'
  gosiCeilingApplied: boolean
}

export interface AvailableHiringMonth {
  available: true
  scheme: GosiScheme
  month: string
  rates: GosiRates
  serviceMonths: number
  eosDivisor: 24 | 12
  employeeGosiHalala: number
  takeHomeHalala: number
  employerGosiHalala: number
  eosProvisionHalala: number
  employerCostHalala: number
  headcountEmployerCostHalala: number
  annualizedEmployerCostHalala: number
  annualizedHeadcountEmployerCostHalala: number
}
export interface UnavailableHiringMonth {
  available: false
  scheme: GosiScheme
  month: string
  reason: 'new-scheme-not-effective'
}
export type HiringMonthScenario = AvailableHiringMonth | UnavailableHiringMonth
export type HiringForecastMonth = { month: string; active: false } | (HiringMonthScenario & { active: true })
export interface AvailableHiringForecast {
  available: true
  scheme: GosiScheme
  months: HiringForecastMonth[]
  perPersonTotalHalala: number
  totalHalala: number
  /** Positive is remaining, negative is exceeded; compares the full headcount period. */
  budgetVarianceHalala: number | null
}
export interface UnavailableHiringForecast {
  available: false
  scheme: GosiScheme
  months: HiringForecastMonth[]
  reason: 'new-scheme-not-effective'
}
export type HiringForecastScenario = AvailableHiringForecast | UnavailableHiringForecast
export interface HiringCostResult {
  inputs: HiringCostInputs
  salary: HiringSalaryBreakdown
  selectedMonth: { month: string; scenarios: HiringMonthScenario[] }
  forecast: { periodStart: string; periodEnd: string; activeMonths: number; scenarios: HiringForecastScenario[] }
  assumptions: string[]
  rulesVersion: string
  limitsVersion: string
}

const wholeMoney = (maximum: number) => z.number().int().min(0).max(maximum)
const monthSchema = z.string().regex(/^(?:19|20|21)\d{2}-(?:0[1-9]|1[0-2])$/, 'Use a month from 1900-01 through 2199-12.')
const planningMonthSchema = monthSchema.refine((month) => month >= '2024-01' && month <= '2100-12', 'Planning months must be from 2024-01 through 2100-12.')
const noteSchema = z.string().max(10_000).refine((value) => !value.includes('\0'), 'Notes cannot contain NUL characters.')

function monthIndex(month: string): number {
  return Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1
}

/** Half-up rounding for nonnegative money, with exact integer intermediate arithmetic. */
function roundedRatio(value: number, numerator: number, denominator: number): number {
  const scaled = BigInt(value) * BigInt(numerator)
  const divisor = BigInt(denominator)
  const rounded = (scaled * 2n + divisor) / (divisor * 2n)
  return safeNumber(rounded)
}

function safeNumber(value: bigint): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) throw new RangeError('Hiring cost exceeds safe integer bounds.')
  return Number(value)
}

function salaryComponents(input: HiringCostInputs['salary']): { basicHalala: number; housingHalala: number } {
  if (input.mode === 'components') return { basicHalala: input.basicHalala, housingHalala: input.housingHalala }
  const basicHalala = roundedRatio(input.combinedHalala, input.basicPercentBps, 10_000)
  // The residual belongs to housing so the displayed split always reconciles.
  return { basicHalala, housingHalala: input.combinedHalala - basicHalala }
}

export const hiringCostInputsSchema = z.strictObject({
  eligibleSaudiPrivateSector: z.literal(true),
  salary: z.strictObject({
    mode: z.enum(['components', 'combined']),
    basicHalala: wholeMoney(MAX_SALARY_COMPONENT_HALALA),
    housingHalala: wholeMoney(MAX_SALARY_COMPONENT_HALALA),
    combinedHalala: wholeMoney(MAX_SALARY_COMPONENT_HALALA * 2),
    basicPercentBps: z.number().int().min(0).max(10_000),
    housingPercentBps: z.number().int().min(0).max(10_000),
    transportHalala: wholeMoney(MAX_SALARY_COMPONENT_HALALA)
  }),
  scheme: z.enum(['existing', 'new', 'compare']),
  selectedMonth: planningMonthSchema,
  periodStart: planningMonthSchema,
  periodEnd: planningMonthSchema,
  employmentStartMonth: monthSchema,
  serviceMonthsAtStart: z.number().int().min(0).max(1_200),
  headcount: z.number().int().min(1).max(MAX_HIRING_HEADCOUNT),
  approvedBudgetHalala: wholeMoney(Number.MAX_SAFE_INTEGER).nullable(),
  gosi: z.strictObject({
    minimumWageHalala: wholeMoney(MAX_SALARY_COMPONENT_HALALA * 2),
    maximumWageHalala: wholeMoney(MAX_SALARY_COMPONENT_HALALA * 2).min(1),
    limitNote: noteSchema,
    registeredWageHalala: wholeMoney(MAX_SALARY_COMPONENT_HALALA * 2).nullable(),
    registeredWageNote: noteSchema
  }),
  eos: z.strictObject({ includeBasic: z.boolean(), includeHousing: z.boolean(), includeTransport: z.boolean() }),
  notes: noteSchema
}).superRefine((input, context) => {
  const issue = (path: (string | number)[], message: string): void => { context.addIssue({ code: 'custom', path, message }) }
  if (input.salary.basicPercentBps + input.salary.housingPercentBps !== 10_000) issue(['salary', 'housingPercentBps'], 'Basic and housing percentages must total 100%.')
  if (monthIndex(input.periodEnd) < monthIndex(input.periodStart)) issue(['periodEnd'], 'The budget period must end on or after its start month.')
  if (monthIndex(input.periodEnd) - monthIndex(input.periodStart) + 1 > MAX_FORECAST_MONTHS) issue(['periodEnd'], 'The budget period cannot exceed 120 months.')
  if (input.gosi.minimumWageHalala > input.gosi.maximumWageHalala) issue(['gosi', 'minimumWageHalala'], 'The minimum GOSI wage cannot exceed its maximum.')
  if ((input.gosi.minimumWageHalala !== DEFAULT_GOSI_MINIMUM_WAGE_HALALA || input.gosi.maximumWageHalala !== DEFAULT_GOSI_MAXIMUM_WAGE_HALALA) && !input.gosi.limitNote.trim()) issue(['gosi', 'limitNote'], 'Record the basis for changed GOSI wage limits.')
  const salary = salaryComponents(input.salary)
  if (salary.basicHalala > MAX_SALARY_COMPONENT_HALALA || salary.housingHalala > MAX_SALARY_COMPONENT_HALALA) issue(['salary', 'combinedHalala'], 'Each derived salary component must be at most SAR 1,000,000.')
  const wage = input.gosi.registeredWageHalala ?? salary.basicHalala + salary.housingHalala
  if (wage < input.gosi.minimumWageHalala) issue(['gosi', input.gosi.registeredWageHalala === null ? 'minimumWageHalala' : 'registeredWageHalala'], 'The GOSI contribution wage is below the configured minimum; verify the applicable wage or registered override.')
  if (input.gosi.registeredWageHalala !== null) {
    if (!input.gosi.registeredWageNote.trim()) issue(['gosi', 'registeredWageNote'], 'Record the basis for the verified registered GOSI wage.')
    if (wage > input.gosi.maximumWageHalala) issue(['gosi', 'registeredWageHalala'], 'The registered GOSI wage exceeds the configured maximum.')
  }
})

export function parseHiringCostInputs(value: unknown): HiringCostInputs {
  return hiringCostInputsSchema.parse(value)
}

function rates(scheme: GosiScheme, effectiveDate: string | null, pensionBps: number): GosiRates {
  return {
    scheme, effectiveDate, employeePensionBps: pensionBps, employeeSanedBps: 75,
    employeeTotalBps: pensionBps + 75, employerPensionBps: pensionBps,
    employerSanedBps: 75, occupationalHazardsBps: 200, employerTotalBps: pensionBps + 275
  }
}

// GOSI's published SANED reduction to 0.75% per party took effect on
// 2022-01-01; official source and scope are recorded in docs/HIRING-BUDGETS.md.
export const GOSI_EXISTING_RATES: Readonly<GosiRates> = Object.freeze(rates('existing', '2022-01-01', 900))
export const GOSI_NEW_RATE_SCHEDULE: readonly Readonly<GosiRates>[] = Object.freeze([
  rates('new', '2024-07-03', 900), rates('new', '2025-07-01', 950),
  rates('new', '2026-07-01', 1_000), rates('new', '2027-07-01', 1_050),
  rates('new', '2028-07-01', 1_100)
].map((entry) => Object.freeze(entry)))

export function gosiRatesForDate(scheme: GosiScheme, date: string): GosiRates | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RangeError('Use an exact ISO date.')
  const parsed = new Date(`${date}T00:00:00.000Z`)
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) throw new RangeError('Use a valid ISO date.')
  if (scheme === 'existing') return date < GOSI_EXISTING_RATES.effectiveDate! ? null : { ...GOSI_EXISTING_RATES }
  if (scheme !== 'new') throw new RangeError('Unknown GOSI scheme.')
  const entry = [...GOSI_NEW_RATE_SCHEDULE].reverse().find((candidate) => candidate.effectiveDate! <= date)
  return entry ? { ...entry } : null
}

function salaryBreakdown(input: HiringCostInputs): HiringSalaryBreakdown {
  const { basicHalala, housingHalala } = salaryComponents(input.salary)
  const transportHalala = input.salary.transportHalala
  const gosiBaseHalala = basicHalala + housingHalala
  return {
    basicHalala, housingHalala, transportHalala, grossHalala: gosiBaseHalala + transportHalala,
    gosiBaseHalala, gosiWageHalala: input.gosi.registeredWageHalala ?? Math.min(gosiBaseHalala, input.gosi.maximumWageHalala),
    eosWageHalala: (input.eos.includeBasic ? basicHalala : 0) + (input.eos.includeHousing ? housingHalala : 0) + (input.eos.includeTransport ? transportHalala : 0),
    gosiWageSource: input.gosi.registeredWageHalala === null ? 'salary' : 'registered',
    gosiCeilingApplied: input.gosi.registeredWageHalala === null && gosiBaseHalala > input.gosi.maximumWageHalala
  }
}

function calculateMonth(input: HiringCostInputs, salary: HiringSalaryBreakdown, scheme: GosiScheme, month: string): HiringMonthScenario {
  const monthRates = gosiRatesForDate(scheme, `${month}-01`)
  if (!monthRates) return { available: false, scheme, month, reason: 'new-scheme-not-effective' }
  const serviceMonths = input.serviceMonthsAtStart + Math.max(0, monthIndex(month) - monthIndex(input.employmentStartMonth))
  const eosDivisor = serviceMonths < 60 ? 24 : 12
  const employeeGosiHalala = roundedRatio(salary.gosiWageHalala, monthRates.employeeTotalBps, 10_000)
  const employerGosiHalala = roundedRatio(salary.gosiWageHalala, monthRates.employerTotalBps, 10_000)
  const eosProvisionHalala = roundedRatio(salary.eosWageHalala, 1, eosDivisor)
  const employerCostHalala = salary.grossHalala + employerGosiHalala + eosProvisionHalala
  return {
    available: true, scheme, month, rates: monthRates, serviceMonths, eosDivisor,
    employeeGosiHalala, takeHomeHalala: salary.grossHalala - employeeGosiHalala,
    employerGosiHalala, eosProvisionHalala, employerCostHalala,
    headcountEmployerCostHalala: safeNumber(BigInt(employerCostHalala) * BigInt(input.headcount)),
    annualizedEmployerCostHalala: safeNumber(BigInt(employerCostHalala) * 12n),
    annualizedHeadcountEmployerCostHalala: safeNumber(BigInt(employerCostHalala) * 12n * BigInt(input.headcount))
  }
}

/** Pure deterministic forecast. No clock, network, employee data or salary defaults. */
export function calculateHiringCosts(value: HiringCostInputs): HiringCostResult {
  const inputs = parseHiringCostInputs(value)
  const salary = salaryBreakdown(inputs)
  const schemes: GosiScheme[] = inputs.scheme === 'compare' ? ['existing', 'new'] : [inputs.scheme]
  const months: string[] = []
  for (let index = monthIndex(inputs.periodStart); index <= monthIndex(inputs.periodEnd); index++) {
    months.push(`${Math.floor(index / 12).toString().padStart(4, '0')}-${(index % 12 + 1).toString().padStart(2, '0')}`)
  }
  const forecasts: HiringForecastScenario[] = schemes.map((scheme) => {
    const rows: HiringForecastMonth[] = months.map((month) => month < inputs.employmentStartMonth
      ? { month, active: false }
      : { ...calculateMonth(inputs, salary, scheme, month), active: true })
    if (rows.some((row) => row.active && !row.available)) return { available: false, scheme, months: rows, reason: 'new-scheme-not-effective' }
    let sum = 0n
    for (const row of rows) if (row.active && row.available) sum += BigInt(row.employerCostHalala)
    const perPersonTotalHalala = safeNumber(sum)
    const totalHalala = safeNumber(sum * BigInt(inputs.headcount))
    return {
      available: true, scheme, months: rows, perPersonTotalHalala, totalHalala,
      budgetVarianceHalala: inputs.approvedBudgetHalala === null ? null : safeNumber(BigInt(inputs.approvedBudgetHalala) - BigInt(totalHalala))
    }
  })
  return {
    inputs, salary,
    selectedMonth: { month: inputs.selectedMonth, scenarios: schemes.map((scheme) => calculateMonth(inputs, salary, scheme, inputs.selectedMonth)) },
    forecast: { periodStart: inputs.periodStart, periodEnd: inputs.periodEnd, activeMonths: months.filter((month) => month >= inputs.employmentStartMonth).length, scenarios: forecasts },
    rulesVersion: HIRING_COST_RULES_VERSION, limitsVersion: HIRING_COST_LIMITS_VERSION,
    assumptions: [
      'Amounts are integer halalas. Each employee GOSI total, employer GOSI total and monthly end-of-service provision is rounded half-up to the nearest halala before summing or multiplying by headcount.',
      'The combined basic-and-housing split is company configuration, not a statutory requirement. Basic is rounded half-up; housing receives the remaining halalas so the split reconciles.',
      'Rates are selected at the start of each calendar month. Partial months are not supported; the new scheme is first available for a full planning month in August 2024.',
      'Scheme selection depends on contribution history and GOSI classification, not a new job or employer. These presets are restricted to eligible Saudi private-sector employees.',
      'Existing-scheme rates use the specified planning preset; the new scheme uses its effective-dated 2024–2028 schedule, retaining the last scheduled rate after July 2028.',
      'Annualized cost holds the selected month’s salary, GOSI rates and end-of-service provision constant for twelve months; it is a benchmark independent of employment start. The budget-period forecast instead sums active months separately.',
      'Service months at start are elapsed employer service at the expected employment start month. End-of-service provision changes after sixty elapsed service months.',
      'Estimated end-of-service provision is a planning estimate for a future benefit, not an employee deduction, immediate payment or exact final settlement. Final eligible wage and departure circumstances can affect entitlement.',
      'Estimated take-home pay is before any other employee deductions. Employee GOSI deductions are already included in gross salary and are not added to employer cost.',
      'Budgeted employment cost excludes medical insurance and all other cost items. Approved-budget variance compares the approved amount with the entire active budget period for the planned headcount.',
      ...(inputs.gosi.registeredWageHalala !== null ? [`Verified registered GOSI wage override: ${inputs.gosi.registeredWageNote}`] : []),
      ...(inputs.gosi.limitNote.trim() ? [`Configured contribution-wage limits: ${inputs.gosi.limitNote}`] : [])
    ]
  }
}

/** Localize an engine assumption. The two note-bearing lines keep the recruiter's own note verbatim. */
export function localizeHiringAssumption(language: Language, assumption: string): string {
  for (const prefix of ['Verified registered GOSI wage override: ', 'Configured contribution-wage limits: ']) {
    if (assumption.startsWith(prefix)) return translate(language, `${prefix}{note}`, { note: assumption.slice(prefix.length) })
  }
  return translate(language, assumption)
}
