import { Pause, Play } from 'lucide-react'
import type { CSSProperties } from 'react'
import type { Track } from '../../../shared/types'
import { usePlayer } from '../store/player'
import { Cover } from './Cover'

interface TrackCardProps {
  track: Track
  queue: Track[]
  index: number
}

export function TrackCard({ track, queue, index }: TrackCardProps) {
  const playQueue = usePlayer((state) => state.playQueue)
  const isCurrent = usePlayer((state) => state.track?.id === track.id)
  const playing = usePlayer((state) => state.playing)

  return (
    <button
      type="button"
      className={`tcard ${isCurrent ? 'is-current' : ''}`}
      onClick={() => playQueue(queue, index)}
      title={`${track.title} — ${track.artist}`}
      style={{ ['--i' as string]: index } as CSSProperties}
    >
      <span className="tcard__art">
        <Cover track={track} className="tcard__cover" />
        <span className="tcard__play" aria-hidden="true">
          {isCurrent && playing ? <Pause size={18} fill="currentColor" /> : <Play size={18} fill="currentColor" />}
        </span>
        {track.preview && <span className="tcard__badge">Фрагмент</span>}
      </span>
      <span className="tcard__title">{track.title}</span>
      <span className="tcard__artist">{track.artist}</span>
    </button>
  )
}
