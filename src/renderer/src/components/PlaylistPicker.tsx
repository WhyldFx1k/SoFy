import { useEffect, useState } from 'react'
import { ListMusic, Plus, X } from 'lucide-react'
import { plural } from '../lib/format'
import { useUi } from '../store/ui'

export function PlaylistPicker() {
  const track = useUi((state) => state.pickerTrack)
  const playlists = useUi((state) => state.playlists)
  const close = useUi((state) => state.closePicker)
  const openNewPlaylist = useUi((state) => state.openNewPlaylist)
  const addToPlaylist = useUi((state) => state.addToPlaylist)
  const newPlaylistOpen = useUi((state) => state.newPlaylistOpen)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    if (!track) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (useUi.getState().newPlaylistOpen) return
      close()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [track, close])

  // Note: the new-playlist dialog stacks above this picker and handles Escape itself.

  if (!track || newPlaylistOpen) return null

  const add = async (playlistId: string, playlistName: string): Promise<void> => {
    setBusyId(playlistId)
    const ok = await addToPlaylist(playlistId, playlistName, track)
    setBusyId(null)
    if (ok) close()
  }

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-label="Добавить в плейлист">
      <div className="modal__backdrop" onClick={close} />
      <div className="modal__panel">
        <header className="modal__head">
          <div className="modal__titles">
            <h2>Добавить в плейлист</h2>
            <p className="modal__subtitle">
              {track.title} <span>·</span> {track.artist}
            </p>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Закрыть">
            <X size={17} />
          </button>
        </header>

        <div className="modal__body">
          {playlists.length === 0 ? (
            <div className="empty-inline">
              <ListMusic size={22} />
              <p>Плейлистов пока нет. Создайте первый — это займёт секунду.</p>
            </div>
          ) : (
            playlists.map((playlist) => (
              <button
                type="button"
                key={playlist.id}
                className="picker-row"
                onClick={() => void add(playlist.id, playlist.name)}
                disabled={busyId !== null}
              >
                <span className={`picker-row__art ${playlist.cover ? 'has-cover' : ''}`} aria-hidden="true">
                  {playlist.cover ? (
                    <img src={playlist.cover} alt="" draggable={false} />
                  ) : (
                    <ListMusic size={17} />
                  )}
                </span>
                <span className="picker-row__meta">
                  <span className="picker-row__name">{playlist.name}</span>
                  <span className="picker-row__count">
                    {playlist.trackCount} {plural(playlist.trackCount, 'трек', 'трека', 'треков')}
                  </span>
                </span>
                <span className={`picker-row__action ${busyId === playlist.id ? 'is-busy' : ''}`}>
                  <Plus size={16} />
                </span>
              </button>
            ))
          )}
        </div>

        <footer className="modal__foot">
          <button type="button" className="btn btn--ghost" onClick={openNewPlaylist}>
            <Plus size={16} />
            Новый плейлист
          </button>
        </footer>
      </div>
    </div>
  )
}
