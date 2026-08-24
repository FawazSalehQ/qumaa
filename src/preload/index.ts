/**
 * The entire renderer-visible surface. Nothing here exposes ipcRenderer or fs
 * directly, so the renderer can only call these named operations.
 */
import { contextBridge, ipcRenderer, webUtils } from 'electron'
import { CH } from '../shared/channels.js'
import type {
  AppSettings,
  DbStats,
  IngestOutcome,
  IngestProgress,
  MenuCommand,
  ModelStatus,
  ResumeDetail,
  MatchResult,
  ResumeSummary,
  SearchResponse
} from '../shared/types.js'

const api = {
  /** Renderer needs this only to match native window chrome. */
  platform: process.platform,

  resumes: {
    list: (): Promise<ResumeSummary[]> => ipcRenderer.invoke(CH.resumesList),
    get: (id: number): Promise<ResumeDetail | null> => ipcRenderer.invoke(CH.resumesGet, id),
    remove: (id: number): Promise<void> => ipcRenderer.invoke(CH.resumesDelete, id),
    /** Resolves with the number actually deleted; 0 means the user cancelled. */
    removeMany: (ids: number[]): Promise<number> =>
      ipcRenderer.invoke(CH.resumesDeleteMany, ids),
    reveal: (path: string): Promise<void> => ipcRenderer.invoke(CH.resumesReveal, path),
    open: (path: string): Promise<void> => ipcRenderer.invoke(CH.resumesOpen, path)
  },

  ingest: {
    files: (paths: string[]): Promise<IngestOutcome[]> => ipcRenderer.invoke(CH.ingestFiles, paths),
    folder: (folder: string): Promise<IngestOutcome[]> =>
      ipcRenderer.invoke(CH.ingestFolder, folder),
    pickFolder: (): Promise<string | null> => ipcRenderer.invoke(CH.ingestPickFolder),
    pickFiles: (): Promise<string[]> => ipcRenderer.invoke(CH.ingestPickFiles),
    text: (text: string, label: string): Promise<IngestOutcome> =>
      ipcRenderer.invoke(CH.ingestText, { text, label }),
    /**
     * Electron removed File.path in v32; this is the supported replacement and
     * must run in the preload, where `webUtils` is available.
     */
    pathForFile: (file: File): string => webUtils.getPathForFile(file)
  },

  search: {
    run: (jobDescription: string): Promise<SearchResponse> =>
      ipcRenderer.invoke(CH.searchRun, jobDescription),
    /** Resolves with the saved path, or null if the user cancelled. */
    rerank: (args: {
      jobDescription: string
      results: MatchResult[]
    }): Promise<MatchResult[]> => ipcRenderer.invoke(CH.searchRerank, args),
    exportPdf: (args: {
      jobTitle: string
      requiredSkills: string[]
      results: MatchResult[]
    }): Promise<string | null> => ipcRenderer.invoke(CH.searchExport, args)
  },

  settings: {
    get: (): Promise<AppSettings> => ipcRenderer.invoke(CH.settingsGet),
    setWatchedFolder: (folder: string | null): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetWatchedFolder, folder),
    setTheme: (theme: AppSettings['theme']): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetTheme, theme),
    /** Write-only: the key is never read back into the renderer. */
    setApiKey: (key: string | null): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetApiKey, key),
    setRerank: (enabled: boolean): Promise<void> =>
      ipcRenderer.invoke(CH.settingsSetRerank, enabled),
    stats: (): Promise<DbStats> => ipcRenderer.invoke(CH.settingsStats),
    modelStatus: (): Promise<ModelStatus> => ipcRenderer.invoke(CH.settingsModelStatus)
  },

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
