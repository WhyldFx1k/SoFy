function nestedScroller(target: EventTarget | null, boundary: HTMLElement): boolean {
  let node = target instanceof Element ? target : null
  while (node && node !== boundary) {
    if (node instanceof HTMLElement) {
      const overflow = getComputedStyle(node).overflowY
      if (
        (overflow === 'auto' || overflow === 'scroll') &&
        node.scrollHeight > node.clientHeight + 1
      ) {
        return true
      }
    }
    node = node.parentElement
  }
  return false
}

/**
 * Wheel scrolling with exponential easing. Native `scroll-behavior: smooth`
 * does not affect mouse wheels, so the motion is driven with rAF instead.
 */
export function attachSmoothWheel(
  element: HTMLElement,
  enabled: () => boolean
): () => void {
  let target = element.scrollTop
  let frame = 0
  let previous = 0

  const stop = (): void => {
    if (frame) cancelAnimationFrame(frame)
    frame = 0
    previous = 0
    target = element.scrollTop
  }

  const tick = (now: number): void => {
    frame = 0
    if (!enabled()) {
      target = element.scrollTop
      return
    }
    const before = element.scrollTop
    const max = Math.max(0, element.scrollHeight - element.clientHeight)
    target = Math.min(max, Math.max(0, target))
    const diff = target - before
    if (Math.abs(diff) < 0.6) return
    const elapsed = previous ? Math.min(64, now - previous) : 16
    previous = now
    element.scrollTop = before + diff * (1 - Math.exp(-elapsed * 0.016))
    // Layout metrics can overshoot the real scroll limit by a few pixels;
    // stop instead of spinning on a position the browser refuses to take.
    if (element.scrollTop === before) return
    frame = requestAnimationFrame(tick)
  }

  const onWheel = (event: WheelEvent): void => {
    if (!enabled() || event.defaultPrevented || event.ctrlKey) return
    if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) return
    if (nestedScroller(event.target, element)) return
    const max = Math.max(0, element.scrollHeight - element.clientHeight)
    if (max <= 0) return
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? element.clientHeight : 1
    const before = element.scrollTop
    if (!frame) target = before
    target = Math.min(max, Math.max(0, target + event.deltaY * unit))
    event.preventDefault()
    if (Math.abs(target - before) < 0.6) return
    previous = 0
    if (!frame) frame = requestAnimationFrame(tick)
  }

  element.addEventListener('wheel', onWheel, { passive: false })
  element.addEventListener('pointerdown', stop)
  return () => {
    stop()
    element.removeEventListener('wheel', onWheel)
    element.removeEventListener('pointerdown', stop)
  }
}
