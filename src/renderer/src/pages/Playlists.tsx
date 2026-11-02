import { useEffect, useState } from 'react'
import { FolderPlus, Loader2, Play, Plus, Trash2 } from 'lucide-react'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Mosaic } from '../components/Mosaic'
import { plural } from '../lib/format'
import { useUi } from '../store/ui'

export function PlaylistsPage() {
  const playlists = useUi((state) => state.playlists)
  const refreshPlaylists = useUi((state) => state.refreshPlaylists)
  const deletePlaylist = useUi((state) => state.deletePlaylist)
  const openNewPlaylist = useUi((state) => state.openNewPlaylist)
  const importLocal = useUi((state) => state.importLocal)
  const importing = useUi((state) => state.importing)
  const navigate = useUi((state) => state.navigate)
  const openPlaylistMenu = useUi((state) => state.openPlaylistMenu)

  const [pending, setPending] = useState<{ id: string; name: string } | null>(null)

  useEffect(() => {
    void refreshPlaylists()
  }, [refreshPlaylists])

  const removePending = async (): Promise<void> => {
    if (!pending) return
    const removed = await deletePlaylist(pending.id, pending.name)
    if (removed) setPending(null)
  }

  return (
    <div className="page">
      <header className="page__head page__head--row">
        <div>
          <h1 className="page__title">Плейлисты</h1>
          <p className="page__sub">Свои подборки и добавленные файлы</p>
        </div>
        <div className="page__head-actions">
          <button
            type="button"
            className="btn btn--ghost"
            onClick={() => void importLocal()}
            disabled={importing}
          >
            {importing ? <Loader2 size={16} className="spin" /> : <FolderPlus size={16} />}
            {importing ? 'Добавляем…' : 'Добавить треки'}
          </button>
          <button type="button" className="btn btn--primary" onClick={openNewPlaylist}>
            <Plus size={16} />
            Создать
          </button>
        </div>
      </header>

      {playlists.length === 0 ? (
        <div className="empty-card">
          <span className="empty-card__icon">
            <Plus size={22} />
          </span>
          <h2>Ни одного плейлиста</h2>
          <p>Создайте первый плейлист или добавьте свои файлы — они попадут в «Мои треки».</p>
          <div className="page__head-actions">
            <button type="button" className="btn btn--primary" onClick={openNewPlaylist}>
              Создать плейлист
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void importLocal()}
              disabled={importing}
            >
              {importing ? <Loader2 size={16} className="spin" /> : <FolderPlus size={16} />}
              {importing ? 'Добавляем…' : 'Добавить файлы'}
            </button>
          </div>
        </div>
      ) : (
        <div className="playlist-grid">
          {playlists.map((playlist) => (
            <div
              className="plcard-wrap"
              key={playlist.id}
              onContextMenu={(event) => {
                event.preventDefault()
                openPlaylistMenu(playlist, event.clientX, event.clientY)
              }}
            >
              <button
                type="button"
                className="plcard"
                onClick={() => navigate({ name: 'playlist', id: playlist.id })}
              >
                <span className="plcard__art">
                  {playlist.cover ? (
                    <img className="plcard__cover" src={playlist.cover} alt="" draggable={false} />
                  ) : (
                    <Mosaic tracks={playlist.preview} />
                  )}
                  <span className="plcard__play" aria-hidden="true">
                    <Play size={17} fill="currentColor" />
                  </span>
                </span>
                <span className="plcard__name">{playlist.name}</span>
                <span className="plcard__meta">
                  {playlist.trackCount} {plural(playlist.trackCount, 'трек', 'трека', 'треков')}
                </span>
              </button>
              <button
                type="button"
                className="plcard__delete"
                onClick={() => setPending({ id: playlist.id, name: playlist.name })}
                title="Удалить плейлист"
                aria-label={`Удалить плейлист «${playlist.name}»`}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
          <button type="button" className="plcard plcard--create" onClick={openNewPlaylist}>
            <span className="plcard__plus">
              <Plus size={24} />
            </span>
            <span className="plcard__name">Новый плейлист</span>
            <span className="plcard__meta">Собрать вручную</span>
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
        onConfirm={removePending}
      />
    </div>
  )
}
