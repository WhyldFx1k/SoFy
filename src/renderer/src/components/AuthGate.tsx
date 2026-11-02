import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Eye, EyeOff, HardDrive, KeyRound, Loader2, ShieldCheck, UserRound } from 'lucide-react'
import { useUi } from '../store/ui'

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,22}[a-z0-9]$/

type Mode = 'login' | 'register'

export function AuthGate() {
  const login = useUi((state) => state.loginAccount)
  const register = useUi((state) => state.registerAccount)

  const [mode, setMode] = useState<Mode>('login')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [repeat, setRepeat] = useState('')
  const [accessKey, setAccessKey] = useState('')
  const [keyOpen, setKeyOpen] = useState(false)
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const usernameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => usernameRef.current?.focus(), 240)
    return () => window.clearTimeout(timer)
  }, [])

  const isRegister = mode === 'register'

  const changeMode = (next: Mode): void => {
    if (busy || next === mode) return
    setMode(next)
    setPassword('')
    setRepeat('')
    setShow(false)
    setError(null)
    window.setTimeout(() => usernameRef.current?.focus(), 30)
  }

  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (busy) return
    const loginName = username.trim().toLowerCase()
    if (!loginName) {
      setError('Введите логин')
      return
    }
    if (isRegister && !USERNAME_PATTERN.test(loginName)) {
      setError('Логин: 3–24 символа, латиница, цифры, точка, дефис или _')
      return
    }
    if (!password) {
      setError('Введите пароль')
      return
    }
    if (isRegister) {
      if (password.length < 8) {
        setError('Пароль должен быть не короче 8 символов')
        return
      }
      if (password !== repeat) {
        setError('Пароли не совпадают')
        return
      }
    }
    setBusy(true)
    setError(null)
    const failure = isRegister
      ? await register({
          username: loginName,
          displayName: displayName.trim(),
          password,
          accessKey: accessKey.trim() || undefined
        })
      : await login({ username: loginName, password })
    setBusy(false)
    if (failure) setError(failure)
  }

  return (
    <main className="auth-gate">
      <div className="auth-gate__frame">
        <section className="auth-gate__story">
          <p className="auth-gate__eyebrow">Локальный профиль</p>
          <h2 className="auth-gate__headline">
            Сначала вход.
            <br />
            Дальше — <span>музыка</span>.
          </h2>
          <p className="auth-gate__lead">
            SoFy открывается после входа. Аккаунт хранится на этом компьютере — без облака и
            лишних шагов.
          </p>

          <div className="auth-gate__points">
            <div className="auth-gate__point">
              <span className="auth-gate__point-icon">
                <ShieldCheck size={17} />
              </span>
              <div>
                <strong>Пароль под защитой</strong>
                <span>Только необратимый хеш, без открытого текста</span>
              </div>
            </div>
            <div className="auth-gate__point">
              <span className="auth-gate__point-icon">
                <HardDrive size={17} />
              </span>
              <div>
                <strong>Всё локально</strong>
                <span>Профиль и сессия остаются на этом компьютере</span>
              </div>
            </div>
            <div className="auth-gate__point">
              <span className="auth-gate__point-icon">
                <UserRound size={17} />
              </span>
              <div>
                <strong>Свой профиль</strong>
                <span>Имя и аватар можно поменять в любой момент</span>
              </div>
            </div>
          </div>
        </section>

        <section className="auth-gate__card">
          <div className="auth-gate__tabs" role="tablist" aria-label="Вход или регистрация">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'login'}
              className={`auth-gate__tab ${mode === 'login' ? 'is-active' : ''}`}
              onClick={() => changeMode('login')}
            >
              Вход
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'register'}
              className={`auth-gate__tab ${mode === 'register' ? 'is-active' : ''}`}
              onClick={() => changeMode('register')}
            >
              Регистрация
            </button>
          </div>

          <header className="auth-gate__head">
            <h1>{isRegister ? 'Давайте знакомиться' : 'С возвращением'}</h1>
            <p>
              {isRegister
                ? 'Имя можно изменить позже в профиле.'
                : 'Войдите, чтобы открыть плеер и свою музыку.'}
            </p>
          </header>

          <form className="auth-gate__form" onSubmit={(event) => void submit(event)}>
            <label className="field">
              <span className="field__label">Логин</span>
              <input
                ref={usernameRef}
                className="input"
                value={username}
                maxLength={24}
                autoComplete="username"
                spellCheck={false}
                placeholder="например, sofy_fan"
                onChange={(event) => setUsername(event.target.value)}
              />
            </label>

            {isRegister && (
              <label className="field">
                <span className="field__label">Ваше имя</span>
                <input
                  className="input"
                  value={displayName}
                  maxLength={40}
                  autoComplete="nickname"
                  placeholder="Необязательно — можно позже"
                  onChange={(event) => setDisplayName(event.target.value)}
                />
              </label>
            )}

            <label className="field">
              <span className="field__label">Пароль</span>
              <span className="auth__control">
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  value={password}
                  maxLength={128}
                  autoComplete={isRegister ? 'new-password' : 'current-password'}
                  placeholder={isRegister ? 'Минимум 8 символов' : 'Ваш пароль'}
                  onChange={(event) => setPassword(event.target.value)}
                />
                <button
                  type="button"
                  className="icon-btn auth__eye"
                  onClick={() => setShow((value) => !value)}
                  aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
                >
                  {show ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </span>
            </label>

            {isRegister && (
              <label className="field">
                <span className="field__label">Повторите пароль</span>
                <input
                  className="input"
                  type={show ? 'text' : 'password'}
                  value={repeat}
                  maxLength={128}
                  autoComplete="new-password"
                  placeholder="Ещё раз"
                  onChange={(event) => setRepeat(event.target.value)}
                />
              </label>
            )}

            {isRegister &&
              (keyOpen ? (
                <label className="field auth-gate__key">
                  <span className="field__label">
                    Ключ доступа
                    <span className="auth-gate__key-optional">если он у вас есть</span>
                  </span>
                  <input
                    className="input admin-key-input"
                    value={accessKey}
                    maxLength={40}
                    spellCheck={false}
                    autoComplete="off"
                    placeholder="SOFY-XXXX-XXXX-XXXX-XXXX"
                    onChange={(event) => setAccessKey(event.target.value.toUpperCase())}
                  />
                </label>
              ) : (
                <button
                  type="button"
                  className="auth-gate__key-toggle"
                  onClick={() => setKeyOpen(true)}
                >
                  <KeyRound size={13} />
                  У меня есть ключ доступа
                </button>
              ))}

            {error && (
              <p className="auth__error" role="alert">
                {error}
              </p>
            )}

            <button type="submit" className="btn btn--accent auth-gate__submit" disabled={busy}>
              {busy ? <Loader2 size={15} className="spin" /> : null}
              {isRegister ? 'Создать аккаунт' : 'Войти'}
            </button>
          </form>

          <p className="auth__note auth-gate__note">
            <ShieldCheck size={14} />
            Пароль хранится только в виде хеша. Профиль — на этом компьютере.
          </p>
        </section>
      </div>
    </main>
  )
}
