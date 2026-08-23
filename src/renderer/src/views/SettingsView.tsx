import { useCallback, useEffect, useState } from 'react'
import type { DbStats, ModelStatus } from '@shared/types.js'
import type { Toast } from '../components/Toasts.js'

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 ** 2).toFixed(1)} MB`
}

export default function SettingsView({
  onToast,
  onChanged
}: {
  onToast: (t: Toast[]) => void
  onChanged: () => Promise<void>
}): React.JSX.Element {
  const [watched, setWatched] = useState<string | null>(null)
  const [stats, setStats] = useState<DbStats | null>(null)
  const [model, setModel] = useState<ModelStatus | null>(null)

  const load = useCallback(async () => {
    const [settings, s, m] = await Promise.all([
      window.api.settings.get(),
      window.api.settings.stats(),
      window.api.settings.modelStatus()
    ])
    setWatched(settings.watchedFolder)
    setStats(s)
    setModel(m)
  }, [])

  useEffect(() => {
    load()
  }, [load])

  const chooseWatched = async (): Promise<void> => {
    const folder = await window.api.ingest.pickFolder()
    if (!folder) return
    await window.api.settings.setWatchedFolder(folder)
    onToast([
      {
        id: crypto.randomUUID(),
        kind: 'success',
        message: `Watching ${folder}. Existing files are being indexed now.`
      }
    ])
    await load()
    await onChanged()
  }

  const clearWatched = async (): Promise<void> => {
    await window.api.settings.setWatchedFolder(null)
    await load()
  }

  return (
    <>
      <header className="view-head">
        <h2>Settings</h2>
        <p className="sub">Everything is stored on this machine.</p>
      </header>

      <div className="card">
        <div className="setting">
          <div className="label">Watched folder</div>
          <div className="desc">
            New resumes dropped into this folder are imported automatically. Files added while the
            app was closed are picked up on the next launch.
          </div>
          {watched ? (
            <div className="row">
              <code>{watched}</code>
              <span className="spacer" />
              <button className="btn sm" onClick={chooseWatched}>
                Change
              </button>
              <button className="btn sm danger" onClick={clearWatched}>
                Stop watching
              </button>
            </div>
          ) : (
            <button className="btn" onClick={chooseWatched}>
              Choose folder…
            </button>
          )}
        </div>

        <div className="setting">
          <div className="label">Embedding model</div>
          <div className="desc">Runs locally. The app never contacts the network.</div>
          <div className="muted">
            {model === null && 'Checking…'}
            {model?.state === 'loading' && 'Loading model…'}
            {model?.state === 'ready' && `bge-small-en-v1.5 · ${model.dimensions} dimensions · ready`}
            {model?.state === 'error' && (
              <span style={{ color: 'var(--bad)' }}>Error: {model.message}</span>
            )}
          </div>
        </div>

        <div className="setting">
          <div className="label">Database</div>
          <div className="desc">
            {stats
              ? `${stats.resumeCount} resumes · ${stats.chunkCount} indexed passages · ${formatBytes(stats.dbSizeBytes)}`
              : 'Loading…'}
          </div>
          {stats && <code>{stats.dbPath}</code>}
        </div>
      </div>
    </>
  )
}
