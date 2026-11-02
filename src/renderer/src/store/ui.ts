import { create } from 'zustand'
import type {
  AccessKeyRole,
  Account,
  AccountLoginInput,
  AccountPatch,
  AccountRegisterInput,
  AdminOverview,
  CreatedAccessKey,
  LocalImportResult,
  Playlist,
  PlaylistCard,
  SettingsMap,
  Track
} from '../../../shared/types'
import { bridge } from '../lib/bridge'
import { errorMessage, plural } from '../lib/format'
import { pickCoverImage } from '../lib/image'
import { ROLE_LABEL } from '../lib/roles'
import { usePlayer } from './player'

export type Route =
  | { name: 'home' }
  | { name: 'search' }
  | { name: 'liked' }
  | { name: 'playlists' }
  | { name: 'playlist'; id: string }
  | { name: 'admin' }

export type ToastKind = 'info' | 'success' | 'error'

export interface Toast {
  id: number
  message: string
  kind: ToastKind
  leaving?: boolean
}

export interface PlaylistMenuState {
  id: string
  name: string
  x: number
  y: number
}

export interface TrackMenuState {
  track: Track
  queue: Track[]
  index: number
  x: number
  y: number
}

interface UiState {
  route: Route
  stack: Route[]
  searchQuery: string
  likes: Track[]
  playlists: PlaylistCard[]
  settings: SettingsMap
  ready: boolean
  coreError: string | null
  pickerTrack: Track | null
  newPlaylistOpen: boolean
  queueOpen: boolean
  importing: boolean
  playlistMenu: PlaylistMenuState | null
  trackMenu: TrackMenuState | null
  nowPlayingOpen: boolean
  lyricsTrack: Track | null
  toasts: Toast[]
  descriptionEditId: string | null
  libraryVersion: number
  account: Account | null
  profileOpen: boolean
  redeemKeyOpen: boolean
  settingsOpen: boolean
  navigate: (route: Route) => void
  back: () => void
  setSearchQuery: (query: string) => void
  bootstrap: () => Promise<void>
  refreshLikes: () => Promise<void>
  refreshPlaylists: () => Promise<void>
  importLocal: () => Promise<void>
  importPaths: (paths: string[]) => Promise<void>
  toggleLike: (track: Track) => Promise<void>
  isLiked: (trackId: string) => boolean
  saveSetting: (key: string, value: string) => Promise<void>
  createPlaylist: (name: string) => Promise<Playlist | null>
  deletePlaylist: (id: string, name: string) => Promise<boolean>
  updatePlaylistMeta: (
    id: string,
    patch: { cover?: string | null; description?: string | null }
  ) => Promise<Playlist | null>
  changePlaylistCover: (id: string, name: string) => Promise<void>
  requestDescriptionEdit: (id: string) => void
  consumeDescriptionEdit: () => void
  setTrackCover: (trackId: string, cover: string | null) => Promise<boolean>
  changeTrackCover: (track: Track) => Promise<void>
  addToPlaylist: (playlistId: string, playlistName: string, track: Track) => Promise<boolean>
  removeFromPlaylist: (playlistId: string, trackId: string) => Promise<void>
  openPicker: (track: Track) => void
  closePicker: () => void
  openNewPlaylist: () => void
  closeNewPlaylist: () => void
  toggleQueue: () => void
  closeQueue: () => void
  openPlaylistMenu: (playlist: { id: string; name: string }, x: number, y: number) => void
  closePlaylistMenu: () => void
  openTrackMenu: (track: Track, queue: Track[], index: number, x: number, y: number) => void
  closeTrackMenu: () => void
  openNowPlaying: () => void
  closeNowPlaying: () => void
  openLyrics: (track: Track) => void
  closeLyrics: () => void
  openProfile: () => void
  closeProfile: () => void
  openRedeemKey: () => void
  closeRedeemKey: () => void
  openSettings: () => void
  closeSettings: () => void
  registerAccount: (input: AccountRegisterInput) => Promise<string | null>
  loginAccount: (input: AccountLoginInput) => Promise<string | null>
  logoutAccount: () => Promise<void>
  switchAccount: () => Promise<void>
  saveProfile: (patch: AccountPatch) => Promise<string | null>
  redeemAccessKey: (key: string) => Promise<string | null>
  loadAdminOverview: () => Promise<AdminOverview | null>
  createAccessKey: (role: AccessKeyRole, note: string) => Promise<CreatedAccessKey | null>
  revokeAccessKey: (id: string) => Promise<boolean>
  setAccountRole: (accountId: string, role: AccessKeyRole) => Promise<boolean>
  setCoreError: (message: string | null) => void
  toast: (message: string, kind?: ToastKind) => void
  dismissToast: (id: number) => void
}

let toastId = 0

const applyImport = async (result: LocalImportResult): Promise<void> => {
  const { imported, errors } = result
  if (imported.length === 0 && errors.length === 0) return
  if (imported.length > 0) {
    await useUi.getState().refreshPlaylists()
    const ui = useUi.getState()
    ui.toast(
      imported.length === 1
        ? `«${imported[0].title}» — в «Мои треки»`
        : `${imported.length} ${plural(imported.length, 'трек', 'трека', 'треков')} — в «Мои треки»`,
      'success'
    )
    const library = ui.playlists.find((playlist) => playlist.name === 'Мои треки')
    if (library) ui.navigate({ name: 'playlist', id: library.id })
  }
  if (errors.length > 0) {
    useUi
      .getState()
      .toast(imported.length > 0 ? `Не всё добавилось: ${errors[0]}` : errors[0], 'error')
  }
}

export const useUi = create<UiState>()((set, get) => ({
  route: { name: 'home' },
  stack: [],
  searchQuery: '',
  likes: [],
  playlists: [],
  settings: {},
  ready: false,
  coreError: null,
  pickerTrack: null,
  newPlaylistOpen: false,
  queueOpen: false,
  importing: false,
  playlistMenu: null,
  trackMenu: null,
  nowPlayingOpen: false,
  lyricsTrack: null,
  toasts: [],
  descriptionEditId: null,
  libraryVersion: 0,
  account: null,
  profileOpen: false,
  redeemKeyOpen: false,
  settingsOpen: false,

  navigate: (route) => {
    set((state) => {
      if (JSON.stringify(state.route) === JSON.stringify(route)) return {}
      return {
        route,
        stack: [...state.stack, state.route].slice(-20),
        pickerTrack: null,
        queueOpen: false,
        playlistMenu: null,
        trackMenu: null,
        profileOpen: false,
        redeemKeyOpen: false,
        settingsOpen: false
      }
    })
  },

  back: () => {
    set((state) => {
      if (state.stack.length === 0) return {}
      const stack = [...state.stack]
      const previous = stack.pop()
      return previous ? { route: previous, stack, playlistMenu: null, trackMenu: null } : {}
    })
  },

  setSearchQuery: (query) => set({ searchQuery: query.slice(0, 120) }),

  bootstrap: async () => {
    const results = await Promise.allSettled([
      bridge.music.settings(),
      bridge.music.likes(),
      bridge.music.playlists(),
      bridge.accounts.me()
    ])
    const [settings, likes, playlists, account] = results
    if (settings.status === 'fulfilled') set({ settings: settings.value.settings })
    if (likes.status === 'fulfilled') set({ likes: likes.value.tracks })
    if (playlists.status === 'fulfilled') set({ playlists: playlists.value.playlists })
    if (account.status === 'fulfilled') set({ account: account.value.account })

    const failure = results
      .slice(0, 3)
      .find((result) => result.status === 'rejected')
    set({
      ready: true,
      coreError:
        failure && failure.status === 'rejected' ? errorMessage(failure.reason) : null
    })
  },

  refreshLikes: async () => {
    try {
      const { tracks } = await bridge.music.likes()
      set({ likes: tracks })
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    }
  },

  refreshPlaylists: async () => {
    try {
      const { playlists } = await bridge.music.playlists()
      set({ playlists })
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    }
  },

  importLocal: async () => {
    if (get().importing) return
    set({ importing: true })
    try {
      await applyImport(await bridge.music.importLocal())
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    } finally {
      set({ importing: false })
    }
  },

  importPaths: async (paths) => {
    if (get().importing || paths.length === 0) return
    set({ importing: true })
    try {
      await applyImport(await bridge.music.importPaths(paths))
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    } finally {
      set({ importing: false })
    }
  },

  toggleLike: async (track) => {
    const liked = get().likes.some((item) => item.id === track.id)
    try {
      if (liked) {
        await bridge.music.unlike(track.id)
        set((state) => ({ likes: state.likes.filter((item) => item.id !== track.id) }))
      } else {
        await bridge.music.like(track)
        set((state) => ({ likes: [track, ...state.likes] }))
      }
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    }
  },

  isLiked: (trackId) => get().likes.some((track) => track.id === trackId),

  saveSetting: async (key, value) => {
    set((state) => ({ settings: { ...state.settings, [key]: value } }))
    try {
      const { settings } = await bridge.music.setSetting(key, value)
      set({ settings })
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    }
  },

  createPlaylist: async (name) => {
    const trimmed = name.trim()
    if (!trimmed) {
      get().toast('Введите название плейлиста', 'info')
      return null
    }
    try {
      const { playlist } = await bridge.music.createPlaylist(trimmed)
      await get().refreshPlaylists()
      get().toast(`Плейлист «${trimmed}» создан`, 'success')
      return playlist
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return null
    }
  },

  deletePlaylist: async (id, name) => {
    try {
      await bridge.music.deletePlaylist(id)
      set((state) => ({ playlists: state.playlists.filter((playlist) => playlist.id !== id) }))
      const route = get().route
      if (route.name === 'playlist' && route.id === id) get().navigate({ name: 'playlists' })
      get().toast(`Плейлист «${name}» удалён`, 'success')
      return true
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return false
    }
  },

  updatePlaylistMeta: async (id, patch) => {
    try {
      const { playlist } = await bridge.music.updatePlaylist(id, patch)
      set((state) => ({
        playlists: state.playlists.map((card) =>
          card.id === id
            ? {
                ...card,
                name: playlist.name,
                cover: playlist.cover,
                description: playlist.description
              }
            : card
        )
      }))
      return playlist
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return null
    }
  },

  changePlaylistCover: async (id, name) => {
    try {
      const cover = await pickCoverImage()
      if (!cover) return
      const playlist = await get().updatePlaylistMeta(id, { cover })
      if (playlist) get().toast(`Обложка «${name}» обновлена`, 'success')
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    }
  },

  requestDescriptionEdit: (id) => {
    set({ descriptionEditId: id })
    get().navigate({ name: 'playlist', id })
  },

  consumeDescriptionEdit: () => set({ descriptionEditId: null }),

  setTrackCover: async (trackId, cover) => {
    try {
      await bridge.music.setTrackCover(trackId, cover)
      usePlayer.setState((state) => ({
        track: state.track?.id === trackId ? { ...state.track, artworkUrl: cover } : state.track,
        queue: state.queue.map((item) =>
          item.id === trackId ? { ...item, artworkUrl: cover } : item
        )
      }))
      set((state) => ({
        likes: state.likes.map((item) =>
          item.id === trackId ? { ...item, artworkUrl: cover } : item
        ),
        libraryVersion: state.libraryVersion + 1
      }))
      void get().refreshPlaylists()
      return true
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return false
    }
  },

  changeTrackCover: async (track) => {
    try {
      const cover = await pickCoverImage()
      if (!cover) return
      const ok = await get().setTrackCover(track.id, cover)
      if (ok) get().toast(`Обложка «${track.title}» обновлена`, 'success')
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    }
  },

  addToPlaylist: async (playlistId, playlistName, track) => {
    try {
      await bridge.music.addToPlaylist(playlistId, track)
      await get().refreshPlaylists()
      get().toast(`«${track.title}» — в «${playlistName}»`, 'success')
      return true
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return false
    }
  },

  removeFromPlaylist: async (playlistId, trackId) => {
    try {
      await bridge.music.removeFromPlaylist(playlistId, trackId)
      await get().refreshPlaylists()
      get().toast('Трек удалён из плейлиста', 'info')
    } catch (error) {
      get().toast(errorMessage(error), 'error')
    }
  },

  openPicker: (track) => set({ pickerTrack: track }),
  closePicker: () => set({ pickerTrack: null }),
  openNewPlaylist: () => set({ newPlaylistOpen: true }),
  closeNewPlaylist: () => set({ newPlaylistOpen: false }),
  toggleQueue: () => set((state) => ({ queueOpen: !state.queueOpen })),
  closeQueue: () => set({ queueOpen: false }),
  openPlaylistMenu: (playlist, x, y) =>
    set({
      playlistMenu: {
        id: playlist.id,
        name: playlist.name,
        x: Math.max(0, x),
        y: Math.max(0, y)
      }
    }),
  closePlaylistMenu: () => set({ playlistMenu: null }),
  openTrackMenu: (track, queue, index, x, y) =>
    set({
      trackMenu: {
        track,
        queue,
        index,
        x: Math.max(0, x),
        y: Math.max(0, y)
      }
    }),
  closeTrackMenu: () => set({ trackMenu: null }),
  openNowPlaying: () => set({ nowPlayingOpen: true, lyricsTrack: null }),
  closeNowPlaying: () => set({ nowPlayingOpen: false }),
  openLyrics: (track) => set({ lyricsTrack: track, nowPlayingOpen: false }),
  closeLyrics: () => set({ lyricsTrack: null }),

  openProfile: () =>
    set({ profileOpen: true, playlistMenu: null, trackMenu: null, queueOpen: false }),
  closeProfile: () => set({ profileOpen: false }),
  openRedeemKey: () => set({ redeemKeyOpen: true, profileOpen: false }),
  closeRedeemKey: () => set({ redeemKeyOpen: false }),
  openSettings: () =>
    set({ settingsOpen: true, profileOpen: false, redeemKeyOpen: false, queueOpen: false }),
  closeSettings: () => set({ settingsOpen: false }),

  registerAccount: async (input) => {
    try {
      const { account } = await bridge.accounts.register(input)
      set({ account })
      get().toast(`Добро пожаловать, ${account.displayName}!`, 'success')
      return null
    } catch (error) {
      return errorMessage(error)
    }
  },

  loginAccount: async (input) => {
    try {
      const { account } = await bridge.accounts.login(input)
      set({ account })
      get().toast(`С возвращением, ${account.displayName}!`, 'success')
      return null
    } catch (error) {
      return errorMessage(error)
    }
  },

  logoutAccount: async () => {
    try {
      await bridge.accounts.logout()
    } catch {
      // the local state is cleared regardless
    }
    usePlayer.getState().pause()
    set({
      account: null,
      route: { name: 'home' },
      stack: [],
      profileOpen: false,
      queueOpen: false,
      nowPlayingOpen: false,
      lyricsTrack: null,
      pickerTrack: null,
      playlistMenu: null,
      trackMenu: null,
      newPlaylistOpen: false,
      redeemKeyOpen: false,
      settingsOpen: false
    })
    get().toast('Вы вышли из аккаунта', 'info')
  },

  switchAccount: async () => {
    try {
      await bridge.accounts.logout()
    } catch {
      // ignore, the point is to clear the current profile
    }
    usePlayer.getState().pause()
    set({
      account: null,
      route: { name: 'home' },
      stack: [],
      profileOpen: false,
      queueOpen: false,
      nowPlayingOpen: false,
      lyricsTrack: null,
      pickerTrack: null,
      playlistMenu: null,
      trackMenu: null,
      newPlaylistOpen: false,
      redeemKeyOpen: false,
      settingsOpen: false
    })
  },

  saveProfile: async (patch) => {
    try {
      const { account } = await bridge.accounts.updateProfile(patch)
      set({ account })
      get().toast('Профиль обновлён', 'success')
      return null
    } catch (error) {
      return errorMessage(error)
    }
  },

  redeemAccessKey: async (key) => {
    try {
      const { account } = await bridge.accounts.redeemKey(key)
      set({ account })
      get().toast(
        account.role === 'user'
          ? 'Ключ активирован'
          : `Ключ активирован — ${ROLE_LABEL[account.role]}`,
        'success'
      )
      return null
    } catch (error) {
      return errorMessage(error)
    }
  },

  loadAdminOverview: async () => {
    try {
      const overview = await bridge.accounts.adminOverview()
      const self = overview.accounts.find((item) => item.id === get().account?.id)
      if (self) set({ account: self })
      return overview
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return null
    }
  },

  createAccessKey: async (role, note) => {
    try {
      const result = await bridge.accounts.createAccessKey(role, note)
      get().toast('Ключ создан — скопируйте его сейчас', 'success')
      return result
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return null
    }
  },

  revokeAccessKey: async (id) => {
    try {
      await bridge.accounts.revokeAccessKey(id)
      get().toast('Ключ отозван', 'success')
      return true
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return false
    }
  },

  setAccountRole: async (accountId, role) => {
    try {
      const { account } = await bridge.accounts.setAccountRole(accountId, role)
      set((state) => ({
        account: state.account?.id === account.id ? account : state.account
      }))
      get().toast(`Роль обновлена: ${ROLE_LABEL[role]}`, 'success')
      return true
    } catch (error) {
      get().toast(errorMessage(error), 'error')
      return false
    }
  },

  setCoreError: (message) => set({ coreError: message }),

  toast: (message, kind = 'info') => {
    toastId += 1
    const id = toastId
    set((state) => ({ toasts: [...state.toasts, { id, message, kind }].slice(-4) }))
    setTimeout(() => get().dismissToast(id), kind === 'error' ? 6000 : 3800)
  },

  dismissToast: (id) => {
    if (!get().toasts.some((toast) => toast.id === id && !toast.leaving)) return
    set((state) => ({
      toasts: state.toasts.map((toast) => (toast.id === id ? { ...toast, leaving: true } : toast))
    }))
    setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((toast) => toast.id !== id) }))
    }, 260)
  }
}))
