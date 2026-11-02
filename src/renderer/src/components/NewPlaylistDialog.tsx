import { useEffect, useRef, useState, type FormEvent } from 'react'
import { X } from 'lucide-react'
import { useUi } from '../store/ui'

export function NewPlaylistDialog() {
  const open = useUi((state) => state.newPlaylistOpen)
  const close = useUi((state) => state.closeNewPlaylist)
  const createPlaylist = useUi((state) => state.createPlaylist)
  const addToPlaylist = useUi((state) => state.addToPlaylist)
  const pickerTrack = useUi((state) => state.pickerTrack)
  const closePicker = useUi((state) => state.closePicker)

  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setName('')
    setBusy(false)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60)
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
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
    const trimmed = name.trim()
    if (!trimmed || busy) return
    setBusy(true)
    const playlist = await createPlaylist(trimmed)
    setBusy(false)
    if (!playlist) return
    if (pickerTrack) {
      await addToPlaylist(playlist.id, playlist.name, pickerTrack)
      closePicker()
    }
    close()
  }

  return (
    <div className="modal modal--front" role="dialog" aria-modal="true" aria-label="Новый плейлист">
      <div className="modal__backdrop" onClick={close} />
      <form className="modal__panel modal__panel--narrow" onSubmit={(event) => void submit(event)}>
        <header className="modal__head">
          <div className="modal__titles">
            <h2>Новый плейлист</h2>
            <p className="modal__subtitle">Соберите треки под настроение</p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Закрыть">
            <X size={17} />
          </button>
        </header>
        <div className="modal__body">
          <label className="field">
            <span className="field__label">Название</span>
            <input
              ref={inputRef}
              className="input"
              value={name}
              maxLength={80}
              placeholder="Например, «Ночная поездка»"
              onChange={(event) => setName(event.target.value)}
            />
          </label>
        </div>
        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={close}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
            {busy ? 'Создаём…' : 'Создать'}
          </button>
        </footer>
      </form>
    </div>
  )
}
