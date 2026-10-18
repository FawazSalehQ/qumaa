import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import type { JobWorkspace } from '@shared/recruiting.js'
import type { ClaudeRerankReview } from '@shared/types.js'
import { DEFAULT_RERANK_CONFIG, isChatGptConfig, sameRerankConfig, rerankProviderLabel, rerankModelLabel, type RerankConfig } from '@shared/rerank.js'
import { useI18n } from '../../i18n.js'
import { errorMessage } from './helpers.js'

interface Props {
  workspace: JobWorkspace
  active: boolean
  disabled: boolean
  libraryRevision: number
  onBusyChange: (busy: boolean) => void
  onError: (message: string | null) => void
  onReranked: (workspace: JobWorkspace, sourceSessionId: string) => void
  onSavedAfterInvalidation: (jobId: string) => void
}

type Phase = 'idle' | 'preview' | 'consent' | 'rerank'
interface PendingConsent extends ClaudeRerankReview {
  jobId: string
  sessionId: string
  request: number
}

/** Optional remote ordering belongs to the exact saved job and local result snapshot. */
export default function JobRerank({ workspace, active, disabled, libraryRevision, onBusyChange, onError, onReranked, onSavedAfterInvalidation }: Props): React.JSX.Element {
  const { t, formatNumber } = useI18n()
  const [available, setAvailable] = useState(false)
  const [chatGptAccountLabel, setChatGptAccountLabel] = useState('')
  const [chatGptFailure, setChatGptFailure] = useState(false)
  const [config, setConfig] = useState<RerankConfig>(DEFAULT_RERANK_CONFIG)
  const [phase, setPhase] = useState<Phase>('idle')
  const [pendingConsent, setPendingConsent] = useState<PendingConsent | null>(null)
  const [showExportedData, setShowExportedData] = useState(false)
  const exportedDataId = useId()
  const phaseRef = useRef<Phase>('idle')
  const requestEpoch = useRef(0)
  const inFlight = useRef<number | null>(null)
  const rerankButtonRef = useRef<HTMLButtonElement>(null)
  const consentDialogRef = useRef<HTMLElement>(null)
  const consentCancelRef = useRef<HTMLButtonElement>(null)
  const jobId = workspace.job.id
  const sessionId = workspace.response?.sessionId
  const reranked = workspace.response?.reranked === true
  const appliedConfig = workspace.response?.rerankConfig ?? DEFAULT_RERANK_CONFIG
  const rerankedWithSelectedModel = reranked && sameRerankConfig(appliedConfig, config)
  const selectedProviderLabel = rerankProviderLabel(config)
  const selectedModelLabel = rerankModelLabel(config.model) || selectedProviderLabel

  const updatePhase = useCallback((next: Phase): void => {
    phaseRef.current = next
    setPhase(next)
    onBusyChange(next !== 'idle')
  }, [onBusyChange])

  const invalidate = useCallback((): void => {
    ++requestEpoch.current
    inFlight.current = null
    setPendingConsent(null)
    setShowExportedData(false)
    setChatGptFailure(false)
    updatePhase('idle')
  }, [updatePhase])

  // Revoke previews and async completions before paint when their source changes.
  // The parent's own rerank busy flag is deliberately excluded from `disabled`.
  useLayoutEffect(() => {
    invalidate()
    return () => {
      ++requestEpoch.current
      inFlight.current = null
      onBusyChange(false)
    }
  }, [jobId, sessionId, libraryRevision, workspace.job.stale, disabled, config.provider, config.model, config.authMode, invalidate, onBusyChange])

  useLayoutEffect(() => {
    // A send already approved through the native dialog may finish while Jobs is
    // hidden. Its result still belongs here if the source snapshot is unchanged.
    if (!active && phaseRef.current !== 'rerank') invalidate()
  }, [active, invalidate])

  useEffect(() => {
    let cancelled = false
    setAvailable(false)
    if (active) {
      void window.api.settings.get().then((settings) => {
        if (!cancelled) {
          setConfig({ provider: settings.rerankProvider, model: settings.rerankModel, ...(settings.rerankAuthMode === 'chatgpt' ? { authMode: 'chatgpt' as const } : {}) })
          setAvailable(settings.hasRerankCredential && settings.rerankEnabled)
          setChatGptAccountLabel(settings.chatGpt.accounts.find((account) => account.id === settings.chatGpt.activeAccountId)?.label ?? '')
        }
      }).catch(() => { /* Keep remote actions disabled if settings cannot be read. */ })
    }
    return () => { cancelled = true }
  }, [active])

  const current = (request: number): boolean => requestEpoch.current === request && inFlight.current === request

  const send = async (request: PendingConsent): Promise<void> => {
    if (!current(request.request) || phaseRef.current === 'rerank') return
    setPendingConsent(null)
    updatePhase('rerank')
    try {
      const result = await window.api.recruiting.rerank({ jobId: request.jobId, sessionId: request.sessionId, approvalToken: request.approvalToken })
      if (!current(request.request)) {
        // Imports can invalidate the UI without changing any CVs. A send that
        // still passed main-process checks may have saved; reload the open job
        // instead of applying this now-obsolete response to its newer workspace.
        onSavedAfterInvalidation(request.jobId)
        return
      }
      inFlight.current = null
      updatePhase('idle')
      onReranked(result, request.sessionId)
    } catch (failure) {
      if (current(request.request)) {
        onError(errorMessage(failure))
        setChatGptFailure(isChatGptConfig(config))
      }
    } finally {
      if (current(request.request)) {
        inFlight.current = null
        updatePhase('idle')
      }
    }
  }

  const run = async (): Promise<void> => {
    if (!active || !available || disabled || workspace.job.stale || rerankedWithSelectedModel || !sessionId || (workspace.response?.results.length ?? 0) < 2 || inFlight.current !== null) return
    const request = ++requestEpoch.current
    inFlight.current = request
    onError(null)
    setChatGptFailure(false)
    updatePhase('preview')
    try {
      const review = await window.api.recruiting.previewRerank({ jobId, sessionId })
      if (!current(request)) return
      const pending = { ...review, jobId, sessionId, request }
      if (review.consentRequired) {
        setShowExportedData(false)
        setPendingConsent(pending)
        updatePhase('consent')
      } else {
        await send(pending)
      }
    } catch (failure) {
      if (current(request)) {
        inFlight.current = null
        updatePhase('idle')
        onError(errorMessage(failure))
        setChatGptFailure(isChatGptConfig(config))
      }
    }
  }

  useEffect(() => {
    if (!pendingConsent) return
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : rerankButtonRef.current
    const dialog = consentDialogRef.current
    const focusable = (): HTMLElement[] => dialog ? Array.from(dialog.querySelectorAll<HTMLElement>(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )) : []
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        invalidate()
        requestAnimationFrame(() => rerankButtonRef.current?.focus())
        return
      }
      if (event.key !== 'Tab') return
      const items = focusable()
      if (items.length === 0) { event.preventDefault(); dialog?.focus(); return }
      const first = items[0]
      const last = items[items.length - 1]
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
    }
    const keepFocusInside = (event: FocusEvent): void => {
      if (dialog && event.target instanceof Node && !dialog.contains(event.target)) consentCancelRef.current?.focus()
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', keepFocusInside)
    consentCancelRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', keepFocusInside)
      if (!previousFocus?.closest('[hidden]')) previousFocus?.focus()
    }
  }, [pendingConsent, invalidate])

  return <>
    {reranked && <span className="hint" role="status">{t(isChatGptConfig(appliedConfig) ? 'Reordered by {model} · ChatGPT plan' : 'Reordered by {model}', { model: rerankModelLabel(appliedConfig.model) })}</span>}
    {!rerankedWithSelectedModel && <button
      ref={rerankButtonRef}
      className="btn sm"
      type="button"
      disabled={!active || !available || disabled || workspace.job.stale || !sessionId || (workspace.response?.results.length ?? 0) < 2 || phase !== 'idle'}
      title={!available ? `${t('Reranking is not enabled.')} ${t('Settings')} · ${t('AI reranking')}` : workspace.job.stale ? t('Refresh matches') : t("Sends the posting fields and the top candidates' matching passages to {provider}", { provider: selectedProviderLabel })}
      onClick={() => { void run() }}
    >{phase === 'rerank' ? t('Reranking…') : phase === 'preview' ? t('Preparing preview…') : t('Rerank with {model}', { model: selectedModelLabel })}</button>}
    {chatGptFailure && <div className="row chatgpt-request-help" role="status">
      {chatGptAccountLabel && <span className="hint">{t('ChatGPT account')}: <bdi>{chatGptAccountLabel}</bdi></span>}
      <button className="btn sm primary" type="button" onClick={() => {
        void window.api.settings.chatGptManageUsage().catch((failure: unknown) => onError(errorMessage(failure)))
      }}>{t('Manage usage')}</button>
    </div>}
    {pendingConsent && active && <div className="consent-backdrop">
      <section ref={consentDialogRef} className="consent-dialog card" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="rerank-consent-title">
        <h3 id="rerank-consent-title">{t('Review data sent to {provider}', { provider: pendingConsent.preview.provider })}</h3>
        <p>{t('{model} sends data to {provider} to reorder these {count} candidates.', { model: rerankModelLabel(pendingConsent.preview.model), provider: pendingConsent.preview.provider, count: formatNumber(pendingConsent.preview.candidateCount) })}</p>
        <dl className="consent-summary">
          <div><dt>{t('Sent')}</dt><dd>{t('The job posting, selected CV passages, years of experience, education, and matched or missing skills.')}</dd></div>
          <div><dt>{t('Redacted')}</dt><dd>{t('Detected names, contact details, locations, filenames, and local paths.')}</dd></div>
          {pendingConsent.preview.authMode === 'chatgpt' ? <>
            <div><dt>{t('ChatGPT account')}</dt><dd><bdi>{pendingConsent.preview.accountLabel}</bdi></dd></div>
            <div><dt>{t('ChatGPT plan')}</dt><dd>{t('This request uses your ChatGPT allowance or credits. Sign-in credentials are never included in the data preview.')}</dd></div>
          </> : <div><dt>{t('API key')}</dt><dd>{t('Used separately to authenticate the request. It is not included in the data preview.')}</dd></div>}
        </dl>
        <button className="btn sm consent-data-toggle" type="button" aria-expanded={showExportedData} aria-controls={exportedDataId} onClick={() => setShowExportedData((show) => !show)}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
            <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
          {t(showExportedData ? 'Hide exported data' : 'See exported data')}
        </button>
        <div id={exportedDataId} hidden={!showExportedData}>
          {showExportedData && <>
            <h4>{t('Exact outbound request')}</h4>
            <pre className="consent-payload" dir="ltr" tabIndex={0} aria-label={t('Exact outbound request')}>{JSON.stringify(pendingConsent.preview.requestBody, null, 2)}</pre>
          </>}
        </div>
        <p className="consent-note">{t('Regular matching stays on your device. This approval is remembered for this provider and model until the data policy changes. Each rerank still needs a separate confirmation before sending.')}</p>
        <div className="row consent-actions">
          <button ref={consentCancelRef} className="btn" type="button" onClick={() => {
            invalidate()
            requestAnimationFrame(() => rerankButtonRef.current?.focus())
          }}>{t('Cancel')}</button>
          <button className="btn primary" type="button" onClick={() => { void send(pendingConsent) }}>{t('Approve and send')}</button>
        </div>
      </section>
    </div>}
  </>
}
