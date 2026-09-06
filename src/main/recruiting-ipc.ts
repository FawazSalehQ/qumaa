import { dialog, ipcMain, type BrowserWindow } from 'electron'
import { writeFile } from 'node:fs/promises'
import { CH } from '@shared/channels.js'
import { indexReadiness } from './embed/readiness.js'
import { maintenance } from './maintenance.js'
import * as recruiting from './recruiting/index.js'
import { recruitingSchemas } from './recruiting/schema.js'
import { parseIpc } from './ipc-validation.js'
import { shortlistHtml, writeShortlistPdf } from './export/shortlist.js'
import { shortlistCsv } from './export/shortlist-csv.js'
import { currentLanguage, nativeText as t } from './language.js'

/** Reading/editing recruiter records stays available if model startup fails. */
function operation<T>(work: () => T | Promise<T>): Promise<T> {
  return maintenance.runOperation(work)
}

export function registerRecruitingHandlers(getWindow: () => BrowserWindow): void {
  ipcMain.handle(CH.recruitingListJobs, () => operation(recruiting.listJobs))
  ipcMain.handle(CH.recruitingSaveJob, (_event, input: unknown) =>
    operation(() => recruiting.saveJob(input)))
  ipcMain.handle(CH.recruitingGetJob, (_event, input: unknown) =>
    operation(() => recruiting.getJob(input)))
  ipcMain.handle(CH.recruitingGetEvidence, (_event, input: unknown) =>
    operation(() => recruiting.getEvidence(input)))
  ipcMain.handle(CH.recruitingSearchJob, async (_event, input: unknown) => {
    await indexReadiness.waitUntilReady()
    return operation(() => recruiting.searchJob(input))
  })
  ipcMain.handle(CH.recruitingSaveReview, (_event, input: unknown) =>
    operation(() => recruiting.saveReview(input)))
  ipcMain.handle(CH.recruitingReorderShortlist, (_event, input: unknown) =>
    operation(() => recruiting.reorderShortlist(input)))
  ipcMain.handle(CH.recruitingListProfiles, () => operation(recruiting.listProfiles))
  ipcMain.handle(CH.recruitingSaveProfile, (_event, input: unknown) =>
    operation(() => recruiting.saveProfile(input)))
  ipcMain.handle(CH.recruitingLinkVersions, (_event, input: unknown) =>
    operation(() => recruiting.linkVersions(input)))
  ipcMain.handle(CH.recruitingUnlinkVersion, (_event, input: unknown) =>
    operation(() => recruiting.unlinkVersion(input)))

  ipcMain.handle(CH.recruitingExportShortlist, async (_event, input: unknown) => {
    const args = parseIpc(recruitingSchemas.exportShortlist, input, 'shortlist export')
    // Capture the exact selected shortlist before the save dialog yields.
    const shortlist = await operation(() => recruiting.getShortlistExport(args.jobId))
    const title = shortlist.jobTitle.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || t('Shortlist')
    const { canceled, filePath } = await dialog.showSaveDialog(getWindow(), {
      title: t("Export selected shortlist"),
      defaultPath: `${title} ${t('shortlist')}.${args.format}`,
      filters: [{ name: args.format === 'pdf' ? 'PDF' : t('CSV (Excel compatible)'), extensions: [args.format] }]
    })
    if (canceled || !filePath) return null
    await operation(async () => {
      if (JSON.stringify(recruiting.getShortlistExport(args.jobId)) !== JSON.stringify(shortlist)) {
        throw new Error('The shortlist changed while the save dialog was open. Review it and export again.')
      }
      if (args.format === 'pdf') {
        await writeShortlistPdf(shortlistHtml({ ...shortlist, language: currentLanguage(), generatedAt: new Date(), curated: true }), filePath)
      } else {
        await writeFile(filePath, shortlistCsv(shortlist, currentLanguage()), { encoding: 'utf8', mode: 0o600 })
      }
    })
    return filePath
  })
}
