import { Heart, ListPlus, Play, Trash2 } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Track } from '../../../shared/types'
import { formatDuration } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'

interface TrackRowProps {
  track: Track
  queue: Track[]
  index: number
  onRemove?: () => void
}

export function TrackRow({ track, queue, index, onRemove }: TrackRowProps) {
  const playQueue = usePlayer((state) => state.playQueue)
  const isCurrent = usePlayer((state) => state.track?.id === track.id)
  const playing = usePlayer((state) => state.playing)
  const liked = useUi((state) => state.likes.some((item) => item.id === track.id))
  const toggleLike = useUi((state) => state.toggleLike)
  const openPicker = useUi((state) => state.openPicker)
  const openTrackMenu = useUi((state) => state.openTrackMenu)

  return (
    <div
      className={`row ${isCurrent ? 'is-current' : ''}`}
      role="button"
      tabIndex={0}
      style={{ ['--i' as string]: index } as CSSProperties}
      onClick={() => playQueue(queue, index)}
      onContextMenu={(event) => {
        event.preventDefault()
        openTrackMenu(track, queue, index, event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget) return
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          playQueue(queue, index)
        }
      }}
    >
      <span className="row__index">
        {isCurrent ? <Equalizer paused={!playing} /> : <span className="row__number">{index + 1}</span>}
        <Play size={13} fill="currentColor" className="row__play-hint" />
      </span>
      <Cover track={track} size={44} />
      <span className="row__meta">
        <span className="row__title">{track.title}</span>
        <span className="row__artist">{track.artist}</span>
      </span>
      <span className="row__album">{track.album ?? ''}</span>
      <span className="row__tail">
        {track.preview && <span className="chip chip--preview">Фрагмент</span>}
        <span className="row__duration">{formatDuration(track.durationMs)}</span>
      </span>
      <span className="row__actions" onClick={(event) => event.stopPropagation()}>
        <button
          type="button"
          className={`icon-btn ${liked ? 'is-on' : ''}`}
          onClick={() => void toggleLike(track)}
          title={liked ? 'Убрать из любимого' : 'В любимое'}
          aria-label={liked ? 'Убрать из любимого' : 'В любимое'}
        >
          <Heart size={16} fill={liked ? 'currentColor' : 'none'} />
        </button>
        <button
          type="button"
          className="icon-btn"
          onClick={() => openPicker(track)}
          title="Добавить в плейлист"
          aria-label="Добавить в плейлист"
        >
          <ListPlus size={17} />
        </button>
        {onRemove && (
          <button
            type="button"
            className="icon-btn icon-btn--danger"
            onClick={onRemove}
            title="Убрать из плейлиста"
            aria-label="Убрать из плейлиста"
          >
            <Trash2 size={15} />
          </button>
        )}
      </span>
    </div>
  )
}
