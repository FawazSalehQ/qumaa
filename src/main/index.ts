import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { basename, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CH } from '@shared/channels.js'
import {
  deleteResume,
  getResumeDetail,
  getSetting,
  listResumes,
  setSetting,
  stats as dbStats
} from './db/index.js'
import { embedder, setEntryDir } from './embed/client.js'
import { collectFiles, ingestFile, ingestText } from './ingest/pipeline.js'
import { onWatchIngest, startWatching, stopWatching } from './ingest/watcher.js'
import { search } from './search/rank.js'
import { buildMenu } from './menu.js'
import { restoredBounds, trackWindow } from './windowState.js'
import type { AppSettings, IngestOutcome, IngestProgress } from '@shared/types.js'

const WATCHED_FOLDER_KEY = 'watchedFolder'

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

/** Ingests a list of paths sequentially, streaming progress to the renderer. */
async function ingestPaths(paths: string[]): Promise<IngestOutcome[]> {
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
  ipcMain.handle(CH.resumesList, () => listResumes())

  ipcMain.handle(CH.resumesGet, (_e, id: number) => getResumeDetail(id))

  ipcMain.handle(CH.resumesDelete, (_e, id: number) => {
    deleteResume(id)
  })

  ipcMain.handle(CH.resumesReveal, (_e, path: string) => {
    shell.showItemInFolder(path)
  })

  ipcMain.handle(CH.resumesOpen, async (_e, path: string) => {
    const err = await shell.openPath(path)
    if (err) throw new Error(err)
  })

  ipcMain.handle(CH.ingestFiles, (_e, paths: string[]) => ingestPaths(paths))

  ipcMain.handle(CH.ingestFolder, async (_e, folder: string) => {
    const files = await collectFiles(folder)
    return ingestPaths(files)
  })

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
    ingestText({
      text: args.text,
      fileName: args.label || 'Pasted resume',
      filePath: '',
      fileType: 'pasted'
    })
  )

  ipcMain.handle(CH.searchRun, (_e, jd: string) => search(jd))

  ipcMain.handle(
    CH.settingsGet,
    (): AppSettings => ({ watchedFolder: getSetting(WATCHED_FOLDER_KEY) })
  )

  ipcMain.handle(CH.settingsSetWatchedFolder, async (_e, folder: string | null) => {
    setSetting(WATCHED_FOLDER_KEY, folder)
    if (folder) await startWatching(folder)
    else await stopWatching()
  })

  ipcMain.handle(CH.settingsStats, () => dbStats())
  ipcMain.handle(CH.settingsModelStatus, () => embedder.getStatus())
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

  // Warm the model in the background so the first search is not the slow one.
  embedder.start().catch((err: unknown) => {
    console.error('Embedder failed to start:', err)
  })

  const watched = getSetting(WATCHED_FOLDER_KEY)
  if (watched) {
    startWatching(watched).catch((err: unknown) => console.error('Watcher failed:', err))
  }

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
