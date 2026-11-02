import {
  app,
  BrowserWindow,
  clipboard,
  dialog,
  ipcMain,
  shell,
  type IpcMainInvokeEvent,
  type OpenDialogOptions
} from 'electron'
import type { CoreController } from './core'
import type { SecretStore } from './secrets'
import type { OnlineAccounts } from './onlineAccounts'
import type { DiscordPresence } from './presence'
import type { Account, AccountPatch, DiscordPresenceState } from '../shared/types'
import { AccountSession } from './accounts'

interface Deps {
  core: CoreController
  secrets: SecretStore
  online: OnlineAccounts | null
  presence: DiscordPresence
}

type Handler = (args: unknown[], event: IpcMainInvokeEvent) => Promise<unknown>

function text(value: unknown, max: number, label: string): string {
  if (typeof value !== 'string') throw new Error(`Некорректное поле «${label}»`)
  const trimmed = value.trim()
  if (!trimmed) throw new Error(`Поле «${label}» обязательно`)
  if (trimmed.length > max) throw new Error(`Поле «${label}» слишком длинное`)
  return trimmed
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`Некорректный объект «${label}»`)
  }
  return value as Record<string, unknown>
}

function windowOf(event: IpcMainInvokeEvent): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender)
}

function trustedSender(event: IpcMainInvokeEvent): boolean {
  const url = event.senderFrame?.url ?? event.sender.getURL()
  if (url.startsWith('file://')) return true
  const devUrl = process.env['ELECTRON_RENDERER_URL']
  return Boolean(devUrl && url.startsWith(devUrl))
}

const AUDIO_EXTENSIONS = ['mp3', 'm4a', 'aac', 'flac', 'ogg', 'opus', 'wav', 'webm']
const IMPORT_WORKERS = 3
const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$/

function accountUsername(value: unknown): string {
  const username = text(value, 40, 'логин').toLowerCase()
  if (!USERNAME_PATTERN.test(username)) {
    throw new Error('Логин: 3–24 символа, латиница, цифры, точка, дефис или _')
  }
  return username
}

function accountPassword(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('Введите пароль')
  if (value.length > 128) throw new Error('Пароль слишком длинный')
  return value
}

function accessKeyRole(value: unknown): 'user' | 'admin' {
  if (value !== 'user' && value !== 'admin') throw new Error('Неизвестная роль')
  return value
}

function accountAvatar(value: unknown): string | null {
  if (value === null) return null
  if (
    typeof value !== 'string' ||
    value.length > 760_000 ||
    !/^data:image\/(?:png|jpe?g|webp);base64,[A-Za-z0-9+/]+={0,2}$/i.test(value)
  ) {
    throw new Error('Некорректное изображение профиля')
  }
  return value
}

function presenceState(value: unknown): DiscordPresenceState | null {
  if (value === null || value === undefined) return null
  const data = record(value, 'статус')
  const title = typeof data.title === 'string' ? data.title.trim().slice(0, 200) : ''
  const artist = typeof data.artist === 'string' ? data.artist.trim().slice(0, 200) : ''
  if (!title || !artist) return null
  const artwork =
    typeof data.artwork === 'string' && /^https:\/\//i.test(data.artwork)
      ? data.artwork.slice(0, 600)
      : null
  const position =
    typeof data.position === 'number' && Number.isFinite(data.position)
      ? Math.max(0, Math.min(86_400, data.position))
      : 0
  const duration =
    typeof data.duration === 'number' && Number.isFinite(data.duration)
      ? Math.max(0, Math.min(86_400, data.duration))
      : 0
  return { title, artist, artwork, playing: data.playing === true, position, duration }
}

async function importFiles(
  core: CoreController,
  paths: string[]
): Promise<{ imported: unknown[]; errors: string[] }> {
  const imported: unknown[] = []
  const errors: string[] = []
  const results: { index: number; track?: unknown; error?: string }[] = []
  let cursor = 0

  const worker = async (): Promise<void> => {
    while (cursor < paths.length) {
      const index = cursor
      cursor += 1
      try {
        const data = await core.request<{ track: unknown }>('POST', '/api/library/import', {
          path: paths[index]
        })
        results.push({ index, track: data.track })
      } catch (error) {
        results.push({
          index,
          error: error instanceof Error ? error.message : 'Не удалось добавить файл'
        })
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(IMPORT_WORKERS, paths.length) }, () => worker())
  )
  results.sort((a, b) => a.index - b.index)
  for (const result of results) {
    if (result.track !== undefined) imported.push(result.track)
    if (result.error) errors.push(result.error)
  }
  return { imported, errors }
}

export function registerBridge({ core, secrets, online, presence }: Deps): void {
  const session = new AccountSession()
  const handlers: Record<string, Handler> = {
    'app.info': async () => ({
      name: app.getName(),
      version: app.getVersion(),
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      platform: process.platform,
      core: core.status()
    }),
    'app.minimize': async (_args, event) => {
      windowOf(event)?.minimize()
      return null
    },
    'app.toggleMaximize': async (_args, event) => {
      const win = windowOf(event)
      if (!win) return false
      if (win.isMaximized()) win.unmaximize()
      else win.maximize()
      return win.isMaximized()
    },
    'app.close': async (_args, event) => {
      windowOf(event)?.close()
      return null
    },
    'app.openDataFolder': async () => {
      const failure = await shell.openPath(core.dataDir)
      if (failure) throw new Error('Не удалось открыть папку данных')
      return null
    },
    'app.copyText': async (args) => {
      const value = text(args[0], 200, 'текст')
      clipboard.writeText(value)
      return null
    },
    'presence.update': async (args) => {
      presence.update(presenceState(args[0]))
      return null
    },
    'core.status': async () => core.status(),
    'core.restart': async () =>
      core.restart({ soundcloud: secrets.get('soundcloud'), yandex: secrets.get('yandex') }),

    'music.home': async () => core.request('GET', '/api/home'),
    'music.search': async (args) => {
      const query = text(args[0], 120, 'запрос')
      const limit = typeof args[1] === 'number' ? Math.min(50, Math.max(1, Math.round(args[1]))) : 50
      const offset = typeof args[2] === 'number' ? Math.min(5000, Math.max(0, Math.round(args[2]))) : 0
      const params = new URLSearchParams({ q: query, limit: String(limit), offset: String(offset) })
      return core.request('GET', `/api/search?${params.toString()}`)
    },
    'music.importLocal': async (_args, event) => {
      const win = windowOf(event)
      const options: OpenDialogOptions = {
        title: 'Добавить треки',
        buttonLabel: 'Добавить',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Аудио', extensions: AUDIO_EXTENSIONS },
          { name: 'Все файлы', extensions: ['*'] }
        ]
      }
      const result = win
        ? await dialog.showOpenDialog(win, options)
        : await dialog.showOpenDialog(options)
      if (result.canceled) return { imported: [], errors: [] }
      return importFiles(core, result.filePaths)
    },
    'music.importPaths': async (args) => {
      const raw = args[0]
      if (!Array.isArray(raw)) throw new Error('Некорректный список файлов')
      const paths = raw
        .slice(0, 100)
        .map((value) => text(value, 4096, 'путь'))
        .filter((value) => value.length > 0)
      if (paths.length === 0) return { imported: [], errors: [] }
      return importFiles(core, paths)
    },
    'music.ticket': async (args) => {
      const trackId = text(args[0], 200, 'трек')
      return core.request('GET', `/api/tracks/${encodeURIComponent(trackId)}/ticket`)
    },
    'music.lyrics': async (args) => {
      const trackId = text(args[0], 200, 'трек')
      return core.request('GET', `/api/tracks/${encodeURIComponent(trackId)}/lyrics`)
    },
    'music.likes': async () => core.request('GET', '/api/library/likes'),
    'music.like': async (args) =>
      core.request('POST', '/api/library/likes', { track: record(args[0], 'трек') }),
    'music.unlike': async (args) => {
      const trackId = text(args[0], 200, 'трек')
      return core.request('DELETE', `/api/library/likes/${encodeURIComponent(trackId)}`)
    },
    'music.history': async (args) => {
      const limit = typeof args[0] === 'number' ? Math.min(100, Math.max(1, Math.round(args[0]))) : 40
      return core.request('GET', `/api/library/history?limit=${limit}`)
    },
    'music.addHistory': async (args) =>
      core.request('POST', '/api/library/history', { track: record(args[0], 'трек') }),
    'music.playlists': async () => core.request('GET', '/api/playlists'),
    'music.createPlaylist': async (args) => {
      const name = text(args[0], 80, 'название')
      return core.request('POST', '/api/playlists', { name })
    },
    'music.playlist': async (args) => {
      const id = text(args[0], 64, 'плейлист')
      return core.request('GET', `/api/playlists/${encodeURIComponent(id)}`)
    },
    'music.updatePlaylist': async (args) => {
      const id = text(args[0], 64, 'плейлист')
      const patch = record(args[1], 'изменения')
      const body: Record<string, unknown> = {}
      if ('cover' in patch) {
        if (patch.cover !== null && typeof patch.cover !== 'string') {
          throw new Error('Некорректная обложка')
        }
        body.cover = patch.cover
      }
      if ('description' in patch) {
        if (patch.description !== null && typeof patch.description !== 'string') {
          throw new Error('Некорректное описание')
        }
        body.description = patch.description
      }
      return core.request('PUT', `/api/playlists/${encodeURIComponent(id)}`, body)
    },
    'music.setTrackCover': async (args) => {
      const trackId = text(args[0], 200, 'трек')
      const cover = args[1]
      if (cover !== null && typeof cover !== 'string') throw new Error('Некорректная обложка')
      return core.request('PUT', `/api/tracks/${encodeURIComponent(trackId)}/cover`, { cover })
    },
    'music.deletePlaylist': async (args) => {
      const id = text(args[0], 64, 'плейлист')
      return core.request('DELETE', `/api/playlists/${encodeURIComponent(id)}`)
    },
    'music.addToPlaylist': async (args) => {
      const id = text(args[0], 64, 'плейлист')
      return core.request('POST', `/api/playlists/${encodeURIComponent(id)}/tracks`, {
        track: record(args[1], 'трек')
      })
    },
    'music.removeFromPlaylist': async (args) => {
      const id = text(args[0], 64, 'плейлист')
      const trackId = text(args[1], 200, 'трек')
      return core.request(
        'DELETE',
        `/api/playlists/${encodeURIComponent(id)}/tracks/${encodeURIComponent(trackId)}`
      )
    },
    'music.settings': async () => core.request('GET', '/api/settings'),
    'music.setSetting': async (args) => {
      const key = text(args[0], 40, 'настройка')
      const value = text(args[1], 40, 'значение')
      return core.request('PUT', '/api/settings', { key, value })
    },

    'accounts.me': async () => {
      if (online) return online.me()
      const token = session.get()
      if (!token) return { account: null }
      const result = await core.request<{ account: Account | null }>(
        'GET',
        '/api/accounts/me',
        undefined,
        { 'X-SoFy-Session': token }
      )
      const account = result.account ?? null
      if (!account) session.clear()
      return { account }
    },
    'accounts.register': async (args) => {
      const input = record(args[0], 'аккаунт')
      const username = accountUsername(input.username)
      const password = accountPassword(input.password)
      const displayName =
        typeof input.displayName === 'string' ? input.displayName.trim().slice(0, 40) : ''
      const accessKey =
        typeof input.accessKey === 'string' && input.accessKey.trim()
          ? text(input.accessKey, 40, 'ключ доступа')
          : undefined
      if (online) {
        return online.register({
          username,
          displayName: displayName || undefined,
          password,
          accessKey
        })
      }
      const result = await core.request<{ account: Account; token: string }>(
        'POST',
        '/api/accounts/register',
        { username, displayName: displayName || undefined, password, accessKey }
      )
      if (typeof result.token !== 'string' || result.token.length < 32) {
        throw new Error('Ядро вернуло некорректную сессию')
      }
      session.set(result.token)
      return { account: result.account }
    },
    'accounts.login': async (args) => {
      const input = record(args[0], 'аккаунт')
      const username = accountUsername(input.username)
      const password = accountPassword(input.password)
      if (online) return online.login({ username, password })
      const result = await core.request<{ account: Account; token: string }>(
        'POST',
        '/api/accounts/login',
        { username, password }
      )
      if (typeof result.token !== 'string' || result.token.length < 32) {
        throw new Error('Ядро вернуло некорректную сессию')
      }
      session.set(result.token)
      return { account: result.account }
    },
    'accounts.logout': async () => {
      if (online) return online.logout()
      const token = session.get()
      if (token) {
        try {
          await core.request('POST', '/api/accounts/logout', undefined, {
            'X-SoFy-Session': token
          })
        } catch {
          // the local session is dropped regardless
        }
      }
      session.clear()
      return { ok: true }
    },
    'accounts.updateProfile': async (args) => {
      const patch = record(args[0], 'профиль')
      const update: AccountPatch = {}
      if ('displayName' in patch) update.displayName = text(patch.displayName, 40, 'имя')
      if ('avatar' in patch) update.avatar = accountAvatar(patch.avatar)
      if (online) return online.updateProfile(update)
      const token = session.get()
      if (!token) throw new Error('Требуется вход в аккаунт')
      const result = await core.request<{ account: Account }>(
        'PUT',
        '/api/accounts/profile',
        update,
        { 'X-SoFy-Session': token }
      )
      return { account: result.account }
    },
    'accounts.redeemKey': async (args) => {
      const key = text(args[0], 40, 'ключ доступа')
      if (online) return online.redeemKey(key)
      const token = session.get()
      if (!token) throw new Error('Требуется вход в аккаунт')
      return core.request('POST', '/api/accounts/redeem', { key }, { 'X-SoFy-Session': token })
    },
    'accounts.adminOverview': async () => {
      if (online) return online.adminOverview()
      const token = session.get()
      if (!token) throw new Error('Требуется вход в аккаунт')
      return core.request('GET', '/api/admin/overview', undefined, {
        'X-SoFy-Session': token
      })
    },
    'accounts.createAccessKey': async (args) => {
      const role = accessKeyRole(args[0])
      const note = typeof args[1] === 'string' ? args[1].trim() : ''
      if (note.length > 60) throw new Error('Заметка не должна превышать 60 символов')
      if (online) return online.createAccessKey(role, note || undefined)
      const token = session.get()
      if (!token) throw new Error('Требуется вход в аккаунт')
      return core.request(
        'POST',
        '/api/admin/keys',
        { role, note: note || undefined },
        { 'X-SoFy-Session': token }
      )
    },
    'accounts.revokeAccessKey': async (args) => {
      const id = text(args[0], 64, 'ключ')
      if (online) return online.revokeAccessKey(id)
      const token = session.get()
      if (!token) throw new Error('Требуется вход в аккаунт')
      return core.request(
        'DELETE',
        `/api/admin/keys/${encodeURIComponent(id)}`,
        undefined,
        { 'X-SoFy-Session': token }
      )
    },
    'accounts.setAccountRole': async (args) => {
      const id = text(args[0], 64, 'аккаунт')
      const role = accessKeyRole(args[1])
      if (online) return online.setAccountRole(id, role)
      const token = session.get()
      if (!token) throw new Error('Требуется вход в аккаунт')
      return core.request(
        'PUT',
        `/api/admin/accounts/${encodeURIComponent(id)}/role`,
        { role },
        { 'X-SoFy-Session': token }
      )
    }
  }

  ipcMain.handle('sofy:invoke', async (event, method: unknown, args: unknown) => {
    try {
      if (typeof method !== 'string' || !Array.isArray(args)) throw new Error('Некорректный вызов')
      if (!trustedSender(event)) throw new Error('Доступ запрещён')
      if (!Object.prototype.hasOwnProperty.call(handlers, method)) throw new Error('Неизвестный метод')
      const data = await handlers[method](args, event)
      return { ok: true, data }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Неизвестная ошибка'
      return { ok: false, error: message }
    }
  })
}
