import { useState, type CSSProperties } from 'react'
import {
  Heart,
  ListMusic,
  Loader2,
  Maximize2,
  Pause,
  Play,
  Repeat,
  Repeat1,
  Shuffle,
  SkipBack,
  SkipForward,
  Volume1,
  Volume2,
  VolumeX
} from 'lucide-react'
import { formatTime } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'

export function PlayerBar() {
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
  const queueLength = usePlayer((state) => state.queue.length)

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
  const queueOpen = useUi((state) => state.queueOpen)
  const toggleQueue = useUi((state) => state.toggleQueue)
  const openNowPlaying = useUi((state) => state.openNowPlaying)

  const [scrubbing, setScrubbing] = useState<number | null>(null)

  const total = duration > 0 ? duration : track ? track.durationMs / 1000 : 0
  const shown = scrubbing ?? position
  const progress = total > 0 ? Math.min(100, (shown / total) * 100) : 0
  const volumeLevel = muted ? 0 : volume

  const VolumeIcon = volumeLevel === 0 ? VolumeX : volumeLevel < 0.5 ? Volume1 : Volume2

  return (
    <footer className={`player ${track ? 'has-track' : ''} ${playing && !loading ? 'is-playing' : ''}`}>
      <div className="player__now" key={track?.id ?? 'empty'}>
        {track ? (
          <button
            type="button"
            className="player__cover-btn"
            onClick={openNowPlaying}
            aria-label="Открыть сейчас играет"
            title="Сейчас играет"
          >
            <Cover track={track} size={58} />
          </button>
        ) : (
          <span className="player__placeholder" aria-hidden="true">
            <ListMusic size={22} />
          </span>
        )}
        <div className="player__meta">
          <span className="player__title-line">
            {track && <Equalizer paused={!playing || loading} />}
            <span className="player__title">{track ? track.title : 'Тишина'}</span>
          </span>
          {error ? (
            <span className="player__error">
              {error}
              <button type="button" className="link-btn" onClick={retry}>
                Повторить
              </button>
            </span>
          ) : (
            <span className="player__artist">
              {track ? track.artist : 'Выберите трек, чтобы начать'}
            </span>
          )}
        </div>
        {track && (
          <button
            type="button"
            className={`icon-btn player__like ${liked ? 'is-on' : ''}`}
            onClick={() => void toggleLike(track)}
            aria-label={liked ? 'Убрать из любимого' : 'В любимое'}
            title={liked ? 'Убрать из любимого' : 'В любимое'}
          >
            <Heart size={17} fill={liked ? 'currentColor' : 'none'} />
          </button>
        )}
      </div>

      <div className="player__center">
        <div className="player__controls">
          <button
            type="button"
            className={`ctrl ${shuffle ? 'is-on' : ''}`}
            onClick={toggleShuffle}
            title="Перемешать"
            aria-label="Перемешать"
          >
            <Shuffle size={17} />
          </button>
          <button type="button" className="ctrl" onClick={prev} title="Предыдущий" aria-label="Предыдущий">
            <SkipBack size={20} fill="currentColor" />
          </button>
          <button
            type="button"
            className={`player__play ${playing && !loading ? 'is-playing' : ''}`}
            onClick={toggle}
            title={playing ? 'Пауза' : 'Слушать'}
            aria-label={playing ? 'Пауза' : 'Слушать'}
          >
            <span className="player__glyph" key={loading ? 'loading' : playing ? 'pause' : 'play'}>
              {loading ? (
                <Loader2 size={21} className="spin" />
              ) : playing ? (
                <Pause size={21} fill="currentColor" />
              ) : (
                <Play size={21} fill="currentColor" className="player__play-icon" />
              )}
            </span>
          </button>
          <button type="button" className="ctrl" onClick={() => next()} title="Следующий" aria-label="Следующий">
            <SkipForward size={20} fill="currentColor" />
          </button>
          <button
            type="button"
            className={`ctrl ${repeat !== 'off' ? 'is-on' : ''}`}
            onClick={cycleRepeat}
            title={repeat === 'one' ? 'Повтор трека' : repeat === 'all' ? 'Повтор очереди' : 'Повтор выключен'}
            aria-label="Режим повтора"
          >
            {repeat === 'one' ? <Repeat1 size={17} /> : <Repeat size={17} />}
          </button>
        </div>
        <div className="player__progress">
          <span className="player__time">{formatTime(shown)}</span>
          <input
            type="range"
            className="slider"
            min={0}
            max={total || 0}
            step={0.1}
            value={total > 0 ? Math.min(shown, total) : 0}
            disabled={!track || total <= 0}
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
          <span className="player__time">{formatTime(total)}</span>
        </div>
      </div>

      <div className="player__right">
        <button
          type="button"
          className="ctrl ctrl--expand"
          onClick={openNowPlaying}
          title="Сейчас играет"
          aria-label="Открыть сейчас играет"
          disabled={!track}
        >
          <Maximize2 size={16} />
        </button>
        <button
          type="button"
          className={`ctrl ctrl--queue ${queueOpen ? 'is-on' : ''}`}
          onClick={toggleQueue}
          title="Очередь"
          aria-label="Очередь"
        >
          <ListMusic size={18} />
          {queueLength > 0 && (
            <span className="ctrl__badge" key={queueLength}>
              {queueLength}
            </span>
          )}
        </button>
        <div className="player__volume">
          <button
            type="button"
            className="ctrl ctrl--compact"
            onClick={toggleMute}
            title={muted ? 'Включить звук' : 'Выключить звук'}
            aria-label={muted ? 'Включить звук' : 'Выключить звук'}
          >
            <VolumeIcon size={18} />
          </button>
          <input
            type="range"
            className="slider slider--volume"
            min={0}
            max={1}
            step={0.01}
            value={volumeLevel}
            style={{ '--fill': `${volumeLevel * 100}%` } as CSSProperties}
            onChange={(event) => setVolume(Number(event.target.value))}
            aria-label="Громкость"
          />
        </div>
      </div>
    </footer>
  )
}
