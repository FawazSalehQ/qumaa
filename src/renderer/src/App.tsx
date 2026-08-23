import { useCallback, useEffect, useRef, useState } from 'react'
import type { MatchResult, IngestOutcome, IngestProgress, ResumeSummary } from '@shared/types.js'
import MatchView from './views/MatchView.js'
import LibraryView from './views/LibraryView.js'
import SettingsView from './views/SettingsView.js'
import Toasts, { type Toast } from './components/Toasts.js'
import ResumeDetail from './components/ResumeDetail.js'
import { Brand } from './components/Brand.js'

type Tab = 'match' | 'library' | 'settings'

/** Which candidate the slide-over is showing, and its match context if any. */
interface Selection {
  resume: ResumeSummary
  match?: MatchResult
}

/** Turns a batch of ingest outcomes into one summary toast plus per-failure detail. */
function summarize(outcomes: IngestOutcome[]): Toast[] {
  const imported = outcomes.filter((o) => o.status === 'imported').length
  const duplicates = outcomes.filter((o) => o.status === 'duplicate').length
  const problems = outcomes.filter((o) => o.status === 'failed' || o.status === 'unsupported')

  const toasts: Toast[] = []
  if (imported || duplicates) {
    const parts = []
    if (imported) parts.push(`${imported} imported`)
    if (duplicates) parts.push(`${duplicates} already in library`)
    toasts.push({ id: crypto.randomUUID(), kind: 'success', message: parts.join(', ') })
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
  const [tab, setTab] = useState<Tab>('match')
  const [resumes, setResumes] = useState<ResumeSummary[]>([])
  const [progress, setProgress] = useState<IngestProgress | null>(null)
  const [dragging, setDragging] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [selected, setSelected] = useState<Selection | null>(null)
  const [resetSignal, setResetSignal] = useState(0)
  /** Nested dragenter/dragleave events fire constantly; count them instead of
   *  toggling, or the overlay flickers as the cursor crosses child elements. */
  const dragDepth = useRef(0)

  const pushToasts = useCallback((next: Toast[]) => {
    setToasts((prev) => [...prev, ...next])
  }, [])

  const refresh = useCallback(async () => {
    setResumes(await window.api.resumes.list())
  }, [])

  useEffect(() => {
    refresh()
  }, [refresh])

  useEffect(() => {
    const offProgress = window.api.on.ingestProgress((p) => {
      setProgress(p.done ? null : p)
      if (p.done) refresh()
    })
    const offWatch = window.api.on.watchIngest((o) => {
      pushToasts(summarize([o]))
      refresh()
    })
    return () => {
      offProgress()
      offWatch()
    }
  }, [refresh, pushToasts])

  const ingestPaths = useCallback(
    async (paths: string[]) => {
      if (paths.length === 0) return
      const outcomes = await window.api.ingest.files(paths)
      pushToasts(summarize(outcomes))
      await refresh()
    },
    [pushToasts, refresh]
  )

  const importViaDialog = useCallback(
    async (kind: 'files' | 'folder') => {
      if (kind === 'files') {
        await ingestPaths(await window.api.ingest.pickFiles())
        return
      }
      const folder = await window.api.ingest.pickFolder()
      if (!folder) return
      pushToasts(summarize(await window.api.ingest.folder(folder)))
      await refresh()
    },
    [ingestPaths, pushToasts, refresh]
  )

  /* ---------- menu commands ---------- */

  useEffect(() => {
    return window.api.on.menuCommand((command) => {
      switch (command) {
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
      ingestPaths(files.map((f) => window.api.ingest.pathForFile(f)).filter(Boolean))
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
  }, [ingestPaths])

  return (
    <div className="app">
      {/* macOS hides its title bar (hiddenInset), so the header doubles as the
          drag region. Windows and Linux keep a native frame above it. */}
      <header className={`topbar ${window.api.platform === 'darwin' ? 'draggable' : ''}`}>
        <Brand />
        <nav className="tabs">
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

        {tab === 'match' && (
          <MatchView
            resumeCount={resumes.length}
            resetSignal={resetSignal}
            onOpenCandidate={(m) => setSelected({ resume: m.resume, match: m })}
          />
        )}
        {tab === 'library' && (
          <LibraryView
            resumes={resumes}
            onChanged={refresh}
            onIngestPaths={ingestPaths}
            onToast={pushToasts}
            onOpenResume={(r) => setSelected({ resume: r })}
          />
        )}
        {tab === 'settings' && <SettingsView onToast={pushToasts} onChanged={refresh} />}
      </main>

      {selected && (
        <ResumeDetail
          key={selected.resume.id}
          resume={selected.resume}
          match={selected.match}
          onClose={() => setSelected(null)}
          onDeleted={() => {
            setSelected(null)
            refresh()
          }}
        />
      )}

      {dragging && (
        <div className="drop-overlay">
          <div>Drop resumes to import</div>
          <div className="hint">PDF, DOCX, TXT or Markdown</div>
        </div>
      )}

      <Toasts toasts={toasts} onDismiss={(id) => setToasts((t) => t.filter((x) => x.id !== id))} />
    </div>
  )
}
