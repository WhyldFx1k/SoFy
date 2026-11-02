import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import { Heart, Loader2, Pause, Play, Plus, Search, Sparkles } from 'lucide-react'
import type { HomeData, Track } from '../../../shared/types'
import { Cover } from '../components/Cover'
import { TrackCard } from '../components/TrackCard'
import { bridge } from '../lib/bridge'
import { accentFor, errorMessage, greeting } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'

const dateFormatter = new Intl.DateTimeFormat('ru-RU', {
  weekday: 'long',
  day: 'numeric',
  month: 'long'
})

function today(): string {
  const value = dateFormatter.format(new Date())
  return value.charAt(0).toUpperCase() + value.slice(1)
}

type RecState = 'idle' | 'loading' | 'error'

export function HomePage() {
  const ready = useUi((state) => state.ready)
  const likes = useUi((state) => state.likes)
  const settings = useUi((state) => state.settings)
  const toggleLike = useUi((state) => state.toggleLike)
  const saveSetting = useUi((state) => state.saveSetting)
  const navigate = useUi((state) => state.navigate)

  const playQueue = usePlayer((state) => state.playQueue)
  const currentId = usePlayer((state) => state.track?.id)
  const playing = usePlayer((state) => state.playing)

  const [data, setData] = useState<HomeData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)

  const [genreId, setGenreId] = useState<string | null>(null)
  const [recs, setRecs] = useState<Track[]>([])
  const [recState, setRecState] = useState<RecState>('idle')
  const [recAttempt, setRecAttempt] = useState(0)
  const [recLoading, setRecLoading] = useState(false)
  const [recExhausted, setRecExhausted] = useState(false)

  useEffect(() => {
    if (!ready) return
    let alive = true
    bridge.music
      .home()
      .then((value) => {
        if (!alive) return
        setData(value)
        setError(null)
      })
      .catch((reason: unknown) => {
        if (alive) setError(errorMessage(reason))
      })
    return () => {
      alive = false
    }
  }, [ready, likes.length, attempt])

  const genres = useMemo(() => data?.genres ?? [], [data])
  const storedGenre = genres.some((genre) => genre.id === settings.genre) ? settings.genre : null
  const activeGenreId = genreId ?? storedGenre ?? genres[0]?.id ?? null
  const activeGenre = genres.find((genre) => genre.id === activeGenreId) ?? null

  useEffect(() => {
    if (!ready || !activeGenre) return
    let alive = true
    setRecState('loading')
    bridge.music
      .search(activeGenre.query, 50)
      .then((value) => {
        if (!alive) return
        setRecs(value.tracks)
        setRecExhausted(false)
        setRecState(value.tracks.length === 0 && value.errors.length > 0 ? 'error' : 'idle')
      })
      .catch(() => {
        if (!alive) return
        setRecs([])
        setRecState('error')
      })
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, activeGenre?.id, recAttempt])

  const loadMoreRecs = (): void => {
    if (!activeGenre || recLoading || recState === 'loading') return
    setRecLoading(true)
    bridge.music
      .search(activeGenre.query, 50, recs.length)
      .then((value) => {
        const known = new Set(recs.map((track) => track.id))
        const fresh = value.tracks.filter((track) => !known.has(track.id))
        if (fresh.length > 0) setRecs((current) => [...current, ...fresh])
        setRecExhausted(fresh.length === 0)
      })
      .catch(() => undefined)
      .finally(() => setRecLoading(false))
  }

  const chooseGenre = (id: string): void => {
    if (id === activeGenreId) return
    setGenreId(id)
    setRecs([])
    setRecExhausted(false)
    void saveSetting('genre', id)
  }

  const hero = data?.heroTrack ?? recs[0] ?? null
  const heroFromHistory = Boolean(data?.heroTrack)
  const heroQueue = hero
    ? heroFromHistory
      ? data?.shelves.find((shelf) => shelf.tracks.some((track) => track.id === hero.id))?.tracks ?? [hero]
      : recs
    : []
  const heroIndex = hero ? Math.max(0, heroQueue.findIndex((track) => track.id === hero.id)) : 0
  const heroIsPlaying = Boolean(hero && currentId === hero.id && playing)
  const heroLiked = Boolean(hero && likes.some((track) => track.id === hero.id))

  return (
    <div className="page home">
      <header className="page__head page__head--row">
        <div>
          <p className="page__eyebrow">{today()}</p>
          <h1 className="page__title">{greeting()}</h1>
        </div>
        <button type="button" className="page__search" onClick={() => navigate({ name: 'search' })}>
          <Search size={16} strokeWidth={1.9} />
          Найти музыку
        </button>
      </header>

      {!data && !error && (
        <>
          <div className="skeleton skeleton--hero" />
          <div className="skeleton-row">
            {Array.from({ length: 5 }).map((_, index) => (
              <div className="skeleton skeleton--card" key={index} />
            ))}
          </div>
        </>
      )}

      {error && (
        <div className="notice">
          <span>
            <strong>Не удалось загрузить главную.</strong> {error}
          </span>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </button>
        </div>
      )}

      {hero && (
        <section className="hero" style={{ ['--accent' as string]: accentFor(hero) } as CSSProperties}>
          <div className="hero__glow" aria-hidden="true" />
          <div className="hero__text">
            <span className="hero__eyebrow">
              {heroFromHistory ? 'Продолжите слушать' : 'Рекомендуем сегодня'}
            </span>
            <h2 className="hero__title">{hero.title}</h2>
            <p className="hero__artist">
              {hero.artist}
              {hero.album ? ` · ${hero.album}` : ''}
            </p>
            <div className="hero__actions">
              <button
                type="button"
                className="btn btn--accent"
                onClick={() => playQueue(heroQueue, heroIndex)}
              >
                {heroIsPlaying ? <Pause size={17} fill="currentColor" /> : <Play size={17} fill="currentColor" />}
                {heroIsPlaying ? 'Пауза' : 'Слушать'}
              </button>
              <button
                type="button"
                className={`btn btn--round ${heroLiked ? 'is-liked' : ''}`}
                onClick={() => void toggleLike(hero)}
                aria-label={heroLiked ? 'Убрать из любимого' : 'В любимое'}
                title={heroLiked ? 'Убрать из любимого' : 'В любимое'}
              >
                <Heart size={18} fill={heroLiked ? 'currentColor' : 'none'} />
              </button>
            </div>
          </div>
          <div className="hero__art">
            <Cover track={hero} />
          </div>
        </section>
      )}

      {data && genres.length > 0 && (
        <section className="shelf shelf--genres">
          <header className="shelf__head">
            <div className="shelf__titles">
              <h2>Для тебя</h2>
              <p>Выберите жанр — соберём подборку</p>
            </div>
            <div className="shelf__actions">
              <button
                type="button"
                className="shelf__action"
                disabled={recs.length === 0 || recLoading || recState === 'loading' || recExhausted}
                onClick={loadMoreRecs}
              >
                {recLoading ? <Loader2 size={14} className="spin" /> : <Plus size={14} />}
                Ещё
              </button>
              <button
                type="button"
                className="shelf__action"
                disabled={recs.length === 0}
                onClick={() => playQueue(recs, 0)}
              >
                <Play size={14} fill="currentColor" />
                Играть всё
              </button>
            </div>
          </header>

          <div className="genre-row" role="tablist" aria-label="Жанры">
            {genres.map((genre, index) => (
              <button
                type="button"
                role="tab"
                aria-selected={genre.id === activeGenreId}
                key={genre.id}
                className={`genre ${genre.id === activeGenreId ? 'is-active' : ''}`}
                style={{ ['--genre-color' as string]: genre.color, ['--i' as string]: index } as CSSProperties}
                onClick={() => chooseGenre(genre.id)}
              >
                <span className="genre__dot" aria-hidden="true" />
                {genre.label}
              </button>
            ))}
          </div>

          {recState === 'loading' && (
            <div className="shelf__row">
              {Array.from({ length: 6 }).map((_, index) => (
                <div className="skeleton skeleton--card" key={index} />
              ))}
            </div>
          )}

          {recState === 'error' && (
            <div className="notice notice--inline">
              <span>Не удалось собрать рекомендации. Проверьте подключение к сети.</span>
              <button
                type="button"
                className="btn btn--ghost btn--small"
                onClick={() => setRecAttempt((value) => value + 1)}
              >
                Повторить
              </button>
            </div>
          )}

          {recState === 'idle' && recs.length > 0 && (
            <div className="shelf__row shelf__row--recs" key={activeGenreId}>
              {recs.map((track, index) => (
                <TrackCard key={track.id} track={track} queue={recs} index={index} />
              ))}
            </div>
          )}

          {recState === 'idle' && recs.length === 0 && (
            <p className="genres__empty">Пока нет подборки для этого жанра — попробуйте другой.</p>
          )}
        </section>
      )}

      {data?.shelves.map((shelf) => (
        <section className="shelf" key={shelf.id}>
          <header className="shelf__head">
            <div className="shelf__titles">
              <h2>{shelf.title}</h2>
              <p>{shelf.subtitle}</p>
            </div>
            <button type="button" className="shelf__action" onClick={() => playQueue(shelf.tracks, 0)}>
              <Play size={14} fill="currentColor" />
              Слушать
            </button>
          </header>
          <div className="shelf__row">
            {shelf.tracks.map((track, index) => (
              <TrackCard key={track.id} track={track} queue={shelf.tracks} index={index} />
            ))}
          </div>
        </section>
      ))}

      {data && !hero && genres.length === 0 && (
        <div className="empty-card">
          <span className="empty-card__icon">
            <Sparkles size={22} />
          </span>
          <h2>Пока тихо</h2>
          <p>Найдите любимые треки через поиск — они появятся здесь.</p>
          <button type="button" className="btn btn--primary" onClick={() => navigate({ name: 'search' })}>
            Открыть поиск
          </button>
        </div>
      )}
    </div>
  )
}
