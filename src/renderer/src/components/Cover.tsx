import { useEffect, useState, type CSSProperties } from 'react'
import { Disc3 } from 'lucide-react'
import type { Track } from '../../../shared/types'
import { coverBackground } from '../lib/format'

interface CoverProps {
  track: Track
  size?: number
  rounded?: number
  className?: string
}

export function Cover({ track, size, rounded, className = '' }: CoverProps) {
  const [broken, setBroken] = useState(false)
  useEffect(() => setBroken(false), [track.id, track.artworkUrl])
  const style: CSSProperties = { background: coverBackground(track) }
  if (size) {
    style.width = size
    style.height = size
    style.borderRadius = rounded ?? Math.max(6, Math.round(size * 0.17))
  }
  return (
    <div className={`cover ${className}`} style={style} aria-hidden="true">
      {track.artworkUrl && !broken ? (
        <img
          src={track.artworkUrl}
          alt=""
          loading="lazy"
          draggable={false}
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
        />
      ) : (
        <Disc3 className="cover__glyph" strokeWidth={1.3} />
      )}
    </div>
  )
}
