import type { HiringCostInputs } from './hiring-costs.js'

/** A company-owned plan. Calculated amounts are always derived from these inputs. */
export interface SavedHiringBudget {
  id: string
  companyId: string
  name: string
  jobId: string | null
  inputs: HiringCostInputs
  calculationVersion: string
  createdAt: number
  updatedAt: number
}

export interface SaveHiringBudgetInput {
  id?: string
  expectedUpdatedAt?: number
  companyId: string
  name: string
  jobId: string | null
  inputs: HiringCostInputs
}

export interface HiringBudgetVersion {
  id: string
  expectedUpdatedAt: number
}

export interface HiringBudgetsApi {
  list(companyId: string): Promise<SavedHiringBudget[]>
  save(input: SaveHiringBudgetInput): Promise<SavedHiringBudget>
  remove(input: HiringBudgetVersion): Promise<void>
  exportCsv(input: HiringBudgetVersion): Promise<string | null>
}
