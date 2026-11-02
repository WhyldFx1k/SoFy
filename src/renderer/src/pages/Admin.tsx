import { useEffect, useState } from 'react'
import {
  Check,
  Copy,
  Crown,
  KeyRound,
  Loader2,
  RefreshCw,
  ShieldCheck
} from 'lucide-react'
import type {
  AccessKey,
  AccessKeyRole,
  Account,
  AdminOverview,
  CreatedAccessKey
} from '../../../shared/types'
import { AccountAvatar } from '../components/AccountAvatar'
import { RoleBadge } from '../components/RoleBadge'
import { bridge } from '../lib/bridge'
import { isStaff } from '../lib/roles'
import { useUi } from '../store/ui'

const KEY_STATUS = {
  active: 'Активен',
  redeemed: 'Использован',
  revoked: 'Отозван'
} as const

type KeyStatus = keyof typeof KEY_STATUS

function keyStatus(key: AccessKey): KeyStatus {
  if (key.revoked) return 'revoked'
  if (key.redeemedBy) return 'redeemed'
  return 'active'
}

function formatDate(value: number): string {
  return new Date(value).toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric'
  })
}

export function AdminPage() {
  const account = useUi((state) => state.account)
  const loadAdminOverview = useUi((state) => state.loadAdminOverview)
  const createAccessKey = useUi((state) => state.createAccessKey)
  const revokeAccessKey = useUi((state) => state.revokeAccessKey)
  const setAccountRole = useUi((state) => state.setAccountRole)

  const [overview, setOverview] = useState<AdminOverview | null>(null)
  const [loading, setLoading] = useState(true)
  const [role, setRole] = useState<AccessKeyRole>('user')
  const [note, setNote] = useState('')
  const [creating, setCreating] = useState(false)
  const [created, setCreated] = useState<CreatedAccessKey | null>(null)
  const [copied, setCopied] = useState(false)
  const [revoking, setRevoking] = useState<string | null>(null)
  const [changingRole, setChangingRole] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  const load = async (): Promise<void> => {
    setLoading(true)
    const data = await loadAdminOverview()
    if (data) setOverview(data)
    setLoading(false)
  }

  useEffect(() => {
    void load()
  }, [])

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 2000)
    return () => window.clearTimeout(timer)
  }, [copied])

  if (!account || !isStaff(account.role)) {
    return (
      <div className="page">
        <header className="page__head">
          <div>
            <h1 className="page__title">Админ-панель</h1>
            <p className="page__sub">Раздел доступен администраторам и владельцу</p>
          </div>
        </header>
        <section className="settings-card admin-empty">
          <ShieldCheck size={22} />
          <span>У вашего профиля нет доступа к этому разделу.</span>
        </section>
      </div>
    )
  }

  const owner = account.role === 'owner'
  const canAdminKeys = overview?.capabilities.createAdminKeys ?? false
  const keyRole: AccessKeyRole = canAdminKeys ? role : 'user'
  const keys = overview?.keys ?? []
  const stats = overview?.stats
  const filteredAccounts = (overview?.accounts ?? []).filter((user) => {
    const value = query.trim().toLowerCase()
    if (!value) return true
    return (
      user.username.toLowerCase().includes(value) ||
      user.displayName.toLowerCase().includes(value)
    )
  })

  const generate = async (): Promise<void> => {
    if (creating) return
    setCreating(true)
    setCopied(false)
    const result = await createAccessKey(keyRole, note)
    setCreating(false)
    if (!result) return
    setCreated(result)
    setNote('')
    void load()
  }

  const copyKey = async (): Promise<void> => {
    if (!created) return
    try {
      await bridge.app.copyText(created.key)
      setCopied(true)
    } catch {
      // copying is best-effort; the key stays visible
    }
  }

  const revoke = async (id: string): Promise<void> => {
    if (revoking) return
    setRevoking(id)
    const ok = await revokeAccessKey(id)
    setRevoking(null)
    if (ok) void load()
  }

  const changeRole = async (user: Account, next: string): Promise<void> => {
    if (next !== 'user' && next !== 'admin') return
    if (next === user.role) return
    setChangingRole(user.id)
    const ok = await setAccountRole(user.id, next)
    setChangingRole(null)
    if (ok) void load()
  }

  const canRevoke = (key: AccessKey): boolean => {
    if (keyStatus(key) !== 'active') return false
    if (overview?.capabilities.revokeAnyKey) return true
    return key.createdBy === account.username && key.role === 'user'
  }

  return (
    <div className="page admin-page">
      <header className="page__head admin-head">
        <div>
          <p className="admin-eyebrow">
            {owner ? <Crown size={13} /> : <ShieldCheck size={13} />}
            {owner ? 'Владелец' : 'Администратор'}
          </p>
          <h1 className="page__title">{owner ? 'Кабинет владельца' : 'Админ-панель'}</h1>
          <p className="page__sub">
            {owner
              ? 'Роли, ключи доступа и все аккаунты SoFy'
              : 'Ключи доступа и список аккаунтов'}
          </p>
        </div>
        <div className="admin-head__side">
          <RoleBadge role={account.role} />
          <button
            type="button"
            className="btn btn--ghost btn--small"
            onClick={() => void load()}
            disabled={loading}
          >
            <RefreshCw size={14} className={loading ? 'spin' : ''} />
            Обновить
          </button>
        </div>
      </header>

      {!overview ? (
        <section className="settings-card admin-empty">
          {loading ? (
            <>
              <Loader2 size={20} className="spin" />
              <span>Загружаем данные</span>
            </>
          ) : (
            <>
              <ShieldCheck size={20} />
              <span>Не удалось загрузить панель. Попробуйте обновить.</span>
            </>
          )}
        </section>
      ) : (
        <>
          <div className="admin-stats">
            <div className="admin-stat">
              <span>Аккаунты</span>
              <strong>{stats?.accounts ?? 0}</strong>
            </div>
            <div className="admin-stat admin-stat--owner">
              <span>Владельцы</span>
              <strong>{stats?.owners ?? 0}</strong>
            </div>
            <div className="admin-stat admin-stat--admin">
              <span>Администраторы</span>
              <strong>{stats?.admins ?? 0}</strong>
            </div>
            <div className="admin-stat">
              <span>Пользователи</span>
              <strong>{stats?.users ?? 0}</strong>
            </div>
            <div className="admin-stat admin-stat--active">
              <span>Активные ключи</span>
              <strong>{stats?.keysActive ?? 0}</strong>
            </div>
            <div className="admin-stat">
              <span>Использовано</span>
              <strong>{stats?.keysRedeemed ?? 0}</strong>
            </div>
          </div>

          <section className="settings-section">
            <header className="settings-section__head">
              <h2>Новый ключ доступа</h2>
              <p>Ключ одноразовый и показывается только в момент создания</p>
            </header>
            <div className="settings-card admin-card">
              <div className="admin-key-form">
                <div className="admin-key-form__role">
                  <span className="admin-field-label">Роль</span>
                  {canAdminKeys ? (
                    <div className="segmented" role="radiogroup" aria-label="Роль ключа">
                      <button
                        type="button"
                        role="radio"
                        aria-checked={keyRole === 'user'}
                        className={`segmented__btn ${keyRole === 'user' ? 'is-active' : ''}`}
                        onClick={() => setRole('user')}
                      >
                        Пользователь
                      </button>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={keyRole === 'admin'}
                        className={`segmented__btn ${keyRole === 'admin' ? 'is-active' : ''}`}
                        onClick={() => setRole('admin')}
                      >
                        Администратор
                      </button>
                    </div>
                  ) : (
                    <div className="admin-key-form__locked">
                      <RoleBadge role="user" />
                      <span>Ключи администратора выдаёт владелец</span>
                    </div>
                  )}
                </div>
                <label className="field admin-key-form__note">
                  <span className="field__label">Заметка</span>
                  <input
                    className="input"
                    value={note}
                    maxLength={60}
                    placeholder="Кому выдан — необязательно"
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn--accent admin-key-form__submit"
                  onClick={() => void generate()}
                  disabled={creating}
                >
                  {creating ? <Loader2 size={15} className="spin" /> : <KeyRound size={15} />}
                  Создать ключ
                </button>
              </div>
              <p className="admin-key-form__hint">
                {keyRole === 'admin'
                  ? 'Ключ администратора открывает эту панель и даёт доступ к аккаунтам.'
                  : 'Ключ пользователя создаёт обычный профиль без прав панели.'}
              </p>

              {created && (
                <div className="admin-key-reveal">
                  <div className="admin-key-reveal__head">
                    <span>Ключ создан</span>
                    <RoleBadge role={created.accessKey.role} />
                  </div>
                  <div className="admin-key-reveal__row">
                    <code>{created.key}</code>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => void copyKey()}
                    >
                      {copied ? <Check size={14} /> : <Copy size={14} />}
                      {copied ? 'Скопирован' : 'Копировать'}
                    </button>
                  </div>
                  <p className="admin-key-reveal__note">
                    Скопируйте сейчас: в списке останутся только последние 4 символа.
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="settings-section">
            <header className="settings-section__head">
              <h2>Ключи доступа</h2>
              <p>
                {keys.length === 0
                  ? 'Пока ни одного ключа'
                  : `${keys.length} ${keys.length === 1 ? 'ключ' : keys.length < 5 ? 'ключа' : 'ключей'}`}
              </p>
            </header>
            <div className="settings-card admin-list">
              {keys.length === 0 ? (
                <div className="admin-empty">
                  <KeyRound size={20} />
                  <span>Создайте первый ключ выше — он появится здесь.</span>
                </div>
              ) : (
                <div className="admin-keys">
                  <div className="admin-keys__head" aria-hidden="true">
                    <span>Ключ</span>
                    <span>Роль</span>
                    <span>Заметка</span>
                    <span>Статус</span>
                    <span>Создан</span>
                    <span />
                  </div>
                  {keys.map((key) => {
                    const status = keyStatus(key)
                    return (
                      <div className="admin-keys__row" key={key.id}>
                        <span className="admin-keys__code">
                          <KeyRound size={13} />
                          <span>••••-{key.hint}</span>
                        </span>
                        <RoleBadge role={key.role} />
                        <span className="admin-keys__note">{key.note ?? '—'}</span>
                        <span className={`admin-status admin-status--${status}`}>
                          {KEY_STATUS[status]}
                          {key.redeemedBy && <small>@{key.redeemedBy}</small>}
                        </span>
                        <span className="admin-keys__date">{formatDate(key.createdAt)}</span>
                        <span className="admin-keys__action">
                          {canRevoke(key) && (
                            <button
                              type="button"
                              className="btn btn--ghost btn--small admin-revoke"
                              onClick={() => void revoke(key.id)}
                              disabled={revoking === key.id}
                            >
                              {revoking === key.id ? (
                                <Loader2 size={13} className="spin" />
                              ) : null}
                              Отозвать
                            </button>
                          )}
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="settings-section">
            <header className="settings-section__head admin-section-head">
              <div>
                <h2>Аккаунты</h2>
                <p>{overview.stats.accounts} на этом компьютере</p>
              </div>
              <input
                className="input admin-search"
                value={query}
                maxLength={40}
                placeholder="Поиск по логину или имени"
                onChange={(event) => setQuery(event.target.value)}
              />
            </header>
            <div className="settings-card admin-list">
              {filteredAccounts.length === 0 ? (
                <div className="admin-empty">
                  <span>Никого не нашли.</span>
                </div>
              ) : (
                <div className="admin-accounts">
                  {filteredAccounts.map((user) => (
                    <div className="admin-account" key={user.id}>
                      <AccountAvatar account={user} className="admin-account__avatar" />
                      <span className="admin-account__meta">
                        <span className="admin-account__name">
                          {user.displayName}
                          {user.id === account.id && (
                            <span className="admin-account__self">это вы</span>
                          )}
                        </span>
                        <span className="admin-account__username">@{user.username}</span>
                      </span>
                      <RoleBadge role={user.role} className="admin-account__badge" />
                      <span className="admin-account__date">с {formatDate(user.createdAt)}</span>
                      <span className="admin-account__action">
                        {overview.capabilities.manageRoles &&
                        user.role !== 'owner' &&
                        user.id !== account.id ? (
                          <select
                            className="input select admin-role-select"
                            value={user.role}
                            disabled={changingRole === user.id}
                            onChange={(event) => void changeRole(user, event.target.value)}
                          >
                            <option value="user">Пользователь</option>
                            <option value="admin">Администратор</option>
                          </select>
                        ) : null}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </section>
        </>
      )}
    </div>
  )
}
