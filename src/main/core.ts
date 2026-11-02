import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { CoreStatus } from '../shared/types'

export interface CoreCredentials {
  soundcloud?: string | null
  yandex?: string | null
}

const READY_TIMEOUT_MS = 45_000
const MAX_AUTO_RESTARTS = 3
const REQUEST_TIMEOUT_MS = 60_000

function resolveJava(): string {
  const executable = process.platform === 'win32' ? 'java.exe' : 'java'
  if (app.isPackaged) {
    const bundled = join(process.resourcesPath, 'jre', 'bin', executable)
    if (existsSync(bundled)) return bundled
  }
  const home = process.env.SOFY_JAVA_HOME ?? process.env.JAVA_HOME
  if (home) {
    const candidate = join(home, 'bin', executable)
    if (existsSync(candidate)) return candidate
  }
  return executable
}

export class CoreController {
  readonly dataDir: string
  readonly jarPath: string
  readonly javaPath: string
  onStatus: (status: CoreStatus) => void = () => {}

  private child: ChildProcessWithoutNullStreams | null = null
  private token = ''
  private port: number | null = null
  private state: CoreStatus['state'] = 'stopped'
  private error: string | null = null
  private restarts = 0
  private intentionalStop = false
  private pending: Promise<CoreStatus> | null = null
  private credentials: CoreCredentials = {}
  private stdoutBuffer = ''
  private stderrTail = ''
  private manualRestart = false

  constructor() {
    this.dataDir = join(app.getPath('userData'), 'core-data')
    this.jarPath = app.isPackaged
      ? join(process.resourcesPath, 'core', 'sofy-core-all.jar')
      : join(app.getAppPath(), 'core', 'build', 'libs', 'sofy-core-all.jar')
    this.javaPath = resolveJava()
  }

  status(): CoreStatus {
    return {
      state: this.state,
      port: this.port,
      error: this.error,
      dataDir: this.dataDir,
      java: this.javaPath,
      restarts: this.restarts
    }
  }

  async start(credentials: CoreCredentials = this.credentials): Promise<CoreStatus> {
    this.credentials = credentials
    if (this.state === 'ready') return this.status()
    if (this.pending) return this.pending
    this.intentionalStop = false
    this.pending = this.spawnCore().finally(() => {
      this.pending = null
    })
    return this.pending
  }

  async restart(credentials: CoreCredentials = this.credentials): Promise<CoreStatus> {
    this.manualRestart = true
    this.stop()
    await new Promise((resolve) => setTimeout(resolve, 400))
    this.restarts = 0
    this.manualRestart = false
    return this.start(credentials)
  }

  stop(): void {
    this.intentionalStop = true
    const child = this.child
    this.child = null
    this.port = null
    this.state = 'stopped'
    this.error = null
    this.emit()
    if (child && !child.killed) {
      try {
        child.kill()
      } catch {
        // already gone
      }
    }
  }

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    extraHeaders?: Record<string, string>
  ): Promise<T> {
    if (this.state === 'starting' && this.pending) {
      try {
        await this.pending
      } catch {
        // the pending rejection already carries the reason
      }
    }
    if (this.state !== 'ready' || this.port === null) {
      throw new Error(this.error ?? 'Ядро ещё запускается')
    }
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.token}`,
      Accept: 'application/json'
    }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    if (extraHeaders) Object.assign(headers, extraHeaders)

    let response: Response
    try {
      response = await fetch(`http://127.0.0.1:${this.port}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (message.includes('timeout') || message.includes('aborted')) {
        throw new Error('Ядро не ответило вовремя')
      }
      throw new Error('Нет связи с ядром SoFy')
    }

    if (!response.ok) {
      throw new Error(await this.readError(response))
    }
    try {
      return (await response.json()) as T
    } catch {
      throw new Error('Некорректный ответ ядра')
    }
  }

  private async readError(response: Response): Promise<string> {
    try {
      const data = (await response.json()) as { error?: unknown }
      if (typeof data.error === 'string' && data.error.trim()) return data.error
    } catch {
      // not JSON
    }
    if (response.status === 401) return 'Ядро отклонило запрос'
    if (response.status === 429) return 'Слишком много запросов. Подождите пару секунд.'
    return `Ядро вернуло ошибку ${response.status}`
  }

  private spawnCore(): Promise<CoreStatus> {
    if (!existsSync(this.jarPath)) {
      return this.fail(`Ядро не найдено: ${this.jarPath}. Соберите его командой npm run core:jar`)
    }
    this.state = 'starting'
    this.error = null
    this.port = null
    this.emit()

    this.token = randomBytes(48).toString('base64url')
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      SOFY_TOKEN: this.token,
      SOFY_DATA_DIR: this.dataDir
    }
    if (this.credentials.soundcloud) env.SOFY_SOUNDCLOUD_CLIENT_ID = this.credentials.soundcloud
    if (this.credentials.yandex) env.SOFY_YANDEX_TOKEN = this.credentials.yandex

    let child: ChildProcessWithoutNullStreams
    try {
      child = spawn(
        this.javaPath,
        ['-XX:+UseSerialGC', '-Xms64m', '-Xmx640m', '-jar', this.jarPath],
        { env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true }
      )
    } catch (error) {
      return this.fail(error instanceof Error ? error.message : 'Не удалось запустить Java')
    }
    this.child = child
    child.stdin.on('error', () => {})
    child.stdin.end()
    this.stdoutBuffer = ''
    this.stderrTail = ''

    return new Promise<CoreStatus>((resolve, reject) => {
      let settled = false
      const finish = (error?: Error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (error) {
          this.error = error.message
          this.state = 'error'
          this.emit()
          reject(error)
        } else {
          resolve(this.status())
        }
      }
      const timer = setTimeout(() => {
        finish(new Error('Ядро не ответило за 45 секунд. Проверьте логи Java.'))
        try {
          child.kill()
        } catch {
          // ignore
        }
      }, READY_TIMEOUT_MS)

      child.stdout.setEncoding('utf8')
      child.stdout.on('data', (chunk: string) => {
        if (this.child !== child) return
        this.stdoutBuffer += chunk
        let newline = this.stdoutBuffer.indexOf('\n')
        while (newline >= 0) {
          const line = this.stdoutBuffer.slice(0, newline).trim()
          this.stdoutBuffer = this.stdoutBuffer.slice(newline + 1)
          if (line) this.handleStdoutLine(line, finish)
          newline = this.stdoutBuffer.indexOf('\n')
        }
      })

      child.stderr.setEncoding('utf8')
      child.stderr.on('data', (chunk: string) => {
        if (this.child !== child) return
        this.stderrTail = (this.stderrTail + chunk).slice(-6000)
        if (process.env.SOFY_DEBUG) process.stderr.write(`[core] ${chunk}`)
      })

      child.once('error', (error) => {
        if (this.child !== child) return
        finish(new Error(`Java недоступна: ${error.message}`))
      })

      child.once('exit', (code, signal) => {
        if (this.child !== child) {
          // A newer core replaced this process (manual restart): settle quietly.
          if (!settled) {
            settled = true
            clearTimeout(timer)
            reject(new Error('Ядро остановлено'))
          }
          return
        }
        this.child = null
        this.port = null
        const stopped = this.intentionalStop
        if (stopped) {
          this.state = 'stopped'
          this.emit()
          finish(settled ? undefined : new Error('Ядро остановлено'))
          return
        }
        const detail = this.lastErrorLine() ?? `Ядро остановилось (${code ?? signal ?? 'без кода'})`
        if (!settled) {
          finish(new Error(detail))
        } else {
          this.state = 'error'
          this.error = detail
          this.emit()
        }
        this.scheduleRestart()
      })
    })
  }

  private handleStdoutLine(line: string, finish: (error?: Error) => void): void {
    const match = /^SOFY_READY\s+(\d{2,5})$/.exec(line)
    if (match) {
      this.port = Number(match[1])
      this.state = 'ready'
      this.error = null
      this.restarts = 0
      this.emit()
      finish()
      return
    }
    if (process.env.SOFY_DEBUG) console.log(`[core] ${line}`)
  }

  private lastErrorLine(): string | null {
    const lines = this.stderrTail
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    if (lines.length === 0) return null
    const meaningful = [...lines].reverse().find((line) => !line.startsWith('at '))
    return meaningful ? meaningful.slice(0, 400) : null
  }

  private scheduleRestart(): void {
    if (this.manualRestart) return
    if (this.restarts >= MAX_AUTO_RESTARTS) return
    this.restarts += 1
    const delay = 1200 * this.restarts
    setTimeout(() => {
      if (this.intentionalStop) return
      void this.start(this.credentials).catch(() => {
        // onStatus already carries the failure
      })
    }, delay)
  }

  private fail(message: string): Promise<CoreStatus> {
    this.state = 'error'
    this.error = message
    this.port = null
    this.emit()
    return Promise.reject(new Error(message))
  }

  private emit(): void {
    this.onStatus(this.status())
  }
}
