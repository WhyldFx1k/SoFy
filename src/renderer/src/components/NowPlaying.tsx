import { useEffect, useState, type CSSProperties } from 'react'
import {
  ChevronDown,
  Disc3,
  Heart,
  Loader2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX,
  Waves
} from 'lucide-react'
import { accentFor, formatTime } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'
import { LyricsView } from './LyricsView'

export function NowPlaying() {
  const open = useUi((state) => state.nowPlayingOpen)
  const close = useUi((state) => state.closeNowPlaying)

  const track = usePlayer((state) => state.track)
  const playing = usePlayer((state) => state.playing)
  const loading = usePlayer((state) => state.loading)
  const position = usePlayer((state) => state.position)
  const duration = usePlayer((state) => state.duration)
  const volume = usePlayer((state) => state.volume)
  const muted = usePlayer((state) => state.muted)
  const shuffle = usePlayer((state) => state.shuffle)
  const repeat = usePlayer((state) => state.repeat)
  const error = usePlayer((state) => state.error)

  const toggle = usePlayer((state) => state.toggle)
  const next = usePlayer((state) => state.next)
  const prev = usePlayer((state) => state.prev)
  const seek = usePlayer((state) => state.seek)
  const setVolume = usePlayer((state) => state.setVolume)
  const toggleMute = usePlayer((state) => state.toggleMute)
  const toggleShuffle = usePlayer((state) => state.toggleShuffle)
  const cycleRepeat = usePlayer((state) => state.cycleRepeat)
  const retry = usePlayer((state) => state.retry)

  const liked = useUi((state) => (track ? state.likes.some((item) => item.id === track.id) : false))
  const toggleLike = useUi((state) => state.toggleLike)

  const [scrubbing, setScrubbing] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setScrubbing(null)
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || event.defaultPrevented) return
      event.preventDefault()
      close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, close])

  if (!open) return null

  if (!track) {
    return (
      <section className="nowplaying" role="dialog" aria-modal="true" aria-label="Сейчас играет">
        <div className="nowplaying__bg nowplaying__bg--empty" />
        <div className="nowplaying__shade" aria-hidden="true" />
        <div className="nowplaying__aurora" aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
        <header className="nowplaying__top">
          <span className="nowplaying__eyebrow">
            <Waves size={15} />
            Сейчас играет
          </span>
          <button type="button" className="nowplaying__close" onClick={close} aria-label="Свернуть">
            <ChevronDown size={20} />
          </button>
        </header>
        <div className="nowplaying__empty">
          <span className="nowplaying__empty-icon">
            <Disc3 size={34} strokeWidth={1.2} />
          </span>
          <h2>Тишина</h2>
          <p>Включите трек — и он развернётся на весь экран</p>
        </div>
      </section>
    )
  }

  const total = duration > 0 ? duration : track.durationMs / 1000
  const shown = scrubbing ?? position
  const progress = total > 0 ? Math.min(100, (shown / total) * 100) : 0
  const volumeLevel = muted ? 0 : volume
  const VolumeIcon = volumeLevel === 0 ? VolumeX : volumeLevel < 0.5 ? Volume1 : Volume2

  return (
    <section
      className="nowplaying"
      role="dialog"
      aria-modal="true"
      aria-label={`Сейчас играет: ${track.title}`}
    >
      <div
        className="nowplaying__bg"
        style={
          track.artworkUrl ? { backgroundImage: `url("${track.artworkUrl}")` } : undefined
        }
      />
      <div className="nowplaying__shade" aria-hidden="true" />
      <div className="nowplaying__aurora" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <header className="nowplaying__top">
        <span className="nowplaying__eyebrow">
          <Waves size={15} />
          Сейчас играет
        </span>
        <div className="nowplaying__top-actions">
          <div className="nowplaying__volume">
            <button
              type="button"
              className="np-icon"
              onClick={toggleMute}
              title={muted ? 'Включить звук' : 'Выключить звук'}
              aria-label={muted ? 'Включить звук' : 'Выключить звук'}
            >
              <VolumeIcon size={18} />
            </button>
            <input
              type="range"
              className="slider"
              min={0}
              max={1}
              step={0.01}
              value={volumeLevel}
              style={{ '--fill': `${volumeLevel * 100}%` } as CSSProperties}
              onChange={(event) => setVolume(Number(event.target.value))}
              aria-label="Громкость"
            />
          </div>
          <button type="button" className="nowplaying__close" onClick={close} aria-label="Свернуть">
            <ChevronDown size={20} />
          </button>
        </div>
      </header>

      <div className="nowplaying__body">
        <div
          className="nowplaying__stage"
          key={track.id}
          style={{ ['--np-glow' as string]: accentFor(track) } as CSSProperties}
        >
          <div className="nowplaying__art">
            <Cover track={track} className="nowplaying__cover" />
            <span className="nowplaying__art-ring" aria-hidden="true" />
          </div>

          <div className="nowplaying__meta">
            <span className="nowplaying__status">
              <Equalizer paused={!playing || loading} />
              {loading ? 'Загрузка' : playing ? 'Играет' : 'На паузе'}
            </span>
            <h1 className="nowplaying__title">{track.title}</h1>
            <p className="nowplaying__artist">
              {track.artist}
              {track.album ? ` · ${track.album}` : ''}
            </p>
            {error ? (
              <p className="nowplaying__error">
                {error}
                <button type="button" className="link-btn" onClick={retry}>
                  Повторить
                </button>
              </p>
            ) : (
              <button
                type="button"
                className={`np-like ${liked ? 'is-on' : ''}`}
                onClick={() => void toggleLike(track)}
                aria-pressed={liked}
              >
                <Heart size={15} fill={liked ? 'currentColor' : 'none'} />
                {liked ? 'В любимом' : 'В любимое'}
              </button>
            )}
          </div>

          <div className="nowplaying__progress">
            <span className="nowplaying__time">{formatTime(shown)}</span>
            <input
              type="range"
              className="slider"
              min={0}
              max={total || 0}
              step={0.1}
              value={total > 0 ? Math.min(shown, total) : 0}
              disabled={total <= 0}
              style={{ '--fill': `${progress}%` } as CSSProperties}
              onChange={(event) => setScrubbing(Number(event.target.value))}
              onPointerUp={() => {
                if (scrubbing !== null) {
                  seek(scrubbing)
                  setScrubbing(null)
                }
              }}
              onKeyUp={() => {
                if (scrubbing !== null) {
                  seek(scrubbing)
                  setScrubbing(null)
                }
              }}
              aria-label="Позиция трека"
            />
            <span className="nowplaying__time">{formatTime(total)}</span>
          </div>

          <div className="np-controls">
            <button
              type="button"
              className={`np-ctrl ${shuffle ? 'is-on' : ''}`}
              onClick={toggleShuffle}
              title="Перемешать"
              aria-label="Перемешать"
            >
              <Shuffle size={19} />
            </button>
            <button
              type="button"
              className="np-ctrl"
              onClick={prev}
              title="Предыдущий"
              aria-label="Предыдущий"
            >
              <SkipBack size={24} fill="currentColor" />
            </button>
            <button
              type="button"
              className={`np-play ${playing && !loading ? 'is-playing' : ''}`}
              onClick={toggle}
              title={playing ? 'Пауза' : 'Слушать'}
              aria-label={playing ? 'Пауза' : 'Слушать'}
            >
              <span key={loading ? 'loading' : playing ? 'pause' : 'play'}>
                {loading ? (
                  <Loader2 size={26} className="spin" />
                ) : playing ? (
                  <Pause size={25} fill="currentColor" />
                ) : (
                  <Play size={25} fill="currentColor" className="np-play-icon" />
                )}
              </span>
            </button>
            <button
              type="button"
              className="np-ctrl"
              onClick={() => next()}
              title="Следующий"
              aria-label="Следующий"
            >
              <SkipForward size={24} fill="currentColor" />
            </button>
            <button
              type="button"
              className={`np-ctrl ${repeat !== 'off' ? 'is-on' : ''}`}
              onClick={cycleRepeat}
              title={
                repeat === 'one'
                  ? 'Повтор трека'
                  : repeat === 'all'
                    ? 'Повтор очереди'
                    : 'Повтор выключен'
              }
              aria-label="Режим повтора"
            >
              {repeat === 'one' ? <Repeat1 size={19} /> : <Repeat size={19} />}
            </button>
          </div>
        </div>

        <aside className="nowplaying__lyrics">
          <LyricsView key={`np:${track.id}`} track={track} variant="stage" />
        </aside>
      </div>
    </section>
  )
}
