import { useEffect, useState } from 'react'
import { AlertTriangle, X } from 'lucide-react'

interface ConfirmDialogProps {
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  busyLabel?: string
  onCancel: () => void
  onConfirm: () => Promise<void> | void
}

export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Удалить',
  busyLabel = 'Удаляем…',
  onCancel,
  onConfirm
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setBusy(false)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onCancel()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const confirm = async (): Promise<void> => {
    if (busy) return
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="modal modal--front" role="dialog" aria-modal="true" aria-label={title}>
      <div className="modal__backdrop" onClick={() => !busy && onCancel()} />
      <div className="modal__panel modal__panel--narrow confirm">
        <header className="modal__head">
          <div className="modal__titles">
            <h2>{title}</h2>
          </div>
          <button type="button" className="icon-btn" onClick={onCancel} aria-label="Закрыть" disabled={busy}>
            <X size={17} />
          </button>
        </header>
        <div className="modal__body confirm__body">
          <span className="confirm__icon" aria-hidden="true">
            <AlertTriangle size={19} />
          </span>
          <p>{description}</p>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={onCancel} disabled={busy}>
            Отмена
          </button>
          <button type="button" className="btn btn--danger" onClick={() => void confirm()} disabled={busy}>
            {busy ? busyLabel : confirmLabel}
          </button>
        </footer>
      </div>
    </div>
  )
}
