import { useCallback, useEffect, useRef, useState } from 'react'
import type { MatchResult, IngestOutcome, IngestProgress, ResumeSummary } from '@shared/types.js'
import MatchView from './views/MatchView.js'
import JobsView from './views/JobsView.js'
import LibraryView from './views/LibraryView.js'
import SettingsView from './views/SettingsView.js'
import Toasts, { type Toast } from './components/Toasts.js'
import { useTheme } from './useTheme.js'
import ResumeDetail from './components/ResumeDetail.js'
import { Brand } from './components/Brand.js'

type Tab = 'jobs' | 'match' | 'library' | 'settings'

/** Which candidate the slide-over is showing, and its match context if any. */
interface Selection {
  resume: ResumeSummary
  match?: MatchResult
}

/** Turns a batch of ingest outcomes into one summary toast plus per-failure detail. */
function summarize(outcomes: IngestOutcome[]): Toast[] {
  const imported = outcomes.filter(
    (o) => o.status === 'imported' || o.status === 'near-duplicate'
  ).length
  const duplicates = outcomes.filter((o) => o.status === 'duplicate').length
  const nearDuplicates = outcomes.filter((o) => o.status === 'near-duplicate')
  const problems = outcomes.filter((o) => o.status === 'failed' || o.status === 'unsupported')

  const toasts: Toast[] = []
  if (imported || duplicates) {
    const parts = []
    if (imported) parts.push(`${imported} imported`)
    if (duplicates) parts.push(`${duplicates} already in library`)
    toasts.push({ id: crypto.randomUUID(), kind: 'success', message: parts.join(', ') })
  }
  // Near-duplicates are imported, so this is information rather than an error:
  // the user decides whether it is a second application or a different person.
  for (const nd of nearDuplicates.slice(0, 3)) {
    if (nd.status !== 'near-duplicate') continue
    const pct = Math.round(nd.similarTo.similarity * 100)
    toasts.push({
      id: crypto.randomUUID(),
      kind: 'info',
      message: `${nd.resume.name ?? nd.resume.fileName} looks ${pct}% like ${nd.similarTo.name ?? nd.similarTo.fileName} already in the library`
    })
  }

  // Cap the noise: a folder of 200 scans should not produce 200 toasts.
  for (const p of problems.slice(0, 4)) {
    const reason = 'reason' in p ? p.reason : 'Failed'
    toasts.push({ id: crypto.randomUUID(), kind: 'error', message: `${p.fileName}: ${reason}` })
  }
  if (problems.length > 4) {
    toasts.push({
      id: crypto.randomUUID(),
      kind: 'error',
      message: `…and ${problems.length - 4} more files could not be imported`
    })
  }
  return toasts
}

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<Tab>('jobs')
  const [resumes, setResumes] = useState<ResumeSummary[]>([])
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [dragging, setDragging] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  const [libraryRevision, setLibraryRevision] = useState(0)
  const [profileRevision, setProfileRevision] = useState(0)
  const [workspaceEpoch, setWorkspaceEpoch] = useState(0)
  /** Nested dragenter/dragleave events fire constantly; count them instead of
   *  toggling, or the overlay flickers as the cursor crosses child elements. */
  const dragDepth = useRef(0)
  /** Tracks ingest jobs so matches are invalidated at their boundaries, not per file. */
  const invalidatedIngestJobs = useRef(new Set<string>())
  // One owner applies the stored theme and follows the OS. Passing its state to
  // Settings avoids mounting a second, potentially stale system-theme listener.
  const { theme, setTheme } = useTheme()

  const pushToasts = useCallback((next: Toast[]) => {
    setToasts((prev) => [...prev, ...next])
  }, [])

  const dismissToast = useCallback((id: string) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const refresh = useCallback(async () => {
    setResumes(await window.api.resumes.list())
  }, [])

  const invalidateMatches = useCallback(() => {
    setSelected(null)
    setLibraryRevision((revision) => revision + 1)
  }, [])

  const refreshAfterLibraryChange = useCallback(async () => {
    // Revoke result snapshots before waiting for the refreshed library list.
    invalidateMatches()
    await refresh()
  }, [invalidateMatches, refresh])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const offProgress = window.api.on.ingestProgress((p) => {
      const firstEvent = !invalidatedIngestJobs.current.has(p.jobId)
      if (firstEvent) {
        invalidatedIngestJobs.current.add(p.jobId)
        invalidateMatches()
      }
      setProgress(p.done ? null : p)
      if (p.done) {
        invalidatedIngestJobs.current.delete(p.jobId)
        // Also revoke a search started while a multi-file import or reindex was
        // running. A one-event/empty job was already revoked just above.
        if (!firstEvent) invalidateMatches()
        refresh()
      }
    })
    const offWatch = window.api.on.watchIngest((o) => {
      pushToasts(summarize([o]))
      if (o.status === 'imported' || o.status === 'near-duplicate') {
        refreshAfterLibraryChange()
      } else {
        refresh()
      }
    })
    const offReindex = window.api.on.reindexed(() => {
      refreshAfterLibraryChange()
      pushToasts([
        { id: crypto.randomUUID(), kind: 'success', message: 'Search index updated for the new model' }
      ])
    })
    return () => {
      offProgress()
      offWatch()
      offReindex()
      invalidatedIngestJobs.current.clear()
    }
  }, [invalidateMatches, refresh, refreshAfterLibraryChange, pushToasts])

  const ingestDroppedFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      const outcomes = await window.api.ingest.files(files)
      pushToasts(summarize(outcomes))
      await refresh()
    },
    [pushToasts, refresh]
  )

  const importViaDialog = useCallback(
    async (kind: 'files' | 'folder') => {
      if (kind === 'files') {
        const outcomes = await window.api.ingest.pickFiles()
        pushToasts(summarize(outcomes))
        await refresh()
        return
      }
      pushToasts(summarize(await window.api.ingest.folder()))
      await refresh()
    },
    [pushToasts, refresh]
  )

  const handleSettingsChanged = useCallback(async (resetWorkspace = false) => {
    if (resetWorkspace) setWorkspaceEpoch((epoch) => epoch + 1)
    await refreshAfterLibraryChange()
  }, [refreshAfterLibraryChange])

  /* ---------- menu commands ---------- */

  useEffect(() => {
    return window.api.on.menuCommand((command) => {
      switch (command) {
        case 'goto-jobs':
          setTab('jobs')
          break
        case 'new-search':
          setTab('match')
          setSelected(null)
          setResetSignal((n) => n + 1)
          break
        case 'import-files':
          importViaDialog('files')
          break
        case 'import-folder':
          importViaDialog('folder')
          break
        case 'goto-match':
          setTab('match')
          break
        case 'goto-library':
          setTab('library')
          break
        case 'goto-settings':
          setTab('settings')
          break
      }
    })
  }, [importViaDialog])

  /* ---------- window-wide drag & drop ---------- */

  useEffect(() => {
    const onDragEnter = (e: DragEvent): void => {
      if (!e.dataTransfer?.types.includes('Files')) return
      dragDepth.current++
      setDragging(true)
    }
    const onDragOver = (e: DragEvent): void => {
      e.preventDefault()
    }
    const onDragLeave = (): void => {
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDragging(false)
    }
    const onDrop = (e: DragEvent): void => {
      e.preventDefault()
      dragDepth.current = 0
      setDragging(false)
      const files = Array.from(e.dataTransfer?.files ?? [])
      // File.path was removed in Electron 32; the preload resolves paths via webUtils.
      ingestDroppedFiles(files)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [ingestDroppedFiles])

  return (
    <div className="app">
      {/* macOS hides its title bar (hiddenInset), so the header doubles as the
          drag region. Windows and Linux keep a native frame above it. */}
      <header className={`topbar ${window.api.platform === 'darwin' ? 'draggable' : ''}`}>
        <Brand />
        <nav className="tabs">
          <button
            className={`tab ${tab === 'jobs' ? 'active' : ''}`}
            onClick={() => setTab('jobs')}
            aria-current={tab === 'jobs' ? 'page' : undefined}
          >
            Jobs
          </button>
          <button
            className={`tab ${tab === 'match' ? 'active' : ''}`}
            onClick={() => setTab('match')}
          >
            Match
          </button>
          <button
            className={`tab ${tab === 'library' ? 'active' : ''}`}
            onClick={() => setTab('library')}
          >
            Library <span className="count">{resumes.length}</span>
          </button>
          <button
            className={`tab ${tab === 'settings' ? 'active' : ''}`}
            onClick={() => setTab('settings')}
          >
            Settings
          </button>
        </nav>
      </header>

      <main className="view">
        {progress && (
          <div className="progress card">
            <div className="row">
              <span>
                Importing {progress.processed + 1} of {progress.total}
              </span>
              <span className="spacer" />
              <span className="muted">{progress.currentFile}</span>
            </div>
            <div className="bar">
              <div style={{ width: `${(progress.processed / progress.total) * 100}%` }} />
            </div>
          </div>
        )}

        <div hidden={tab !== 'jobs'}>
          <JobsView
            key={workspaceEpoch}
            resumes={resumes}
            libraryRevision={libraryRevision + profileRevision}
            onOpenCandidate={(m) => setSelected({ resume: m.resume, match: m })}
            onToast={pushToasts}
          />
        </div>
        {tab === 'match' && (
          <MatchView
            resumeCount={resumes.length}
            resetSignal={resetSignal}
            libraryRevision={libraryRevision}
            onOpenCandidate={(m) => setSelected({ resume: m.resume, match: m })}
          />
        )}
        {tab === 'library' && (
          <LibraryView
            resumes={resumes}
            profileRevision={profileRevision}
            onChanged={refreshAfterLibraryChange}
            onImport={importViaDialog}
            onToast={pushToasts}
            onOpenResume={(r) => setSelected({ resume: r })}
          />
        )}
        {tab === 'settings' && (
          <SettingsView
            theme={theme}
            onThemeChange={setTheme}
            onToast={pushToasts}
            onChanged={handleSettingsChanged}
          />
        )}
      </main>

      {selected && (
        <ResumeDetail
          key={`${selected.resume.id}:${selected.resume.recordKey}`}
          resume={selected.resume}
          match={selected.match}
          onProfileChanged={() => setProfileRevision((revision) => revision + 1)}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            refreshAfterLibraryChange()
          }}
        />
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>Drop resumes to import</div>
          <div className="hint">PDF, DOCX or Markdown</div>
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={dismissToast} />
    </div>
  )
}
