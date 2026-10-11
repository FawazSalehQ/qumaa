import { randomUUID } from 'node:crypto'
import { calculateHiringCosts, HIRING_COST_RULES_VERSION } from '@shared/hiring-costs.js'
import type { SavedHiringBudget } from '@shared/hiring-budget.js'
import type { Company } from '@shared/recruiting.js'
import { getDb } from '../db/index.js'
import { hiringBudgetSchemas, assertHiringBudgetReferences } from './hiring-budget-schema.js'
import { parseRecruiting, type JobRecord } from './schema.js'
import { putRecord, readRecord, readRecords } from './storage.js'

export function listHiringBudgets(companyId: unknown): SavedHiringBudget[] {
  const id = parseRecruiting(hiringBudgetSchemas.companyId, companyId)
  if (!readRecord<Company>(getDb(), 'company', id)) throw new Error('This company no longer exists.')
  return readRecords<SavedHiringBudget>(getDb(), 'hiringBudget').filter((plan) => plan.companyId === id)
    .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
}

export function requireHiringBudget(input: unknown): SavedHiringBudget {
  const args = parseRecruiting(hiringBudgetSchemas.version, input)
  const plan = readRecord<SavedHiringBudget>(getDb(), 'hiringBudget', args.id)
  if (!plan) throw new Error('This hiring budget no longer exists.')
  if (plan.updatedAt !== args.expectedUpdatedAt) throw new Error('This hiring budget changed. Refresh and try again.')
  return plan
}

export function saveHiringBudget(input: unknown): SavedHiringBudget {
  const args = parseRecruiting(hiringBudgetSchemas.save, input)
  const previous = args.id ? requireHiringBudget({ id: args.id, expectedUpdatedAt: args.expectedUpdatedAt }) : null
  if (previous && previous.companyId !== args.companyId) throw new Error('A hiring budget cannot move to another company.')
  assertHiringBudgetReferences(args, new Set(readRecords<Company>(getDb(), 'company').map((company) => company.id)),
    new Map(readRecords<JobRecord>(getDb(), 'job').map((job) => [job.id, job])))
  // Calculate in main, even when a renderer supplied a successful preview.
  calculateHiringCosts(args.inputs)
  const now = Math.max(Date.now(), (previous?.updatedAt ?? -1) + 1)
  const plan: SavedHiringBudget = {
    id: previous?.id ?? randomUUID(), companyId: args.companyId, name: args.name, jobId: args.jobId,
    inputs: args.inputs, calculationVersion: HIRING_COST_RULES_VERSION,
    createdAt: previous?.createdAt ?? now, updatedAt: now
  }
  putRecord(getDb(), 'hiringBudget', plan)
  return plan
}

export function removeHiringBudget(input: unknown): void {
  const plan = requireHiringBudget(input)
  getDb().prepare("DELETE FROM recruiting_records WHERE kind = 'hiringBudget' AND id = ?").run(plan.id)
}
