import { useEffect } from 'react'

export interface Toast {
  id: string
  kind: 'success' | 'error' | 'info'
  message: string
}

/** Auto-dismisses after a delay; errors linger longer since they need reading. */
function ToastItem({
  toast,
  onDismiss
}: {
  toast: Toast
  onDismiss: (id: string) => void
}): React.JSX.Element {
  useEffect(() => {
    const ms = toast.kind === 'error' ? 8000 : 4000
    const t = setTimeout(() => onDismiss(toast.id), ms)
    return () => clearTimeout(t)
  }, [toast.id, toast.kind, onDismiss])

  return (
    <div
      className={`toast ${toast.kind}`}
      role={toast.kind === 'error' ? 'alert' : 'status'}
      aria-live={toast.kind === 'error' ? 'assertive' : 'polite'}
      onClick={() => onDismiss(toast.id)}
    >
      {toast.message}
    </div>
  )
}

export default function Toasts({
  toasts,
  onDismiss
}: {
  toasts: Toast[]
  onDismiss: (id: string) => void
}): React.JSX.Element {
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <ToastItem key={t.id} toast={t} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
