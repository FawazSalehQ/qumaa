import { writeFile } from 'node:fs/promises'
import { dialog, ipcMain, type BrowserWindow } from 'electron'
import type { Company } from '@shared/recruiting.js'
import { maintenance } from './maintenance.js'
import { currentLanguage, nativeText as t } from './language.js'
import { getDb } from './db/index.js'
import { hiringBudgetCsv } from './export/hiring-budget-csv.js'
import { listHiringBudgets, saveHiringBudget, removeHiringBudget, requireHiringBudget } from './recruiting/hiring-budgets.js'
import { assertHiringBudgetReferences } from './recruiting/hiring-budget-schema.js'
import { readRecord } from './recruiting/storage.js'
import type { JobRecord } from './recruiting/schema.js'

/** Capture canonical data only; renderer calculations and CSV content are never trusted. */
function captureExport(input: unknown): { name: string; csv: string } {
  const plan = requireHiringBudget(input)
  const company = readRecord<Company>(getDb(), 'company', plan.companyId)
  if (!company) throw new Error('This company no longer exists.')
  const job = plan.jobId ? readRecord<JobRecord>(getDb(), 'job', plan.jobId) : null
  assertHiringBudgetReferences(plan, new Set([company.id]), new Map(job ? [[job.id, job]] : []))
  return { name: plan.name, csv: hiringBudgetCsv(plan, company.name, job?.posting.position ?? '', currentLanguage()) }
}

export function registerHiringBudgetHandlers(getWindow: () => BrowserWindow): void {
  ipcMain.handle('hiringBudgets:list', (_event, input: unknown) => maintenance.runOperation(() => listHiringBudgets(input)))
  ipcMain.handle('hiringBudgets:save', (_event, input: unknown) => maintenance.runOperation(() => saveHiringBudget(input)))
  ipcMain.handle('hiringBudgets:remove', (_event, input: unknown) => maintenance.runOperation(() => removeHiringBudget(input)))
  ipcMain.handle('hiringBudgets:exportCsv', async (_event, input: unknown) => {
    const snapshot = await maintenance.runOperation(() => captureExport(input))
    const name = snapshot.name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 120) || 'Hiring budget'
    const { canceled, filePath } = await dialog.showSaveDialog(getWindow(), {
      title: t('Export hiring budget CSV'), defaultPath: `${name}.csv`,
      filters: [{ name: 'CSV', extensions: ['csv'] }]
    })
    if (canceled || !filePath) return null
    await maintenance.runOperation(async () => {
      // The save dialog deliberately releases the maintenance gate. Recheck
      // plan, company, job and language after an edit, wipe or restore.
      if (captureExport(input).csv !== snapshot.csv) throw new Error('This hiring budget changed. Refresh and try again.')
      await writeFile(filePath, snapshot.csv, { encoding: 'utf8', mode: 0o600 })
    })
    return filePath
  })
}
