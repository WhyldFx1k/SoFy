import { useEffect, useRef, useState } from 'react'
import { FileText, Image as ImageIcon, ListMusic, Trash2 } from 'lucide-react'
import { ConfirmDialog } from './ConfirmDialog'
import { useUi } from '../store/ui'

const MENU_WIDTH = 236
const MENU_HEIGHT = 186
const EDGE = 10

export function PlaylistMenu() {
  const menu = useUi((state) => state.playlistMenu)
  const closeMenu = useUi((state) => state.closePlaylistMenu)
  const navigate = useUi((state) => state.navigate)
  const deletePlaylist = useUi((state) => state.deletePlaylist)
  const changePlaylistCover = useUi((state) => state.changePlaylistCover)
  const requestDescriptionEdit = useUi((state) => state.requestDescriptionEdit)

  const panelRef = useRef<HTMLDivElement>(null)
  const [pending, setPending] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    if (!menu) return
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    })
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) {
        return
      }
      closeMenu()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        closeMenu()
      }
    }
    const onDismiss = (): void => closeMenu()

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
  }, [menu, closeMenu])

  if (!menu && !pending) return null

  const left = menu
    ? Math.max(EDGE, Math.min(menu.x, window.innerWidth - MENU_WIDTH - EDGE))
    : 0
  const top = menu
    ? Math.max(EDGE, Math.min(menu.y, window.innerHeight - MENU_HEIGHT - EDGE))
    : 0

  const openPlaylist = (): void => {
    if (!menu) return
    closeMenu()
    navigate({ name: 'playlist', id: menu.id })
  }

  const askDelete = (): void => {
    if (!menu) return
    setPending({ id: menu.id, name: menu.name })
    closeMenu()
  }

  const changeCover = (): void => {
    if (!menu) return
    const { id, name } = menu
    closeMenu()
    void changePlaylistCover(id, name)
  }

  const editDescription = (): void => {
    if (!menu) return
    const id = menu.id
    closeMenu()
    requestDescriptionEdit(id)
  }

  const confirmDelete = async (): Promise<void> => {
    if (!pending) return
    const removed = await deletePlaylist(pending.id, pending.name)
    if (removed) setPending(null)
  }

  return (
    <>
      {menu && (
        <div
          className="ctx-menu"
          role="menu"
          aria-label={`Плейлист «${menu.name}»`}
          ref={panelRef}
          style={{ left, top }}
        >
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={openPlaylist}>
            <ListMusic size={15} strokeWidth={1.9} />
            Открыть плейлист
          </button>
          <span className="ctx-menu__sep" role="separator" />
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={changeCover}>
            <ImageIcon size={15} strokeWidth={1.9} />
            Изменить обложку
          </button>
          <button type="button" className="ctx-menu__item" role="menuitem" onClick={editDescription}>
            <FileText size={15} strokeWidth={1.9} />
            Изменить описание
          </button>
          <span className="ctx-menu__sep" role="separator" />
          <button
            type="button"
            className="ctx-menu__item ctx-menu__item--danger"
            role="menuitem"
            onClick={askDelete}
          >
            <Trash2 size={15} strokeWidth={1.9} />
            Удалить плейлист
          </button>
        </div>
      )}

      <ConfirmDialog
        open={pending !== null}
        title="Удалить плейлист?"
        description={
          pending
            ? `«${pending.name}» исчезнет вместе с треками. Это действие нельзя отменить.`
            : ''
        }
        onCancel={() => setPending(null)}
        onConfirm={confirmDelete}
      />
    </>
  )
}
