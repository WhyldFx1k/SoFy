import type {
  AccessKey,
  Account,
  AccountRole,
  AccountsApi,
  AppInfo,
  CoreStatus,
  Genre,
  HomeData,
  Lyrics,
  MusicApi,
  Playlist,
  PlaylistCard,
  PlaylistDetail,
  SearchResult,
  SettingsMap,
  SoFyBridge,
  StreamInfo,
  Track
} from '../../../shared/types'

const DURATION = 40_000

function track(
  externalId: string,
  title: string,
  artist: string,
  album: string,
  color: string
): Track {
  return {
    id: `demo:${externalId}`,
    provider: 'soundcloud',
    externalId,
    title,
    artist,
    album,
    durationMs: DURATION,
    artworkUrl: null,
    color,
    preview: false,
    streamable: true
  }
}

const LIBRARY: Track[] = [
  track('aurora', 'Aurora Drift', 'SoFy Sessions', 'Horizons', '#FFD84D'),
  track('night-air', 'Ночной эфир', 'Морс', 'Тёплый сигнал', '#7B61FF'),
  track('neon-rain', 'Neon Rain', 'Lumen', 'City Lights', '#FF5C7A'),
  track('north-wind', 'Северный ветер', 'Полярный', 'Тишина', '#4FD1C5'),
  track('velvet-sky', 'Velvet Sky', 'Monsoon', 'Slow Motion', '#FFA94D'),
  track('gravity', 'Гравитация', 'Космонавт', 'Орбита', '#5C9DFF'),
  track('afterglow', 'Afterglow', 'Aria Moon', 'Night Bloom', '#E879F9'),
  track('city-sleeps', 'Город спит', 'Тихий', 'Огни', '#94A3B8'),
  track('horizon-lines', 'Horizon Lines', 'Nami', 'Coastline', '#34D399'),
  track('no-words', 'Без слов', 'Аэро', 'Воздух', '#F472B6')
]

const GENRES: Genre[] = [
  { id: 'pop', label: 'Поп', query: 'pop music', color: '#f0b64f' },
  { id: 'rock', label: 'Рок', query: 'rock music', color: '#ef5d6a' },
  { id: 'hiphop', label: 'Хип-хоп', query: 'hip hop', color: '#8f7bff' },
  { id: 'electronic', label: 'Электроника', query: 'electronic music', color: '#3fc1c9' },
  { id: 'indie', label: 'Инди', query: 'indie music', color: '#7fcf7a' },
  { id: 'jazz', label: 'Джаз', query: 'jazz music', color: '#e0a15c' },
  { id: 'rnb', label: 'R&B', query: 'r&b music', color: '#d77fa8' },
  { id: 'classical', label: 'Классика', query: 'classical music', color: '#a9b7d0' }
]

const settings: SettingsMap = {
  volume: '0.8',
  quality: 'high',
  shuffle: 'false',
  repeat: 'off',
  reduceMotion: 'false',
  genre: 'pop'
}

let liked: Track[] = [LIBRARY[2], LIBRARY[5], LIBRARY[8]]
let history: Track[] = [LIBRARY[0], LIBRARY[3], LIBRARY[6], LIBRARY[1]]
let playlists: { playlist: Playlist; tracks: Track[] }[] = [
  {
    playlist: {
      id: 'mock-playlist-night',
      name: 'Ночная поездка',
      cover: null,
      description: 'Тихие треки для дороги домой',
      createdAt: Date.now() - 86400000 * 3,
      updatedAt: Date.now() - 86400000
    },
    tracks: [LIBRARY[1], LIBRARY[7], LIBRARY[6], LIBRARY[2]]
  },
  {
    playlist: {
      id: 'mock-playlist-focus',
      name: 'Фокус',
      cover: null,
      description: null,
      createdAt: Date.now() - 86400000 * 12,
      updatedAt: Date.now() - 86400000 * 2
    },
    tracks: [LIBRARY[0], LIBRARY[8], LIBRARY[9]]
  }
]

let wavUrl: string | null = null

interface MockUser {
  account: Account
  password: string
}

const seedNow = Date.now()
const day = 86_400_000

let users: MockUser[] = [
  {
    account: {
      id: 'mock-owner',
      username: 'whyldfx1k',
      displayName: 'Michael',
      avatar: null,
      role: 'owner',
      createdAt: seedNow - day * 30,
      updatedAt: seedNow - day
    },
    password: 'owner-preview'
  },
  {
    account: {
      id: 'mock-admin',
      username: 'admin',
      displayName: 'Администратор',
      avatar: null,
      role: 'admin',
      createdAt: seedNow - day * 20,
      updatedAt: seedNow - day * 2
    },
    password: 'admin-preview'
  },
  {
    account: {
      id: 'mock-user',
      username: 'listener',
      displayName: 'Слушатель',
      avatar: null,
      role: 'user',
      createdAt: seedNow - day * 8,
      updatedAt: seedNow - day * 3
    },
    password: 'listener-preview'
  }
]
let currentUserId: string | null = null
let accessKeys: { raw: string; key: AccessKey }[] = []

const KEY_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'

function currentUser(): MockUser | undefined {
  return users.find((item) => item.account.id === currentUserId)
}

function requireActor(roles: AccountRole[]): MockUser {
  const user = currentUser()
  if (!user) throw new Error('Требуется вход в аккаунт')
  if (!roles.includes(user.account.role)) throw new Error('Недостаточно прав')
  return user
}

function compactKey(value: string): string {
  return value.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
}

function activeKey(raw: string): { raw: string; key: AccessKey } {
  const compact = compactKey(raw)
  const entry = accessKeys.find((item) => compactKey(item.raw) === compact)
  if (!entry || entry.key.revoked || entry.key.redeemedBy) {
    throw new Error('Ключ доступа недействителен или уже использован')
  }
  return entry
}

function makeKey(): string {
  const block = (): string =>
    Array.from(
      { length: 4 },
      () => KEY_ALPHABET[Math.floor(Math.random() * KEY_ALPHABET.length)]
    ).join('')
  return `SOFY-${block()}-${block()}-${block()}-${block()}`
}

const accounts: AccountsApi = {
  me: async () => {
    return delay({ account: currentUser()?.account ?? null }, 120)
  },
  register: async ({ username, displayName, password, accessKey }) => {
    const login = username.trim().toLowerCase()
    if (!/^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$/.test(login)) {
      throw new Error('Логин: 3–24 символа, латиница, цифры, точка, дефис или _')
    }
    if (password.length < 8) throw new Error('Пароль должен быть не короче 8 символов')
    if (users.some((item) => item.account.username === login)) {
      throw new Error('Этот логин уже занят')
    }
    const entry = accessKey?.trim() ? activeKey(accessKey) : null
    const now = Date.now()
    const account: Account = {
      id: `mock-account-${now}`,
      username: login,
      displayName: displayName?.trim() || login,
      avatar: null,
      role: entry?.key.role ?? 'user',
      createdAt: now,
      updatedAt: now
    }
    if (entry) {
      entry.key = {
        ...entry.key,
        redeemedBy: account.username,
        redeemedAt: now
      }
    }
    users = [...users, { account, password }]
    currentUserId = account.id
    return delay({ account }, 220)
  },
  login: async ({ username, password }) => {
    const login = username.trim().toLowerCase()
    const user = users.find(
      (item) => item.account.username === login && item.password === password
    )
    if (!user) throw new Error('Неверный логин или пароль')
    currentUserId = user.account.id
    return delay({ account: user.account }, 220)
  },
  logout: async () => {
    currentUserId = null
    return delay({ ok: true }, 120)
  },
  updateProfile: async (patch) => {
    const user = currentUser()
    if (!user) throw new Error('Требуется вход в аккаунт')
    user.account = {
      ...user.account,
      ...(patch.displayName !== undefined ? { displayName: patch.displayName } : {}),
      ...(patch.avatar !== undefined ? { avatar: patch.avatar } : {}),
      updatedAt: Date.now()
    }
    return delay({ account: user.account }, 160)
  },
  redeemKey: async (raw) => {
    const user = requireActor(['user'])
    const entry = activeKey(raw)
    entry.key = {
      ...entry.key,
      redeemedBy: user.account.username,
      redeemedAt: Date.now()
    }
    if (entry.key.role === 'admin') {
      user.account = { ...user.account, role: 'admin', updatedAt: Date.now() }
    }
    return delay({ account: user.account }, 220)
  },
  adminOverview: async () => {
    const actor = requireActor(['admin', 'owner'])
    const owner = actor.account.role === 'owner'
    const keys = accessKeys.map((entry) => entry.key)
    return delay(
      {
        stats: {
          accounts: users.length,
          owners: users.filter((item) => item.account.role === 'owner').length,
          admins: users.filter((item) => item.account.role === 'admin').length,
          users: users.filter((item) => item.account.role === 'user').length,
          keysActive: keys.filter((key) => !key.revoked && !key.redeemedBy).length,
          keysRedeemed: keys.filter((key) => !key.revoked && key.redeemedBy).length,
          keysRevoked: keys.filter((key) => key.revoked).length
        },
        accounts: users.map((item) => item.account),
        keys,
        capabilities: {
          manageRoles: owner,
          createAdminKeys: owner,
          revokeAnyKey: owner
        }
      },
      220
    )
  },
  createAccessKey: async (role, note) => {
    const actor = requireActor(['admin', 'owner'])
    if (role === 'admin' && actor.account.role !== 'owner') {
      throw new Error('Только владелец может выдавать ключи администратора')
    }
    const raw = makeKey()
    const key: AccessKey = {
      id: `mock-key-${Date.now()}-${accessKeys.length}`,
      role,
      note: note?.trim() || null,
      hint: raw.slice(-4),
      createdBy: actor.account.username,
      redeemedBy: null,
      createdAt: Date.now(),
      redeemedAt: null,
      revoked: false,
      revokedAt: null
    }
    accessKeys = [{ raw, key }, ...accessKeys]
    return delay({ key: raw, accessKey: key }, 200)
  },
  revokeAccessKey: async (id) => {
    const actor = requireActor(['admin', 'owner'])
    const entry = accessKeys.find((item) => item.key.id === id)
    if (!entry) throw new Error('Ключ не найден')
    if (entry.key.revoked) return delay({ ok: true }, 120)
    if (actor.account.role !== 'owner') {
      if (entry.key.createdBy !== actor.account.username) {
        throw new Error('Можно отзывать только свои ключи')
      }
      if (entry.key.role === 'admin') {
        throw new Error('Ключи администратора отзывает владелец')
      }
    }
    entry.key = { ...entry.key, revoked: true, revokedAt: Date.now() }
    return delay({ ok: true }, 160)
  },
  setAccountRole: async (accountId, role) => {
    const actor = requireActor(['owner'])
    if (actor.account.id === accountId) throw new Error('Нельзя изменить собственную роль')
    const target = users.find((item) => item.account.id === accountId)
    if (!target) throw new Error('Аккаунт не найден')
    if (target.account.role === 'owner') throw new Error('Роль владельца изменить нельзя')
    target.account = { ...target.account, role, updatedAt: Date.now() }
    return delay({ account: target.account }, 160)
  }
}

function buildWav(): Blob {
  const sampleRate = 22_050
  const seconds = 40
  const total = sampleRate * seconds
  const buffer = new ArrayBuffer(44 + total * 2)
  const view = new DataView(buffer)
  const write = (offset: number, value: string): void => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index))
    }
  }
  write(0, 'RIFF')
  view.setUint32(4, 36 + total * 2, true)
  write(8, 'WAVE')
  write(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  write(36, 'data')
  view.setUint32(40, total * 2, true)

  const notes = [220, 277.18, 329.63, 440]
  for (let index = 0; index < total; index += 1) {
    const time = index / sampleRate
    const fade = Math.min(1, time / 2, (seconds - time) / 3)
    const tremolo = 0.82 + 0.18 * Math.sin(time * 1.6)
    const pad =
      Math.sin(2 * Math.PI * notes[0] * time) * 0.34 +
      Math.sin(2 * Math.PI * notes[1] * time) * 0.22 +
      Math.sin(2 * Math.PI * notes[2] * time) * 0.18 +
      Math.sin(2 * Math.PI * notes[3] * time) * 0.08
    const sample = Math.max(-1, Math.min(1, pad * fade * tremolo * 0.32))
    view.setInt16(44 + index * 2, sample * 32767, true)
  }
  return new Blob([buffer], { type: 'audio/wav' })
}

function mockStream(): StreamInfo {
  if (!wavUrl) wavUrl = URL.createObjectURL(buildWav())
  return { url: wavUrl, kind: 'progressive', expiresAt: Date.now() + 3_600_000 }
}

function delay<T>(value: T, ms = 320): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms))
}

function shelf(id: string, title: string, subtitle: string, tracks: Track[]) {
  return { id, title, subtitle, tracks }
}

function card(entry: { playlist: Playlist; tracks: Track[] }): PlaylistCard {
  return {
    id: entry.playlist.id,
    name: entry.playlist.name,
    cover: entry.playlist.cover,
    description: entry.playlist.description,
    trackCount: entry.tracks.length,
    updatedAt: entry.playlist.updatedAt,
    preview: entry.tracks.slice(0, 4)
  }
}

const music: MusicApi = {
  home: async (): Promise<HomeData> => {
    const shelves = []
    if (history.length > 0) shelves.push(shelf('recent', 'Недавно слушали', 'Продолжите с того места', history))
    if (liked.length > 0) shelves.push(shelf('liked', 'Мне нравится', 'Ваша коллекция', liked))
    return delay({ heroTrack: history[0] ?? null, shelves, genres: GENRES }, 260)
  },
  importLocal: async () => delay({ imported: [], errors: [] }, 180),
  importPaths: async () => delay({ imported: [], errors: [] }, 180),
  search: async (query): Promise<SearchResult> => {
    const normalized = query.trim().toLowerCase()
    if (GENRES.some((genre) => genre.query === normalized)) {
      return delay({ tracks: LIBRARY, errors: [] }, 520)
    }
    const matches = LIBRARY.filter(
      (item) =>
        item.title.toLowerCase().includes(normalized) ||
        item.artist.toLowerCase().includes(normalized) ||
        (item.album ?? '').toLowerCase().includes(normalized)
    )
    return delay({ tracks: matches, errors: [] }, 420)
  },
  ticket: async (id) => {
    if (!LIBRARY.some((item) => item.id === id) && !liked.some((item) => item.id === id)) {
      const known = playlists.some((entry) => entry.tracks.some((item) => item.id === id))
      if (!known) throw new Error('Трек не найден')
    }
    return delay(mockStream(), 220)
  },
  likes: async () => delay({ tracks: liked }),
  like: async (item) => {
    if (!liked.some((entry) => entry.id === item.id)) liked = [item, ...liked]
    return delay({ liked: true, track: item }, 120)
  },
  unlike: async (id) => {
    liked = liked.filter((entry) => entry.id !== id)
    return delay({ liked: false }, 120)
  },
  lyrics: async (): Promise<Lyrics> => {
    const lines = [
      'Свет в окне — и город спит',
      'Мы одни на всей планете',
      'Тихий вечер всё хранит',
      'Наши тёплые секреты',
      'Пусть играет эта песня',
      'Пока время не спешит',
      'И под музыку чудесней',
      'Каждый вдох звучит в груди',
      'Мы вернёмся к этим строчкам',
      'Через годы, через дни',
      'Чтобы снова этой ночью',
      'Стать друг другу ближе мы',
      'Свет в окне — и город спит',
      'Мы одни на всей планете'
    ]
    return delay(
      {
        found: true,
        instrumental: false,
        plain: lines.join('\n'),
        synced: lines.map((text, index) => ({ timeMs: index * 5000, text }))
      },
      240
    )
  },
  history: async (limit = 40) => delay({ tracks: history.slice(0, limit) }),
  addHistory: async (item) => {
    history = [item, ...history.filter((entry) => entry.id !== item.id)].slice(0, 50)
    return delay({ ok: true }, 60)
  },
  playlists: async () => delay({ playlists: playlists.map(card) }),
  createPlaylist: async (name): Promise<{ playlist: Playlist }> => {
    const playlist: Playlist = {
      id: `mock-${Date.now()}`,
      name,
      cover: null,
      description: null,
      createdAt: Date.now(),
      updatedAt: Date.now()
    }
    playlists = [{ playlist, tracks: [] }, ...playlists]
    return delay({ playlist }, 180)
  },
  playlist: async (id): Promise<PlaylistDetail> => {
    const entry = playlists.find((item) => item.playlist.id === id)
    if (!entry) throw new Error('Плейлист не найден')
    return delay({
      playlist: entry.playlist,
      trackCount: entry.tracks.length,
      tracks: entry.tracks
    })
  },
  updatePlaylist: async (id, patch) => {
    const entry = playlists.find((item) => item.playlist.id === id)
    if (!entry) throw new Error('Плейлист не найден')
    if ('cover' in patch) entry.playlist.cover = patch.cover ?? null
    if ('description' in patch) entry.playlist.description = patch.description ?? null
    return delay({ playlist: entry.playlist }, 140)
  },
  setTrackCover: async (trackId, cover) => {
    const apply = (item: Track): Track =>
      item.id === trackId ? { ...item, artworkUrl: cover } : item
    liked = liked.map(apply)
    history = history.map(apply)
    playlists = playlists.map((entry) => ({ ...entry, tracks: entry.tracks.map(apply) }))
    return delay({ ok: true, cover }, 140)
  },
  deletePlaylist: async (id) => {
    playlists = playlists.filter((item) => item.playlist.id !== id)
    return delay({ ok: true }, 160)
  },
  addToPlaylist: async (id, item) => {
    const entry = playlists.find((value) => value.playlist.id === id)
    if (!entry) throw new Error('Плейлист не найден')
    if (!entry.tracks.some((value) => value.id === item.id)) entry.tracks.push(item)
    entry.playlist.updatedAt = Date.now()
    return delay({ ok: true }, 160)
  },
  removeFromPlaylist: async (id, trackId) => {
    const entry = playlists.find((value) => value.playlist.id === id)
    if (entry) entry.tracks = entry.tracks.filter((value) => value.id !== trackId)
    return delay({ ok: true }, 160)
  },
  settings: async () => delay({ settings: { ...settings } }, 120),
  setSetting: async (key, value) => {
    settings[key] = value
    return delay({ settings: { ...settings } }, 80)
  }
}

const coreStatus: CoreStatus = {
  state: 'ready',
  port: null,
  error: null,
  dataDir: '≈/AppData/Roaming/SoFy/core-data',
  java: 'java 22',
  restarts: 0
}

const appInfo: AppInfo = {
  name: 'SoFy',
  version: '0.1.0 · preview',
  electron: '—',
  chrome: typeof navigator === 'undefined' ? '—' : navigator.userAgent,
  node: '—',
  platform: 'browser preview',
  core: coreStatus
}

export function createMockBridge(): SoFyBridge {
  return {
    app: {
      info: async () => appInfo,
      minimize: async () => {},
      toggleMaximize: async () => false,
      close: async () => {},
      openDataFolder: async () => {},
      copyText: async (value) => {
        try {
          await navigator.clipboard.writeText(value)
        } catch {
          // clipboard may be unavailable in plain preview
        }
      },
      onWindowState: () => () => {}
    },
    core: {
      status: async () => coreStatus,
      restart: async () => coreStatus,
      onStatus: () => () => {}
    },
    music,
    accounts,
    presence: {
      update: async () => {}
    },
    files: {
      pathForFile: () => ''
    }
  }
}
