import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { FileText, Image as ImageIcon, Shuffle, Trash2 } from 'lucide-react'
import { useUi } from '../store/ui'

const MENU_WIDTH = 232
const MENU_HEIGHT = 188
const EDGE = 10

function MoreDots() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="4" cy="12" r="2" />
      <circle cx="12" cy="12" r="2" />
      <circle cx="20" cy="12" r="2" />
    </svg>
  )
}

interface Props {
  playlistId: string
  playlistName: string
  shuffleDisabled: boolean
  onShuffle: () => void
  onDelete: () => void
}

export function PlaylistHeaderMenu({
  playlistId,
  playlistName,
  shuffleDisabled,
  onShuffle,
  onDelete
}: Props) {
  const changePlaylistCover = useUi((state) => state.changePlaylistCover)
  const requestDescriptionEdit = useUi((state) => state.requestDescriptionEdit)

  const [anchor, setAnchor] = useState<{ left: number; top: number } | null>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!anchor) return
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    })
    const onPointerDown = (event: PointerEvent): void => {
      if (!(event.target instanceof Node)) return
      if (panelRef.current?.contains(event.target) || buttonRef.current?.contains(event.target)) {
        return
      }
      setAnchor(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        setAnchor(null)
      }
    }
    const onDismiss = (): void => setAnchor(null)

    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('blur', onDismiss)
    window.addEventListener('resize', onDismiss)
    window.addEventListener('scroll', onDismiss, true)
    window.addEventListener('wheel', onDismiss, { passive: true })
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('blur', onDismiss)
      window.removeEventListener('resize', onDismiss)
      window.removeEventListener('scroll', onDismiss, true)
      window.removeEventListener('wheel', onDismiss)
    }
  }, [anchor])

  const toggle = (): void => {
    if (anchor) {
      setAnchor(null)
      return
    }
    const rect = buttonRef.current?.getBoundingClientRect()
    if (!rect) return
    setAnchor({
      left: Math.max(EDGE, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - EDGE)),
      top: Math.max(EDGE, Math.min(rect.bottom + 8, window.innerHeight - MENU_HEIGHT - EDGE))
    })
  }

  const run = (action: () => void): void => {
    setAnchor(null)
    action()
  }

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        className={`btn btn--ghost btn--round playlist-actions__more ${anchor ? 'is-open' : ''}`}
        aria-label="Ещё действия с плейлистом"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={toggle}
      >
        <MoreDots />
      </button>

      {anchor &&
        createPortal(
          <div
            className="ctx-menu ctx-menu--header"
            role="menu"
            aria-label={`Действия с плейлистом «${playlistName}»`}
            ref={panelRef}
            style={{ left: anchor.left, top: anchor.top }}
          >
            <button
              type="button"
              className="ctx-menu__item"
              role="menuitem"
              disabled={shuffleDisabled}
              onClick={() => run(onShuffle)}
            >
              <Shuffle size={15} strokeWidth={1.9} />
              Смешать
            </button>
            <span className="ctx-menu__sep" role="separator" />
            <button
              type="button"
              className="ctx-menu__item"
              role="menuitem"
              onClick={() => run(() => void changePlaylistCover(playlistId, playlistName))}
            >
              <ImageIcon size={15} strokeWidth={1.9} />
              Изменить обложку
            </button>
            <button
              type="button"
              className="ctx-menu__item"
              role="menuitem"
              onClick={() => run(() => requestDescriptionEdit(playlistId))}
            >
              <FileText size={15} strokeWidth={1.9} />
              Изменить описание
            </button>
            <span className="ctx-menu__sep" role="separator" />
            <button
              type="button"
              className="ctx-menu__item ctx-menu__item--danger"
              role="menuitem"
              onClick={() => run(onDelete)}
            >
              <Trash2 size={15} strokeWidth={1.9} />
              Удалить плейлист
            </button>
          </div>,
          document.body
        )}
    </>
  )
}
