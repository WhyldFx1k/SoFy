import { useEffect } from 'react'
import { X } from 'lucide-react'
import { useUi } from '../store/ui'
import { Cover } from './Cover'
import { LyricsView } from './LyricsView'

export function LyricsDrawer() {
  const track = useUi((state) => state.lyricsTrack)
  const close = useUi((state) => state.closeLyrics)

  useEffect(() => {
    if (!track) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      const ui = useUi.getState()
      if (ui.trackMenu || ui.playlistMenu || ui.newPlaylistOpen || ui.pickerTrack) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [track, close])

  if (!track) return null

  return (
    <aside className="lyrics-drawer" aria-label="Текст песни">
      <header className="lyrics-drawer__head">
        <Cover track={track} size={46} rounded={13} />
        <div className="lyrics-drawer__titles">
          <span className="lyrics-drawer__eyebrow">Текст песни</span>
          <h2>{track.title}</h2>
          <p>{track.artist}</p>
        </div>
        <button type="button" className="icon-btn" onClick={close} aria-label="Закрыть текст">
          <X size={17} />
        </button>
      </header>
      <LyricsView key={track.id} track={track} />
    </aside>
  )
}
