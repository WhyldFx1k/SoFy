import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * Session tokens stay in the main process. They are persisted only when the OS
 * can encrypt them (DPAPI on Windows), never written as plain text.
 */
export class AccountSession {
  private readonly file: string
  private loaded = false
  private token: string | null = null

  constructor() {
    this.file = join(app.getPath('userData'), 'account-session.bin')
  }

  get(): string | null {
    if (this.loaded) return this.token
    this.loaded = true
    try {
      if (!existsSync(this.file) || !safeStorage.isEncryptionAvailable()) return null
      const value = safeStorage.decryptString(readFileSync(this.file)).trim()
      this.token = value.length > 0 ? value : null
    } catch {
      this.token = null
    }
    return this.token
  }

  set(token: string): void {
    this.loaded = true
    this.token = token
    if (!safeStorage.isEncryptionAvailable()) return
    try {
      writeFileSync(this.file, safeStorage.encryptString(token), { mode: 0o600 })
    } catch {
      // keep the session in memory for this run
    }
  }

  clear(): void {
    this.loaded = true
    this.token = null
    try {
      unlinkSync(this.file)
    } catch {
      // already gone
    }
  }
}
