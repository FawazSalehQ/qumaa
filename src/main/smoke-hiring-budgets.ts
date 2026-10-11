/** Company hiring-cost plan checks run only in the disposable Electron smoke DB. */
import { randomUUID } from 'node:crypto'
import { HIRING_COST_RULES_VERSION, type HiringCostInputs } from '@shared/hiring-costs.js'
import type { SavedHiringBudget } from '@shared/hiring-budget.js'
import { closeDbForMaintenance, getDb } from './db/index.js'
import { getJob, saveJob } from './recruiting/index.js'
import { listHiringBudgets, removeHiringBudget, requireHiringBudget, saveHiringBudget } from './recruiting/hiring-budgets.js'
import { hiringBudgetCsv } from './export/hiring-budget-csv.js'

type Check = (label: string, ok: boolean, detail?: string) => void
const rejected = (operation: () => unknown): boolean => { try { operation(); return false } catch { return true } }

export function hiringBudgetsSnapshot(): string {
  return JSON.stringify(getDb().prepare("SELECT id,data FROM recruiting_records WHERE kind = 'hiringBudget' ORDER BY id").all())
}

function recruitingState(jobId: string): Record<string, string> {
  const workspace = getJob(jobId)
  // Every getJob read issues a new search-session capability, even when nothing
  // changed. Exclude only that capability; keep all dates, evidence and scores.
  const stableWorkspace = { ...workspace, response: workspace.response ? { ...workspace.response, sessionId: '<per-read capability>' } : null }
  return {
    ...Object.fromEntries(Object.entries(stableWorkspace).map(([key, value]) => [key, JSON.stringify(value)])),
    // Raw records also protect stored fingerprints, status history and any
    // recruiter data not included in this particular workspace response.
    persistedRecords: JSON.stringify(getDb().prepare("SELECT kind,id,data FROM recruiting_records WHERE kind <> 'hiringBudget' ORDER BY kind,id").all())
  }
}

export function smokeHiringBudgets(check: Check, companyId: string, jobId: string, otherCompanyId: string): { snapshot: string; plan: SavedHiringBudget } {
  console.log('\n7a. Company hiring budgets and employment costs')
  const inputs: HiringCostInputs = {
    eligibleSaudiPrivateSector: true,
    salary: { mode: 'combined', basicHalala: 0, housingHalala: 0, combinedHalala: 2_000_000, basicPercentBps: 7500, housingPercentBps: 2500, transportHalala: 100_000 },
    scheme: 'compare', selectedMonth: '2026-07', periodStart: '2026-06', periodEnd: '2026-07', employmentStartMonth: '2026-06', serviceMonthsAtStart: 59, headcount: 2, approvedBudgetHalala: 10_000_000,
    gosi: { minimumWageHalala: 150_000, maximumWageHalala: 4_500_000, limitNote: 'Verified planning limits', registeredWageHalala: 1_900_000, registeredWageNote: 'Verified registered contribution wage supplied by recruiter' },
    eos: { includeBasic: true, includeHousing: true, includeTransport: true }, notes: 'تخطيط التوظيف، دون التأمين الطبي'
  }
  const baseline = recruitingState(jobId)
  const first = saveHiringBudget({ companyId, jobId, name: 'Hiring plan', inputs })
  const standalone = saveHiringBudget({ companyId, jobId: null, name: 'Company growth option', inputs: { ...inputs, headcount: 3, approvedBudgetHalala: null } })
  check('stores multiple independent cost plans with company/job identity and no inherited approved budget', listHiringBudgets(companyId).length === 2 && first.jobId === jobId && standalone.jobId === null && standalone.inputs.approvedBudgetHalala === null && first.calculationVersion === HIRING_COST_RULES_VERSION)
  let plan = saveHiringBudget({ id: first.id, expectedUpdatedAt: first.updatedAt, companyId, jobId, name: 'Revised hiring plan', inputs: { ...inputs, notes: `${inputs.notes}\nApproved for review` } })
  check('edits hiring budgets with stable identity and monotonic dates', plan.id === first.id && plan.createdAt === first.createdAt && plan.updatedAt > first.updatedAt)
  check('rejects stale hiring budget edit, deletion and export versions', [
    () => saveHiringBudget({ id: first.id, expectedUpdatedAt: first.updatedAt, companyId, jobId, name: 'Stale overwrite', inputs }),
    () => removeHiringBudget({ id: first.id, expectedUpdatedAt: first.updatedAt }),
    () => requireHiringBudget({ id: first.id, expectedUpdatedAt: first.updatedAt })
  ].every(rejected) && listHiringBudgets(companyId).some((candidate) => candidate.name === plan.name))
  check('rejects missing company/job, wrong job company, company moves and invalid engine inputs', [
    () => saveHiringBudget({ companyId: randomUUID(), jobId: null, name: 'Missing company', inputs }),
    () => saveHiringBudget({ companyId, jobId: randomUUID(), name: 'Missing job', inputs }),
    () => saveHiringBudget({ companyId: otherCompanyId, jobId, name: 'Wrong company', inputs }),
    () => saveHiringBudget({ id: plan.id, expectedUpdatedAt: plan.updatedAt, companyId: otherCompanyId, jobId: null, name: plan.name, inputs }),
    () => saveHiringBudget({ companyId, jobId, name: plan.name, inputs: { ...inputs, headcount: 0 } }),
    () => saveHiringBudget({ companyId, jobId, name: plan.name, inputs: { ...inputs, gosi: { ...inputs.gosi, registeredWageNote: '' } } })
  ].every(rejected))
  const job = getJob(jobId).job
  let reassignmentError = ''
  try { saveJob({ id: jobId, posting: job.posting, status: job.status, criteria: job.criteria, companyId: null }) } catch (error) { reassignmentError = String(error) }
  check('protects linked plan/company relationships when moving a job', reassignmentError.includes('Detach this job') && getJob(jobId).job.companyId === companyId)
  const detached = saveHiringBudget({ id: plan.id, expectedUpdatedAt: plan.updatedAt, companyId, jobId: null, name: plan.name, inputs: plan.inputs })
  plan = saveHiringBudget({ id: detached.id, expectedUpdatedAt: detached.updatedAt, companyId, jobId, name: detached.name, inputs: detached.inputs })
  check('explicitly detaches and reattaches a job without losing a plan or its assumptions', detached.jobId === null && plan.id === first.id && plan.jobId === jobId && plan.createdAt === first.createdAt && JSON.stringify(plan.inputs) === JSON.stringify(detached.inputs))
  const afterPlanning = recruitingState(jobId)
  const changedFields = Object.keys(baseline).filter((key) => afterPlanning[key] !== baseline[key])
  check('cost planning does not change scoring, reviews, criteria, budgets or job history', changedFields.length === 0, changedFields.length ? `Changed: ${changedFields.join(', ')}` : undefined)
  const disposable = saveHiringBudget({ companyId, jobId: null, name: 'Disposable plan', inputs })
  removeHiringBudget({ id: disposable.id, expectedUpdatedAt: disposable.updatedAt })
  check('removes only the selected plan while keeping other plans, company and job', listHiringBudgets(companyId).length === 2 && !listHiringBudgets(companyId).some((candidate) => candidate.id === disposable.id) && getJob(jobId).job.companyId === companyId)
  const snapshot = hiringBudgetsSnapshot()
  closeDbForMaintenance()
  check('reopens cost-plan inputs, provenance, versions and company/job references unchanged', hiringBudgetsSnapshot() === snapshot && listHiringBudgets(companyId).some((candidate) => candidate.id === plan.id))
  const csv = hiringBudgetCsv(requireHiringBudget({ id: plan.id, expectedUpdatedAt: plan.updatedAt }), 'Company', 'Job', 'ar')
  check('exports canonical Arabic forecast with rates, assumptions, salary and GOSI override provenance', csv.includes('"21000.00","ريال سعودي"') && csv.includes('2026-07-01') && csv.includes(inputs.gosi.registeredWageNote) && csv.includes('التأمين الطبي') && csv.includes('مخصص نهاية الخدمة'))
  return { snapshot, plan }
}
