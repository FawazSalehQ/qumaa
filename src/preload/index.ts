/**
 * The entire renderer-visible surface. Nothing here exposes ipcRenderer or fs
 * directly, so the renderer can only call these named operations.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH } from '../shared/channels.js'
import { copyResumeRefs, resolveNativeFilePaths } from './bridge-input.js'
import type { RecruitingApi } from '../shared/recruiting.js'
import type {
  AppSettings,
  BackupSummary,
  ClaudeRerankReview,
  DbStats,
  IngestOutcome,
  IngestProgress,
  MenuCommand,
  ModelStatus,
  ResumeDetail,
  ResumeRef,
  MatchResult,
  ResumeSummary,
  SearchResponse
} from '../shared/types.js'

const recruiting: RecruitingApi = {
  listJobs: () => ipcRenderer.invoke(CH.recruitingListJobs),
  saveJob: (input) => ipcRenderer.invoke(CH.recruitingSaveJob, input),
  getJob: (id) => ipcRenderer.invoke(CH.recruitingGetJob, id),
  searchJob: (id) => ipcRenderer.invoke(CH.recruitingSearchJob, id),
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

  search: {
    run: (jobDescription: string): Promise<SearchResponse> =>
      ipcRenderer.invoke(CH.searchRun, jobDescription),
    rerank: (args: {
      sessionId: string
      approvalToken?: string
    }): Promise<MatchResult[]> => ipcRenderer.invoke(CH.searchRerank, args),
    previewRerank: (args: {
      sessionId: string
    }): Promise<ClaudeRerankReview> => ipcRenderer.invoke(CH.searchRerankPreview, args),
    /** Resolves with the saved path, or null if the user cancelled. */
    exportPdf: (args: {
      jobTitle: string
      requiredSkills: string[]
      results: MatchResult[]
    }): Promise<string | null> => ipcRenderer.invoke(CH.searchExport, args)
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
    /** Write-only: the key is never read back into the renderer. */
    setApiKey: (key: string | null): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetApiKey, key),
    protectLegacyApiKey: (): Promise<boolean> =>
      ipcRenderer.invoke(CH.settingsProtectLegacyApiKey),
    setRerank: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetRerank, enabled),
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
