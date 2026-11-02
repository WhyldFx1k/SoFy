import { useEffect, useRef } from 'react'
import { Heart, ImagePlus, ListPlus, MessageSquareText, Pause, Play } from 'lucide-react'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'

const MENU_WIDTH = 248
const MENU_HEIGHT = 244
const EDGE = 10

export function TrackMenu() {
  const menu = useUi((state) => state.trackMenu)
  const close = useUi((state) => state.closeTrackMenu)
  const openLyrics = useUi((state) => state.openLyrics)
  const openPicker = useUi((state) => state.openPicker)
  const toggleLike = useUi((state) => state.toggleLike)
  const changeTrackCover = useUi((state) => state.changeTrackCover)
  const liked = useUi((state) =>
    menu ? state.likes.some((item) => item.id === menu.track.id) : false
  )

  const playQueue = usePlayer((state) => state.playQueue)
  const currentId = usePlayer((state) => state.track?.id)
  const playing = usePlayer((state) => state.playing)

  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const frame = requestAnimationFrame(() => {
      panelRef.current?.querySelector<HTMLButtonElement>('button')?.focus({ preventScroll: true })
    })
    const onPointerDown = (event: PointerEvent): void => {
      if (panelRef.current && event.target instanceof Node && panelRef.current.contains(event.target)) {
        return
      }
      close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        close()
      }
    }
    const onDismiss = (): void => close()

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
  }, [menu, close])

  if (!menu) return null

  const left = Math.max(EDGE, Math.min(menu.x, window.innerWidth - MENU_WIDTH - EDGE))
  const top = Math.max(EDGE, Math.min(menu.y, window.innerHeight - MENU_HEIGHT - EDGE))
  const isCurrent = currentId === menu.track.id

  return (
    <div
      className="ctx-menu ctx-menu--track"
      role="menu"
      aria-label={`Трек «${menu.track.title}»`}
      ref={panelRef}
      style={{ left, top }}
    >
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          close()
          playQueue(menu.queue, menu.index)
        }}
      >
        {isCurrent && playing ? <Pause size={15} strokeWidth={1.9} /> : <Play size={15} strokeWidth={1.9} />}
        {isCurrent && playing ? 'Пауза' : 'Слушать'}
      </button>
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          close()
          openLyrics(menu.track)
        }}
      >
        <MessageSquareText size={15} strokeWidth={1.9} />
        Текст песни
      </button>
      <span className="ctx-menu__sep" role="separator" />
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          close()
          void toggleLike(menu.track)
        }}
      >
        <Heart size={15} strokeWidth={1.9} fill={liked ? 'currentColor' : 'none'} />
        {liked ? 'Убрать из любимого' : 'В любимое'}
      </button>
      <button
        type="button"
        className="ctx-menu__item"
        role="menuitem"
        onClick={() => {
          close()
          openPicker(menu.track)
        }}
      >
        <ListPlus size={15} strokeWidth={1.9} />
        Добавить в плейлист
      </button>
      {menu.track.provider === 'local' && (
        <>
          <span className="ctx-menu__sep" role="separator" />
          <button
            type="button"
            className="ctx-menu__item"
            role="menuitem"
            onClick={() => {
              const track = menu.track
              close()
              void changeTrackCover(track)
            }}
          >
            <ImagePlus size={15} strokeWidth={1.9} />
            Изменить обложку
          </button>
        </>
      )}
    </div>
  )
}
