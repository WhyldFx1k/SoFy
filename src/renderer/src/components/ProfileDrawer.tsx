import { useEffect, useRef, useState } from 'react'
import {
  Camera,
  ChevronRight,
  Crown,
  KeyRound,
  Loader2,
  LogIn,
  LogOut,
  Pencil,
  Settings,
  ShieldCheck,
  Trash2,
  X
} from 'lucide-react'
import { useUi } from '../store/ui'
import { pickCoverImage } from '../lib/image'
import { isStaff } from '../lib/roles'
import { AccountAvatar } from './AccountAvatar'
import { RoleBadge } from './RoleBadge'

export function ProfileDrawer() {
  const open = useUi((state) => state.profileOpen)
  const account = useUi((state) => state.account)
  const close = useUi((state) => state.closeProfile)
  const navigate = useUi((state) => state.navigate)
  const openSettings = useUi((state) => state.openSettings)
  const switchAccount = useUi((state) => state.switchAccount)
  const logout = useUi((state) => state.logoutAccount)
  const saveProfile = useUi((state) => state.saveProfile)
  const openRedeemKey = useUi((state) => state.openRedeemKey)

  const [visible, setVisible] = useState(open)
  const [leaving, setLeaving] = useState(false)
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState('')
  const [avatar, setAvatar] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (open) {
      setVisible(true)
      setLeaving(false)
      const timer = window.setTimeout(() => closeRef.current?.focus(), 80)
      return () => window.clearTimeout(timer)
    }
    if (!visible) return
    setLeaving(true)
    const timer = window.setTimeout(() => {
      setVisible(false)
      setLeaving(false)
      setEditing(false)
      setError(null)
    }, 220)
    return () => window.clearTimeout(timer)
  }, [open, visible])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape' || busy) return
      event.preventDefault()
      if (editing) {
        setEditing(false)
        setError(null)
      } else {
        close()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, editing, busy, close])

  if (!visible || !account) return null

  const beginEdit = (): void => {
    setName(account.displayName)
    setAvatar(account.avatar)
    setError(null)
    setEditing(true)
  }

  const cancelEdit = (): void => {
    setEditing(false)
    setError(null)
    setName(account.displayName)
    setAvatar(account.avatar)
  }

  const chooseAvatar = async (): Promise<void> => {
    if (busy) return
    try {
      const picked = await pickCoverImage()
      if (picked) setAvatar(picked)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось открыть изображение')
    }
  }

  const submitEdit = async (): Promise<void> => {
    const trimmed = name.trim()
    if (!trimmed) {
      setError('Введите имя')
      return
    }
    setBusy(true)
    setError(null)
    const failure = await saveProfile({ displayName: trimmed, avatar })
    setBusy(false)
    if (failure) {
      setError(failure)
      return
    }
    setEditing(false)
  }

  return (
    <>
      <div className="profile-drawer__backdrop" onClick={close} />
      <aside
        className={`profile-drawer ${leaving ? 'is-leaving' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label="Профиль"
      >
        <button
          ref={closeRef}
          type="button"
          className="profile-drawer__close icon-btn"
          onClick={close}
          aria-label="Закрыть профиль"
        >
          <X size={17} />
        </button>

        <header className="profile-drawer__hero">
          {editing ? (
            <button
              type="button"
              className="profile-drawer__avatar profile-drawer__avatar--edit"
              onClick={() => void chooseAvatar()}
              disabled={busy}
              aria-label="Изменить фото профиля"
            >
              <AccountAvatar account={{ ...account, avatar }} />
              <span className="profile-drawer__camera">
                <Camera size={16} />
              </span>
            </button>
          ) : (
            <AccountAvatar account={account} className="profile-drawer__avatar" />
          )}
          <h2>{account.displayName}</h2>
          <RoleBadge role={account.role} className="profile-drawer__role" />
          <p>@{account.username}</p>
        </header>

        {editing ? (
          <div className="profile-drawer__edit">
            <label className="field">
              <span className="field__label">Имя</span>
              <input
                className="input"
                value={name}
                maxLength={40}
                placeholder="Как вас зовут"
                onChange={(event) => setName(event.target.value)}
                autoFocus
              />
            </label>
            {avatar && (
              <button
                type="button"
                className="profile-drawer__remove"
                onClick={() => setAvatar(null)}
                disabled={busy}
              >
                <Trash2 size={14} />
                Убрать фото
              </button>
            )}
            {error && (
              <p className="profile-drawer__error" role="alert">
                {error}
              </p>
            )}
            <div className="profile-drawer__edit-actions">
              <button type="button" className="btn btn--ghost" onClick={cancelEdit} disabled={busy}>
                Отмена
              </button>
              <button
                type="button"
                className="btn btn--accent"
                onClick={() => void submitEdit()}
                disabled={busy || !name.trim()}
              >
                {busy ? <Loader2 size={15} className="spin" /> : null}
                Сохранить
              </button>
            </div>
          </div>
        ) : (
          <div className="profile-drawer__rows">
            <button type="button" className="profile-drawer__row" onClick={beginEdit}>
              <span className="profile-drawer__row-icon">
                <Pencil size={17} />
              </span>
              <span className="profile-drawer__row-label">Изменить профиль</span>
              <ChevronRight size={16} className="profile-drawer__row-chevron" />
            </button>
            <button
              type="button"
              className="profile-drawer__row"
              onClick={openSettings}
            >
              <span className="profile-drawer__row-icon">
                <Settings size={17} />
              </span>
              <span className="profile-drawer__row-label">Настройки</span>
              <ChevronRight size={16} className="profile-drawer__row-chevron" />
            </button>
            {isStaff(account.role) ? (
              <button
                type="button"
                className={`profile-drawer__row profile-drawer__row--staff profile-drawer__row--${account.role}`}
                onClick={() => navigate({ name: 'admin' })}
              >
                <span className="profile-drawer__row-icon">
                  {account.role === 'owner' ? <Crown size={17} /> : <ShieldCheck size={17} />}
                </span>
                <span className="profile-drawer__row-label">
                  {account.role === 'owner' ? 'Кабинет владельца' : 'Админ-панель'}
                </span>
                <ChevronRight size={16} className="profile-drawer__row-chevron" />
              </button>
            ) : (
              <button type="button" className="profile-drawer__row" onClick={openRedeemKey}>
                <span className="profile-drawer__row-icon">
                  <KeyRound size={17} />
                </span>
                <span className="profile-drawer__row-label">Активировать ключ</span>
                <ChevronRight size={16} className="profile-drawer__row-chevron" />
              </button>
            )}
            <div className="profile-drawer__separator" />
            <button
              type="button"
              className="profile-drawer__row"
              onClick={() => void switchAccount()}
            >
              <span className="profile-drawer__row-icon">
                <LogIn size={17} />
              </span>
              <span className="profile-drawer__row-label">Сменить аккаунт</span>
            </button>
            <button type="button" className="profile-drawer__row" onClick={() => void logout()}>
              <span className="profile-drawer__row-icon">
                <LogOut size={17} />
              </span>
              <span className="profile-drawer__row-label">Выйти</span>
            </button>
          </div>
        )}

        <footer className="profile-drawer__note">
          <ShieldCheck size={15} />
          Пароль защищён, профиль хранится на этом компьютере
        </footer>
      </aside>
    </>
  )
}
