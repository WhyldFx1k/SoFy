import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type {
  AccessKey,
  AccessKeyRole,
  Account,
  AccountLoginInput,
  AccountPatch,
  AccountRegisterInput,
  AdminCapabilities,
  AdminOverview,
  AdminStats,
  CreatedAccessKey
} from '../shared/types'
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './supabase-config'

const EMAIL_DOMAIN = 'users.sofy.app'
const REQUEST_TIMEOUT_MS = 20_000

interface StoredSession {
  version: 1
  refreshToken: string
  accessToken: string
  expiresAt: number
  account: Account
}

interface AuthPayload {
  access_token?: unknown
  refresh_token?: unknown
  expires_in?: unknown
  expires_at?: unknown
  session?: unknown
  [key: string]: unknown
}

interface ProfileRow {
  id: string
  username: string
  displayName: string
  avatar: string | null
  role: unknown
  createdAt: number
  updatedAt: number
}

interface AccessKeyRow {
  id: string
  role: unknown
  note: string | null
  hint: string
  createdBy: string | null
  redeemedBy: string | null
  createdAt: number
  redeemedAt: number | null
  revoked: boolean
  revokedAt: number | null
}

const RPC_MESSAGES: Record<string, string> = {
  forbidden: 'Недостаточно прав',
  forbidden_admin_key: 'Только владелец может выдавать ключи администратора',
  invalid_role: 'Неизвестная роль',
  invalid_username: 'Логин: 3–24 символа, латиница, цифры, точка, дефис или _',
  invalid_display_name: 'Имя не должно быть пустым или длиннее 40 символов',
  invalid_avatar: 'Некорректное изображение профиля',
  note_too_long: 'Заметка не должна превышать 60 символов',
  username_taken: 'Этот логин уже занят',
  key_not_found: 'Ключ не найден',
  unauthorized: 'Требуется вход в аккаунт',
  already_has_role: 'У вас уже есть роль',
  access_key_invalid: 'Ключ доступа недействителен',
  access_key_used: 'Ключ доступа уже использован или отозван',
  access_key_revoked: 'Ключ доступа уже использован или отозван',
  account_not_found: 'Аккаунт не найден',
  self_role: 'Нельзя изменить собственную роль',
  owner_role_immutable: 'Роль владельца изменить нельзя'
}

class OnlineError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string
  ) {
    super(message)
    this.name = 'OnlineError'
  }
}

function asAccount(value: unknown): Account {
  if (!value || typeof value !== 'object') throw new OnlineError(500, 'profile', 'Сервер аккаунтов вернул профиль неверного формата')
  const raw = value as Partial<ProfileRow>
  const role = raw.role === 'owner' || raw.role === 'admin' ? raw.role : 'user'
  if (typeof raw.id !== 'string' || typeof raw.username !== 'string') {
    throw new OnlineError(500, 'profile', 'Сервер аккаунтов вернул профиль неверного формата')
  }
  return {
    id: raw.id,
    username: raw.username,
    displayName: typeof raw.displayName === 'string' && raw.displayName ? raw.displayName : raw.username,
    avatar: typeof raw.avatar === 'string' ? raw.avatar : null,
    role,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0
  }
}

function asAccessKey(value: unknown): AccessKey {
  if (!value || typeof value !== 'object') throw new OnlineError(500, 'key', 'Сервер аккаунтов вернул ключ неверного формата')
  const raw = value as Partial<AccessKeyRow>
  if (typeof raw.id !== 'string') throw new OnlineError(500, 'key', 'Сервер аккаунтов вернул ключ неверного формата')
  return {
    id: raw.id,
    role: (raw.role === 'admin' ? 'admin' : 'user') satisfies AccessKeyRole,
    note: typeof raw.note === 'string' ? raw.note : null,
    hint: typeof raw.hint === 'string' ? raw.hint : '',
    createdBy: typeof raw.createdBy === 'string' ? raw.createdBy : null,
    redeemedBy: typeof raw.redeemedBy === 'string' ? raw.redeemedBy : null,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : 0,
    redeemedAt: typeof raw.redeemedAt === 'number' ? raw.redeemedAt : null,
    revoked: raw.revoked === true,
    revokedAt: typeof raw.revokedAt === 'number' ? raw.revokedAt : null
  }
}

function messageOf(payload: unknown): string {
  if (!payload || typeof payload !== 'object') return ''
  const raw = payload as Record<string, unknown>
  const value = raw.error_description ?? raw.msg ?? raw.message ?? raw.error ?? ''
  return typeof value === 'string' ? value : ''
}

function authFailure(status: number, payload: unknown, mode: 'login' | 'signup' | 'refresh'): OnlineError {
  const raw = messageOf(payload)
  if (status === 429 || /rate limit|too many/i.test(raw)) {
    return new OnlineError(429, 'rate', 'Слишком много попыток. Подождите немного.')
  }
  if (status >= 500) {
    return new OnlineError(502, 'server', 'Сервер аккаунтов временно недоступен')
  }
  if (/user already registered|already been registered|already exists/i.test(raw)) {
    return new OnlineError(409, 'taken', 'Этот логин уже занят')
  }
  if (/password/i.test(raw) && /least|characters|short/i.test(raw)) {
    return new OnlineError(400, 'password', 'Пароль должен быть не короче 8 символов')
  }
  if (/email/i.test(raw) && /invalid/i.test(raw)) {
    return new OnlineError(400, 'email', 'Некорректный логин')
  }
  if (mode === 'refresh') return new OnlineError(401, 'expired', 'Сессия истекла. Войдите снова.')
  if (mode === 'signup') {
    return new OnlineError(400, 'signup', 'Не удалось создать аккаунт. Проверьте ключ доступа и логин.')
  }
  return new OnlineError(401, 'credentials', 'Неверный логин или пароль')
}

function rpcFailure(status: number, payload: unknown): OnlineError {
  const raw = messageOf(payload)
  if (status === 401) return new OnlineError(401, 'unauthorized', 'Требуется войти в аккаунт')
  if (status === 429) return new OnlineError(429, 'rate', 'Слишком много попыток. Подождите немного.')
  const mapped = RPC_MESSAGES[raw]
  if (mapped) return new OnlineError(status, raw, mapped)
  if (status === 403) return new OnlineError(403, 'forbidden', 'Недостаточно прав')
  return new OnlineError(status || 502, raw || 'rpc', 'Сервер аккаунтов временно недоступен')
}

function normalizeKey(raw: string): string {
  const compact = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '')
  return `SOFY-${compact.slice(4, 8)}-${compact.slice(8, 12)}-${compact.slice(12, 16)}-${compact.slice(16, 20)}`
}

function emailFor(username: string): string {
  return `${username}@${EMAIL_DOMAIN}`
}

class OnlineSessionStore {
  private readonly file = join(app.getPath('userData'), 'online-session.bin')
  private cache: StoredSession | null | undefined

  get(): StoredSession | null {
    if (this.cache !== undefined) return this.cache
    this.cache = null
    try {
      if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return null
      const value = JSON.parse(safeStorage.decryptString(readFileSync(this.file))) as Partial<StoredSession>
      if (
        value.version !== 1 ||
        typeof value.refreshToken !== 'string' ||
        typeof value.accessToken !== 'string' ||
        typeof value.expiresAt !== 'number'
      ) {
        return null
      }
      this.cache = {
        version: 1,
        refreshToken: value.refreshToken,
        accessToken: value.accessToken,
        expiresAt: value.expiresAt,
        account: asAccount(value.account)
      }
    } catch {
      this.cache = null
    }
    return this.cache
  }

  write(session: StoredSession): void {
    this.cache = session
    if (!safeStorage.isEncryptionAvailable()) return
    try {
      writeFileSync(this.file, safeStorage.encryptString(JSON.stringify(session)), { mode: 0o600 })
    } catch {
      // keep the session in memory for this run
    }
  }

  updateAccount(account: Account): void {
    const session = this.get()
    if (!session) return
    this.write({ ...session, account })
  }

  clear(): void {
    this.cache = null
    try {
      unlinkSync(this.file)
    } catch {
      // already gone
    }
  }
}

export class OnlineAccounts {
  private readonly url: string
  private readonly anonKey: string
  private readonly session = new OnlineSessionStore()

  constructor() {
    this.url = SUPABASE_URL.trim().replace(/\/+$/, '')
    this.anonKey = SUPABASE_ANON_KEY.trim()
  }

  get enabled(): boolean {
    return this.url.startsWith('https://') && this.anonKey.length > 20
  }

  async me(): Promise<{ account: Account | null }> {
    const session = this.session.get()
    if (!session) return { account: null }
    try {
      const token = await this.accessToken(session)
      const profile = await this.rpc<ProfileRow | null>('my_profile', {}, token)
      if (!profile) {
        this.session.clear()
        return { account: null }
      }
      const account = asAccount(profile)
      this.session.updateAccount(account)
      return { account }
    } catch (error) {
      if (error instanceof OnlineError && error.status === 401) {
        this.session.clear()
        return { account: null }
      }
      return { account: session.account }
    }
  }

  async register(input: AccountRegisterInput): Promise<{ account: Account }> {
    const username = input.username
    if (!input.password || input.password.length < 8) {
      throw new OnlineError(400, 'password', 'Пароль должен быть не короче 8 символов')
    }
    const taken = await this.rpc<boolean>('username_taken', { p_username: username }, this.anonKey)
    if (taken) throw new OnlineError(409, 'taken', 'Этот логин уже занят')

    const accessKey = input.accessKey ? normalizeKey(input.accessKey) : undefined
    if (accessKey) {
      const status = await this.rpc<string>('access_key_status', { p_key: accessKey }, this.anonKey)
      if (status === 'used' || status === 'revoked') {
        throw new OnlineError(409, 'key', 'Ключ доступа уже использован или отозван')
      }
      if (status !== 'valid') throw new OnlineError(400, 'key', 'Ключ доступа недействителен')
    }

    const payload = await this.authRequest(
      '/auth/v1/signup',
      {
        email: emailFor(username),
        password: input.password,
        data: {
          username,
          display_name: input.displayName?.trim() || undefined,
          access_key: accessKey
        }
      },
      'signup'
    )
    const tokens = this.tokensOf(payload)
    const profile = await this.profileFor(tokens.accessToken)
    this.save(tokens, profile)
    return { account: profile }
  }

  async login(input: AccountLoginInput): Promise<{ account: Account }> {
    const payload = await this.authRequest(
      '/auth/v1/token?grant_type=password',
      { email: emailFor(input.username), password: input.password },
      'login'
    )
    const tokens = this.tokensOf(payload)
    const profile = await this.profileFor(tokens.accessToken)
    this.save(tokens, profile)
    return { account: profile }
  }

  async logout(): Promise<{ ok: boolean }> {
    const session = this.session.get()
    if (session) {
      try {
        const token = await this.accessToken(session)
        await this.request('/auth/v1/logout', { method: 'POST', token })
      } catch {
        // the local session is dropped regardless
      }
    }
    this.session.clear()
    return { ok: true }
  }

  async updateProfile(patch: AccountPatch): Promise<{ account: Account }> {
    const session = this.session.get()
    if (!session) throw new OnlineError(401, 'unauthorized', 'Требуется вход в аккаунт')
    const token = await this.accessToken(session)
    const profile = await this.rpc<ProfileRow>('update_profile', {
      p_display_name: patch.displayName ?? null,
      p_set_display_name: 'displayName' in patch,
      p_avatar: patch.avatar ?? null,
      p_set_avatar: 'avatar' in patch
    }, token)
    const account = asAccount(profile)
    this.session.updateAccount(account)
    return { account }
  }

  async redeemKey(rawKey: string): Promise<{ account: Account }> {
    const session = this.session.get()
    if (!session) throw new OnlineError(401, 'unauthorized', 'Требуется вход в аккаунт')
    const token = await this.accessToken(session)
    const profile = await this.rpc<ProfileRow>('redeem_access_key', { p_key: normalizeKey(rawKey) }, token)
    const account = asAccount(profile)
    this.session.updateAccount(account)
    return { account }
  }

  async adminOverview(): Promise<AdminOverview> {
    const session = this.session.get()
    if (!session) throw new OnlineError(401, 'unauthorized', 'Требуется вход в аккаунт')
    const token = await this.accessToken(session)
    const data = await this.rpc<{ accounts?: unknown; keys?: unknown; actor?: unknown }>(
      'admin_data',
      {},
      token
    )
    const actor = asAccount(data.actor)
    const accounts = Array.isArray(data.accounts) ? data.accounts.map(asAccount) : []
    const keys = Array.isArray(data.keys) ? data.keys.map(asAccessKey) : []
    const stats: AdminStats = {
      accounts: accounts.length,
      owners: accounts.filter((item) => item.role === 'owner').length,
      admins: accounts.filter((item) => item.role === 'admin').length,
      users: accounts.filter((item) => item.role === 'user').length,
      keysActive: keys.filter((item) => !item.revoked && item.redeemedBy === null).length,
      keysRedeemed: keys.filter((item) => !item.revoked && item.redeemedBy !== null).length,
      keysRevoked: keys.filter((item) => item.revoked).length
    }
    const owner = actor.role === 'owner'
    const capabilities: AdminCapabilities = {
      manageRoles: owner,
      createAdminKeys: owner,
      revokeAnyKey: owner
    }
    return { stats, accounts, keys, capabilities }
  }

  async createAccessKey(role: AccessKeyRole, note?: string): Promise<CreatedAccessKey> {
    const session = this.session.get()
    if (!session) throw new OnlineError(401, 'unauthorized', 'Требуется вход в аккаунт')
    const token = await this.accessToken(session)
    const data = await this.rpc<{ key?: unknown; accessKey?: unknown }>(
      'create_access_key',
      { p_role: role, p_note: note ?? null },
      token
    )
    if (typeof data.key !== 'string') {
      throw new OnlineError(500, 'key', 'Сервер аккаунтов вернул ключ неверного формата')
    }
    return { key: data.key, accessKey: asAccessKey(data.accessKey) }
  }

  async revokeAccessKey(id: string): Promise<{ ok: boolean }> {
    const session = this.session.get()
    if (!session) throw new OnlineError(401, 'unauthorized', 'Требуется вход в аккаунт')
    const token = await this.accessToken(session)
    await this.rpc('revoke_access_key', { p_id: id }, token)
    return { ok: true }
  }

  async setAccountRole(accountId: string, role: AccessKeyRole): Promise<{ account: Account }> {
    const session = this.session.get()
    if (!session) throw new OnlineError(401, 'unauthorized', 'Требуется вход в аккаунт')
    const token = await this.accessToken(session)
    const profile = await this.rpc<ProfileRow>('set_account_role', {
      p_account_id: accountId,
      p_role: role
    }, token)
    return { account: asAccount(profile) }
  }

  private tokensOf(payload: AuthPayload): { accessToken: string; refreshToken: string; expiresAt: number } {
    const source =
      payload.session && typeof payload.session === 'object'
        ? (payload.session as AuthPayload)
        : payload
    const accessToken = source.access_token
    const refreshToken = source.refresh_token
    if (typeof accessToken !== 'string' || typeof refreshToken !== 'string') {
      throw new OnlineError(500, 'session', 'Сервер аккаунтов не выдал сессию. Попробуйте войти вручную.')
    }
    const expiresIn = typeof source.expires_in === 'number' ? source.expires_in : 3600
    const expiresAt =
      typeof source.expires_at === 'number' ? source.expires_at * 1000 : Date.now() + expiresIn * 1000
    return { accessToken, refreshToken, expiresAt }
  }

  private save(
    tokens: { accessToken: string; refreshToken: string; expiresAt: number },
    account: Account
  ): void {
    this.session.write({
      version: 1,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt,
      account
    })
  }

  private async accessToken(session: StoredSession): Promise<string> {
    if (session.accessToken && session.expiresAt > Date.now() + 60_000) {
      return session.accessToken
    }
    const payload = await this.authRequest(
      '/auth/v1/token?grant_type=refresh_token',
      { refresh_token: session.refreshToken },
      'refresh'
    )
    const tokens = this.tokensOf(payload)
    const next: StoredSession = {
      ...session,
      refreshToken: tokens.refreshToken,
      accessToken: tokens.accessToken,
      expiresAt: tokens.expiresAt
    }
    this.session.write(next)
    return tokens.accessToken
  }

  private async profileFor(token: string): Promise<Account> {
    const profile = await this.rpc<ProfileRow | null>('my_profile', {}, token)
    if (!profile) throw new OnlineError(401, 'profile', 'Требуется вход в аккаунт')
    return asAccount(profile)
  }

  private async authRequest(
    path: string,
    body: unknown,
    mode: 'login' | 'signup' | 'refresh'
  ): Promise<AuthPayload> {
    const { status, data } = await this.request(path, { method: 'POST', body, token: this.anonKey })
    if (status >= 200 && status < 300 && data && typeof data === 'object') {
      return data as AuthPayload
    }
    throw authFailure(status, data, mode)
  }

  private async rpc<T>(fn: string, args: Record<string, unknown>, token: string): Promise<T> {
    const { status, data } = await this.request(`/rest/v1/rpc/${fn}`, {
      method: 'POST',
      body: args,
      token
    })
    if (status >= 200 && status < 300) return data as T
    throw rpcFailure(status, data)
  }

  private async request(
    path: string,
    options: { method?: string; body?: unknown; token?: string }
  ): Promise<{ status: number; data: unknown }> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
    try {
      const response = await fetch(`${this.url}${path}`, {
        method: options.method ?? 'GET',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${options.token ?? this.anonKey}`,
          ...(options.body === undefined ? {} : { 'Content-Type': 'application/json' })
        },
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: controller.signal
      })
      const text = await response.text()
      let data: unknown = null
      if (text) {
        try {
          data = JSON.parse(text)
        } catch {
          data = text
        }
      }
      return { status: response.status, data }
    } catch (error) {
      if (error instanceof OnlineError) throw error
      throw new OnlineError(0, 'network', 'Не удалось связаться с сервером аккаунтов. Проверьте интернет.')
    } finally {
      clearTimeout(timer)
    }
  }
}

export function createOnlineAccounts(): OnlineAccounts | null {
  const accounts = new OnlineAccounts()
  return accounts.enabled ? accounts : null
}
