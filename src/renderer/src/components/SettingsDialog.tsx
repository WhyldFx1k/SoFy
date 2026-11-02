import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from 'react'
import {
  AudioLines,
  Check,
  Cpu,
  Droplets,
  FolderOpen,
  Gamepad2,
  Info,
  Keyboard,
  KeyRound,
  LibraryBig,
  Loader2,
  Mouse,
  Music2,
  Palette,
  PanelLeft,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  X,
  type LucideIcon
} from 'lucide-react'
import type { AppInfo, CoreStatus } from '../../../shared/types'
import logo from '../assets/sofy-icon.png'
import { bridge } from '../lib/bridge'
import { errorMessage } from '../lib/format'
import { attachSmoothWheel } from '../lib/smoothScroll'
import { useUi } from '../store/ui'
import { RoleBadge } from './RoleBadge'

const QUALITY = [
  { value: 'low', label: 'Низкое', hint: '64 кбит/с · экономно' },
  { value: 'normal', label: 'Обычное', hint: '128 кбит/с · сбалансированно' },
  { value: 'high', label: 'Высокое', hint: '256 кбит/с · рекомендуется' },
  { value: 'lossless', label: 'Без потерь', hint: 'FLAC, если доступно' }
]

const BLUR_OPTIONS = [
  { value: 'off', label: 'Выкл' },
  { value: 'soft', label: 'Мягкое' },
  { value: 'strong', label: 'Сильное' }
]

interface ThemeArt {
  bg: string
  panel: string
  rail: string
  accent: string
  text: string
  dim: string
}

interface ThemeOption {
  value: string
  label: string
  light: boolean
  art: ThemeArt
}

const THEMES: ThemeOption[] = [
  {
    value: 'aurora',
    label: 'Аврора',
    light: false,
    art: {
      bg: 'radial-gradient(120% 90% at 84% 0%, rgba(240, 182, 79, 0.24), transparent 62%), #0b0906',
      panel: '#161209',
      rail: '#0e0c07',
      accent: '#f0b64f',
      text: '#f6f3ec',
      dim: 'rgba(246, 243, 236, 0.24)'
    }
  },
  {
    value: 'arctic',
    label: 'Арктика',
    light: false,
    art: {
      bg: 'radial-gradient(120% 90% at 84% 0%, rgba(127, 214, 255, 0.26), transparent 62%), #061019',
      panel: '#0c1a26',
      rail: '#08141d',
      accent: '#7fd6ff',
      text: '#eaf7ff',
      dim: 'rgba(234, 247, 255, 0.24)'
    }
  },
  {
    value: 'rose',
    label: 'Роза',
    light: false,
    art: {
      bg: 'radial-gradient(120% 90% at 84% 0%, rgba(255, 122, 182, 0.26), transparent 62%), #0c060d',
      panel: '#190d1a',
      rail: '#110813',
      accent: '#ff7ab6',
      text: '#fceef6',
      dim: 'rgba(252, 238, 246, 0.24)'
    }
  },
  {
    value: 'emerald',
    label: 'Изумруд',
    light: false,
    art: {
      bg: 'radial-gradient(120% 90% at 84% 0%, rgba(87, 226, 163, 0.24), transparent 62%), #050e09',
      panel: '#0b1a12',
      rail: '#07130c',
      accent: '#57e2a3',
      text: '#eefbf4',
      dim: 'rgba(238, 251, 244, 0.24)'
    }
  },
  {
    value: 'ocean',
    label: 'Океан',
    light: false,
    art: {
      bg: 'radial-gradient(120% 90% at 84% 0%, rgba(76, 201, 255, 0.26), transparent 62%), #04101a',
      panel: '#0a1a28',
      rail: '#06131f',
      accent: '#4cc9ff',
      text: '#eaf8ff',
      dim: 'rgba(234, 248, 255, 0.24)'
    }
  },
  {
    value: 'mono',
    label: 'Графит',
    light: false,
    art: {
      bg: 'radial-gradient(120% 90% at 84% 0%, rgba(230, 230, 239, 0.16), transparent 62%), #0a0a0d',
      panel: '#15151b',
      rail: '#0e0e13',
      accent: '#e6e6ef',
      text: '#f6f6fa',
      dim: 'rgba(246, 246, 250, 0.24)'
    }
  },
  {
    value: 'dawn',
    label: 'Рассвет',
    light: true,
    art: {
      bg: 'radial-gradient(120% 90% at 84% 0%, rgba(201, 138, 46, 0.26), transparent 62%), #f1e6d3',
      panel: '#fffaf0',
      rail: '#f7eddc',
      accent: '#b97a20',
      text: '#2b2419',
      dim: 'rgba(43, 36, 25, 0.26)'
    }
  },
  {
    value: 'frost',
    label: 'Иней',
    light: true,
    art: {
      bg: 'radial-gradient(120% 90% at 84% 0%, rgba(47, 127, 196, 0.24), transparent 62%), #e8f1fa',
      panel: '#ffffff',
      rail: '#f0f7fe',
      accent: '#2f7fc4',
      text: '#16202b',
      dim: 'rgba(22, 32, 43, 0.24)'
    }
  }
]

type TabId = 'appearance' | 'sound' | 'library' | 'core' | 'hotkeys' | 'developer' | 'about'

interface TabDef {
  id: TabId
  label: string
  icon: LucideIcon
  title: string
  subtitle: string
}

const TABS: TabDef[] = [
  {
    id: 'appearance',
    label: 'Внешний вид',
    icon: Palette,
    title: 'Внешний вид',
    subtitle: 'Тема, стекло и поведение интерфейса'
  },
  {
    id: 'sound',
    label: 'Звук',
    icon: AudioLines,
    title: 'Звук',
    subtitle: 'Качество потока и воспроизведение'
  },
  {
    id: 'library',
    label: 'Библиотека',
    icon: LibraryBig,
    title: 'Библиотека',
    subtitle: 'Файлы, папки и локальная музыка'
  },
  {
    id: 'core',
    label: 'Ядро',
    icon: Cpu,
    title: 'Ядро',
    subtitle: 'Локальная служба, которая играет музыку'
  },
  {
    id: 'hotkeys',
    label: 'Горячие клавиши',
    icon: Keyboard,
    title: 'Горячие клавиши',
    subtitle: 'Управление без мыши'
  },
  {
    id: 'developer',
    label: 'Для разработчиков',
    icon: KeyRound,
    title: 'Для разработчиков',
    subtitle: 'Ключ доступа и роль профиля'
  },
  {
    id: 'about',
    label: 'О системе',
    icon: Info,
    title: 'О системе',
    subtitle: 'Версии и платформа'
  }
]

const HOTKEYS: { keys: string[]; label: string }[] = [
  { keys: ['Пробел'], label: 'Пауза и воспроизведение' },
  { keys: ['Shift', '←'], label: 'Предыдущий трек' },
  { keys: ['Shift', '→'], label: 'Следующий трек' },
  { keys: ['←'], label: 'Перемотка на 5 секунд назад' },
  { keys: ['→'], label: 'Перемотка на 5 секунд вперёд' },
  { keys: ['M'], label: 'Выключить или включить звук' }
]

export function SettingsDialog() {
  const settings = useUi((state) => state.settings)
  const saveSetting = useUi((state) => state.saveSetting)
  const toast = useUi((state) => state.toast)
  const account = useUi((state) => state.account)
  const redeemAccessKey = useUi((state) => state.redeemAccessKey)
  const closeSettings = useUi((state) => state.closeSettings)
  const navigate = useUi((state) => state.navigate)
  const importLocal = useUi((state) => state.importLocal)
  const importing = useUi((state) => state.importing)
  const playlists = useUi((state) => state.playlists)

  const [tab, setTab] = useState<TabId>('appearance')
  const [info, setInfo] = useState<AppInfo | null>(null)
  const [status, setStatus] = useState<CoreStatus | null>(null)
  const [restarting, setRestarting] = useState(false)
  const [devKey, setDevKey] = useState('')
  const [keyBusy, setKeyBusy] = useState(false)
  const [keyError, setKeyError] = useState<string | null>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const element = bodyRef.current
    if (!element) return
    return attachSmoothWheel(element, () => {
      const current = useUi.getState().settings
      return current.reduceMotion !== 'true' && current.smoothScroll !== 'false'
    })
  }, [])

  useEffect(() => {
    let alive = true
    void bridge.app
      .info()
      .then((value) => {
        if (alive) setInfo(value)
      })
      .catch(() => {})
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
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      closeSettings()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [closeSettings])

  const restartCore = async (): Promise<void> => {
    setRestarting(true)
    try {
      const value = await bridge.core.restart()
      setStatus(value)
      toast('Ядро перезапущено', 'success')
    } catch (reason) {
      toast(errorMessage(reason), 'error')
    } finally {
      setRestarting(false)
    }
  }

  const activateKey = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    const value = devKey.trim()
    if (!value || keyBusy) return
    setKeyBusy(true)
    setKeyError(null)
    const failure = await redeemAccessKey(value)
    setKeyBusy(false)
    if (failure) {
      setKeyError(failure)
      return
    }
    setDevKey('')
  }

  const reduceMotion = settings.reduceMotion === 'true'
  const theme = settings.theme ?? 'aurora'
  const blur = settings.blur ?? 'soft'
  const linuxControls = settings.windowButtons === 'left'
  const discordPresence = settings.discordPresence !== 'false'
  const smoothScroll = settings.smoothScroll !== 'false'
  const activeTab = TABS.find((item) => item.id === tab) ?? TABS[0]
  const myTracks = playlists.find((playlist) => playlist.name === 'Мои треки')

  if (!account) return null

  return (
    <div className="prefs" role="dialog" aria-modal="true" aria-label="Настройки">
      <div className="prefs__backdrop" onClick={closeSettings} />
      <div className="prefs__window">
        <aside className="prefs__nav">
          <header className="prefs__nav-head">
            <span className="prefs__nav-title">Настройки</span>
            <button type="button" className="prefs__close" onClick={closeSettings} aria-label="Закрыть настройки">
              <X size={16} strokeWidth={2} />
            </button>
          </header>

          <nav className="prefs__tabs" aria-label="Разделы настроек">
            {TABS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  className={`prefs__tab ${tab === item.id ? 'is-active' : ''}`}
                  onClick={() => setTab(item.id)}
                  aria-current={tab === item.id ? 'page' : undefined}
                >
                  <Icon size={15} strokeWidth={1.8} />
                  <span>{item.label}</span>
                </button>
              )
            })}
          </nav>

          <footer className="prefs__brand">
            <span className="prefs__brand-mark">
              <img src={logo} alt="" draggable={false} />
            </span>
            <span className="prefs__brand-text">
              <span className="prefs__brand-name">
                <span className="brand__so">So</span>
                <span className="brand__fy">Fy</span>
              </span>
              <span className="prefs__brand-hint">музыка без лишнего шума</span>
            </span>
          </footer>
        </aside>

        <section className="prefs__main">
          <header className="prefs__head">
            <h1>{activeTab.title}</h1>
            <p>{activeTab.subtitle}</p>
          </header>

          <div className="prefs__body" ref={bodyRef}>
            {tab === 'appearance' && (
              <>
                <div className="prefs__section-head">
                  <h2>Темы</h2>
                  <p>Цвет интерфейса, акцентов и плеера — применяется сразу</p>
                </div>

                <div className="theme-grid" role="radiogroup" aria-label="Тема оформления">
                  {THEMES.map((item) => {
                    const active = theme === item.value
                    return (
                      <button
                        key={item.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        title={item.label}
                        className={`theme-tile ${active ? 'is-active' : ''}`}
                        style={
                          {
                            '--tile-bg': item.art.bg,
                            '--tile-panel': item.art.panel,
                            '--tile-rail': item.art.rail,
                            '--tile-accent': item.art.accent,
                            '--tile-text': item.art.text,
                            '--tile-dim': item.art.dim
                          } as CSSProperties
                        }
                        onClick={() => void saveSetting('theme', item.value)}
                      >
                        <span className="theme-tile__art">
                          <span className="theme-tile__window">
                            <span className="theme-tile__rail">
                              <span className="theme-tile__logo" />
                              <span className="theme-tile__nav" />
                              <span className="theme-tile__nav" />
                              <span className="theme-tile__nav theme-tile__nav--short" />
                            </span>
                            <span className="theme-tile__main">
                              <span className="theme-tile__title" />
                              <span className="theme-tile__line" />
                              <span className="theme-tile__line theme-tile__line--short" />
                              <span className="theme-tile__cards">
                                <span />
                                <span />
                                <span />
                              </span>
                            </span>
                            <span className="theme-tile__player" />
                          </span>
                          {active && (
                            <span className="theme-tile__check">
                              <Check size={11} strokeWidth={3.2} />
                            </span>
                          )}
                        </span>
                        <span className="theme-tile__meta">
                          <span className="theme-tile__name">{item.label}</span>
                          <span className="theme-tile__kind">{item.light ? 'светлая' : 'тёмная'}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                <div className="prefs__section-head">
                  <h2>Поведение</h2>
                  <p>Мелочи, из которых складывается ощущение</p>
                </div>

                <div className="prefs-card">
                  <div className="prefs-row">
                    <span className="prefs-row__text">
                      <span className="prefs-row__title">
                        <Droplets size={15} />
                        Размытие стекла
                      </span>
                      <span className="prefs-row__hint">
                        Насколько фон растворяется под панелями и карточками
                      </span>
                    </span>
                    <div className="segmented" role="radiogroup" aria-label="Размытие стекла">
                      {BLUR_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          role="radio"
                          aria-checked={blur === option.value}
                          className={`segmented__btn ${blur === option.value ? 'is-active' : ''}`}
                          onClick={() => void saveSetting('blur', option.value)}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="prefs-row">
                    <span className="prefs-row__text">
                      <span className="prefs-row__title">
                        <Gamepad2 size={15} />
                        Статус в Discord
                      </span>
                      <span className="prefs-row__hint">
                        Текущий трек, обложка и логотип SoFy в вашем профиле
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={discordPresence}
                      aria-label="Статус в Discord"
                      className={`switch ${discordPresence ? 'is-on' : ''}`}
                      onClick={() =>
                        void saveSetting('discordPresence', String(!discordPresence))
                      }
                    >
                      <span />
                    </button>
                  </div>

                  <div className="prefs-row">
                    <span className="prefs-row__text">
                      <span className="prefs-row__title">
                        <Mouse size={15} />
                        Плавная прокрутка
                      </span>
                      <span className="prefs-row__hint">
                        Мягкая инерция колеса мыши вместо резких скачков
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={smoothScroll}
                      aria-label="Плавная прокрутка"
                      className={`switch ${smoothScroll ? 'is-on' : ''}`}
                      onClick={() => void saveSetting('smoothScroll', String(!smoothScroll))}
                    >
                      <span />
                    </button>
                  </div>

                  <div className="prefs-row">
                    <span className="prefs-row__text">
                      <span className="prefs-row__title">
                        <PanelLeft size={15} />
                        Кнопки окна слева
                      </span>
                      <span className="prefs-row__hint">Свернуть, развернуть и закрыть — как в Linux</span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={linuxControls}
                      aria-label="Кнопки окна слева"
                      className={`switch ${linuxControls ? 'is-on' : ''}`}
                      onClick={() => void saveSetting('windowButtons', linuxControls ? 'right' : 'left')}
                    >
                      <span />
                    </button>
                  </div>

                  <div className="prefs-row">
                    <span className="prefs-row__text">
                      <span className="prefs-row__title">
                        <Sparkles size={15} />
                        Меньше анимаций
                      </span>
                      <span className="prefs-row__hint">
                        Спокойный интерфейс без постоянного движения фона
                      </span>
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={reduceMotion}
                      aria-label="Меньше анимаций"
                      className={`switch ${reduceMotion ? 'is-on' : ''}`}
                      onClick={() => void saveSetting('reduceMotion', String(!reduceMotion))}
                    >
                      <span />
                    </button>
                  </div>
                </div>
              </>
            )}

            {tab === 'sound' && (
              <>
                <div className="prefs__section-head">
                  <h2>Качество звука</h2>
                  <p>Применяется при выборе потока для нового трека</p>
                </div>

                <div className="prefs-card prefs-card--choices" role="radiogroup" aria-label="Качество звука">
                  {QUALITY.map((option) => {
                    const active = (settings.quality ?? 'high') === option.value
                    return (
                      <button
                        key={option.value}
                        type="button"
                        role="radio"
                        aria-checked={active}
                        className={`prefs-choice ${active ? 'is-active' : ''}`}
                        onClick={() => void saveSetting('quality', option.value)}
                      >
                        <span className="prefs-choice__radio">{active && <span />}</span>
                        <span className="prefs-choice__text">
                          <span className="prefs-choice__label">{option.label}</span>
                          <span className="prefs-choice__hint">{option.hint}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>

                <p className="prefs-note">
                  <ShieldCheck size={15} />
                  Если источник не поддерживает выбранное качество, SoFy возьмёт лучшее доступное.
                </p>
              </>
            )}

            {tab === 'library' && (
              <>
                <div className="prefs__section-head">
                  <h2>Локальная музыка</h2>
                  <p>Файлы копируются в папку SoFy и появляются в «Мои треки»</p>
                </div>

                <div className="prefs-card">
                  <div className="prefs-row">
                    <span className="prefs-row__text">
                      <span className="prefs-row__title">
                        <Music2 size={15} />
                        Добавить треки
                      </span>
                      <span className="prefs-row__hint">MP3, FLAC, M4A, WAV, OGG и другие форматы</span>
                    </span>
                    <button
                      type="button"
                      className="btn btn--primary btn--small"
                      onClick={() => void importLocal()}
                      disabled={importing}
                    >
                      {importing ? <Loader2 size={14} className="spin" /> : <Music2 size={14} />}
                      {importing ? 'Добавляем' : 'Выбрать файлы'}
                    </button>
                  </div>

                  <div className="prefs-row">
                    <span className="prefs-row__text">
                      <span className="prefs-row__title">
                        <LibraryBig size={15} />
                        Мои треки
                      </span>
                      <span className="prefs-row__hint">
                        {myTracks
                          ? `${myTracks.trackCount} в библиотеке`
                          : 'Плейлист появится после первого импорта'}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => {
                        if (!myTracks) return
                        closeSettings()
                        navigate({ name: 'playlist', id: myTracks.id })
                      }}
                      disabled={!myTracks}
                    >
                      Открыть
                    </button>
                  </div>

                  <div className="prefs-row">
                    <span className="prefs-row__text">
                      <span className="prefs-row__title">
                        <FolderOpen size={15} />
                        Папка музыки
                      </span>
                      <span className="prefs-row__hint prefs-row__hint--path" title={status?.dataDir}>
                        {status?.dataDir ?? '—'}
                      </span>
                    </span>
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => void bridge.app.openDataFolder()}
                    >
                      <FolderOpen size={14} />
                      Открыть
                    </button>
                  </div>
                </div>

                <p className="prefs-note">
                  <ShieldCheck size={15} />
                  Файлы остаются на устройстве. SoFy не загружает музыку в сеть.
                </p>
              </>
            )}

            {tab === 'core' && (
              <>
                <div className="prefs__section-head">
                  <h2>Состояние</h2>
                  <p>Java-ядро работает локально и не покидает устройство</p>
                </div>

                <div className="prefs-card prefs-card--core">
                  <div className="core-grid">
                    <div className="core-stat">
                      <span className="core-stat__label">Состояние</span>
                      <span className={`status-pill ${status?.state === 'ready' ? 'is-on' : 'is-off'}`}>
                        {status?.state === 'ready'
                          ? 'Готово'
                          : status?.state === 'starting'
                            ? 'Запуск'
                            : status?.state === 'error'
                              ? 'Ошибка'
                              : 'Остановлено'}
                      </span>
                    </div>
                    <div className="core-stat">
                      <span className="core-stat__label">Порт</span>
                      <span className="core-stat__value">
                        {status?.port ? `127.0.0.1:${status.port}` : '—'}
                      </span>
                    </div>
                    <div className="core-stat">
                      <span className="core-stat__label">Java</span>
                      <span className="core-stat__value" title={status?.java}>
                        {status?.java ?? '—'}
                      </span>
                    </div>
                    <div className="core-stat">
                      <span className="core-stat__label">Перезапусков</span>
                      <span className="core-stat__value">{status?.restarts ?? 0}</span>
                    </div>
                  </div>
                  {status?.error && <p className="core-error">{status.error}</p>}
                  <div className="core-actions">
                    <button
                      type="button"
                      className="btn btn--ghost btn--small"
                      onClick={() => void restartCore()}
                      disabled={restarting}
                    >
                      <RefreshCw size={14} className={restarting ? 'spin' : ''} />
                      Перезапустить ядро
                    </button>
                  </div>
                </div>

                <p className="prefs-note">
                  <ShieldCheck size={15} />
                  Музыка приходит через короткоживущие ссылки локального ядра — в плеер не попадают
                  служебные данные.
                </p>
              </>
            )}

            {tab === 'hotkeys' && (
              <>
                <div className="prefs__section-head">
                  <h2>Управление</h2>
                  <p>Работают, когда фокус не в поле ввода и не открыто окно</p>
                </div>

                <div className="prefs-card prefs-card--keys">
                  {HOTKEYS.map((item) => (
                    <div key={item.label} className="prefs-key">
                      <span className="prefs-key__keys">
                        {item.keys.map((key) => (
                          <kbd key={key}>{key}</kbd>
                        ))}
                      </span>
                      <span className="prefs-key__label">{item.label}</span>
                    </div>
                  ))}
                </div>
              </>
            )}

            {tab === 'developer' && (
              <>
                <div className="prefs__section-head">
                  <h2>Ключ доступа</h2>
                  <p>Ключ активирует роль в профиле — без перезапуска</p>
                </div>

                <div className="prefs-card">
                  <div className="dev-access">
                    <span className="dev-access__icon">
                      <KeyRound size={18} />
                    </span>
                    <div className="dev-access__body">
                      <div className="dev-access__head">
                        <span className="dev-access__title">Ваша роль</span>
                        <RoleBadge role={account.role} />
                      </div>
                      {account.role === 'user' ? (
                        <>
                          <p className="dev-access__hint">
                            Вставьте ключ, выданный владельцем или администратором, — роль обновится
                            сразу.
                          </p>
                          <form className="dev-access__form" onSubmit={(event) => void activateKey(event)}>
                            <input
                              className="input admin-key-input"
                              value={devKey}
                              maxLength={40}
                              spellCheck={false}
                              placeholder="SOFY-XXXX-XXXX-XXXX-XXXX"
                              onChange={(event) => {
                                setDevKey(event.target.value.toUpperCase())
                                setKeyError(null)
                              }}
                            />
                            <button
                              type="submit"
                              className="btn btn--primary btn--small"
                              disabled={keyBusy || !devKey.trim()}
                            >
                              {keyBusy ? <Loader2 size={14} className="spin" /> : <KeyRound size={14} />}
                              Активировать
                            </button>
                          </form>
                          {keyError && (
                            <p className="dev-access__error" role="alert">
                              {keyError}
                            </p>
                          )}
                        </>
                      ) : (
                        <>
                          <p className="dev-access__hint">
                            {account.role === 'owner'
                              ? 'У вашего профиля максимальная роль. Участники и ключи — в кабинете владельца.'
                              : 'Роль уже активна. Участники и ключи — в админ-панели.'}
                          </p>
                          <button
                            type="button"
                            className="btn btn--ghost btn--small dev-access__open"
                            onClick={() => {
                              closeSettings()
                              navigate({ name: 'admin' })
                            }}
                          >
                            <ShieldCheck size={14} />
                            {account.role === 'owner' ? 'Открыть кабинет' : 'Открыть админ-панель'}
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </>
            )}

            {tab === 'about' && (
              <>
                <div className="prefs__section-head">
                  <h2>SoFy</h2>
                  <p>Музыка без лишнего шума</p>
                </div>

                <div className="prefs-card prefs-card--about">
                  <div className="about-grid">
                    <div className="core-stat">
                      <span className="core-stat__label">Версия</span>
                      <span className="core-stat__value">{info?.version ?? '—'}</span>
                    </div>
                    <div className="core-stat">
                      <span className="core-stat__label">Electron</span>
                      <span className="core-stat__value">{info?.electron ?? '—'}</span>
                    </div>
                    <div className="core-stat">
                      <span className="core-stat__label">Chromium</span>
                      <span className="core-stat__value">{info?.chrome?.split(' ')[0] ?? '—'}</span>
                    </div>
                    <div className="core-stat">
                      <span className="core-stat__label">Платформа</span>
                      <span className="core-stat__value">{info?.platform ?? '—'}</span>
                    </div>
                  </div>
                  <p className="about-brand">SoFy · музыка без лишнего шума</p>
                </div>
              </>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}
