import { app, BrowserWindow, dialog, ipcMain, protocol, session, shell } from 'electron'
import { readFile, realpath, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, join, relative, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { CH } from '@shared/channels.js'
import {
  dbPath,
  deleteAllData,
  deleteResume,
  deleteResumes,
  getResumeFilePath,
  getResumeDetail,
  getSetting,
  listResumes,
  setSetting,
  stats as dbStats
} from './db/index.js'
import {
  commitRestore,
  discardStagedRestore,
  exportPortableBackup,
  installStagedPortableRestore,
  rollbackRestore,
  stagePortableRestore
} from './db/backup.js'
import { embedder, setEntryDir } from './embed/client.js'
import { indexReadiness } from './embed/readiness.js'
import { markEmptyIndexCurrent, needsReindex, reindexAll } from './embed/reindex.js'
import { backfillDocumentVectors } from './ingest/duplicates.js'
import { SUPPORTED_EXTENSIONS } from './ingest/extract.js'
import { collectFiles, ingestFile, ingestText } from './ingest/pipeline.js'
import { backfillResumeSkills } from './ingest/skills-backfill.js'
import { backfillResumeDerivedData } from './ingest/derived-backfill.js'
import {
  onWatchIngest,
  startWatching,
  stopWatching,
  withWatcherLifecycle
} from './ingest/watcher.js'
import { searchSessions } from './search/sessions.js'
import { isChatGptConfig, rerankConsentKey } from '@shared/rerank.js'
import { CHATGPT_USAGE_URL } from '@shared/chatgpt.js'
import {
  acknowledgeChatGptWelcome, cancelChatGptSignIn, getChatGptStatus,
  invalidateChatGptOperations, refreshChatGptModels, selectChatGptAccount,
  setChatGptChangeHandler, signInChatGpt, signOutChatGpt
} from './chatgpt/index.js'
import {
  clearProviderRerankConsent,
  getRerankConfig,
  getRerankModels,
  getChatGptModel,
  hasRerankCredential,
  rerankConsentValue,
  RERANK_ENABLED_KEY,
  setRerankConfig
} from './search/rerank-settings.js'
import {
  finishPendingSecretCleanup,
  getApiKeyStatus,
  hasApiKey,
  hasPendingSecretCleanup,
  protectLegacyApiKey,
  setApiKey
} from './secrets.js'
import { buildMenu } from './menu.js'
import { currentLanguage, LANGUAGE_KEY, nativeText as t } from './language.js'
import { registerRecruitingHandlers } from './recruiting-ipc.js'
import { registerTalentHandlers } from './talent-ipc.js'
import { registerClientPackHandlers } from './client-pack-ipc.js'
import { registerHiringBudgetHandlers } from './hiring-budget-ipc.js'
import { ipcSchemas, parseIpc } from './ipc-validation.js'
import { maintenance } from './maintenance.js'
import { restoredBounds, trackWindow } from './windowState.js'
import { showStartupRecovery } from './startup-recovery.js'
import type {
  AppSettings,
  IngestOutcome,
  IngestProgress,
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
const RENDERER_SCHEME = 'qumaa'
const RENDERER_ORIGIN = `${RENDERER_SCHEME}://app`
const RENDERER_PARTITION = 'qumaa-ui'
const RENDERER_CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  "connect-src 'self'",
  "form-action 'none'",
  "frame-src 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "webrtc 'block'"
].join('; ')

// Chromium 150 implements WebRTC blocking through Connection-Allowlist behind
// these two features. Preserve flags supplied by Electron/test tooling rather
// than replacing them: losing an existing flag can silently change runtime
// behaviour in an otherwise unrelated subsystem.
const enabledChromiumFeatures = new Set(
  app.commandLine
    .getSwitchValue('enable-features')
    .split(',')
    .map((feature) => feature.trim())
    .filter(Boolean)
)
enabledChromiumFeatures.add('ConnectionAllowlists')
enabledChromiumFeatures.add('OverrideConnectionAllowlistOriginTrial')
app.commandLine.appendSwitch('enable-features', [...enabledChromiumFeatures].join(','))

// Register before app readiness so Chromium gives the packaged UI an ordinary,
// secure origin. Unlike file://, this origin has no ambient access to the rest
// of the user's filesystem.
protocol.registerSchemesAsPrivileged([
  {
    scheme: RENDERER_SCHEME,
    privileges: {
      standard: true,
      secure: true,
      codeCache: true
    }
  }
])

let mainWindow: BrowserWindow | null = null

function isWithinDirectory(root: string, candidate: string): boolean {
  const remainder = relative(root, candidate)
  return (
    remainder !== '..' &&
    !remainder.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) &&
    !isAbsolute(remainder)
  )
}

function isPackagedRendererUrl(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl)
    return (
      url.protocol === `${RENDERER_SCHEME}:` &&
      url.hostname === 'app' &&
      url.username === '' &&
      url.password === '' &&
      url.port === ''
    )
  } catch {
    return false
  }
}

function rendererContentType(path: string): string {
  switch (extname(path).toLowerCase()) {
    case '.html':
      return 'text/html; charset=utf-8'
    case '.js':
      return 'text/javascript; charset=utf-8'
    case '.css':
      return 'text/css; charset=utf-8'
    case '.json':
      return 'application/json; charset=utf-8'
    case '.svg':
      return 'image/svg+xml'
    case '.png':
      return 'image/png'
    case '.woff':
      return 'font/woff'
    case '.woff2':
      return 'font/woff2'
    default:
      return 'application/octet-stream'
  }
}

async function installRendererProtocol(): Promise<void> {
  const rendererRoot = await realpath(join(__dirname, '../renderer'))

  session.fromPartition(RENDERER_PARTITION).protocol.handle(RENDERER_SCHEME, async (request) => {
    try {
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(null, { status: 405 })
      }

      if (!isPackagedRendererUrl(request.url)) {
        return new Response(null, { status: 404 })
      }
      const url = new URL(request.url)

      const decodedPath = decodeURIComponent(url.pathname)
      if (decodedPath.includes('\0') || decodedPath.includes('\\')) {
        return new Response(null, { status: 404 })
      }
      const relativeAsset = decodedPath === '/' ? 'index.html' : decodedPath.replace(/^\/+/, '')
      const candidate = resolve(rendererRoot, relativeAsset)
      if (!isWithinDirectory(rendererRoot, candidate)) {
        return new Response(null, { status: 404 })
      }

      // Resolve packaged/local symlinks before serving and re-check containment.
      const canonical = await realpath(candidate)
      if (!isWithinDirectory(rendererRoot, canonical) || !(await stat(canonical)).isFile()) {
        return new Response(null, { status: 404 })
      }

      const bytes = request.method === 'HEAD' ? null : await readFile(canonical)
      return new Response(bytes, {
        status: 200,
        headers: {
          'Content-Type': rendererContentType(canonical),
          'Content-Security-Policy': RENDERER_CONTENT_SECURITY_POLICY,
          'Connection-Allowlist': '(response-origin); webrtc=block',
          'X-Content-Type-Options': 'nosniff'
        }
      })
    } catch {
      return new Response(null, { status: 404 })
    }
  })
}

function trustedDevRendererUrl(): string | null {
  if (app.isPackaged || !process.env.ELECTRON_RENDERER_URL) return null
  const url = new URL(process.env.ELECTRON_RENDERER_URL)
  if (
    url.protocol !== 'http:' ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  ) {
    throw new Error('ELECTRON_RENDERER_URL must use an HTTP loopback address.')
  }
  return url.toString()
}

function installRendererRequestPolicy(window: BrowserWindow, devRendererUrl: string | null): void {
  const dev = devRendererUrl ? new URL(devRendererUrl) : null

  window.webContents.session.webRequest.onBeforeRequest((details, callback) => {
    let allowed = isPackagedRendererUrl(details.url)
    if (dev) {
      try {
        const requested = new URL(details.url)
        allowed =
          requested.hostname === dev.hostname &&
          requested.port === dev.port &&
          (requested.protocol === 'http:' || requested.protocol === 'ws:')
      } catch {
        allowed = false
      }
    }
    callback({ cancel: !allowed })
  })
}

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
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      // A dedicated in-memory session lets the request policy below deny every
      // renderer-originated request without affecting main-process integrations.
      partition: RENDERER_PARTITION
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

  // Qumaa's renderer has no external links. Deny every new window instead of
  // giving a compromised renderer an operating-system URL handler as an
  // outbound channel.
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  // The app is a single local page. Any attempt to navigate it elsewhere is
  // either a bug or an attack, so block it outright.
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url !== mainWindow?.webContents.getURL()) {
      event.preventDefault()
    }
  })
  mainWindow.webContents.on('will-frame-navigate', (event) => {
    if (!event.isMainFrame || event.url !== mainWindow?.webContents.getURL()) {
      event.preventDefault()
    }
  })
  mainWindow.webContents.on('will-attach-webview', (event) => event.preventDefault())

  const devRendererUrl = trustedDevRendererUrl()
  installRendererRequestPolicy(mainWindow, devRendererUrl)
  if (devRendererUrl) {
    mainWindow.loadURL(devRendererUrl)
  } else {
    mainWindow.loadURL(`${RENDERER_ORIGIN}/index.html`)
  }
}

function send(channel: string, payload: unknown): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, payload)
  }
}

async function initializeSearchIndex(): Promise<void> {
  await embedder.start()

  const derived = await backfillResumeDerivedData(({ done, total }) => {
    send(CH.evIngestProgress, {
      jobId: 'derivation', processed: done, total, currentFile: 'Updating search index', done: done >= total
    } satisfies IngestProgress)
  })
  let rebuilt = derived > 0
  if (rebuilt) console.log(`Updated sections and extracted fields for ${derived} resumes.`)
  // An empty library has no vector provenance to migrate; establish its marker
  // before opening ingestion. A non-empty mismatch must be rebuilt in full.
  const empty = markEmptyIndexCurrent()
  if (!empty && needsReindex()) {
    rebuilt = true
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
  const vectorsFilled = backfillDocumentVectors()
  if (vectorsFilled > 0) console.log(`Backfilled ${vectorsFilled} document vectors.`)

  const skills = backfillResumeSkills()
  if (skills.updated > 0) {
    console.log(
      `Refreshed skills for ${skills.updated} resumes (${skills.version.slice(0, 19)}…).`
    )
  }

  if (rebuilt) send(CH.evReindexed, null)
  searchSessions.clear()
}

function didImport(outcome: IngestOutcome): boolean {
  return outcome.status === 'imported' || outcome.status === 'near-duplicate'
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
  setChatGptChangeHandler(() => {
    searchSessions.clearApprovals()
    // A new account or permission grant never enables outbound matching itself.
    if (isChatGptConfig(getRerankConfig())) setSetting(RERANK_ENABLED_KEY, 'false')
    // Plan consent values include the connection revision, invalidating prior notices.
  })
  registerRecruitingHandlers(() => mainWindow!)
  registerTalentHandlers()
  registerClientPackHandlers(() => mainWindow!)
  registerHiringBudgetHandlers(() => mainWindow!)
  ipcMain.handle(CH.settingsOpenLinkedIn, () =>
    shell.openExternal('https://www.linkedin.com/in/fawazsalehq/')
  )
  ipcMain.handle(CH.resumesList, async () => {
    await indexReadiness.waitUntilReady()
    return maintenance.runOperation(listResumes)
  })

  ipcMain.handle(CH.resumesGet, async (_e, rawId: unknown) => {
    const ref = parseIpc(ipcSchemas.resumeRef, rawId, 'resume reference')
    await indexReadiness.waitUntilReady()
    return maintenance.runOperation(() => getResumeDetail(ref))
  })

  ipcMain.handle(CH.resumesDelete, async (_e, rawId: unknown) => {
    const ref = parseIpc(ipcSchemas.resumeRef, rawId, 'resume reference')
    await indexReadiness.waitUntilReady()
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: [t('Cancel'), t('Delete resume')],
      defaultId: 0,
      cancelId: 0,
      message: t("Delete this resume?"),
      detail: t("It is removed from the library. The original file is not touched.")
    })
    if (response !== 1) return false
    return maintenance.runOperation(() => {
      const deleted = deleteResume(ref)
      if (!deleted) throw new Error('The resume changed or no longer exists. Refresh the library.')
      searchSessions.clear()
      return true
    })
  })

  ipcMain.handle(CH.resumesDeleteMany, async (_e, rawIds: unknown) => {
    const refs = parseIpc(ipcSchemas.resumeRefs, rawIds, 'resume references')
    await indexReadiness.waitUntilReady()
    // Destructive and irreversible, so it is confirmed in the main process where
    // the dialog is native and cannot be skipped by the renderer.
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: [t('Cancel'), t('Delete {count}', { count: refs.length })],
      defaultId: 0,
      cancelId: 0,
      message: t(refs.length === 1 ? 'Delete {count} resume?' : 'Delete {count} resumes?', { count: refs.length }),
      detail: t("They are removed from the library. The original files are not touched.")
    })
    if (response !== 1) return 0
    return maintenance.runOperation(() => {
      const deleted = deleteResumes(refs)
      if (deleted > 0) searchSessions.clear()
      return deleted
    })
  })

  ipcMain.handle(CH.resumesReveal, async (_e, rawId: unknown) => {
    const ref = parseIpc(ipcSchemas.resumeRef, rawId, 'resume reference')
    return maintenance.runOperation(() => {
      const path = getResumeFilePath(ref)
      if (!path) throw new Error('The original resume file is not available.')
      shell.showItemInFolder(path)
    })
  })

  ipcMain.handle(CH.resumesOpen, async (_e, rawId: unknown) => {
    const ref = parseIpc(ipcSchemas.resumeRef, rawId, 'resume reference')
    return maintenance.runOperation(async () => {
      const path = getResumeFilePath(ref)
      if (!path) throw new Error('The original resume file is not available.')
      const err = await shell.openPath(path)
      if (err) throw new Error(err)
    })
  })

  ipcMain.handle(CH.ingestFiles, (_e, rawPaths: unknown) => {
    const paths = parseIpc(ipcSchemas.resumePaths, rawPaths, 'resume paths')
    return maintenance.runOperation(async () => {
      const outcomes = await ingestPathsWithoutGate(paths)
      if (outcomes.some(didImport)) searchSessions.clear()
      return outcomes
    })
  })

  ipcMain.handle(CH.ingestFolder, async () => {
    const selected = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: t("Choose a folder of resumes")
    })
    if (selected.canceled || !selected.filePaths[0]) return []
    const folder = selected.filePaths[0]
    return maintenance.runOperation(async () => {
      await indexReadiness.waitUntilReady()
      // Collection belongs inside the shared operation. Otherwise a wipe can
      // land after collection and the saved paths can repopulate the library.
      const files = await collectFiles(folder)
      const outcomes = await ingestPathsWithoutGate(files)
      if (outcomes.some(didImport)) searchSessions.clear()
      return outcomes
    })
  })

  ipcMain.handle(CH.ingestPickFiles, async () => {
    const res = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
      title: t("Choose resumes"),
      filters: [
        { name: t("Resumes"), extensions: SUPPORTED_EXTENSIONS.map((ext) => ext.slice(1)) }
      ]
    })
    if (res.canceled || res.filePaths.length === 0) return []
    return maintenance.runOperation(async () => {
      const outcomes = await ingestPathsWithoutGate(res.filePaths)
      if (outcomes.some(didImport)) searchSessions.clear()
      return outcomes
    })
  })

  ipcMain.handle(CH.ingestText, (_e, rawArgs: unknown) => {
    const args = parseIpc(ipcSchemas.ingestText, rawArgs, 'pasted resume')
    return maintenance.runOperation(async () => {
      await indexReadiness.waitUntilReady()
      const outcome = await ingestText({
        text: args.text,
        fileName: args.label || t('Pasted resume'),
        filePath: '',
        fileType: 'pasted'
      })
      if (didImport(outcome)) searchSessions.clear()
      return outcome
    })
  })

  ipcMain.handle(CH.settingsGet, () =>
    maintenance.runOperation((): AppSettings => {
      const storedTheme = ipcSchemas.theme.safeParse(getSetting(THEME_KEY))
      const config = getRerankConfig()
      const apiKeyStatus = getApiKeyStatus(config.provider)
      const credentialAvailable = hasRerankCredential(config)
      return {
        language: currentLanguage(),
        watchedFolder: getSetting(WATCHED_FOLDER_KEY),
        theme: storedTheme.success ? storedTheme.data : 'system',
        rerankEnabled: getSetting(RERANK_ENABLED_KEY) === 'true' && credentialAvailable,
        rerankProvider: config.provider,
        rerankModel: config.model,
        rerankAuthMode: config.authMode ?? 'api-key',
        rerankModels: getRerankModels(),
        chatGpt: getChatGptStatus(),
        chatGptModel: getChatGptModel(),
        hasRerankCredential: credentialAvailable,
        // The key itself is deliberately not returned: the renderer only needs to
        // know whether one exists.
        hasApiKey: apiKeyStatus === 'protected',
        apiKeyStatus,
        rerankConsentGranted:
          getSetting(rerankConsentKey(config)) === rerankConsentValue(config)
      }
    })
  )

  ipcMain.handle(CH.chatGptSignIn, (_e, rawId: unknown) => signInChatGpt(
    rawId === undefined ? undefined : parseIpc(ipcSchemas.chatGptAccountId, rawId, 'ChatGPT account')
  ))
  ipcMain.handle(CH.chatGptCancelSignIn, () => cancelChatGptSignIn())
  ipcMain.handle(CH.chatGptSelectAccount, (_e, rawId: unknown) =>
    selectChatGptAccount(parseIpc(ipcSchemas.chatGptAccountId, rawId, 'ChatGPT account')))
  ipcMain.handle(CH.chatGptSignOut, (_e, rawId: unknown) =>
    signOutChatGpt(parseIpc(ipcSchemas.chatGptAccountId, rawId, 'ChatGPT account')))
  ipcMain.handle(CH.chatGptRefreshModels, () => refreshChatGptModels())
  ipcMain.handle(CH.chatGptAcknowledgeWelcome, () => acknowledgeChatGptWelcome())
  ipcMain.handle(CH.chatGptManageUsage, () => shell.openExternal(CHATGPT_USAGE_URL))

  ipcMain.handle(CH.settingsSetApiKey, (_e, rawKey: unknown, rawProvider: unknown) => {
    const key = parseIpc(ipcSchemas.apiKey, rawKey, 'API key')
    const provider = parseIpc(ipcSchemas.rerankProvider, rawProvider === undefined ? 'anthropic' : rawProvider, 'AI provider')
    return maintenance.runMaintenance(() => {
      const previouslyUsable = hasApiKey(provider)
      const cleanupNeeded = setApiKey(key, provider)
      if ((!key || !previouslyUsable) && provider === getRerankConfig().provider && !isChatGptConfig(getRerankConfig())) {
        setSetting(RERANK_ENABLED_KEY, 'false')
      }
      searchSessions.clearApprovals()
      clearProviderRerankConsent(provider)
      if (cleanupNeeded) finishPendingSecretCleanup()
    })
  })

  ipcMain.handle(CH.settingsProtectLegacyApiKey, (_e, rawProvider: unknown) => {
    const provider = parseIpc(ipcSchemas.rerankProvider, rawProvider === undefined ? 'anthropic' : rawProvider, 'AI provider')
    return maintenance.runMaintenance(() => {
      const migrated = protectLegacyApiKey(provider)
      if (migrated) {
        if (provider === getRerankConfig().provider && !isChatGptConfig(getRerankConfig())) setSetting(RERANK_ENABLED_KEY, 'false')
        searchSessions.clearApprovals()
        clearProviderRerankConsent(provider)
      }
      if (migrated) finishPendingSecretCleanup()
      return migrated
    })
  })

  ipcMain.handle(CH.settingsSetRerankConfig, (_e, rawConfig: unknown) => {
    const config = parseIpc(ipcSchemas.rerankConfig, rawConfig, 'AI provider and model')
    return maintenance.runOperation(() => {
      setRerankConfig(config)
      searchSessions.clearApprovals()
    })
  })

  ipcMain.handle(CH.settingsSetRerank, (_e, rawEnabled: unknown) => {
    const enabled = parseIpc(ipcSchemas.enabled, rawEnabled, 'rerank setting')
    return maintenance.runOperation(() => {
      if (enabled && !hasRerankCredential(getRerankConfig())) throw new Error(
        isChatGptConfig(getRerankConfig())
          ? 'Connect a ChatGPT account with plan access and choose an available model in Settings.'
          : 'Add an API key for the selected provider first.')
      setSetting(RERANK_ENABLED_KEY, String(enabled))
      searchSessions.clearApprovals()
    })
  })

  ipcMain.handle(CH.settingsResetRerankConsent, () =>
    maintenance.runOperation(() => {
      setSetting(rerankConsentKey(getRerankConfig()), null)
      searchSessions.clearApprovals()
    })
  )

  ipcMain.handle(CH.settingsSetTheme, (_e, rawTheme: unknown) => {
    const theme = parseIpc(ipcSchemas.theme, rawTheme, 'theme')
    return maintenance.runOperation(() => setSetting(THEME_KEY, theme))
  })

  ipcMain.handle(CH.settingsSetLanguage, (_e, rawLanguage: unknown) => {
    const language = parseIpc(ipcSchemas.language, rawLanguage, 'language')
    return maintenance.runOperation(() => {
      setSetting(LANGUAGE_KEY, language)
      buildMenu(() => mainWindow)
      return language
    })
  })

  ipcMain.handle(CH.settingsSetWatchedFolder, async (_e, rawFolder: unknown) => {
    parseIpc(ipcSchemas.watchedFolder, rawFolder, 'watched folder')
    await withWatcherLifecycle(async () => {
      await stopWatching()
      await maintenance.runMaintenance(() => setSetting(WATCHED_FOLDER_KEY, null))
    })
  })

  ipcMain.handle(CH.settingsChooseWatchedFolder, async () => {
    const selected = await dialog.showOpenDialog(mainWindow!, {
      properties: ['openDirectory'],
      title: t("Choose a watched folder")
    })
    if (selected.canceled || !selected.filePaths[0]) return null
    const folder = selected.filePaths[0]
    await withWatcherLifecycle(async () => {
      const previousFolder = await maintenance.runOperation(() => getSetting(WATCHED_FOLDER_KEY))
      await stopWatching()
      await maintenance.runMaintenance(() =>
        setSetting(WATCHED_FOLDER_KEY, folder)
      )
      try {
        await startWatching(folder)
      } catch (error) {
        await maintenance.runMaintenance(() =>
          setSetting(WATCHED_FOLDER_KEY, previousFolder)
        )
        if (previousFolder) await startWatching(previousFolder)
        throw error
      }
    })
    return folder
  })

  // Reveals the app's own data folder. Takes no path from the renderer, so
  // there is nothing here that could be pointed somewhere else.
  ipcMain.handle(CH.settingsRevealData, () => {
    shell.showItemInFolder(dbPath())
  })

  ipcMain.handle(CH.settingsBackup, async () => {
    await indexReadiness.waitUntilReady()
    const date = new Date().toISOString().slice(0, 10)
    const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
      title: t("Back up Qumaa library"),
      defaultPath: `Qumaa-backup-${date}.qumaa-backup`,
      filters: [{ name: t("Qumaa backup"), extensions: ['qumaa-backup'] }]
    })
    if (canceled || !filePath) return null

    const summary = await maintenance.runMaintenance(() =>
      exportPortableBackup(filePath)
    )
    return { ...summary, path: filePath }
  })

  ipcMain.handle(CH.settingsRestore, async () => {
    await indexReadiness.waitUntilReady()
    const selected = await dialog.showOpenDialog(mainWindow!, {
      title: t("Restore Qumaa library"),
      properties: ['openFile'],
      filters: [{ name: t("Qumaa backup"), extensions: ['qumaa-backup'] }]
    })
    if (selected.canceled || !selected.filePaths[0]) return null

    const sourcePath = selected.filePaths[0]
    // Snapshot first so the confirmation describes the exact bytes that will
    // be installed, even if the selected SQLite file has WAL sidecars or is
    // modified while the dialog is open.
    const staged = await stagePortableRestore(sourcePath)
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: [t('Cancel'), t('Restore backup')],
      defaultId: 0,
      cancelId: 0,
      message: t(staged.resumeCount === 1 ? 'Replace this library with {count} backed-up resume?' : 'Replace this library with {count} backed-up resumes?', { count: staged.resumeCount }),
      detail:
        t("The current library is kept only while Qumaa validates the restored search index, then removed automatically. Restoring removes this device's API keys, connected ChatGPT accounts, watched folder, original-file paths, and window state.")
    })
    if (response !== 1) {
      discardStagedRestore(staged)
      return null
    }

    return withWatcherLifecycle(async () => {
      const previousWatchedFolder = await maintenance.runOperation(() =>
        getSetting(WATCHED_FOLDER_KEY)
      )
      // Drain outside the maintenance gate. The lifecycle lock prevents a
      // concurrent folder change from restarting it before replacement begins.
      await stopWatching()
      try {
        invalidateChatGptOperations()
        const restored = await maintenance.runLibraryChange(async () => {
          const result = await installStagedPortableRestore(staged)
          try {
            // A backup from a compatible older build may still need derived-data
            // repairs or a model reindex before normal work resumes.
            await initializeSearchIndex()
          } catch (restoreError) {
            try {
              rollbackRestore(result.rollbackPath)
              await initializeSearchIndex()
            } catch (rollbackError) {
              throw new AggregateError(
                [restoreError, rollbackError],
                'Restore failed and the previous library could not be fully reopened.'
              )
            }
            throw restoreError
          }
          commitRestore(result.rollbackPath)
          searchSessions.clear()
          return result
        })
        buildMenu(() => mainWindow)
        return {
          schemaVersion: restored.schemaVersion,
          resumeCount: restored.resumeCount,
          chunkCount: restored.chunkCount,
          path: sourcePath
        }
      } catch (error) {
        // No-op once the stage has been moved into place or consumed by
        // rollback; essential when failure happens before installation.
        discardStagedRestore(staged)
        // A failed restore rolls the database back. Resume its former watcher
        // while still holding the lifecycle lock.
        if (previousWatchedFolder) await startWatching(previousWatchedFolder)
        throw error
      }
    })
  })

  ipcMain.handle(CH.settingsDeleteAll, async () => {
    const { resumeCount } = await maintenance.runOperation(dbStats)
    // Irreversible, so the confirmation is native and states exactly what goes.
    const { response } = await dialog.showMessageBox(mainWindow!, {
      type: 'warning',
      buttons: [t('Cancel'), t('Delete everything')],
      defaultId: 0,
      cancelId: 0,
      message: t("Delete all data?"),
      detail:
        t(resumeCount === 1 ? 'This removes all {count} resume from the library, along with all companies, jobs, contacts, recruiting records, settings, watched folder, saved API keys, and connected ChatGPT accounts. The original resume files on disk are not touched. This cannot be undone.' : 'This removes all {count} resumes from the library, along with all companies, jobs, contacts, recruiting records, settings, watched folder, saved API keys, and connected ChatGPT accounts. The original resume files on disk are not touched. This cannot be undone.', { count: resumeCount })
    })
    if (response !== 1) return false

    // Drain the watched-folder queue before asking for exclusive access. A
    // queued watcher import enters through the same coordinator; waiting for
    // that queue from inside the exclusive section would deadlock it behind us.
    return withWatcherLifecycle(async () => {
      await stopWatching()
      invalidateChatGptOperations()
      return maintenance.runLibraryChange(async () => {
        // Existing manual imports finish before exclusive access is granted, and
        // later imports are rejected until deletion and marker repair complete.
        deleteAllData()
        searchSessions.clear()
        // Readiness remains open after a wipe, so restore internal provenance for
        // the now-empty index before a new resume can be ingested.
        markEmptyIndexCurrent()
        buildMenu(() => mainWindow)
        return true
      })
    })
  })

  ipcMain.handle(CH.settingsStats, () => maintenance.runOperation(dbStats))
  ipcMain.handle(CH.settingsModelStatus, () => modelStatus())
}

// Must run from the entry file itself; see setEntryDir's comment.
setEntryDir(__dirname)

// Database replacement is only safe when no second Qumaa process can hold the
// same WAL open. Acquire the lock before any handler or startup task can touch
// userData; later launches focus the existing window instead.
const ownsInstanceLock = app.requestSingleInstanceLock()

if (!ownsInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow || mainWindow.isDestroyed()) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.whenReady().then(async () => {
    if (!trustedDevRendererUrl()) await installRendererProtocol()
    registerHandlers()
    onWatchIngest((outcome) => {
      if (didImport(outcome)) searchSessions.clear()
      send(CH.evWatchIngest, outcome)
    })
    createWindow()
    // After createWindow: the About panel reads the library count from the database,
    // which is opened lazily on first access.
    buildMenu(() => mainWindow)

    // A crash after replacing a legacy plaintext key but before page/WAL
    // cleanup leaves this non-secret retry marker. Finish it without touching
    // the keychain, then continue startup even if the filesystem is busy.
    if (hasPendingSecretCleanup()) {
      try {
        await maintenance.runMaintenance(finishPendingSecretCleanup)
      } catch (error) {
        console.error('Credential cleanup will be retried next launch:', error)
      }
    }

    // Model loading, vector migration, and all derived-data backfills form one
    // readiness boundary. Search and every ingest path wait for the entire chain.
    indexReadiness
      .start(() => maintenance.runMaintenance(initializeSearchIndex))
      .then(() =>
        withWatcherLifecycle(async () => {
          const watched = await maintenance.runOperation(() => getSetting(WATCHED_FOLDER_KEY))
          if (watched) await startWatching(watched)
        })
      )
      .catch((err: unknown) => {
        console.error('Search index failed to initialize:', err)
      })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  }).catch((error: unknown) => {
    console.error('Qumaa failed to start:', error)
    return showStartupRecovery()
  })

  // Startup itself has a recovery dialog above; retain diagnostics for later
  // asynchronous failures that do not propagate through the startup promise.
  process.on('unhandledRejection', (reason) => {
    console.error('Unhandled rejection during startup:', reason)
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  app.on('before-quit', () => {
    invalidateChatGptOperations()
    stopWatching()
    embedder.stop()
  })
}
