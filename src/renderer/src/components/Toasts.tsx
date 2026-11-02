import { AlertCircle, CircleCheck, Info, X } from 'lucide-react'
import { useUi } from '../store/ui'

export function Toasts() {
  const toasts = useUi((state) => state.toasts)
  const dismiss = useUi((state) => state.dismissToast)

  if (toasts.length === 0) return null

  return (
    <div className="toasts" role="status" aria-live="polite">
      {toasts.map((toast) => {
        const Icon = toast.kind === 'success' ? CircleCheck : toast.kind === 'error' ? AlertCircle : Info
        const ttl = toast.kind === 'error' ? 6000 : 3800
        return (
          <div
            key={toast.id}
            className={`toast toast--${toast.kind} ${toast.leaving ? 'is-leaving' : ''}`}
            style={{ ['--toast-ttl' as string]: `${ttl}ms` }}
          >
            <span className="toast__rail" aria-hidden="true" />
            <Icon size={17} className="toast__icon" />
            <span className="toast__text">{toast.message}</span>
            <button
              type="button"
              className="toast__close"
              onClick={() => dismiss(toast.id)}
              aria-label="Скрыть уведомление"
            >
              <X size={13} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
