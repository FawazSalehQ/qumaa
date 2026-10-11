import { ipcMain } from 'electron'
import { maintenance } from './maintenance.js'
import * as talent from './recruiting/talent.js'

/** Named local operations only; every write validates its bounded input in main. */
export function registerTalentHandlers(): void {
  const handlers: Record<string, (input: unknown) => unknown> = {
    overview: talent.overview,
    ensurePerson: talent.ensurePerson,
    savePerson: talent.savePerson,
    deletePerson: talent.deletePerson,
    linkCv: talent.linkCv,
    previewMerge: talent.previewMerge,
    mergeContacts: talent.mergeContacts,
    saveActivity: talent.saveActivity,
    completeActivity: talent.completeActivity,
    saveAssignment: talent.saveAssignment,
    deleteAssignment: talent.deleteAssignment,
    addSubmission: talent.addSubmission,
    updateSubmission: talent.updateSubmission,
    generateScreening: talent.generateScreening,
    saveScreening: talent.saveScreening,
    deleteScreening: talent.deleteScreening,
    savePool: talent.savePool,
    reviewPool: talent.reviewPool,
    deletePool: talent.deletePool
  }
  for (const [name, handler] of Object.entries(handlers)) {
    ipcMain.handle(`talent:${name}`, (_event, input: unknown) => maintenance.runOperation(() => handler(input)))
  }
}
