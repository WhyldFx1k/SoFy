export type ProviderId = 'local' | 'soundcloud' | 'yandex'

export interface Track {
  id: string
  provider: ProviderId
  externalId: string
  title: string
  artist: string
  album: string | null
  durationMs: number
  artworkUrl: string | null
  color: string | null
  preview: boolean
  streamable: boolean
}

export interface Shelf {
  id: string
  title: string
  subtitle: string
  tracks: Track[]
}

export interface Genre {
  id: string
  label: string
  query: string
  color: string
}

export interface HomeData {
  heroTrack: Track | null
  shelves: Shelf[]
  genres: Genre[]
}

export interface ProviderIssue {
  provider: string
  label: string
  message: string
}

export interface SearchResult {
  tracks: Track[]
  errors: ProviderIssue[]
}

export interface StreamInfo {
  url: string
  kind: 'file' | 'progressive' | 'hls'
  expiresAt: number
}

export interface Playlist {
  id: string
  name: string
  cover: string | null
  description: string | null
  createdAt: number
  updatedAt: number
}

export interface PlaylistCard {
  id: string
  name: string
  cover: string | null
  description: string | null
  trackCount: number
  updatedAt: number
  preview: Track[]
}

export interface PlaylistDetail {
  playlist: Playlist
  trackCount: number
  tracks: Track[]
}

export type SettingsMap = Record<string, string>

export type CoreState = 'starting' | 'ready' | 'stopped' | 'error'

export interface CoreStatus {
  state: CoreState
  port: number | null
  error: string | null
  dataDir: string
  java: string
  restarts: number
}

export interface WindowState {
  maximized: boolean
  focused: boolean
  fullscreen: boolean
}

export interface AppInfo {
  name: string
  version: string
  electron: string
  chrome: string
  node: string
  platform: string
  core: CoreStatus
}

export interface LocalImportResult {
  imported: Track[]
  errors: string[]
}

export type AccountRole = 'user' | 'admin' | 'owner'
export type AccessKeyRole = 'user' | 'admin'

export interface Account {
  id: string
  username: string
  displayName: string
  avatar: string | null
  role: AccountRole
  createdAt: number
  updatedAt: number
}

export interface AccountRegisterInput {
  username: string
  displayName?: string
  password: string
  accessKey?: string
}

export interface AccountLoginInput {
  username: string
  password: string
}

export interface AccountPatch {
  displayName?: string
  avatar?: string | null
}

export interface AccessKey {
  id: string
  role: AccessKeyRole
  note: string | null
  hint: string
  createdBy: string | null
  redeemedBy: string | null
  createdAt: number
  redeemedAt: number | null
  revoked: boolean
  revokedAt: number | null
}

export interface CreatedAccessKey {
  key: string
  accessKey: AccessKey
}

export interface AdminStats {
  accounts: number
  owners: number
  admins: number
  users: number
  keysActive: number
  keysRedeemed: number
  keysRevoked: number
}

export interface AdminCapabilities {
  manageRoles: boolean
  createAdminKeys: boolean
  revokeAnyKey: boolean
}

export interface AdminOverview {
  stats: AdminStats
  accounts: Account[]
  keys: AccessKey[]
  capabilities: AdminCapabilities
}

export interface AccountsApi {
  me(): Promise<{ account: Account | null }>
  register(input: AccountRegisterInput): Promise<{ account: Account }>
  login(input: AccountLoginInput): Promise<{ account: Account }>
  logout(): Promise<{ ok: boolean }>
  updateProfile(patch: AccountPatch): Promise<{ account: Account }>
  redeemKey(key: string): Promise<{ account: Account }>
  adminOverview(): Promise<AdminOverview>
  createAccessKey(role: AccessKeyRole, note?: string): Promise<CreatedAccessKey>
  revokeAccessKey(id: string): Promise<{ ok: boolean }>
  setAccountRole(accountId: string, role: AccessKeyRole): Promise<{ account: Account }>
}

export interface DiscordPresenceState {
  title: string
  artist: string
  artwork: string | null
  playing: boolean
  position: number
  duration: number
}

export interface LyricsLine {
  timeMs: number
  text: string
}

export interface Lyrics {
  found: boolean
  instrumental: boolean
  plain: string | null
  synced: LyricsLine[]
}

export interface MusicApi {
  home(): Promise<HomeData>
  importLocal(): Promise<LocalImportResult>
  importPaths(paths: string[]): Promise<LocalImportResult>
  search(query: string, limit?: number, offset?: number): Promise<SearchResult>
  ticket(trackId: string): Promise<StreamInfo>
  lyrics(trackId: string): Promise<Lyrics>
  likes(): Promise<{ tracks: Track[] }>
  like(track: Track): Promise<{ liked: boolean; track: Track }>
  unlike(trackId: string): Promise<{ liked: boolean }>
  history(limit?: number): Promise<{ tracks: Track[] }>
  addHistory(track: Track): Promise<{ ok: boolean }>
  playlists(): Promise<{ playlists: PlaylistCard[] }>
  createPlaylist(name: string): Promise<{ playlist: Playlist }>
  playlist(id: string): Promise<PlaylistDetail>
  updatePlaylist(
    id: string,
    patch: { cover?: string | null; description?: string | null }
  ): Promise<{ playlist: Playlist }>
  setTrackCover(trackId: string, cover: string | null): Promise<{ ok: boolean; cover: string | null }>
  deletePlaylist(id: string): Promise<{ ok: boolean }>
  addToPlaylist(playlistId: string, track: Track): Promise<{ ok: boolean }>
  removeFromPlaylist(playlistId: string, trackId: string): Promise<{ ok: boolean }>
  settings(): Promise<{ settings: SettingsMap }>
  setSetting(key: string, value: string): Promise<{ settings: SettingsMap }>
}

export interface SoFyBridge {
  app: {
    info(): Promise<AppInfo>
    minimize(): Promise<void>
    toggleMaximize(): Promise<boolean>
    close(): Promise<void>
    openDataFolder(): Promise<void>
    copyText(text: string): Promise<void>
    onWindowState(callback: (state: WindowState) => void): () => void
  }
  core: {
    status(): Promise<CoreStatus>
    restart(): Promise<CoreStatus>
    onStatus(callback: (status: CoreStatus) => void): () => void
  }
  music: MusicApi
  accounts: AccountsApi
  presence: {
    update(state: DiscordPresenceState | null): Promise<void>
  }
  files: {
    pathForFile(file: File): string
  }
}
