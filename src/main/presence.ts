import { Client } from '@xhayper/discord-rpc'
import type { DiscordPresenceState } from '../shared/types'

// Name and avatar of the activity come from this application in the Discord
// Developer Portal. The icon is fetched at runtime, so rebranding the app is
// enough — no code change or release is needed.
const DEFAULT_APP_ID = '1566181840815923391'
export const DISCORD_APP_ID = process.env['SOFY_DISCORD_APP_ID']?.trim() || DEFAULT_APP_ID

const KNOWN_ICONS: Record<string, string> = {
  '1566181840815923391':
    'https://cdn.discordapp.com/app-icons/1566181840815923391/102deb70ce905d22771422f676a0e356.png'
}

const RECONNECT_DELAY = 5000

let cachedIconUrl: string | null | undefined

async function appIconUrl(appId: string): Promise<string | null> {
  if (cachedIconUrl !== undefined) return cachedIconUrl
  try {
    const response = await fetch(`https://discord.com/api/v10/applications/${appId}/rpc`, {
      signal: AbortSignal.timeout(5000)
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const data = (await response.json()) as { icon?: string }
    cachedIconUrl = data.icon
      ? `https://cdn.discordapp.com/app-icons/${appId}/${data.icon}.png`
      : (KNOWN_ICONS[appId] ?? null)
  } catch {
    cachedIconUrl = KNOWN_ICONS[appId] ?? null
  }
  return cachedIconUrl
}

function clip(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max - 1).trimEnd()}…`
}

export class DiscordPresence {
  private client: Client | null = null
  private connecting = false
  private pending: DiscordPresenceState | null = null
  private retryTimer: NodeJS.Timeout | null = null
  private stopped = false

  update(state: DiscordPresenceState | null): void {
    this.pending = state
    if (state && !this.client) {
      if (!this.connecting) void this.connect()
      return
    }
    void this.apply(state)
  }

  private async connect(): Promise<void> {
    if (this.stopped || this.client || this.connecting || !DISCORD_APP_ID) return
    this.connecting = true
    const client = new Client({ clientId: DISCORD_APP_ID })
    try {
      await client.login()
    } catch {
      this.connecting = false
      this.scheduleReconnect()
      return
    }
    this.connecting = false
    if (this.stopped) {
      void client.destroy().catch(() => undefined)
      return
    }
    this.client = client
    client.on('disconnected', () => {
      if (this.client !== client) return
      this.client = null
      this.scheduleReconnect()
    })
    if (this.pending) await this.apply(this.pending)
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      if (this.pending) void this.connect()
    }, RECONNECT_DELAY)
    this.retryTimer.unref()
  }

  private async apply(state: DiscordPresenceState | null): Promise<void> {
    const user = this.client?.user
    if (!user) return
    try {
      if (!state) {
        await user.clearActivity()
        return
      }
      const now = Date.now()
      const artwork = state.artwork && /^https:\/\//i.test(state.artwork) ? state.artwork : null
      const icon = await appIconUrl(DISCORD_APP_ID)
      const largeImage = artwork ?? icon
      await user.setActivity({
        type: 2,
        details: clip(state.title, 128),
        state: clip(state.artist, 128),
        startTimestamp: state.playing ? new Date(now - state.position * 1000) : undefined,
        endTimestamp:
          state.playing && state.duration > state.position + 1
            ? new Date(now + (state.duration - state.position) * 1000)
            : undefined,
        largeImageKey: largeImage ?? undefined,
        largeImageText: artwork && icon ? 'SoFy' : undefined,
        smallImageKey: artwork && icon ? icon : undefined,
        smallImageText: artwork && icon ? 'SoFy' : undefined
      })
    } catch {
      // Discord can reject malformed payloads or time out; presence is optional
    }
  }

  async destroy(): Promise<void> {
    this.stopped = true
    this.pending = null
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    const client = this.client
    this.client = null
    if (!client) return
    try {
      await client.destroy()
    } catch {
      // ignore
    }
  }
}
