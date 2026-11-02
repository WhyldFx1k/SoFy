import { contextBridge, ipcRenderer, webUtils } from 'electron'
import type {
  AppInfo,
  CoreStatus,
  LocalImportResult,
  SoFyBridge,
  WindowState
} from '../shared/types'

interface Envelope<T> {
  ok: boolean
  data?: T
  error?: string
}

async function invoke<T>(method: string, ...args: unknown[]): Promise<T> {
  const result = (await ipcRenderer.invoke('sofy:invoke', method, args)) as Envelope<T>
  if (!result || result.ok !== true) {
    throw new Error(result?.error ?? 'Не удалось выполнить запрос')
  }
  return result.data as T
}

function subscribe<T>(type: string, callback: (value: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: { type: string; data: unknown }) => {
    if (payload && payload.type === type) callback(payload.data as T)
  }
  ipcRenderer.on('sofy:event', listener)
  return () => {
    ipcRenderer.removeListener('sofy:event', listener)
  }
}

const bridge: SoFyBridge = {
  app: {
    info: () => invoke<AppInfo>('app.info'),
    minimize: () => invoke<void>('app.minimize'),
    toggleMaximize: () => invoke<boolean>('app.toggleMaximize'),
    close: () => invoke<void>('app.close'),
    openDataFolder: () => invoke<void>('app.openDataFolder'),
    copyText: (text) => invoke<void>('app.copyText', text),
    onWindowState: (callback) => subscribe<WindowState>('window-state', callback)
  },
  core: {
    status: () => invoke<CoreStatus>('core.status'),
    restart: () => invoke<CoreStatus>('core.restart'),
    onStatus: (callback) => subscribe<CoreStatus>('core-status', callback)
  },
  music: {
    home: () => invoke('music.home'),
    importLocal: () => invoke<LocalImportResult>('music.importLocal'),
    importPaths: (paths) => invoke<LocalImportResult>('music.importPaths', paths),
    search: (query, limit, offset) => invoke('music.search', query, limit, offset),
    ticket: (trackId) => invoke('music.ticket', trackId),
    lyrics: (trackId) => invoke('music.lyrics', trackId),
    likes: () => invoke('music.likes'),
    like: (track) => invoke('music.like', track),
    unlike: (trackId) => invoke('music.unlike', trackId),
    history: (limit) => invoke('music.history', limit),
    addHistory: (track) => invoke('music.addHistory', track),
    playlists: () => invoke('music.playlists'),
    createPlaylist: (name) => invoke('music.createPlaylist', name),
    playlist: (id) => invoke('music.playlist', id),
    updatePlaylist: (id, patch) => invoke('music.updatePlaylist', id, patch),
    setTrackCover: (trackId, cover) => invoke('music.setTrackCover', trackId, cover),
    deletePlaylist: (id) => invoke('music.deletePlaylist', id),
    addToPlaylist: (playlistId, track) => invoke('music.addToPlaylist', playlistId, track),
    removeFromPlaylist: (playlistId, trackId) => invoke('music.removeFromPlaylist', playlistId, trackId),
    settings: () => invoke('music.settings'),
    setSetting: (key, value) => invoke('music.setSetting', key, value)
  },
  accounts: {
    me: () => invoke('accounts.me'),
    register: (input) => invoke('accounts.register', input),
    login: (input) => invoke('accounts.login', input),
    logout: () => invoke('accounts.logout'),
    updateProfile: (patch) => invoke('accounts.updateProfile', patch),
    redeemKey: (key) => invoke('accounts.redeemKey', key),
    adminOverview: () => invoke('accounts.adminOverview'),
    createAccessKey: (role, note) => invoke('accounts.createAccessKey', role, note),
    revokeAccessKey: (id) => invoke('accounts.revokeAccessKey', id),
    setAccountRole: (accountId, role) => invoke('accounts.setAccountRole', accountId, role)
  },
  presence: {
    update: (state) => invoke<void>('presence.update', state)
  },
  files: {
    pathForFile: (file) => webUtils.getPathForFile(file)
  }
}

contextBridge.exposeInMainWorld('sofy', bridge)
