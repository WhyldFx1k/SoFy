import { app, safeStorage } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

interface SecretFile {
  version: 1
  encrypted: boolean
  items: Record<string, string>
}

type ProviderKey = 'soundcloud' | 'yandex'

const ALLOWED: readonly ProviderKey[] = ['soundcloud', 'yandex']

/**
 * Optional provider credentials surviving from earlier versions are kept out of
 * SQLite: encrypted with Electron safeStorage (DPAPI on Windows) and handed to
 * the core through environment variables at launch, never through the UI.
 */
export class SecretStore {
  private readonly file: string
  private cache: SecretFile | null = null

  constructor() {
    this.file = join(app.getPath('userData'), 'secrets.json')
  }

  get(provider: ProviderKey): string | null {
    const data = this.load()
    const stored = data.items[provider]
    if (!stored) return null
    if (!data.encrypted) return stored
    try {
      return safeStorage.decryptString(Buffer.from(stored, 'base64'))
    } catch {
      return null
    }
  }

  private load(): SecretFile {
    if (this.cache) return { ...this.cache, items: { ...this.cache.items } }
    let data: SecretFile = { version: 1, encrypted: true, items: {} }
    try {
      if (existsSync(this.file)) {
        const parsed = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SecretFile>
        if (parsed && parsed.version === 1 && parsed.items && typeof parsed.items === 'object') {
          data = {
            version: 1,
            encrypted: parsed.encrypted !== false,
            items: Object.fromEntries(
              Object.entries(parsed.items).filter(
                ([key, value]) => ALLOWED.includes(key as ProviderKey) && typeof value === 'string'
              )
            )
          }
        }
      }
    } catch {
      data = { version: 1, encrypted: true, items: {} }
    }
    this.cache = data
    return { ...data, items: { ...data.items } }
  }
}
