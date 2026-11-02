import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { AlertTriangle, Loader2, MessageSquareText, Music2, RefreshCw } from 'lucide-react'
import type { Lyrics, LyricsLine, Track } from '../../../shared/types'
import { bridge } from '../lib/bridge'
import { errorMessage } from '../lib/format'
import { usePlayer } from '../store/player'
import { useUi } from '../store/ui'

type LoadState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'done'; lyrics: Lyrics }

const NO_LINES: LyricsLine[] = []

interface LyricsViewProps {
  track: Track
  variant?: 'drawer' | 'stage'
}

export function LyricsView({ track, variant = 'drawer' }: LyricsViewProps) {
  const [state, setState] = useState<LoadState>({ status: 'loading' })
  const [attempt, setAttempt] = useState(0)
  const reduceMotion = useUi((settings) => settings.settings.reduceMotion === 'true')
  const isCurrent = usePlayer((player) => player.track?.id === track.id)
  const seek = usePlayer((player) => player.seek)

  useEffect(() => {
    let alive = true
    setState({ status: 'loading' })
    void bridge.music
      .lyrics(track.id)
      .then((lyrics) => {
        if (alive) setState({ status: 'done', lyrics })
      })
      .catch((error) => {
        if (alive) setState({ status: 'error', message: errorMessage(error) })
      })
    return () => {
      alive = false
    }
  }, [track.id, attempt])

  const lines = state.status === 'done' && state.lyrics.found && !state.lyrics.instrumental
    ? state.lyrics.synced
    : NO_LINES

  const [active, setActive] = useState(-1)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lineRefs = useRef<Array<HTMLButtonElement | null>>([])
  const manualUntil = useRef(0)

  useEffect(() => {
    manualUntil.current = 0
    scrollRef.current?.scrollTo({ top: 0 })
  }, [track.id])

  useEffect(() => {
    if (!isCurrent || lines.length === 0) {
      setActive(-1)
      return
    }
    const locate = (): number => {
      const ms = usePlayer.getState().position * 1000
      let index = -1
      for (let i = 0; i < lines.length; i += 1) {
        if (lines[i].timeMs > ms + 120) break
        index = i
      }
      return index
    }
    setActive(locate())
    return usePlayer.subscribe((current, previous) => {
      if (current.position === previous.position) return
      const next = locate()
      setActive((value) => (value === next ? value : next))
    })
  }, [isCurrent, lines])

  useEffect(() => {
    if (active < 0 || Date.now() < manualUntil.current) return
    const container = scrollRef.current
    const line = lineRefs.current[active]
    if (!container || !line) return
    container.scrollTo({
      top: Math.max(0, line.offsetTop - container.clientHeight / 2 + line.clientHeight / 2),
      behavior: reduceMotion ? 'auto' : 'smooth'
    })
  }, [active, reduceMotion])

  const retry = (): void => setAttempt((value) => value + 1)

  if (state.status === 'loading') {
    return (
      <div className="lyrics-view" aria-busy="true">
        <div className="lyrics-state">
          <span className="lyrics-state__icon is-spinning">
            <Loader2 size={20} className="spin" />
          </span>
          <span className="lyrics-state__title">Ищем текст…</span>
          <p className="lyrics-state__hint">Обычно это занимает мгновение</p>
        </div>
      </div>
    )
  }

  if (state.status === 'error') {
    return (
      <div className="lyrics-view">
        <div className="lyrics-state">
          <span className="lyrics-state__icon is-warn">
            <AlertTriangle size={20} />
          </span>
          <span className="lyrics-state__title">Текст не загрузился</span>
          <p className="lyrics-state__hint">{state.message}</p>
          <button type="button" className="btn btn--ghost btn--small" onClick={retry}>
            <RefreshCw size={14} />
            Попробовать снова
          </button>
        </div>
      </div>
    )
  }

  const { lyrics } = state
  const hasSynced = lyrics.synced.length > 0
  const hasPlain = Boolean(lyrics.plain && lyrics.plain.trim().length > 0)

  if (!lyrics.found || (!hasSynced && !hasPlain)) {
    return (
      <div className="lyrics-view">
        <div className="lyrics-state">
          <span className="lyrics-state__icon">
            <MessageSquareText size={20} />
          </span>
          <span className="lyrics-state__title">Текста пока нет</span>
          <p className="lyrics-state__hint">
            Для этой песни текст ещё не добавили — зато музыка уже здесь
          </p>
        </div>
      </div>
    )
  }

  if (lyrics.instrumental) {
    return (
      <div className="lyrics-view">
        <div className="lyrics-state">
          <span className="lyrics-state__icon">
            <Music2 size={20} />
          </span>
          <span className="lyrics-state__title">Инструментал</span>
          <p className="lyrics-state__hint">Здесь нет слов — только музыка</p>
        </div>
      </div>
    )
  }

  return (
    <div className={`lyrics-view lyrics-view--${variant}`}>
      {variant === 'stage' && (
        <div className="lyrics-view__head">
          <MessageSquareText size={14} />
          Текст песни
        </div>
      )}
      <div
        className="lyrics-view__scroll"
        ref={scrollRef}
        onWheel={() => {
          manualUntil.current = Date.now() + 4500
        }}
        onPointerDown={() => {
          manualUntil.current = Date.now() + 4500
        }}
      >
        {hasSynced ? (
          <div className="lyrics-lines">
            {lyrics.synced.map((line, index) => (
              <button
                type="button"
                key={`${line.timeMs}:${index}`}
                ref={(node) => {
                  lineRefs.current[index] = node
                }}
                className={`lyrics-line ${index === active ? 'is-active' : ''} ${
                  active >= 0 && index < active ? 'is-past' : ''
                }`}
                style={{ ['--i' as string]: Math.min(index, 24) } as CSSProperties}
                onClick={() => {
                  if (isCurrent) seek(line.timeMs / 1000)
                }}
                title={isCurrent ? 'Перейти к этому моменту' : undefined}
              >
                {line.text || '…'}
              </button>
            ))}
          </div>
        ) : (
          <div className="lyrics-plain">{lyrics.plain}</div>
        )}
      </div>
    </div>
  )
}
