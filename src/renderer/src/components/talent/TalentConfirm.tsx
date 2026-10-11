import { useLayoutEffect, useRef, type ReactNode } from 'react'
import { useI18n } from '../../i18n.js'

interface Props {
  title: string
  children: ReactNode
  confirmLabel: string
  busy: boolean
  destructive?: boolean
  onCancel: () => void
  onConfirm: () => void
}

/** Native dialogs trap focus and keep background controls out of a confirmation. */
export default function TalentConfirm({ title, children, confirmLabel, busy, destructive, onCancel, onConfirm }: Props): React.JSX.Element {
  const { t } = useI18n()
  const dialog = useRef<HTMLDialogElement>(null)
  useLayoutEffect(() => {
    const element = dialog.current
    element?.showModal()
    return () => { if (element?.open) element.close() }
  }, [])
  return <dialog className="talent-confirm" ref={dialog} aria-labelledby="talent-confirm-title" onCancel={(event) => { event.preventDefault(); if (!busy) onCancel() }}>
    <h3 id="talent-confirm-title">{title}</h3>
    <div className="talent-confirm-body">{children}</div>
    <div className="talent-actions"><button type="button" className={`btn ${destructive ? 'danger' : 'primary'}`} disabled={busy} onClick={onConfirm}>{busy ? t('Saving…') : confirmLabel}</button><button type="button" className="btn" disabled={busy} autoFocus onClick={onCancel}>{t('Cancel')}</button></div>
  </dialog>
}
