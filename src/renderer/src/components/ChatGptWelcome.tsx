import { useEffect, useRef } from 'react'
import { useI18n } from '../i18n.js'

/** The first connection explains billing before optional sharing is enabled. */
export default function ChatGptWelcome({ busy, onDismiss, onManageUsage }: {
  busy: boolean
  onDismiss: () => Promise<void>
  onManageUsage: () => Promise<void>
}): React.JSX.Element {
  const { t } = useI18n()
  const panelRef = useRef<HTMLElement>(null)
  const dismissRef = useRef<HTMLButtonElement>(null)
  const latest = useRef({ busy, onDismiss })
  latest.current = { busy, onDismiss }

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const panel = panelRef.current
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!latest.current.busy) void latest.current.onDismiss()
        return
      }
      if (event.key !== 'Tab') return
      const items = Array.from(panel?.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]') ?? [])
      if (!items.length) { event.preventDefault(); panel?.focus(); return }
      if (event.shiftKey && document.activeElement === items[0]) { event.preventDefault(); items.at(-1)?.focus() }
      else if (!event.shiftKey && document.activeElement === items.at(-1)) { event.preventDefault(); items[0].focus() }
    }
    const keepFocusInside = (event: FocusEvent): void => {
      if (panel && event.target instanceof Node && !panel.contains(event.target)) {
        if (!dismissRef.current?.disabled) dismissRef.current?.focus()
        else panel.focus()
      }
    }
    document.addEventListener('keydown', onKeyDown)
    document.addEventListener('focusin', keepFocusInside)
    dismissRef.current?.focus()
    return () => {
      document.removeEventListener('keydown', onKeyDown)
      document.removeEventListener('focusin', keepFocusInside)
      previousFocus?.focus()
    }
  }, [])

  return <div className="consent-backdrop">
    <section ref={panelRef} className="consent-dialog card" role="dialog" tabIndex={-1} aria-modal="true" aria-labelledby="chatgpt-welcome-title">
      <h3 id="chatgpt-welcome-title">{t('You’re using your ChatGPT plan')}</h3>
      <p>{t('Eligible Qumaa requests use the allowance or credits available through your ChatGPT plan. Limits depend on your plan; you can review usage in ChatGPT.')}</p>
      <p>{t('Local matching stays on this device. Connecting does not enable AI reranking: choose a model and turn it on when you are ready. You still review the shared evidence and confirm every send.')}</p>
      <div className="row consent-actions">
        <button className="btn" type="button" disabled={busy} onClick={() => { void onManageUsage() }}>{t('Manage usage')}</button>
        <button ref={dismissRef} className="btn primary" type="button" disabled={busy} onClick={() => { void onDismiss() }}>{t('Got it')}</button>
      </div>
    </section>
  </div>
}
