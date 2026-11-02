import Hls from 'hls.js'
import { create } from 'zustand'
import type { SettingsMap, StreamInfo, Track } from '../../../shared/types'
import { bridge } from '../lib/bridge'
import { errorMessage } from '../lib/format'

export type RepeatMode = 'off' | 'all' | 'one'

interface PlayerState {
  track: Track | null
  queue: Track[]
  index: number
  playing: boolean
  loading: boolean
  position: number
  duration: number
  volume: number
  muted: boolean
  shuffle: boolean
  repeat: RepeatMode
  error: string | null
  playQueue: (tracks: Track[], startIndex?: number) => void
  loadAt: (index: number, autoplay?: boolean, startAt?: number) => Promise<void>
  play: () => Promise<void>
  pause: () => void
  toggle: () => void
  next: (auto?: boolean) => void
  prev: () => void
  seek: (seconds: number) => void
  handleEnded: () => void
  setVolume: (value: number) => void
  toggleMute: () => void
  toggleShuffle: () => void
  cycleRepeat: () => void
  retry: () => void
  hydrate: (settings: SettingsMap) => void
}

let audio: HTMLAudioElement | null = null
let hls: Hls | null = null
let streamKind: StreamInfo['kind'] = 'progressive'
let retried = false
let session = 0
let desiredPlaying = false
let volumeTimer: ReturnType<typeof setTimeout> | null = null
let mediaBound = false
let resolvePendingSource: (() => void) | null = null

function destroyHls(): void {
  if (resolvePendingSource) {
    const settle = resolvePendingSource
    resolvePendingSource = null
    settle()
  }
  if (!hls) return
  hls.destroy()
  hls = null
}

function ensureAudio(): HTMLAudioElement {
  if (audio) return audio
  const element = new Audio()
  element.preload = 'auto'
  element.volume = usePlayer.getState().volume

  element.addEventListener('timeupdate', () => {
    usePlayer.setState({ position: element.currentTime })
  })
  element.addEventListener('durationchange', () => {
    if (Number.isFinite(element.duration) && element.duration > 0) {
      usePlayer.setState({ duration: element.duration })
    }
  })
  element.addEventListener('play', () => {
    desiredPlaying = true
    usePlayer.setState({ playing: true })
  })
  element.addEventListener('pause', () => {
    if (!desiredPlaying) usePlayer.setState({ playing: false })
  })
  element.addEventListener('playing', () => {
    usePlayer.setState({ loading: false, playing: true, error: null })
  })
  element.addEventListener('canplay', () => {
    usePlayer.setState({ loading: false })
  })
  element.addEventListener('waiting', () => {
    usePlayer.setState({ loading: true })
  })
  element.addEventListener('ended', () => {
    usePlayer.getState().handleEnded()
  })
  element.addEventListener('error', () => {
    void recoverFromError()
  })

  audio = element
  bindMediaSession()
  return element
}

function safePlay(): void {
  const element = ensureAudio()
  void element.play().catch(() => {
    desiredPlaying = false
    usePlayer.setState({ playing: false, loading: false })
  })
}

async function recoverFromError(): Promise<void> {
  const element = audio
  const state = usePlayer.getState()
  if (!element || !state.track) return
  if (streamKind === 'hls' && hls) return
  if (!element.currentSrc) return
  if (retried) {
    desiredPlaying = false
    usePlayer.setState({ playing: false, loading: false, error: 'Не удалось воспроизвести трек' })
    return
  }
  retried = true
  const position = Number.isFinite(element.currentTime) ? element.currentTime : state.position
  await state.loadAt(state.index, desiredPlaying, position)
}

function applyMediaSession(track: Track | null): void {
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  try {
    if (!track) {
      navigator.mediaSession.metadata = null
      return
    }
    const artwork = track.artworkUrl ? [{ src: track.artworkUrl, sizes: '512x512' }] : []
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artist: track.artist,
      album: track.album ?? 'SoFy',
      artwork
    })
  } catch {
    // media session is best-effort
  }
}

function bindMediaSession(): void {
  if (mediaBound) return
  if (typeof navigator === 'undefined' || !('mediaSession' in navigator)) return
  mediaBound = true
  const session = navigator.mediaSession
  try {
    session.setActionHandler('play', () => void usePlayer.getState().play())
    session.setActionHandler('pause', () => usePlayer.getState().pause())
    session.setActionHandler('previoustrack', () => usePlayer.getState().prev())
    session.setActionHandler('nexttrack', () => usePlayer.getState().next())
    session.setActionHandler('seekto', (details) => {
      if (typeof details.seekTime === 'number') usePlayer.getState().seek(details.seekTime)
    })
  } catch {
    // unsupported action
  }
}

async function applySource(
  info: StreamInfo,
  startAt: number,
  autoplay: boolean,
  sessionToken: number
): Promise<void> {
  const element = ensureAudio()
  streamKind = info.kind

  if (info.kind === 'hls' && Hls.isSupported()) {
    await new Promise<void>((resolve, reject) => {
      const instance = new Hls({
        enableWorker: true,
        backBufferLength: 30,
        maxBufferLength: 30,
        manifestLoadingTimeOut: 20_000
      })
      hls = instance
      let settled = false
      const finish = (error?: Error): void => {
        if (settled) return
        settled = true
        if (resolvePendingSource === cancel) resolvePendingSource = null
        if (error) reject(error)
        else resolve()
      }
      const cancel = (): void => finish()
      resolvePendingSource = cancel

      instance.on(Hls.Events.MEDIA_ATTACHED, () => {
        instance.loadSource(info.url)
      })
      instance.on(Hls.Events.MANIFEST_PARSED, () => {
        if (startAt > 0) {
          try {
            element.currentTime = startAt
          } catch {
            // seek is best-effort
          }
        }
        finish()
      })
      instance.on(Hls.Events.ERROR, (_event, data) => {
        if (!data.fatal) return
        if (sessionToken !== session) {
          finish()
          return
        }
        const state = usePlayer.getState()
        if (retried) {
          desiredPlaying = false
          usePlayer.setState({ playing: false, loading: false, error: 'Не удалось воспроизвести трек' })
          finish(new Error('Не удалось воспроизвести трек'))
          return
        }
        retried = true
        const position = element.currentTime > 1 ? element.currentTime : startAt
        finish()
        void state.loadAt(state.index, true, position)
      })
      instance.attachMedia(element)
    })
  } else if (info.kind === 'hls' && element.canPlayType('application/vnd.apple.mpegurl')) {
    element.src = info.url
    element.load()
    if (startAt > 0) {
      element.addEventListener(
        'loadedmetadata',
        () => {
          try {
            element.currentTime = startAt
          } catch {
            // ignore
          }
        },
        { once: true }
      )
    }
  } else if (info.kind === 'hls') {
    throw new Error('Этот формат потока не поддерживается')
  } else {
    element.src = info.url
    element.load()
    if (startAt > 0) {
      element.addEventListener(
        'loadedmetadata',
        () => {
          try {
            element.currentTime = startAt
          } catch {
            // ignore
          }
        },
        { once: true }
      )
    }
  }

  if (sessionToken !== session) return
  if (autoplay && desiredPlaying) safePlay()
}

function persist(key: string, value: string): void {
  void bridge.music.setSetting(key, value).catch(() => {})
}

export const usePlayer = create<PlayerState>()((set, get) => ({
  track: null,
  queue: [],
  index: 0,
  playing: false,
  loading: false,
  position: 0,
  duration: 0,
  volume: 0.8,
  muted: false,
  shuffle: false,
  repeat: 'off',
  error: null,

  playQueue: (tracks, startIndex = 0) => {
    if (tracks.length === 0) return
    const index = Math.max(0, Math.min(startIndex, tracks.length - 1))
    const current = get().track
    const next = tracks[index]
    if (current && next && current.id === next.id) {
      set({ queue: tracks, index })
      if (get().playing) {
        get().pause()
      } else {
        void get().play()
      }
      return
    }
    set({ queue: tracks, index })
    void get().loadAt(index, true)
  },

  loadAt: async (index, autoplay = true, startAt = 0) => {
    const item = get().queue[index]
    if (!item) return
    const token = ++session
    retried = false
    destroyHls()
    const element = ensureAudio()
    element.pause()
    element.removeAttribute('src')
    element.load()
    desiredPlaying = autoplay
    set({
      track: item,
      index,
      playing: autoplay,
      loading: true,
      error: null,
      position: startAt,
      duration: item.durationMs > 0 ? item.durationMs / 1000 : 0
    })
    applyMediaSession(item)
    void bridge.music.addHistory(item).catch(() => {})

    try {
      const info = await bridge.music.ticket(item.id)
      if (token !== session) return
      await applySource(info, startAt, autoplay, token)
    } catch (error) {
      if (token !== session) return
      desiredPlaying = false
      set({ loading: false, playing: false, error: errorMessage(error) })
    }
  },

  play: async () => {
    const state = get()
    if (!state.track) return
    desiredPlaying = true
    const element = ensureAudio()
    if (!element.currentSrc && !hls) {
      await state.loadAt(state.index, true, state.position)
      return
    }
    set({ playing: true })
    try {
      await element.play()
    } catch {
      desiredPlaying = false
      set({ playing: false })
    }
  },

  pause: () => {
    desiredPlaying = false
    ensureAudio().pause()
    set({ playing: false })
  },

  toggle: () => {
    if (get().playing) get().pause()
    else void get().play()
  },

  next: (auto = false) => {
    const { queue, index, repeat, shuffle } = get()
    if (queue.length === 0) return
    if (auto && repeat === 'one') {
      const element = ensureAudio()
      element.currentTime = 0
      desiredPlaying = true
      safePlay()
      return
    }
    let target = index + 1
    if (shuffle && queue.length > 1) {
      do {
        target = Math.floor(Math.random() * queue.length)
      } while (target === index)
    }
    if (target >= queue.length) {
      if (auto && repeat !== 'all') {
        desiredPlaying = false
        set({ playing: false, position: 0 })
        return
      }
      target = 0
    }
    void get().loadAt(target, true)
  },

  prev: () => {
    const { queue, index, position } = get()
    if (queue.length === 0) return
    if (position > 4) {
      get().seek(0)
      return
    }
    const target = (index - 1 + queue.length) % queue.length
    void get().loadAt(target, true)
  },

  seek: (seconds) => {
    const element = ensureAudio()
    const duration = get().duration
    const max = Number.isFinite(duration) && duration > 0 ? duration : seconds
    const value = Math.max(0, Math.min(max, seconds))
    try {
      element.currentTime = value
      set({ position: value })
    } catch {
      // metadata not ready yet
    }
  },

  handleEnded: () => {
    const { repeat, queue, index } = get()
    if (queue.length === 0) return
    if (repeat === 'one') {
      const element = ensureAudio()
      element.currentTime = 0
      desiredPlaying = true
      safePlay()
      return
    }
    if (index >= queue.length - 1 && repeat !== 'all') {
      desiredPlaying = false
      set({ playing: false, position: 0 })
      return
    }
    get().next(true)
  },

  setVolume: (value) => {
    const volume = Math.max(0, Math.min(1, value))
    const element = ensureAudio()
    element.volume = volume
    if (volume > 0) element.muted = false
    set({ volume, muted: volume === 0 ? get().muted : false })
    if (volumeTimer) clearTimeout(volumeTimer)
    volumeTimer = setTimeout(() => {
      persist('volume', String(Math.round(volume * 100) / 100))
    }, 350)
  },

  toggleMute: () => {
    const element = ensureAudio()
    const muted = !get().muted
    element.muted = muted
    set({ muted })
  },

  toggleShuffle: () => {
    const shuffle = !get().shuffle
    set({ shuffle })
    persist('shuffle', String(shuffle))
  },

  cycleRepeat: () => {
    const order: RepeatMode[] = ['off', 'all', 'one']
    const next = order[(order.indexOf(get().repeat) + 1) % order.length]
    set({ repeat: next })
    persist('repeat', next)
  },

  retry: () => {
    retried = false
    const state = get()
    if (!state.track) return
    void state.loadAt(state.index, true, state.position)
  },

  hydrate: (settings) => {
    const parsedVolume = Number.parseFloat(settings.volume ?? '0.8')
    const volume = Number.isFinite(parsedVolume) ? Math.max(0, Math.min(1, parsedVolume)) : 0.8
    const shuffle = settings.shuffle === 'true'
    const repeat = (['off', 'all', 'one'] as RepeatMode[]).includes(settings.repeat as RepeatMode)
      ? (settings.repeat as RepeatMode)
      : 'off'
    set({ volume, shuffle, repeat })
    if (audio) audio.volume = volume
  }
}))
