import { useEffect, useRef, useState } from 'react'
import { Loader2, PlusCircle, Search as SearchIcon, X } from 'lucide-react'
import type { SearchResult, Track } from '../../../shared/types'
import { TrackRow } from '../components/TrackRow'
import { bridge } from '../lib/bridge'
import { errorMessage } from '../lib/format'
import { useUi } from '../store/ui'

export function SearchPage() {
  const query = useUi((state) => state.searchQuery)
  const setQuery = useUi((state) => state.setSearchQuery)

  const [result, setResult] = useState<SearchResult | null>(null)
  const [more, setMore] = useState<Track[]>([])
  const [hasMore, setHasMore] = useState(false)
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [moreError, setMoreError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const trimmed = query.trim()
    if (!trimmed) {
      setResult(null)
      setLoading(false)
      setError(null)
      return
    }
    let alive = true
    setLoading(true)
    setMore([])
    setHasMore(false)
    setMoreError(null)
    const timer = window.setTimeout(() => {
      bridge.music
        .search(trimmed, 50)
        .then((value) => {
          if (!alive) return
          setResult(value)
          setHasMore(value.tracks.length >= 50)
          setError(null)
        })
        .catch((reason: unknown) => {
          if (!alive) return
          setResult(null)
          setError(errorMessage(reason))
        })
        .finally(() => {
          if (alive) setLoading(false)
        })
    }, 360)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [query, attempt])

  const trimmed = query.trim()
  const tracks = [...(result?.tracks ?? []), ...more]

  const loadMore = (): void => {
    if (!trimmed || loading || loadingMore) return
    setLoadingMore(true)
    setMoreError(null)
    bridge.music
      .search(trimmed, 50, tracks.length)
      .then((value) => {
        const known = new Set(tracks.map((track) => track.id))
        const fresh = value.tracks.filter((track) => !known.has(track.id))
        setMore((current) => [...current, ...fresh])
        setHasMore(fresh.length > 0)
      })
      .catch((reason: unknown) => setMoreError(errorMessage(reason)))
      .finally(() => setLoadingMore(false))
  }

  return (
    <div className="page search">
      <header className="page__head">
        <div>
          <h1 className="page__title">Поиск</h1>
          <p className="page__sub">Треки, исполнители и альбомы</p>
        </div>
      </header>

      <div className="search-box">
        <SearchIcon size={19} className="search-box__icon" />
        <input
          ref={inputRef}
          className="search-box__input"
          value={query}
          placeholder="Трек, исполнитель или альбом"
          maxLength={120}
          onChange={(event) => setQuery(event.target.value)}
          spellCheck={false}
          autoComplete="off"
        />
        {loading && <Loader2 size={17} className="spin search-box__spinner" />}
        {query && !loading && (
          <button
            type="button"
            className="search-box__clear"
            onClick={() => setQuery('')}
            aria-label="Очистить поиск"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {error && trimmed && (
        <div className="notice">
          <span>{error}</span>
          <button type="button" className="btn btn--ghost btn--small" onClick={() => setAttempt((value) => value + 1)}>
            Повторить
          </button>
        </div>
      )}

      {loading && trimmed && (
        <div className="list-card">
          {Array.from({ length: 6 }).map((_, index) => (
            <div className="row row--skeleton" key={index}>
              <span className="skeleton skeleton--dot" />
              <span className="skeleton skeleton--art" />
              <span className="skeleton skeleton--line" />
            </div>
          ))}
        </div>
      )}

      {!loading && trimmed && result && tracks.length > 0 && (
        <section className="list-card">
          <header className="list-card__head">
            <h2>Результаты</h2>
            <span>
              {tracks.length} {tracks.length === 1 ? 'трек' : tracks.length < 5 ? 'трека' : 'треков'}
            </span>
          </header>
          <div className="list-card__body">
            {tracks.map((track: Track, index: number) => (
              <TrackRow key={track.id} track={track} queue={tracks} index={index} />
            ))}
          </div>
        </section>
      )}

      {!loading && trimmed && tracks.length > 0 && (hasMore || moreError) && (
        <div className="load-more">
          <button
            type="button"
            className="btn btn--ghost load-more__btn"
            disabled={loadingMore}
            onClick={loadMore}
          >
            {loadingMore ? <Loader2 size={16} className="spin" /> : <PlusCircle size={16} />}
            {loadingMore ? 'Загружаем…' : 'Загрузить ещё'}
          </button>
          {moreError && <p className="load-more__error">{moreError}</p>}
        </div>
      )}

      {!loading && trimmed && result && tracks.length === 0 && !error && (
        <div className="empty-card">
          <span className="empty-card__icon">
            <SearchIcon size={22} />
          </span>
          <h2>Ничего не нашлось</h2>
          <p>Попробуйте другой запрос — например, название трека или исполнителя.</p>
          <button type="button" className="btn btn--ghost" onClick={() => setQuery('')}>
            Сбросить поиск
          </button>
        </div>
      )}
    </div>
  )
}
