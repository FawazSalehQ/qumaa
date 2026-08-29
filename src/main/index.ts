import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, isAbsolute, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CH } from '@shared/channels.js'
import {
  dbPath,
  deleteAllData,
  deleteResume,
  deleteResumes,
  getResumeDetail,
  getSetting,
  listResumes,
  setSetting,
  stats as dbStats
} from './db/index.js'
import { embedder, setEntryDir } from './embed/client.js'
import { indexReadiness, type IndexInitializationPhase } from './embed/readiness.js'
import { markEmptyIndexCurrent, needsReindex, reindexAll } from './embed/reindex.js'
import { backfillDocumentVectors } from './ingest/duplicates.js'
import { collectFiles, ingestFile, ingestText } from './ingest/pipeline.js'
import { backfillResumeSkills } from './ingest/skills-backfill.js'
import { onWatchIngest, startWatching, stopWatching } from './ingest/watcher.js'
import { search } from './search/rank.js'
import { shortlistHtml, writeShortlistPdf } from './export/shortlist.js'
import { rerank } from './search/rerank.js'
import { getApiKey, hasApiKey, setApiKey } from './secrets.js'
import { buildMenu } from './menu.js'
import { SharedExclusiveGate } from './shared-exclusive-gate.js'
import { restoredBounds, trackWindow } from './windowState.js'
import type {
  AppSettings,
  IngestOutcome,
  IngestProgress,
  MatchResult,
  ModelStatus
} from '@shared/types.js'

// Test-only isolation hook. UI/package smoke runs with a throwaway absolute
// directory so it cannot read or mutate the developer's real resume library.
const e2eUserData = process.env.QUMAA_E2E_USER_DATA?.trim()
if (e2eUserData) {
  if (!isAbsolute(e2eUserData)) {
    throw new Error('QUMAA_E2E_USER_DATA must be an absolute path.')
  }
  app.setPath('userData', e2eUserData)
}

const WATCHED_FOLDER_KEY = 'watchedFolder'
const THEME_KEY = 'theme'
const RERANK_KEY = 'rerankEnabled'
/** Coordinates complete manual imports with the destructive full-library wipe. */
const libraryMutationGate = new SharedExclusiveGate()

let mainWindow: BrowserWindow | null = null

function createWindow(): void {
  const { options, maximized } = restoredBounds()

  mainWindow = new BrowserWindow({
    ...options,
    minWidth: 940,
    minHeight: 620,
    show: false,
    // `hiddenInset` is macOS-only. On Windows it would hide the title bar
    // *and* the window controls, leaving no way to close the window.
    ...(process.platform === 'darwin' ? { titleBarStyle: 'hiddenInset' as const } : {}),
    backgroundColor: '#ffffff',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  if (maximized) mainWindow.maximize()
  trackWindow(mainWindow)

  mainWindow.on('ready-to-show', () => mainWindow?.show())

  // A window that never paints must not stay invisible: show it anyway and say
  // why, rather than leaving a running app with no UI.
  mainWindow.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`Renderer failed to load (${code} ${desc}): ${url}`)
    mainWindow?.show()
  })
  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    console.error('Renderer process gone:', details.reason)
  })
  mainWindow.webContents.once('did-finish-load', () => mainWindow?.show())

  // Keep navigation inside the app; open real links in the system browser.
  // Only web and mail schemes: handing an arbitrary URL to the OS lets any
  // unexpected scheme (file:, or a registered custom protocol) launch something.
  const OPENABLE = new Set(['http:', 'https:', 'mailto:'])
  const openExternally = (raw: string): void => {
    let scheme: string
    try {
      scheme = new URL(raw).protocol
    } catch {
      return
    }
    if (OPENABLE.has(scheme)) shell.openExternal(raw)
  }

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    openExternally(url)
    return { action: 'deny' }
  })

  // The app is a single local page. Any attempt to navigate it elsewhere is
  // either a bug or an attack, so send it to the browser instead.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault()
      openExternally(url)
    }
  })

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function initializeSearchIndex(
  setPhase: (phase: IndexInitializationPhase) => void
): Promise<void> {
  await embedder.start()

  let rebuilt = false
  // An empty library has no vector provenance to migrate; establish its marker
  // before opening ingestion. A non-empty mismatch must be rebuilt in full.
  const empty = markEmptyIndexCurrent()
  if (!empty && needsReindex()) {
    rebuilt = true
    setPhase('reindexing')
    console.log('Embedding model changed; rebuilding the index.')
    const n = await reindexAll(({ done, total }) => {
      send(CH.evIngestProgress, {
        jobId: 'reindex',
        processed: done,
        total,
        currentFile: 'Updating search index',
        done: done >= total
      } satisfies IngestProgress)
    })
    console.log(`Re-embedded ${n} passages.`)
  }

  // Reindex clears these derived vectors. Older libraries may also have been
  // created before the column existed.
  setPhase('backfilling-vectors')
  const vectorsFilled = backfillDocumentVectors()
  if (vectorsFilled > 0) console.log(`Backfilled ${vectorsFilled} document vectors.`)

  setPhase('backfilling-skills')
  const skills = backfillResumeSkills()
  if (skills.updated > 0) {
    console.log(
      `Refreshed skills for ${skills.updated} resumes (${skills.version.slice(0, 19)}…).`
    )
  }

  if (rebuilt) send(CH.evReindexed, null)
}

function modelStatus(): ModelStatus {
  const readiness = indexReadiness.getStatus()
  if (readiness.state === 'error') return { state: 'error', message: readiness.message }
  if (readiness.state !== 'ready') return { state: 'loading' }
  return embedder.getStatus()
}

/** Ingests a list of paths sequentially, streaming progress to the renderer. */
async function ingestPathsWithoutGate(paths: string[]): Promise<IngestOutcome[]> {
  await indexReadiness.waitUntilReady()
  const jobId = randomUUID()
  const outcomes: IngestOutcome[] = []

  for (const [i, path] of paths.entries()) {
    send(CH.evIngestProgress, {
      jobId,
      processed: i,
      total: paths.length,
      currentFile: basename(path),
      done: false
    } satisfies IngestProgress)

    outcomes.push(await ingestFile(path))
  }

  send(CH.evIngestProgress, {
    jobId,
    processed: paths.length,
    total: paths.length,
    currentFile: '',
    done: true
  } satisfies IngestProgress)

  return outcomes
}

function registerHandlers(): void {
  ipcMain.handle(CH.resumesList, async () => {
    await indexReadiness.waitUntilReady()
    return listResumes()
  })

  ipcMain.handle(CH.resumesGet, async (_e, id: number) => {
    await indexReadiness.waitUntilReady()
    return getResumeDetail(id)
  })

  ipcMain.handle(CH.resumesDelete, async (_e, id: number) => {
    await indexReadiness.waitUntilReady()
    deleteResume(id)
  })

  ipcMain.handle(CH.resumesDeleteMany, async (_e, ids: number[]) => {
    await indexReadiness.waitUntilReady()
    // Destructive and irreversible, so it is confirmed in the main process where
    // the dialog is native and cannot be skipped by the renderer.
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', `Delete ${ids.length}`],
      defaultId: 0,
      cancelId: 0,
      message: `Delete ${ids.length} resume${ids.length === 1 ? '' : 's'}?`,
      detail: 'They are removed from the library. The original files are not touched.'
    })
    if (response !== 1) return 0
    return deleteResumes(ids)
  })

  ipcMain.handle(CH.resumesReveal, (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle(CH.resumesOpen, async (_e, path: string) => {
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  })

  ipcMain.handle(CH.ingestFiles, (_e, paths: string[]) =>
    libraryMutationGate.runShared(() => ingestPathsWithoutGate(paths))
  )

  ipcMain.handle(CH.ingestFolder, (_e, folder: string) =>
    libraryMutationGate.runShared(async () => {
      await indexReadiness.waitUntilReady()
      // Collection belongs inside the shared operation. Otherwise a wipe can
      // land after collection and the saved paths can repopulate the library.
      const files = await collectFiles(folder)
      return ingestPathsWithoutGate(files)
    })
  )

  ipcMain.handle(CH.ingestPickFolder, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: 'Choose a folder of resumes'
    })
    return res.canceled ? null : res.filePaths[0]
  })

  ipcMain.handle(CH.ingestPickFiles, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: 'Choose resumes',
      filters: [{ name: 'Resumes', extensions: ['pdf', 'docx', 'txt', 'md', 'markdown'] }]
    })
    return res.canceled ? [] : res.filePaths
  })

  ipcMain.handle(CH.ingestText, (_e, args: { text: string; label: string }) =>
    libraryMutationGate.runShared(async () => {
      await indexReadiness.waitUntilReady()
      return ingestText({
        text: args.text,
        fileName: args.label || 'Pasted resume',
        filePath: '',
        fileType: 'pasted'
      })
    })
  )

  ipcMain.handle(CH.searchRun, async (_e, jd: string) => {
    await indexReadiness.waitUntilReady()
    return search(jd)
  })

  ipcMain.handle(
    CH.searchExport,
    async (_e, args: { jobTitle: string; requiredSkills: string[]; results: MatchResult[] }) => {
      const safeTitle = args.jobTitle.replace(/[^\p{L}\p{N} _-]/gu, '').trim() || 'Shortlist'
      const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
        title: 'Export shortlist',
        defaultPath: `${safeTitle} shortlist.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }]
      })
      if (canceled || !filePath) return null

      await writeShortlistPdf(
        shortlistHtml({ ...args, generatedAt: new Date() }),
        filePath
      )
      return filePath
    }
  )

  ipcMain.handle(
    CH.settingsGet,
    (): AppSettings => ({
      watchedFolder: getSetting(WATCHED_FOLDER_KEY),
      theme: (getSetting(THEME_KEY) as AppSettings['theme']) ?? 'system',
      rerankEnabled: getSetting(RERANK_KEY) === 'true',
      // The key itself is deliberately not returned: the renderer only needs to
      // know whether one exists.
      hasApiKey: hasApiKey()
    })
  )

  ipcMain.handle(CH.settingsSetApiKey, (_e, key: string | null) => {
    setApiKey(key)
    if (!key) setSetting(RERANK_KEY, 'false')
  })

  ipcMain.handle(CH.settingsSetRerank, (_e, enabled: boolean) => {
    // Cannot enable without a key; silently refusing would look like a bug.
    if (enabled && !hasApiKey()) throw new Error('Add an API key first.')
    setSetting(RERANK_KEY, String(enabled))
  })

  ipcMain.handle(
    CH.searchRerank,
    async (_e, args: { jobDescription: string; results: MatchResult[] }) => {
      const apiKey = getApiKey()
      if (!apiKey) throw new Error('No API key is configured.')
      if (getSetting(RERANK_KEY) !== 'true') throw new Error('Reranking is not enabled.')
      return rerank({ apiKey, ...args })
    }
  )

  ipcMain.handle(CH.settingsSetTheme, (_e, theme: AppSettings['theme']) => {
    setSetting(THEME_KEY, theme)
  })

  ipcMain.handle(CH.settingsSetWatchedFolder, async (_e, folder: string | null) => {
    setSetting(WATCHED_FOLDER_KEY, folder)
    if (folder) await startWatching(folder)
    else await stopWatching()
  })

  // Reveals the app's own data folder. Takes no path from the renderer, so
  // there is nothing here that could be pointed somewhere else.
  ipcMain.handle(CH.settingsRevealData, () => {
    shell.showItemInFolder(dbPath())
  })

  ipcMain.handle(CH.settingsDeleteAll, async () => {
    const { resumeCount } = dbStats()
    // Irreversible, so the confirmation is native and states exactly what goes.
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: ['Cancel', 'Delete everything'],
      defaultId: 0,
      cancelId: 0,
      message: 'Delete all data?',
      detail:
        `This removes all ${resumeCount} resume${resumeCount === 1 ? '' : 's'} from the library, ` +
        'along with your settings, watched folder, and saved API key. ' +
        'The original resume files on disk are not touched. This cannot be undone.'
    })
    if (response !== 1) return false

    return libraryMutationGate.runExclusive(async () => {
      // Existing manual imports finish before exclusive access is granted, and
      // later imports cannot start until deletion and marker repair complete.
      // The watcher has its own invalidation/drain path inside this boundary.
      await stopWatching()
      deleteAllData()
      // Readiness remains open after a wipe, so restore internal provenance for
      // the now-empty index before a new resume can be ingested.
      markEmptyIndexCurrent()
      return true
    })
  })

  ipcMain.handle(CH.settingsStats, () => dbStats())
  ipcMain.handle(CH.settingsModelStatus, () => modelStatus())
}

// Must run from the entry file itself; see setEntryDir's comment.
setEntryDir(__dirname)

app.whenReady().then(async () => {
  registerHandlers()
  onWatchIngest((outcome) => send(CH.evWatchIngest, outcome))
  createWindow()
  // After createWindow: the About panel reads the library count from the database,
  // which is opened lazily on first access.
  buildMenu(() => mainWindow)

  // Model loading, vector migration, and all derived-data backfills form one
  // readiness boundary. Search and every ingest path wait for the entire chain.
  indexReadiness
    .start(initializeSearchIndex)
    .then(async () => {
      const watched = getSetting(WATCHED_FOLDER_KEY)
      if (watched) await startWatching(watched)
    })
    .catch((err: unknown) => {
      console.error('Search index failed to initialize:', err)
    })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Without this, a throw during startup rejects silently: no window is created,
// nothing is logged, and the process simply lingers with no UI.
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled rejection during startup:', reason)
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopWatching()
  embedder.stop()
})
