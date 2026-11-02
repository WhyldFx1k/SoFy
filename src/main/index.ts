import { app, BrowserWindow, Menu, session, shell } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { registerBridge } from './bridge'
import { CoreController } from './core'
import { createOnlineAccounts } from './onlineAccounts'
import { DiscordPresence } from './presence'
import { SecretStore } from './secrets'
import type { WindowState } from '../shared/types'

let mainWindow: BrowserWindow | null = null
let core: CoreController | null = null
let secrets: SecretStore | null = null
let presence: DiscordPresence | null = null

app.enableSandbox()
app.setAppUserModelId('ru.sofy.player')

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  bootstrap()
}

function bootstrap(): void {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
  })

  app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event) => event.preventDefault())
  })

  app.whenReady().then(() => {
    Menu.setApplicationMenu(null)
    const defaultSession = session.defaultSession
    defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false))
    defaultSession.setPermissionCheckHandler(() => false)
    defaultSession.setSpellCheckerEnabled(false)

    secrets = new SecretStore()
    core = new CoreController()
    presence = new DiscordPresence()
    core.onStatus = (status) => sendEvent('core-status', status)

    registerBridge({ core, secrets, online: createOnlineAccounts(), presence })
    createWindow()

    void core
      .start({ soundcloud: secrets.get('soundcloud'), yandex: secrets.get('yandex') })
      .catch((error: unknown) => {
        console.error('[sofy] core start failed:', error)
      })

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    app.quit()
  })

  app.on('before-quit', () => {
    core?.stop()
    void presence?.destroy()
  })
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1120,
    minHeight: 680,
    show: false,
    frame: false,
    backgroundColor: '#07070a',
    title: 'SoFy',
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      spellcheck: false,
      backgroundThrottling: false
    }
  })
  mainWindow = win
  win.setMenuBarVisibility(false)

  win.once('ready-to-show', () => {
    win.show()
    pushWindowState(win)
  })

  const push = (): void => pushWindowState(win)
  win.on('maximize', push)
  win.on('unmaximize', push)
  win.on('enter-full-screen', push)
  win.on('leave-full-screen', push)
  win.on('focus', push)
  win.on('blur', push)
  win.on('closed', () => {
    if (mainWindow === win) mainWindow = null
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  win.webContents.on('will-navigate', (event, url) => {
    if (!isAppUrl(url)) event.preventDefault()
  })

  const devUrl = process.env['ELECTRON_RENDERER_URL']
  if (!app.isPackaged && devUrl) {
    void win.loadURL(devUrl)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function pushWindowState(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  const state: WindowState = {
    maximized: win.isMaximized(),
    focused: win.isFocused(),
    fullscreen: win.isFullScreen()
  }
  win.webContents.send('sofy:event', { type: 'window-state', data: state })
}

function sendEvent(type: string, data: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('sofy:event', { type, data })
  }
}

function isAppUrl(url: string): boolean {
  try {
    const target = new URL(url)
    const devUrl = process.env['ELECTRON_RENDERER_URL']
    if (devUrl) {
      return target.origin === new URL(devUrl).origin
    }
    const appFile = new URL(pathToFileURL(join(__dirname, '../renderer/index.html')).href)
    return target.protocol === 'file:' && target.pathname === appFile.pathname
  } catch {
    return false
  }
}
