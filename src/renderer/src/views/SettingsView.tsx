import { useCallback, useEffect, useState } from 'react'
import type { DbStats, ModelStatus, ThemeChoice } from '@shared/types.js'
import type { Toast } from '../components/Toasts.js'
import { useTheme } from '../useTheme.js'

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
  const [hasKey, setHasKey] = useState(false)
  const [rerankOn, setRerankOn] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [stats, setStats] = useState<DbStats | null>(null)
  const [model, setModel] = useState<ModelStatus | null>(null)
  const { theme, setTheme } = useTheme()

  const load = useCallback(async () => {
    const [settings, s, m] = await Promise.all([
      window.api.settings.get(),
      window.api.settings.stats(),
      window.api.settings.modelStatus()
    ])
    setWatched(settings.watchedFolder)
    setHasKey(settings.hasApiKey)
    setRerankOn(settings.rerankEnabled)
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
          <div className="label">Appearance</div>
          <div className="desc">
            The brand supports a dark context, so both are first class. System follows your
            machine and keeps following it.
          </div>
          <div className="row segmented">
            {(['system', 'light', 'dark'] as ThemeChoice[]).map((t) => (
              <button
                key={t}
                className={`btn sm ${theme === t ? 'primary' : ''}`}
                onClick={() => setTheme(t)}
              >
                {t[0].toUpperCase() + t.slice(1)}
              </button>
            ))}
          </div>
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
          <div className="label">Claude rerank</div>
          <div className="desc">
            <strong>This is the only feature that sends data off your machine.</strong> When you
            run it, the job description and the matching passages from the top {15} candidates are
            sent to Anthropic. Everything else, including the whole search, stays local. Off unless
            you add a key and switch it on.
          </div>

          {hasKey ? (
            <div className="row">
              <span className="muted">API key stored</span>
              <label className="row toggle">
                <input
                  type="checkbox"
                  checked={rerankOn}
                  onChange={async (e) => {
                    await window.api.settings.setRerank(e.target.checked)
                    await load()
                  }}
                />
                Enable reranking
              </label>
              <span className="spacer" />
              <button
                className="btn sm danger"
                onClick={async () => {
                  await window.api.settings.setApiKey(null)
                  await load()
                }}
              >
                Remove key
              </button>
            </div>
          ) : (
            <div className="row">
              <input
                type="password"
                placeholder="sk-ant-…"
                value={keyDraft}
                onChange={(e) => setKeyDraft(e.target.value)}
                style={{ width: 320 }}
              />
              <button
                className="btn"
                disabled={!keyDraft.trim()}
                onClick={async () => {
                  await window.api.settings.setApiKey(keyDraft)
                  setKeyDraft('')
                  await load()
                }}
              >
                Save key
              </button>
            </div>
          )}
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
