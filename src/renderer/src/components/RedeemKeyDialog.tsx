import { useEffect, useRef, useState, type FormEvent } from 'react'
import { KeyRound, Loader2, X } from 'lucide-react'
import { useUi } from '../store/ui'

export function RedeemKeyDialog() {
  const open = useUi((state) => state.redeemKeyOpen)
  const close = useUi((state) => state.closeRedeemKey)
  const redeem = useUi((state) => state.redeemAccessKey)

  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const busyRef = useRef(false)

  useEffect(() => {
    busyRef.current = busy
  }, [busy])

  useEffect(() => {
    if (!open) return
    setKey('')
    setBusy(false)
    setError(null)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && !busyRef.current) close()
    }
    window.addEventListener('keydown', onKey)
    return () => {
      window.clearTimeout(timer)
      window.removeEventListener('keydown', onKey)
    }
  }, [open, close])

  if (!open) return null

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    if (!key.trim()) {
      setError('Введите ключ доступа')
      return
    }
    setBusy(true)
    setError(null)
    const failure = await redeem(key.trim().toUpperCase())
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    close()
  }

  return (
    <div className="modal modal--front" role="dialog" aria-modal="true" aria-label="Ключ доступа">
      <div className="modal__backdrop" onClick={() => !busy && close()} />
      <form className="modal__panel modal__panel--narrow" onSubmit={(event) => void submit(event)}>
        <header className="modal__head">
          <div className="modal__titles">
            <h2>Ключ доступа</h2>
            <p className="modal__subtitle">Один ключ — одна роль. Ключ срабатывает один раз</p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Закрыть">
            <X size={17} />
          </button>
        </header>
        <div className="modal__body">
          <label className="field">
            <span className="field__label">Ключ</span>
            <input
              ref={inputRef}
              className="input admin-key-input"
              value={key}
              maxLength={40}
              spellCheck={false}
              autoComplete="off"
              placeholder="SOFY-XXXX-XXXX-XXXX-XXXX"
              onChange={(event) => setKey(event.target.value.toUpperCase())}
            />
          </label>
          <p className="admin-key-hint">
            <KeyRound size={14} />
            После активации роль в профиле обновится сразу.
          </p>
          {error && (
            <p className="admin-key-error" role="alert">
              {error}
            </p>
          )}
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !key.trim()}>
            {busy ? <Loader2 size={15} className="spin" /> : null}
            Активировать
          </button>
        </footer>
      </form>
    </div>
  )
}
