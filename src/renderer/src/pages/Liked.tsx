import { useEffect } from 'react'
import { Heart, Play } from 'lucide-react'
import { TrackRow } from '../components/TrackRow'
import { plural } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'

export function LikedPage() {
  const likes = useUi((state) => state.likes)
  const refreshLikes = useUi((state) => state.refreshLikes)
  const navigate = useUi((state) => state.navigate)
  const playQueue = usePlayer((state) => state.playQueue)

  useEffect(() => {
    void refreshLikes()
  }, [refreshLikes])

  return (
    <div className="page">
      <header className="page__head page__head--row">
        <div>
          <h1 className="page__title">Любимое</h1>
          <p className="page__sub">
            {likes.length > 0
              ? `${likes.length} ${plural(likes.length, 'трек', 'трека', 'треков')} в коллекции`
              : 'Треки, которым вы поставили сердце'}
          </p>
        </div>
        {likes.length > 0 && (
          <button type="button" className="btn btn--accent" onClick={() => playQueue(likes, 0)}>
            <Play size={16} fill="currentColor" />
            Слушать всё
          </button>
        )}
      </header>

      {likes.length > 0 ? (
        <div className="list-card list-card--bare">
          <div className="list-card__body">
            {likes.map((track, index) => (
              <TrackRow key={track.id} track={track} queue={likes} index={index} />
            ))}
          </div>
        </div>
      ) : (
        <div className="empty-card">
          <span className="empty-card__icon">
            <Heart size={22} />
          </span>
          <h2>Пока пусто</h2>
          <p>Найдите треки, которые нравятся, и нажмите на сердце.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>
            Перейти к поиску
          </button>
        </div>
      )}
    </div>
  )
}
