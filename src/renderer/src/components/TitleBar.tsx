import { useEffect, useState } from 'react'
import { Copy, Minus, Settings2, Square, X } from 'lucide-react'
import type { WindowState } from '../../../shared/types'
import logo from '../assets/sofy-icon.png'
import { bridge } from '../lib/bridge'
import { useUi } from '../store/ui'

export function TitleBar() {
  const account = useUi((state) => state.account)
  const settingsOpen = useUi((state) => state.settingsOpen)
  const openSettings = useUi((state) => state.openSettings)
  const closeSettings = useUi((state) => state.closeSettings)
  const [state, setState] = useState<WindowState>({
    maximized: false,
    focused: true,
    fullscreen: false
  })

  useEffect(() => bridge.app.onWindowState(setState), [])

  return (
    <header className={`titlebar ${state.focused ? 'is-focused' : ''}`}>
      <div className="titlebar__drag" onDoubleClick={() => void bridge.app.toggleMaximize()}>
        <img className="titlebar__logo" src={logo} alt="" draggable={false} />
        <span className="titlebar__name">
          <span className="brand__so">So</span>
          <span className="brand__fy">Fy</span>
        </span>
      </div>
      {account && (
        <div className="titlebar__actions">
          <button
            type="button"
            className={`titlebar__gear ${settingsOpen ? 'is-active' : ''}`}
            onClick={() => (settingsOpen ? closeSettings() : openSettings())}
            aria-label="Настройки"
            title="Настройки"
          >
            <Settings2 size={16} strokeWidth={1.8} />
          </button>
        </div>
      )}
      <div className="titlebar__controls" onDoubleClick={(event) => event.stopPropagation()}>
        <button type="button" onClick={() => void bridge.app.minimize()} aria-label="Свернуть окно">
          <Minus size={15} strokeWidth={1.8} />
        </button>
        <button
          type="button"
          onClick={() => void bridge.app.toggleMaximize()}
          aria-label={state.maximized ? 'Восстановить окно' : 'Развернуть окно'}
        >
          {state.maximized ? (
            <Copy size={12} strokeWidth={1.8} />
          ) : (
            <Square size={11} strokeWidth={1.8} />
          )}
        </button>
        <button
          type="button"
          className="titlebar__close"
          onClick={() => void bridge.app.close()}
          aria-label="Закрыть"
        >
          <X size={15} strokeWidth={1.8} />
        </button>
      </div>
    </header>
  )
}
