import { z } from 'zod'
import { HIRING_COST_RULES_VERSION, hiringCostInputsSchema } from '@shared/hiring-costs.js'
import type { SavedHiringBudget } from '@shared/hiring-budget.js'

const uuid = z.string().uuid()
const timestamp = z.number().int().nonnegative().max(8.64e15)
const fields = {
  companyId: uuid,
  name: z.string().trim().min(1).max(512).refine((value) => !/[\u0000-\u001f\u007f]/.test(value), 'must not contain control characters'),
  jobId: uuid.nullable(),
  inputs: hiringCostInputsSchema
}

export const hiringBudgetSchemas = {
  companyId: uuid,
  version: z.strictObject({ id: uuid, expectedUpdatedAt: timestamp }),
  save: z.strictObject({ ...fields, id: uuid.optional(), expectedUpdatedAt: timestamp.optional() })
    .refine((value) => !!value.id === (value.expectedUpdatedAt !== undefined), 'Edits require the current hiring budget version.')
}

export const hiringBudgetRecordSchema = z.strictObject({
  id: uuid, ...fields, calculationVersion: z.string().max(100).refine((value): boolean => value === HIRING_COST_RULES_VERSION, 'Unsupported hiring budget calculation version.'), createdAt: timestamp, updatedAt: timestamp
}).refine((value) => value.updatedAt >= value.createdAt, 'Updated date cannot precede creation.')

export function assertHiringBudgetReferences(
  plan: Pick<SavedHiringBudget, 'companyId' | 'jobId'>,
  companyIds: ReadonlySet<string>,
  jobs: ReadonlyMap<string, { companyId?: string | null }>
): void {
  if (!companyIds.has(plan.companyId)) throw new Error('The hiring budget references an unknown company.')
  if (plan.jobId !== null && (!jobs.has(plan.jobId) || jobs.get(plan.jobId)?.companyId !== plan.companyId)) {
    throw new Error('The hiring budget job must belong to its company.')
  }
}
