interface EqualizerProps {
  paused?: boolean
}

export function Equalizer({ paused = false }: EqualizerProps) {
  return (
    <span className={`eq ${paused ? 'is-paused' : ''}`} aria-hidden="true">
      <i />
      <i />
      <i />
      <i />
    </span>
  )
}
