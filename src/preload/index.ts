/**
 * The entire renderer-visible surface. Nothing here exposes ipcRenderer or fs
 * directly, so the renderer can only call these named operations.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH } from '../shared/channels.js'
import { copyResumeRefs, resolveNativeFilePaths } from './bridge-input.js'
import type { RecruitingApi } from '../shared/recruiting.js'
import type { HiringBudgetsApi } from '../shared/hiring-budget.js'
import type { TalentApi } from '../shared/talent.js'
import type { ClientPackApi } from '../shared/client-pack.js'
import type { RerankConfig, RerankProvider } from '../shared/rerank.js'
import type {
  AppSettings,
  BackupSummary,
  DbStats,
  IngestOutcome,
  IngestProgress,
  MenuCommand,
  ModelStatus,
  ResumeDetail,
  ResumeRef,
  ResumeSummary
} from '../shared/types.js'

const recruiting: RecruitingApi = {
  listCompanies: () => ipcRenderer.invoke(CH.recruitingListCompanies),
  saveCompany: (input) => ipcRenderer.invoke(CH.recruitingSaveCompany, input),
  saveTargetCompanies: (input) => ipcRenderer.invoke(CH.recruitingSaveTargetCompanies, input),
  listJobs: () => ipcRenderer.invoke(CH.recruitingListJobs),
  saveJob: (input) => ipcRenderer.invoke(CH.recruitingSaveJob, input),
  changeJobStatus: (input) => ipcRenderer.invoke(CH.recruitingChangeJobStatus, {
    ...input,
    ...(input.placement ? { placement: {
      hired: copyResumeRefs([input.placement.hired])[0],
      ...(input.placement.backup2 ? { backup2: copyResumeRefs([input.placement.backup2])[0] } : {}),
      ...(input.placement.backup3 ? { backup3: copyResumeRefs([input.placement.backup3])[0] } : {})
    } } : {})
  }),
  getJob: (id) => ipcRenderer.invoke(CH.recruitingGetJob, id),
  searchJob: (id) => ipcRenderer.invoke(CH.recruitingSearchJob, id),
  searchTemporary: (input) => ipcRenderer.invoke(CH.recruitingSearchTemporary, input),
  saveTemporary: (input) => ipcRenderer.invoke(CH.recruitingSaveTemporary, input),
  discardTemporary: (id) => ipcRenderer.invoke(CH.recruitingDiscardTemporary, id),
  exportTemporary: (input) => ipcRenderer.invoke(CH.recruitingExportTemporary, input),
  previewRerank: (input) => ipcRenderer.invoke(CH.recruitingRerankPreview, input),
  rerank: (input) => ipcRenderer.invoke(CH.recruitingRerank, input),
  getEvidence: (input) => ipcRenderer.invoke(CH.recruitingGetEvidence, {
    jobId: input.jobId, resumes: copyResumeRefs(input.resumes)
  }),
  saveReview: (input) => ipcRenderer.invoke(CH.recruitingSaveReview, {
    ...input, resume: copyResumeRefs([input.resume])[0]
  }),
  reorderShortlist: (input) => ipcRenderer.invoke(CH.recruitingReorderShortlist, {
    jobId: input.jobId, resumes: copyResumeRefs(input.resumes)
  }),
  listProfiles: () => ipcRenderer.invoke(CH.recruitingListProfiles),
  saveProfile: (input) => ipcRenderer.invoke(CH.recruitingSaveProfile, {
    ...input, resume: copyResumeRefs([input.resume])[0]
  }),
  linkVersions: (input) => ipcRenderer.invoke(CH.recruitingLinkVersions, {
    primary: copyResumeRefs([input.primary])[0], version: copyResumeRefs([input.version])[0]
  }),
  unlinkVersion: (input) => ipcRenderer.invoke(CH.recruitingUnlinkVersion, {
    resume: copyResumeRefs([input.resume])[0]
  }),
  exportShortlist: (input) => ipcRenderer.invoke(CH.recruitingExportShortlist, input)
}

const talent: TalentApi = {
  overview: () => ipcRenderer.invoke('talent:overview'),
  ensurePerson: (resume) => ipcRenderer.invoke('talent:ensurePerson', copyResumeRefs([resume])[0]),
  savePerson: (input) => ipcRenderer.invoke('talent:savePerson', input),
  deletePerson: (input) => ipcRenderer.invoke('talent:deletePerson', input),
  linkCv: (input) => ipcRenderer.invoke('talent:linkCv', { ...input, resume: copyResumeRefs([input.resume])[0] }),
  previewMerge: (input) => ipcRenderer.invoke('talent:previewMerge', input),
  mergeContacts: (input) => ipcRenderer.invoke('talent:mergeContacts', input),
  saveActivity: (input) => ipcRenderer.invoke('talent:saveActivity', input),
  completeActivity: (input) => ipcRenderer.invoke('talent:completeActivity', input),
  saveAssignment: (input) => ipcRenderer.invoke('talent:saveAssignment', input),
  deleteAssignment: (input) => ipcRenderer.invoke('talent:deleteAssignment', input),
  addSubmission: (input) => ipcRenderer.invoke('talent:addSubmission', input),
  updateSubmission: (input) => ipcRenderer.invoke('talent:updateSubmission', input),
  generateScreening: (input) => ipcRenderer.invoke('talent:generateScreening', input),
  saveScreening: (input) => ipcRenderer.invoke('talent:saveScreening', input),
  deleteScreening: (input) => ipcRenderer.invoke('talent:deleteScreening', input),
  savePool: (input) => ipcRenderer.invoke('talent:savePool', input),
  reviewPool: (input) => ipcRenderer.invoke('talent:reviewPool', input),
  deletePool: (input) => ipcRenderer.invoke('talent:deletePool', input)
}

const clientPack: ClientPackApi = {
  source: (jobId, personIds) => ipcRenderer.invoke('clientPack:source', { jobId, personIds }),
  preview: (config) => ipcRenderer.invoke('clientPack:preview', config),
  export: (input) => ipcRenderer.invoke('clientPack:export', input)
}

const hiringBudgets: HiringBudgetsApi = {
  list: (companyId) => ipcRenderer.invoke('hiringBudgets:list', companyId),
  save: (input) => ipcRenderer.invoke('hiringBudgets:save', input),
  remove: (input) => ipcRenderer.invoke('hiringBudgets:remove', input),
  exportCsv: (input) => ipcRenderer.invoke('hiringBudgets:exportCsv', input)
}

const api = {
  /** Renderer needs this only to match native window chrome. */
  platform: process.platform,

  resumes: {
    list: (): Promise<ResumeSummary[]> => ipcRenderer.invoke(CH.resumesList),
    get: (resume: ResumeRef): Promise<ResumeDetail | null> =>
      ipcRenderer.invoke(CH.resumesGet, { id: resume.id, recordKey: resume.recordKey }),
    remove: (resume: ResumeRef): Promise<boolean> =>
      ipcRenderer.invoke(CH.resumesDelete, { id: resume.id, recordKey: resume.recordKey }),
    /** Resolves with the number actually deleted; 0 means the user cancelled. */
    removeMany: (resumes: ResumeRef[]): Promise<number> =>
      ipcRenderer.invoke(
        CH.resumesDeleteMany,
        copyResumeRefs(resumes)
      ),
    reveal: (resume: ResumeRef): Promise<void> =>
      ipcRenderer.invoke(CH.resumesReveal, { id: resume.id, recordKey: resume.recordKey }),
    open: (resume: ResumeRef): Promise<void> =>
      ipcRenderer.invoke(CH.resumesOpen, { id: resume.id, recordKey: resume.recordKey })
  },

  ingest: {
    /** Native-backed File objects are resolved inside preload. Arbitrary path
        strings supplied by a compromised renderer never reach main. */
    files: (files: File[]): Promise<IngestOutcome[]> =>
      ipcRenderer.invoke(
        CH.ingestFiles,
        resolveNativeFilePaths(files, (file) => webUtils.getPathForFile(file as File))
      ),
    folder: (): Promise<IngestOutcome[]> => ipcRenderer.invoke(CH.ingestFolder),
    pickFiles: (): Promise<IngestOutcome[]> => ipcRenderer.invoke(CH.ingestPickFiles),
    text: (text: string, label: string): Promise<IngestOutcome> =>
      ipcRenderer.invoke(CH.ingestText, { text, label }),
  },

  settings: {
    /** Opens only the creator's fixed profile in the user's browser. */
    openLinkedIn: (): Promise<void> => ipcRenderer.invoke(CH.settingsOpenLinkedIn),
    get: (): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsGet),
    chooseWatchedFolder: (): Promise<string | null> =>
      ipcRenderer.invoke(CH.settingsChooseWatchedFolder),
    stopWatchingFolder: (): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetWatchedFolder, null),
    setTheme: (theme: AppSettings['theme']): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetTheme, theme),
    setLanguage: (language: AppSettings['language']): Promise<AppSettings['language']> =>
      ipcRenderer.invoke(CH.settingsSetLanguage, language),
    /** Write-only: the key is never read back into the renderer. */
    setApiKey: (key: string | null, provider: RerankProvider = 'anthropic'): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetApiKey, key, provider),
    protectLegacyApiKey: (provider: RerankProvider = 'anthropic'): Promise<boolean> =>
      ipcRenderer.invoke(CH.settingsProtectLegacyApiKey, provider),
    setRerank: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetRerank, enabled),
    setRerankConfig: (config: RerankConfig): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetRerankConfig, config),
    resetRerankConsent: (): Promise<void> =>
      ipcRenderer.invoke(CH.settingsResetRerankConsent),
    stats: (): Promise<DbStats> => ipcRenderer.invoke(CH.settingsStats),
    modelStatus: (): Promise<ModelStatus> => ipcRenderer.invoke(CH.settingsModelStatus),
    /** No path argument: main reveals its own data folder, not one the
        renderer names. */
    revealData: (): Promise<void> => ipcRenderer.invoke(CH.settingsRevealData),
    /** Native dialogs choose the paths; the renderer never supplies one. */
    backup: (): Promise<BackupSummary | null> => ipcRenderer.invoke(CH.settingsBackup),
    restore: (): Promise<BackupSummary | null> => ipcRenderer.invoke(CH.settingsRestore),
    /** Resolves true when the user confirmed and the wipe happened. */
    deleteAll: (): Promise<boolean> => ipcRenderer.invoke(CH.settingsDeleteAll)
  },

  recruiting,
  talent,
  clientPack,
  hiringBudgets,

  on: {
    ingestProgress: (cb: (p: IngestProgress) => void): (() => void) => {
      const handler = (_e: unknown, p: IngestProgress): void => cb(p)
      ipcRenderer.on(CH.evIngestProgress, handler)
      return () => ipcRenderer.removeListener(CH.evIngestProgress, handler)
    },
    reindexed: (cb: () => void): (() => void) => {
      const handler = (): void => cb()
      ipcRenderer.on(CH.evReindexed, handler)
      return () => ipcRenderer.removeListener(CH.evReindexed, handler)
    },
    watchIngest: (cb: (o: IngestOutcome) => void): (() => void) => {
      const handler = (_e: unknown, o: IngestOutcome): void => cb(o)
      ipcRenderer.on(CH.evWatchIngest, handler)
      return () => ipcRenderer.removeListener(CH.evWatchIngest, handler)
    },
    menuCommand: (cb: (c: MenuCommand) => void): (() => void) => {
      const handler = (_e: unknown, c: MenuCommand): void => cb(c)
      ipcRenderer.on(CH.evMenuCommand, handler)
      return () => ipcRenderer.removeListener(CH.evMenuCommand, handler)
    }
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
