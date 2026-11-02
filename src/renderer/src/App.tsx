import { useEffect, useRef, useState } from 'react'
import { Music4 } from 'lucide-react'
import type { CoreStatus } from '../../shared/types'
import { AuthGate } from './components/AuthGate'
import { BootScreen } from './components/BootScreen'
import { LyricsDrawer } from './components/LyricsDrawer'
import { NewPlaylistDialog } from './components/NewPlaylistDialog'
import { NowPlaying } from './components/NowPlaying'
import { PlayerBar } from './components/PlayerBar'
import { PlaylistMenu } from './components/PlaylistMenu'
import { PlaylistPicker } from './components/PlaylistPicker'
import { ProfileDrawer } from './components/ProfileDrawer'
import { QueueDrawer } from './components/QueueDrawer'
import { RedeemKeyDialog } from './components/RedeemKeyDialog'
import { SettingsDialog } from './components/SettingsDialog'
import { Sidebar } from './components/Sidebar'
import { TitleBar } from './components/TitleBar'
import { Toasts } from './components/Toasts'
import { TrackMenu } from './components/TrackMenu'
import { bridge } from './lib/bridge'
import { errorMessage, isTypingTarget } from './lib/format'
import { attachSmoothWheel } from './lib/smoothScroll'
import { AdminPage } from './pages/Admin'
import { HomePage } from './pages/Home'
import { LikedPage } from './pages/Liked'
import { PlaylistView } from './pages/PlaylistView'
import { PlaylistsPage } from './pages/Playlists'
import { SearchPage } from './pages/Search'
import { usePlayer } from './store/player'
import { useUi, type Route } from './store/ui'

function renderPage(route: Route) {
  switch (route.name) {
    case 'home':
      return <HomePage />
    case 'search':
      return <SearchPage />
    case 'liked':
      return <LikedPage />
    case 'playlists':
      return <PlaylistsPage />
    case 'playlist':
      return <PlaylistView />
    case 'admin':
      return <AdminPage />
  }
}

export default function App() {
  const route = useUi((state) => state.route)
  const ready = useUi((state) => state.ready)
  const account = useUi((state) => state.account)
  const settings = useUi((state) => state.settings)
  const settingsOpen = useUi((state) => state.settingsOpen)
  const modalOpen = useUi(
    (state) => state.newPlaylistOpen || state.pickerTrack !== null || state.settingsOpen
  )
  const menuOpen = useUi((state) => state.playlistMenu !== null || state.trackMenu !== null)

  const [status, setStatus] = useState<CoreStatus | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [dropping, setDropping] = useState(false)
  const dragDepth = useRef(0)
  const hydrated = useRef(false)
  const contentRef = useRef<HTMLElement>(null)

  const routeKey = route.name === 'playlist' ? `playlist:${route.id}` : route.name
  const coreReady = status?.state === 'ready'
  const showBoot = !coreReady || !ready

  useEffect(() => {
    let alive = true
    void bridge.core
      .status()
      .then((value) => {
        if (alive) setStatus(value)
      })
      .catch(() => {})
    const off = bridge.core.onStatus(setStatus)
    return () => {
      alive = false
      off()
    }
  }, [])

  useEffect(() => {
    if (!coreReady || ready) return
    void useUi.getState().bootstrap()
  }, [coreReady, ready])

  useEffect(() => {
    if (!ready || !account || hydrated.current) return
    hydrated.current = true
    usePlayer.getState().hydrate(settings)
  }, [ready, account, settings])

  useEffect(() => {
    document.documentElement.dataset.motion = settings.reduceMotion === 'true' ? 'reduce' : 'full'
  }, [settings.reduceMotion])

  useEffect(() => {
    document.documentElement.dataset.theme = settings.theme ?? 'aurora'
  }, [settings.theme])

  useEffect(() => {
    document.documentElement.dataset.controls =
      settings.windowButtons === 'left' ? 'left' : 'right'
  }, [settings.windowButtons])

  useEffect(() => {
    document.documentElement.dataset.blur = settings.blur ?? 'soft'
  }, [settings.blur])

  useEffect(() => {
    contentRef.current?.scrollTo({ top: 0 })
  }, [routeKey])

  useEffect(() => {
    const element = contentRef.current
    if (!element || !account) return
    return attachSmoothWheel(element, () => {
      const current = useUi.getState().settings
      return current.reduceMotion !== 'true' && current.smoothScroll !== 'false'
    })
  }, [account])

  useEffect(() => {
    if (!ready || !account) return
    if (settings.discordPresence === 'false') {
      void bridge.presence.update(null)
      return
    }
    let lastKey = ''
    const sync = (): void => {
      const player = usePlayer.getState()
      const track = player.track
      if (!track) {
        if (lastKey !== 'idle') {
          lastKey = 'idle'
          void bridge.presence.update(null)
        }
        return
      }
      const key = `${track.id}:${player.playing}:${Math.floor(player.position / 10)}`
      if (key === lastKey) return
      lastKey = key
      void bridge.presence.update({
        title: track.title,
        artist: track.artist,
        artwork: track.artworkUrl,
        playing: player.playing,
        position: player.position,
        duration: player.duration
      })
    }
    sync()
    const off = usePlayer.subscribe(sync)
    return () => {
      off()
      void bridge.presence.update(null)
    }
  }, [ready, account, settings.discordPresence])

  useEffect(() => {
    if (!coreReady || !ready || !account) return
    const hasFiles = (event: DragEvent): boolean =>
      Array.from(event.dataTransfer?.types ?? []).includes('Files')

    const onDragEnter = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current += 1
      setDropping(true)
    }
    const onDragOver = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy'
    }
    const onDragLeave = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      dragDepth.current = Math.max(0, dragDepth.current - 1)
      if (dragDepth.current === 0) setDropping(false)
    }
    const onDrop = (event: DragEvent): void => {
      if (!hasFiles(event)) return
      event.preventDefault()
      dragDepth.current = 0
      setDropping(false)
      const paths = Array.from(event.dataTransfer?.files ?? [])
        .map((file) => bridge.files.pathForFile(file))
        .filter((path) => path.length > 0)
      if (paths.length > 0) void useUi.getState().importPaths(paths)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
    return () => {
      dragDepth.current = 0
      setDropping(false)
      window.removeEventListener('dragenter', onDragEnter)
      window.removeEventListener('dragover', onDragOver)
      window.removeEventListener('dragleave', onDragLeave)
      window.removeEventListener('drop', onDrop)
    }
  }, [coreReady, ready, account])

  useEffect(() => {
    const isActivatable = (target: EventTarget | null): boolean =>
      target instanceof HTMLElement &&
      Boolean(
        target.closest(
          'button, a[href], input, textarea, select, [role="button"], [role="switch"], [role="tab"], [role="menuitem"], summary'
        )
      )
    const onKeyDown = (event: KeyboardEvent): void => {
      if (!account) return
      if (event.defaultPrevented || isTypingTarget(event.target) || modalOpen || menuOpen) return
      const player = usePlayer.getState()
      if (event.code === 'Space') {
        if (isActivatable(event.target)) return
        event.preventDefault()
        player.toggle()
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        if (event.shiftKey) player.next()
        else player.seek(player.position + 5)
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        if (event.shiftKey) player.prev()
        else player.seek(player.position - 5)
      } else if (event.key.toLowerCase() === 'm') {
        player.toggleMute()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [account, modalOpen, menuOpen])

  const retryCore = async (): Promise<void> => {
    setRestarting(true)
    try {
      const value = await bridge.core.restart()
      setStatus(value)
    } catch (reason) {
      setStatus((current) =>
        current
          ? { ...current, state: 'error', error: errorMessage(reason) }
          : {
              state: 'error',
              port: null,
              error: errorMessage(reason),
              dataDir: '',
              java: '',
              restarts: 0
            }
      )
    } finally {
      setRestarting(false)
    }
  }

  return (
    <div className="app">
      <div className="ambient" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>

      <TitleBar />

      {showBoot ? (
        <BootScreen
          status={status}
          starting={restarting || status?.state === 'starting'}
          onRetry={() => void retryCore()}
        />
      ) : !account ? (
        <AuthGate />
      ) : (
        <>
          <div className="shell">
            <Sidebar />
            <main className="content" ref={contentRef}>
              <div className="page-wrap" key={routeKey}>
                {renderPage(route)}
              </div>
            </main>
          </div>
          <PlayerBar />
          <NowPlaying />
          <QueueDrawer />
          <LyricsDrawer />
          <PlaylistPicker />
          <PlaylistMenu />
          <TrackMenu />
          <NewPlaylistDialog />
          <RedeemKeyDialog />
          {settingsOpen && <SettingsDialog />}
          <ProfileDrawer />
        </>
      )}

      <Toasts />

      {dropping && account && (
        <div className="dropzone" aria-hidden="true">
          <div className="dropzone__card">
            <span className="dropzone__icon">
              <Music4 size={26} />
            </span>
            <p className="dropzone__title">Отпустите файлы</p>
            <p className="dropzone__hint">MP3, FLAC, M4A, WAV, OGG и другие — в «Мои треки»</p>
          </div>
        </div>
      )}
    </div>
  )
}
