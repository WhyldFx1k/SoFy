import { AlertCircle, FolderOpen, RefreshCw } from 'lucide-react'
import type { CoreStatus } from '../../../shared/types'
import logo from '../assets/sofy-icon.png'
import { bridge } from '../lib/bridge'

interface BootScreenProps {
  status: CoreStatus | null
  starting: boolean
  onRetry: () => void
}

export function BootScreen({ status, starting, onRetry }: BootScreenProps) {
  const failed = status?.state === 'error'

  return (
    <div className="boot">
      <div className="boot__rings" aria-hidden="true">
        <span />
        <span />
        <span />
      </div>
      <div className="boot__mark" aria-hidden="true">
        <img src={logo} alt="" draggable={false} />
      </div>

      {failed ? (
        <div className="boot__content">
          <span className="boot__icon boot__icon--error">
            <AlertCircle size={19} />
          </span>
          <h1>Ядро не запустилось</h1>
          <p className="boot__message">{status?.error ?? 'Неизвестная ошибка'}</p>
          <div className="boot__actions">
            <button type="button" className="btn btn--primary" onClick={onRetry} disabled={starting}>
              <RefreshCw size={15} className={starting ? 'spin' : ''} />
              {starting ? 'Запускаем…' : 'Попробовать снова'}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={() => void bridge.app.openDataFolder()}
            >
              <FolderOpen size={15} />
              Папка данных
            </button>
          </div>
          <p className="boot__hint">
            Проверьте, что установлена Java 22 и собран файл <code>core/build/libs/sofy-core-all.jar</code>.
          </p>
        </div>
      ) : (
        <div className="boot__content">
          <h1>Запускаем SoFy</h1>
          <p className="boot__message">Подключаем ядро и вашу коллекцию…</p>
          <div className="boot__bar" aria-hidden="true">
            <span />
          </div>
        </div>
      )}
    </div>
  )
}
