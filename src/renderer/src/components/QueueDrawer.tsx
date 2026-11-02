import { useEffect, useState, type CSSProperties } from 'react'
import { X } from 'lucide-react'
import { formatDuration } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'
import { Cover } from './Cover'
import { Equalizer } from './Equalizer'

export function QueueDrawer() {
  const open = useUi((state) => state.queueOpen)
  const close = useUi((state) => state.closeQueue)
  const queue = usePlayer((state) => state.queue)
  const index = usePlayer((state) => state.index)
  const playing = usePlayer((state) => state.playing)
  const loadAt = usePlayer((state) => state.loadAt)

  const [visible, setVisible] = useState(open)
  const [leaving, setLeaving] = useState(false)

  useEffect(() => {
    if (open) {
      setVisible(true)
      setLeaving(false)
      return
    }
    if (!visible) return
    setLeaving(true)
    const timer = setTimeout(() => {
      setVisible(false)
      setLeaving(false)
    }, 220)
    return () => clearTimeout(timer)
  }, [open, visible])

  if (!visible) return null

  return (
    <aside className={`queue ${leaving ? 'is-leaving' : ''}`} aria-label="Очередь воспроизведения">
      <header className="queue__head">
        <div>
          <h2>Очередь</h2>
          <p>{queue.length > 0 ? `${queue.length} в списке` : 'Пока пусто'}</p>
        </div>
        <button type="button" className="icon-btn" onClick={close} aria-label="Закрыть очередь">
          <X size={17} />
        </button>
      </header>
      <div className="queue__list">
        {queue.map((track, position) => (
          <button
            type="button"
            key={`${track.id}:${position}`}
            className={`queue__item ${position === index ? 'is-current' : ''}`}
            style={{ ['--i' as string]: Math.min(position, 14) } as CSSProperties}
            onClick={() => void loadAt(position, true)}
          >
            <Cover track={track} size={38} />
            <span className="queue__meta">
              <span className="queue__title">{track.title}</span>
              <span className="queue__artist">{track.artist}</span>
            </span>
            {position === index ? (
              <Equalizer paused={!playing} />
            ) : (
              <span className="queue__time">{formatDuration(track.durationMs)}</span>
            )}
          </button>
        ))}
      </div>
    </aside>
  )
}
