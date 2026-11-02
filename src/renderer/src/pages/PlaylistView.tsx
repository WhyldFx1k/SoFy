import { useEffect, useState } from 'react'
import { ArrowLeft, Camera, FolderPlus, Loader2, Pencil, Play, Shuffle } from 'lucide-react'
import type { PlaylistDetail } from '../../../shared/types'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { Mosaic } from '../components/Mosaic'
import { PlaylistHeaderMenu } from '../components/PlaylistHeaderMenu'
import { TrackRow } from '../components/TrackRow'
import { bridge } from '../lib/bridge'
import { errorMessage, plural } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })

function updatedAtLabel(value: number): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const dayStart = (input: Date): number =>
    new Date(input.getFullYear(), input.getMonth(), input.getDate()).getTime()
  const diff = Math.round((dayStart(new Date()) - dayStart(date)) / 86_400_000)
  if (diff <= 0) return 'сегодня'
  if (diff === 1) return 'вчера'
  return dateFormatter.format(date)
}

export function PlaylistView() {
  const route = useUi((state) => state.route)
  const back = useUi((state) => state.back)
  const navigate = useUi((state) => state.navigate)
  const deletePlaylist = useUi((state) => state.deletePlaylist)
  const removeFromPlaylist = useUi((state) => state.removeFromPlaylist)
  const updatePlaylistMeta = useUi((state) => state.updatePlaylistMeta)
  const changePlaylistCover = useUi((state) => state.changePlaylistCover)
  const descriptionEditId = useUi((state) => state.descriptionEditId)
  const consumeDescriptionEdit = useUi((state) => state.consumeDescriptionEdit)
  const libraryVersion = useUi((state) => state.libraryVersion)
  const refreshPlaylists = useUi((state) => state.refreshPlaylists)
  const toast = useUi((state) => state.toast)
  const playQueue = usePlayer((state) => state.playQueue)

  const [detail, setDetail] = useState<PlaylistDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [descEditing, setDescEditing] = useState(false)
  const [descDraft, setDescDraft] = useState('')
  const [importingHere, setImportingHere] = useState(false)

  const id = route.name === 'playlist' ? route.id : ''

  useEffect(() => {
    if (!id) return
    let alive = true
    bridge.music
      .playlist(id)
      .then((value) => {
        if (!alive) return
        setDetail(value)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (alive) setError(errorMessage(reason))
      })
    return () => {
      alive = false
    }
  }, [id, reload, libraryVersion])

  useEffect(() => {
    setDescEditing(false)
    setDescDraft('')
  }, [id])

  useEffect(() => {
    if (!id || descriptionEditId !== id) return
    consumeDescriptionEdit()
    setDescDraft(detail?.playlist.description ?? '')
    setDescEditing(true)
  }, [descriptionEditId, id, detail, consumeDescriptionEdit])

  const remove = async (trackId: string): Promise<void> => {
    if (!id) return
    await removeFromPlaylist(id, trackId)
    setReload((value) => value + 1)
  }

  const removePlaylist = async (): Promise<void> => {
    if (!id || !detail) return
    const removed = await deletePlaylist(id, detail.playlist.name)
    if (removed) setConfirmDelete(false)
  }

  const beginDescription = (): void => {
    setDescDraft(detail?.playlist.description ?? '')
    setDescEditing(true)
  }

  const saveDescription = async (): Promise<void> => {
    if (!id) return
    const value = descDraft.trim()
    const updated = await updatePlaylistMeta(id, {
      description: value.length > 0 ? value : null
    })
    if (!updated) return
    setDetail((current) => (current ? { ...current, playlist: updated } : current))
    setDescEditing(false)
    toast('Описание обновлено', 'success')
  }

  const shufflePlay = (): void => {
    if (tracks.length === 0) return
    const shuffled = [...tracks]
    for (let index = shuffled.length - 1; index > 0; index -= 1) {
      const swap = Math.floor(Math.random() * (index + 1))
      const item = shuffled[index]
      shuffled[index] = shuffled[swap]
      shuffled[swap] = item
    }
    playQueue(shuffled, 0)
  }

  if (error) {
    return (
      <div className="page">
        <button type="button" className="back-link" onClick={back}>
          <ArrowLeft size={15} />
          Назад
        </button>
        <div className="empty-card">
          <h2>Плейлист не открылся</h2>
          <p>{error}</p>
          <button type="button" className="btn btn--ghost" onClick={() => setReload((value) => value + 1)}>
            Повторить
          </button>
        </div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className="page">
        <div className="skeleton skeleton--head" />
        <div className="list-card">
          {Array.from({ length: 5 }).map((_, index) => (
            <div className="row row--skeleton" key={index}>
              <span className="skeleton skeleton--dot" />
              <span className="skeleton skeleton--art" />
              <span className="skeleton skeleton--line" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  const { playlist, tracks } = detail

  const importTracks = async (): Promise<void> => {
    if (!id || importingHere) return
    setImportingHere(true)
    try {
      const result = await bridge.music.importLocal()
      if (result.imported.length === 0) {
        if (result.errors.length > 0) toast(result.errors[0], 'error')
        return
      }
      for (const track of result.imported) {
        await bridge.music.addToPlaylist(id, track)
      }
      await refreshPlaylists()
      setReload((value) => value + 1)
      toast(
        result.imported.length === 1
          ? `«${result.imported[0].title}» — в «${playlist.name}»`
          : `${result.imported.length} ${plural(result.imported.length, 'трек', 'трека', 'треков')} — в «${playlist.name}»`,
        'success'
      )
      if (result.errors.length > 0) toast(`Не всё добавилось: ${result.errors[0]}`, 'error')
    } catch (reason) {
      toast(errorMessage(reason), 'error')
    } finally {
      setImportingHere(false)
    }
  }

  return (
    <div className="page page--playlist">
      <button type="button" className="back-link" onClick={back}>
        <ArrowLeft size={15} />
        Назад
      </button>

      <section className="playlist-top">
        <div className="playlist-head">
          <div className={`playlist-head__cover ${playlist.cover ? 'has-image' : ''}`}>
            {playlist.cover ? (
              <img className="playlist-head__img" src={playlist.cover} alt="" draggable={false} />
            ) : (
              <Mosaic tracks={tracks} />
            )}
            <button
              type="button"
              className="playlist-head__edit"
              onClick={() => void changePlaylistCover(playlist.id, playlist.name)}
            >
              <Camera size={18} strokeWidth={1.8} />
              <span>{playlist.cover ? 'Изменить обложку' : 'Добавить обложку'}</span>
            </button>
          </div>

          <div className="playlist-head__info">
            <p className="playlist-head__kind">Плейлист</p>
            <h1 className="playlist-head__title">{playlist.name}</h1>

            {descEditing ? (
              <div className="desc-editor">
                <textarea
                  className="desc-editor__field"
                  value={descDraft}
                  maxLength={300}
                  rows={5}
                  autoFocus
                  placeholder="Расскажите об этом плейлисте"
                  onChange={(event) => setDescDraft(event.target.value.slice(0, 300))}
                  onKeyDown={(event) => {
                    if (event.key === 'Escape') {
                      event.preventDefault()
                      setDescEditing(false)
                    }
                    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
                      event.preventDefault()
                      void saveDescription()
                    }
                  }}
                />
                <div className="desc-editor__foot">
                  <span className="desc-editor__count">{descDraft.length}/300</span>
                  <button
                    type="button"
                    className="btn btn--ghost desc-editor__btn"
                    onClick={() => setDescEditing(false)}
                  >
                    Отмена
                  </button>
                  <button
                    type="button"
                    className="btn btn--accent desc-editor__btn"
                    onClick={() => void saveDescription()}
                  >
                    Сохранить
                  </button>
                </div>
              </div>
            ) : playlist.description ? (
              <button
                type="button"
                className="playlist-head__desc"
                onClick={beginDescription}
                title="Изменить описание"
              >
                <span>{playlist.description}</span>
                <Pencil size={12} className="playlist-head__desc-pencil" />
              </button>
            ) : (
              <button
                type="button"
                className="playlist-head__desc playlist-head__desc--empty"
                onClick={beginDescription}
              >
                <Pencil size={12} />
                <span>Добавить описание</span>
              </button>
            )}

            <p className="playlist-head__meta">
              {tracks.length} {plural(tracks.length, 'трек', 'трека', 'треков')}
              {updatedAtLabel(playlist.updatedAt)
                ? ` · обновлён ${updatedAtLabel(playlist.updatedAt)}`
                : ''}
            </p>
          </div>
        </div>

        <div className="playlist-actions">
          <div className="playlist-actions__main">
            <button
              type="button"
              className="btn btn--accent playlist-actions__play"
              disabled={tracks.length === 0}
              onClick={() => playQueue(tracks, 0)}
            >
              <Play size={17} fill="currentColor" />
              Слушать
            </button>
            <button
              type="button"
              className="btn btn--round playlist-actions__shuffle"
              disabled={tracks.length === 0}
              onClick={shufflePlay}
              aria-label="Смешать треки"
              title="Смешать"
            >
              <Shuffle size={17} />
            </button>
            <PlaylistHeaderMenu
              playlistId={playlist.id}
              playlistName={playlist.name}
              shuffleDisabled={tracks.length === 0}
              onShuffle={shufflePlay}
              onDelete={() => setConfirmDelete(true)}
            />
          </div>
          <button
            type="button"
            className="btn btn--ghost playlist-actions__import"
            disabled={importingHere}
            onClick={() => void importTracks()}
          >
            {importingHere ? <Loader2 size={16} className="spin" /> : <FolderPlus size={16} />}
            {importingHere ? 'Добавляем…' : 'Добавить треки'}
          </button>
        </div>
      </section>

      {tracks.length > 0 ? (
        <div className="list-card list-card--bare">
          <div className="list-card__body">
            {tracks.map((track, index) => (
              <TrackRow
                key={track.id}
                track={track}
                queue={tracks}
                index={index}
                onRemove={() => void remove(track.id)}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-card">
          <h2>Плейлист пуст</h2>
          <p>Добавьте свои файлы или найдите треки через поиск.</p>
          <div className="page__head-actions">
            <button
              type="button"
              className="btn btn--primary"
              disabled={importingHere}
              onClick={() => void importTracks()}
            >
              {importingHere ? <Loader2 size={16} className="spin" /> : <FolderPlus size={16} />}
              {importingHere ? 'Добавляем…' : 'Добавить треки'}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => navigate({ name: 'search' })}>
              Найти треки
            </button>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={confirmDelete}
        title="Удалить плейлист?"
        description={`«${playlist.name}» исчезнет вместе с треками. Это действие нельзя отменить.`}
        onCancel={() => setConfirmDelete(false)}
        onConfirm={removePlaylist}
      />
    </div>
  )
}
