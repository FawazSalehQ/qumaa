import { useCallback, useEffect, useRef, useState } from 'react'
import type { DbStats, ModelStatus, ThemeChoice } from '@shared/types.js'
import { DEFAULT_RERANK_CONFIG, DEFAULT_RERANK_MODELS, PROVIDER_LABELS, RERANK_MODELS, type RerankConfig, type RerankModel, type RerankProvider } from '@shared/rerank.js'
import type { Toast } from '../components/Toasts.js'
import { useI18n } from '../i18n.js'
import { displayError } from '@shared/i18n.js'


export default function SettingsView({
  theme,
  onThemeChange,
  onToast,
  onChanged
}: {
  theme: ThemeChoice
  onThemeChange: (theme: ThemeChoice) => void
  onToast: (t: Toast[]) => void
  onChanged: (resetWorkspace?: boolean) => Promise<void>
}): React.JSX.Element {
  const { language, setLanguage, t, formatNumber } = useI18n()
  const formatBytes = (n: number): string => n < 1024 ? t('{size} B', { size: formatNumber(n) }) : n < 1024 ** 2 ? t('{size} KB', { size: formatNumber(n / 1024, { maximumFractionDigits: 0 }) }) : t('{size} MB', { size: formatNumber(n / 1024 ** 2, { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })
  const [changingLanguage, setChangingLanguage] = useState(false)
  const errorMessage = (error: unknown, fallback: string): string => displayError(language, error, fallback)
  const [watched, setWatched] = useState<string | null>(null)
  const [hasKey, setHasKey] = useState(false)
  const [keyStatus, setKeyStatus] = useState<'none' | 'protected' | 'migration-needed'>('none')
  const [rerankOn, setRerankOn] = useState(false)
  const [consentGranted, setConsentGranted] = useState(false)
  const [keyDraft, setKeyDraft] = useState('')
  const [rerankConfig, setRerankConfig] = useState<RerankConfig>(DEFAULT_RERANK_CONFIG)
  const [rerankModels, setRerankModels] = useState<Record<RerankProvider, RerankModel>>(DEFAULT_RERANK_MODELS)
  const [aiBusy, setAiBusy] = useState(false)
  const [aiReady, setAiReady] = useState(false)
  const aiMutationInFlight = useRef(false)
  const loadEpoch = useRef(0)
  const [stats, setStats] = useState<DbStats | null>(null)
  const [dataAction, setDataAction] = useState<'backup' | 'restore' | null>(null)
  const revealLabel = window.api.platform === 'darwin'
    ? 'Show in Finder'
    : 'Show in Explorer'
  const [model, setModel] = useState<ModelStatus | null>(null)
  const providerLabel = PROVIDER_LABELS[rerankConfig.provider]
  const aiDisabled = !aiReady || aiBusy || dataAction !== null

  const load = useCallback(async () => {
    const epoch = ++loadEpoch.current
    const [settings, s, m] = await Promise.all([
      window.api.settings.get(),
      window.api.settings.stats(),
      window.api.settings.modelStatus()
    ])
    if (epoch !== loadEpoch.current) return
    setWatched(settings.watchedFolder)
    setHasKey(settings.hasApiKey)
    setKeyStatus(settings.apiKeyStatus)
    setRerankOn(settings.rerankEnabled)
    setConsentGranted(settings.rerankConsentGranted)
    setRerankConfig({ provider: settings.rerankProvider, model: settings.rerankModel })
    setRerankModels(settings.rerankModels)
    setAiReady(true)
    setStats(s)
    setModel(m)
  }, [])

  useEffect(() => {
    void load().catch((error: unknown) => {
      onToast([{ id: crypto.randomUUID(), kind: 'error', message: displayError(language, error, 'Could not load settings') }])
    })
  }, [load])

  const changeAiSetting = async (action: () => Promise<unknown>, fallback: string, success?: string): Promise<void> => {
    if (aiMutationInFlight.current || !aiReady || dataAction !== null) return
    aiMutationInFlight.current = true
    setAiBusy(true)
    ++loadEpoch.current
    try {
      await action()
      await load()
      if (success) onToast([{ id: crypto.randomUUID(), kind: 'success', message: t(success) }])
    } catch (error) {
      onToast([{ id: crypto.randomUUID(), kind: 'error', message: errorMessage(error, fallback) }])
    } finally {
      aiMutationInFlight.current = false
      setAiBusy(false)
    }
  }

  /**
   * Main owns the confirmation dialog, so this only reacts to the answer.
   * Nothing is written back afterwards, including the theme: re-saving a
   * preference here would leave a settings row behind and make the wipe a lie.
   * The window keeps its current appearance until the next launch.
   */
  const wipe = useCallback(async () => {
    const done = await window.api.settings.deleteAll()
    if (!done) return
    setWatched(null)
    setHasKey(false)
    setKeyStatus('none')
    setRerankOn(false)
    setConsentGranted(false)
    setKeyDraft('')
    await Promise.all([load(), onChanged(true)])
    onToast([{ id: crypto.randomUUID(), kind: 'success', message: t('All data deleted.') }])
  }, [load, onChanged, onToast, t])

  const chooseWatched = async (): Promise<void> => {
    const folder = await window.api.settings.chooseWatchedFolder()
    if (!folder) return
    onToast([
      {
        id: crypto.randomUUID(),
        kind: 'success',
        message: t('Watching {folder}. Existing files are being indexed now.', { folder })
      }
    ])
    await load()
    await onChanged()
  }

  const clearWatched = async (): Promise<void> => {
    await window.api.settings.stopWatchingFolder()
    await load()
  }

  const backUp = async (): Promise<void> => {
    setDataAction('backup')
    try {
      const result = await window.api.settings.backup()
      if (result) {
        onToast([
          {
            id: crypto.randomUUID(),
            kind: 'success',
            message: t(result.resumeCount === 1 ? 'Backed up {count} resume.' : 'Backed up {count} resumes.', { count: result.resumeCount })
          }
        ])
      }
    } catch (error) {
      onToast([
        {
          id: crypto.randomUUID(),
          kind: 'error',
          message: errorMessage(error, 'Backup failed')
        }
      ])
    } finally {
      setDataAction(null)
    }
  }

  const restore = async (): Promise<void> => {
    setDataAction('restore')
    try {
      const result = await window.api.settings.restore()
      if (!result) return
      const restoredSettings = await window.api.settings.get()
      setWatched(restoredSettings.watchedFolder)
      setHasKey(restoredSettings.hasApiKey)
      setKeyStatus(restoredSettings.apiKeyStatus)
      setRerankOn(restoredSettings.rerankEnabled)
      setConsentGranted(restoredSettings.rerankConsentGranted)
      setKeyDraft('')
      onThemeChange(restoredSettings.theme)
      await Promise.all([load(), onChanged(true)])
      onToast([
        {
          id: crypto.randomUUID(),
          kind: 'success',
          message: t(result.resumeCount === 1 ? 'Restored {count} resume.' : 'Restored {count} resumes.', { count: result.resumeCount })
        }
      ])
    } catch (error) {
      onToast([
        {
          id: crypto.randomUUID(),
          kind: 'error',
          message: errorMessage(error, 'Restore failed')
        }
      ])
    } finally {
      setDataAction(null)
    }
  }

  return (
    <>
      <header className="view-head">
        <h2>{t("Settings")}</h2>
      </header>

      <div className="settings-grid">
        <section className="card setting setting-wide" aria-labelledby="language-heading">
          <h3 id="language-heading">{t('Language')}</h3>
          <div className="row segmented" role="group" aria-label={t('Language')}>
            {(['en', 'ar'] as const).map((choice) => <button key={choice} className={`btn sm ${language === choice ? 'primary' : ''}`} lang={choice} dir={choice === 'ar' ? 'rtl' : 'ltr'} aria-pressed={language === choice} disabled={changingLanguage} onClick={async () => {
              setChangingLanguage(true)
              try { await setLanguage(choice) }
              catch (error) { onToast([{ id: crypto.randomUUID(), kind: 'error', message: errorMessage(error, 'Could not change the language.') }]) }
              finally { setChangingLanguage(false) }
            }}>{choice === 'ar' ? 'العربية' : 'English'}</button>)}
          </div>
        </section>
        <section className="card setting setting-wide" aria-labelledby="watched-folder-heading">
          <h3 id="watched-folder-heading">{t("Watched folder")}</h3>
          <div className="desc">{t('Files added here are imported automatically, including while Qumaa is closed.')}</div>
          {watched ? (
            <div className="row setting-actions">
              <code className="setting-path" dir="ltr">{watched}</code>
              <span className="spacer" />
              <button className="btn sm" onClick={chooseWatched}>{t("Change")}</button>
              <button className="btn sm danger" onClick={clearWatched}>{t("Stop watching")}</button>
            </div>
          ) : (
            <button className="btn" onClick={chooseWatched}>{t("Choose folder…")}</button>
          )}
        </section>

        <section className="card setting" aria-labelledby="appearance-heading">
          <h3 id="appearance-heading">{t("Appearance")}</h3>
          <div className="row segmented" role="group" aria-label={t("Appearance")}>
            {(['system', 'light', 'dark'] as ThemeChoice[]).map((choice) => (
              <button
                key={choice}
                className={`btn sm ${theme === choice ? 'primary' : ''}`}
                aria-pressed={theme === choice}
                onClick={() => onThemeChange(choice)}
              >
                {t(choice[0].toUpperCase() + choice.slice(1))}
              </button>
            ))}
          </div>
        </section>

        <section className="card setting" aria-labelledby="matching-heading">
          <h3 id="matching-heading">{t("Local matching")}</h3>
          {/* The model's identity is an implementation detail. Its *state* is not:
              a failure has to stay visible, or a broken search looks like a
              ranking problem rather than a model that never loaded. */}
          <div className={`model-status ${model?.state ?? 'loading'}`} role="status">
            <span className="status-dot" aria-hidden="true" />
            {model === null && t('Checking availability…')}
            {model?.state === 'loading' && t('Starting local matching…')}
            {model?.state === 'ready' && t('Ready to match')}
            {model?.state === 'error' && (
              <span>{t('Matching unavailable: {message}', { message: t(model.message) })}</span>
            )}
          </div>
        </section>

        <section className="card setting setting-wide" aria-labelledby="rerank-heading">
          <div className="row setting-heading">
            <h3 id="rerank-heading">{t('AI reranking')}</h3>
            <span className="setting-badge">{t('Optional')}</span>
          </div>
          <fieldset className="ai-settings" disabled={aiDisabled} aria-busy={aiBusy}>
            <legend className="sr-only">{t('AI reranking')}</legend>
            <div className="ai-model-selectors">
              <label htmlFor="rerank-provider">
                <span className="label">{t('AI provider')}</span>
                <select id="rerank-provider" value={rerankConfig.provider} onChange={(event) => {
                  const provider = event.target.value as RerankProvider
                  setKeyDraft('')
                  void changeAiSetting(() => window.api.settings.setRerankConfig({ provider, model: rerankModels[provider] }), 'Could not change the AI provider or model')
                }}>
                  {Object.entries(PROVIDER_LABELS).map(([provider, label]) => <option key={provider} value={provider}>{label}</option>)}
                </select>
              </label>
              <label htmlFor="rerank-model">
                <span className="label">{t('AI model')}</span>
                <select id="rerank-model" value={rerankConfig.model} onChange={(event) => {
                  const model = event.target.value as RerankModel
                  void changeAiSetting(() => window.api.settings.setRerankConfig({ provider: rerankConfig.provider, model }), 'Could not change the AI provider or model')
                }}>
                  {RERANK_MODELS[rerankConfig.provider].map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}
                </select>
              </label>
            </div>
            <p className="desc">{t('Reranking sends the job posting and redacted evidence from up to {count} candidates to {provider}. You review what will be sent before first use with each model, and confirm every send. Local matching stays on your device.', { count: 15, provider: providerLabel })}</p>
            {keyStatus === 'migration-needed' ? (
              <div className="credential-warning" role="alert">
                <p>{t('An older Qumaa version saved this API key without operating-system protection. Protect or remove it before AI reranking can be used.')}</p>
                <div className="row">
                  <button className="btn" onClick={() => void changeAiSetting(
                    () => window.api.settings.protectLegacyApiKey(rerankConfig.provider),
                    'Could not protect the existing API key',
                    'The existing API key is now protected by the operating system.'
                  )}>{t('Protect existing key')}</button>
                  <button className="btn danger" onClick={() => void changeAiSetting(
                    () => window.api.settings.setApiKey(null, rerankConfig.provider), 'Could not remove the API key'
                  )}>{t('Remove key')}</button>
                </div>
              </div>
            ) : hasKey ? (
              <div className="row">
                <span className="muted">{t('{provider} API key stored', { provider: providerLabel })}</span>
                <label className="row toggle">
                  <input type="checkbox" checked={rerankOn} onChange={(event) => {
                    const enabled = event.target.checked
                    void changeAiSetting(() => window.api.settings.setRerank(enabled), 'Could not change the rerank setting')
                  }} />{t('Enable reranking')}
                </label>
                <span className="spacer" />
                {consentGranted && <button className="btn sm" onClick={() => void changeAiSetting(
                  () => window.api.settings.resetRerankConsent(),
                  'Could not reset the sharing review',
                  'Qumaa will show the sharing review for this model next time.'
                )}>{t('Review sharing again')}</button>}
                <button className="btn sm danger" onClick={() => void changeAiSetting(
                  () => window.api.settings.setApiKey(null, rerankConfig.provider), 'Could not remove the API key'
                )}>{t('Remove key')}</button>
              </div>
            ) : (
              <div className="row">
                <label className="sr-only" htmlFor="rerank-api-key">{t('{provider} API key', { provider: providerLabel })}</label>
                <input
                  id="rerank-api-key" type="password" dir="ltr" autoComplete="off" spellCheck={false}
                  placeholder={rerankConfig.provider === 'anthropic' ? 'sk-ant-…' : 'sk-…'}
                  value={keyDraft} onChange={(event) => setKeyDraft(event.target.value)} className="api-key-input"
                />
                <button className="btn" disabled={!keyDraft.trim()} onClick={() => void changeAiSetting(async () => {
                  await window.api.settings.setApiKey(keyDraft, rerankConfig.provider)
                  setKeyDraft('')
                }, 'Could not save the API key securely', 'API key saved in protected operating-system storage.')}>{t('Save key')}</button>
              </div>
            )}
          </fieldset>
        </section>

        <section className="card setting setting-wide" aria-labelledby="data-heading">
          <h3 id="data-heading">{t("Library & backups")}</h3>
          {stats ? (
            <dl className="storage-stats">
              <div><dt>{t("Resumes")}</dt><dd>{formatNumber(stats.resumeCount)}</dd></div>
              <div><dt>{t("Indexed passages")}</dt><dd>{formatNumber(stats.chunkCount)}</dd></div>
              <div><dt>{t("Library size")}</dt><dd>{formatBytes(stats.dbSizeBytes)}</dd></div>
            </dl>
          ) : <div className="desc">{t("Loading library information…")}</div>}
          {stats && <code className="setting-path" dir="ltr">{stats.dbPath}</code>}
          {/* Uninstalling leaves this folder in place on both platforms, so the
              app has to be the thing that can remove it. */}
          <div className="desc">{t("Uninstalling the app does not remove this data.")}</div>
          <div className="desc">{t("Portable backups include resume text, companies, jobs, contacts, activity, talent pools, pipelines, submissions, screening kits, recruiter profiles, review notes, and portable preferences. On restore, Qumaa rebuilds the search index; refresh your saved jobs to generate updated matches. API keys, watched folders, original-file paths, consent, and window position are excluded. Backup files are not encrypted, so store them securely.")}</div>
          <div className="row">
            <button className="btn sm" disabled={dataAction !== null || aiBusy} onClick={() => void backUp()}>
              {t(dataAction === 'backup' ? 'Backing up…' : 'Back up…')}
            </button>
            <button className="btn sm" disabled={dataAction !== null || aiBusy} onClick={() => void restore()}>
              {t(dataAction === 'restore' ? 'Restoring…' : 'Restore…')}
            </button>
            <button className="btn sm" onClick={() => void window.api.settings.revealData()}>
              {t(revealLabel)}
            </button>
          </div>
          <div className="setting-danger">
            <div>
              <div className="label">{t("Delete local data")}</div>
              <p className="desc">{t("Remove all local CVs, companies, jobs, contacts, and recruiting records, and reset your preferences.")}</p>
            </div>
            <button className="btn sm danger" disabled={dataAction !== null || aiBusy} onClick={() => void wipe()}>{t("Delete all data…")}</button>
          </div>
        </section>

        <footer className="settings-creator setting-wide">
          <div>
            <span className="creator-label">{t("Created by")}</span>
            <bdi className="creator-name" lang="en">Fawaz Aljathnan</bdi>
          </div>
          <a
            className="creator-link"
            href="https://www.linkedin.com/in/fawazsalehq/"
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("View Fawaz Aljathnan on LinkedIn (opens in your browser)")}
            onClick={(event) => {
              event.preventDefault()
              void window.api.settings.openLinkedIn().catch((error: unknown) => {
                onToast([{
                  id: crypto.randomUUID(),
                  kind: 'error',
                  message: errorMessage(error, 'Could not open LinkedIn')
                }])
              })
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <path d="M20.45 2H3.55C2.69 2 2 2.68 2 3.53v16.94C2 21.32 2.69 22 3.55 22h16.9c.86 0 1.55-.68 1.55-1.53V3.53C22 2.68 21.31 2 20.45 2ZM7.93 18.75H4.98V9.2h2.95v9.55ZM6.46 7.9a1.71 1.71 0 1 1 0-3.42 1.71 1.71 0 0 1 0 3.42Zm12.29 10.85H15.8V14.1c0-1.11-.02-2.54-1.55-2.54-1.55 0-1.79 1.21-1.79 2.46v4.73H9.51V9.2h2.83v1.31h.04c.39-.75 1.36-1.55 2.79-1.55 2.99 0 3.58 1.97 3.58 4.53v5.26Z" />
            </svg>
            <span>{t("LinkedIn")}</span>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M7 17 17 7M7 7h10v10" />
            </svg>
          </a>
        </footer>
      </div>
    </>
  )
}
