import type { Track } from '../../../shared/types'

export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0
  const total = Math.floor(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(rest).padStart(2, '0')}`
  }
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  return formatTime(ms / 1000)
}

export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '0'
  if (value < 1000) return String(Math.round(value))
  const thousands = value / 1000
  return `${thousands >= 10 ? Math.round(thousands) : thousands.toFixed(1).replace('.0', '')} тыс.`
}

export function plural(count: number, one: string, few: string, many: string): string {
  const mod10 = count % 10
  const mod100 = count % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

export function greeting(date = new Date()): string {
  const hour = date.getHours()
  if (hour < 5) return 'Доброй ночи'
  if (hour < 12) return 'Доброе утро'
  if (hour < 18) return 'Добрый день'
  return 'Добрый вечер'
}

export function hashString(value: string): number {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

const FALLBACK_HUES = [268, 205, 332, 24, 162, 286, 348]

export function trackHue(track: Track): number {
  return FALLBACK_HUES[hashString(track.id) % FALLBACK_HUES.length]
}

export function coverBackground(track: Track): string {
  const base = track.color ?? `hsl(${trackHue(track)} 68% 44%)`
  return `radial-gradient(circle at 28% 22%, ${base} 0%, ${base}33 46%, #0c0c12 100%)`
}

export function accentFor(track: Track | null): string {
  if (!track) return '#f0b64f'
  return track.color ?? `hsl(${trackHue(track)} 78% 62%)`
}

export function initials(title: string): string {
  const parts = title.trim().split(/\s+/).slice(0, 2)
  return parts.map((part) => part.charAt(0).toUpperCase()).join('')
}

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message.replace(/^Error:\s*/, '')
  if (typeof error === 'string') return error
  return 'Что-то пошло не так'
}

export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName.toLowerCase()
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable
}
