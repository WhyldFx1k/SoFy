import { ListMusic } from 'lucide-react'
import type { Track } from '../../../shared/types'
import { Cover } from './Cover'

interface MosaicProps {
  tracks: Track[]
  className?: string
}

export function Mosaic({ tracks, className = '' }: MosaicProps) {
  const cells = tracks.slice(0, 4)
  return (
    <span className={`mosaic ${cells.length === 0 ? 'is-empty' : ''} ${className}`} aria-hidden="true">
      {cells.length === 0 ? (
        <span className="mosaic__glyph">
          <ListMusic size={24} strokeWidth={1.5} />
        </span>
      ) : (
        cells.map((track) => <Cover key={track.id} track={track} className="mosaic__cell" />)
      )}
    </span>
  )
}
