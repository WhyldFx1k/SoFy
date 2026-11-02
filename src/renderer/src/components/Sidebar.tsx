import { ChevronUp, Heart, Home, ListMusic, Plus, Search, type LucideIcon } from 'lucide-react'
import logo from '../assets/sofy-icon.png'
import { plural } from '../lib/format'
import { useUi, type Route } from '../store/ui'
import { AccountAvatar } from './AccountAvatar'
import { RoleBadge } from './RoleBadge'

interface NavItem {
  name: 'home' | 'search' | 'liked' | 'playlists'
  label: string
  icon: LucideIcon
}

const ITEMS: NavItem[] = [
  { name: 'home', label: 'Главная', icon: Home },
  { name: 'search', label: 'Поиск', icon: Search },
  { name: 'liked', label: 'Любимое', icon: Heart },
  { name: 'playlists', label: 'Плейлисты', icon: ListMusic }
]

export function Sidebar() {
  const route = useUi((state) => state.route)
  const playlists = useUi((state) => state.playlists)
  const navigate = useUi((state) => state.navigate)
  const openNewPlaylist = useUi((state) => state.openNewPlaylist)
  const openPlaylistMenu = useUi((state) => state.openPlaylistMenu)
  const account = useUi((state) => state.account)
  const openProfile = useUi((state) => state.openProfile)

  const isActive = (name: NavItem['name']): boolean => {
    if (route.name === name) return true
    return name === 'playlists' && route.name === 'playlist'
  }

  const go = (target: Route): void => navigate(target)

  return (
    <aside className="sidebar">
      <button type="button" className="brand" onClick={() => go({ name: 'home' })}>
        <span className="brand__mark" aria-hidden="true">
          <img src={logo} alt="" draggable={false} />
        </span>
        <span className="brand__text">
          <span className="brand__word">
            <span className="brand__so">So</span>
            <span className="brand__fy">Fy</span>
          </span>
          <span className="brand__beta">beta</span>
        </span>
      </button>

      <nav className="nav">
        {ITEMS.map((item) => {
          const Icon = item.icon
          return (
            <button
              type="button"
              key={item.name}
              className={`nav__item ${isActive(item.name) ? 'is-active' : ''}`}
              onClick={() => go({ name: item.name } as Route)}
            >
              <Icon size={19} strokeWidth={1.9} />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="sidebar__section">
        <div className="sidebar__label">
          <span>Плейлисты</span>
          <button
            type="button"
            className="mini-btn"
            onClick={openNewPlaylist}
            title="Создать плейлист"
            aria-label="Создать плейлист"
          >
            <Plus size={15} strokeWidth={2} />
          </button>
        </div>
        <div className="sidebar__playlists">
          {playlists.map((playlist) => (
            <button
              type="button"
              key={playlist.id}
              className={`plink ${route.name === 'playlist' && route.id === playlist.id ? 'is-current' : ''}`}
              onClick={() => go({ name: 'playlist', id: playlist.id })}
              onContextMenu={(event) => {
                event.preventDefault()
                openPlaylistMenu(playlist, event.clientX, event.clientY)
              }}
            >
              <span className={`plink__icon ${playlist.cover ? 'has-cover' : ''}`}>
                {playlist.cover ? (
                  <img src={playlist.cover} alt="" draggable={false} />
                ) : (
                  <ListMusic size={15} strokeWidth={1.9} />
                )}
              </span>
              <span className="plink__meta">
                <span className="plink__name">{playlist.name}</span>
                <span className="plink__count" key={playlist.trackCount}>
                  {playlist.trackCount} {plural(playlist.trackCount, 'трек', 'трека', 'треков')}
                </span>
              </span>
            </button>
          ))}
          {playlists.length === 0 && <p className="sidebar__empty">Пока пусто</p>}
        </div>
      </div>

      <div className="sidebar__foot">
        <button
          type="button"
          className="profile-chip"
          onClick={openProfile}
          title="Открыть профиль"
        >
          <AccountAvatar account={account} className="profile-chip__avatar" />
          <span className="profile-chip__meta">
            <span className="profile-chip__top">
              <span className="profile-chip__name">
                {account ? account.displayName : 'Войти в аккаунт'}
              </span>
              {account && <RoleBadge role={account.role} className="profile-chip__role" />}
            </span>
            <span className="profile-chip__sub">
              {account ? `@${account.username}` : 'Профиль на этом компьютере'}
            </span>
          </span>
          <ChevronUp size={15} strokeWidth={2} className="profile-chip__chevron" />
        </button>
      </div>
    </aside>
  )
}
