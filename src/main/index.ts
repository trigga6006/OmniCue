import { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { registerIpcHandlers } from './ipc'
import { startServer } from './server'
import { startScheduler } from './scheduler'
import { overlayState } from './overlayState'
import { settingsStore } from './store'
import icon from '../../resources/icon.png?asset'
import trayIconPath from '../../resources/tray-icon.png?asset'

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null

// Default small window dimensions
const DEFAULT_WIDTH = 800
const DEFAULT_HEIGHT = 500

function createWindow(): void {
  // Load saved bar position (screen coordinates) or default to primary center
  const settings = settingsStore.get() as Record<string, unknown>
  const primary = screen.getPrimaryDisplay()
  let barX = primary.bounds.x + Math.round(primary.bounds.width / 2)
  let barY = primary.bounds.y + 32

  if (
    settings.barPosX != null &&
    settings.barPosY != null &&
    typeof settings.barPosX === 'number' &&
    typeof settings.barPosY === 'number'
  ) {
    // Validate saved position is on some display
    const onScreen = screen.getAllDisplays().some((d) => {
      const b = d.bounds
      return (
        settings.barPosX as number >= b.x &&
        settings.barPosX as number <= b.x + b.width &&
        settings.barPosY as number >= b.y &&
        settings.barPosY as number <= b.y + b.height
      )
    })
    if (onScreen) {
      barX = settings.barPosX as number
      barY = settings.barPosY as number
    }
  }

  const winX = Math.round(barX - DEFAULT_WIDTH / 2)
  const winY = barY - 10

  mainWindow = new BrowserWindow({
    width: DEFAULT_WIDTH,
    height: DEFAULT_HEIGHT,
    x: winX,
    y: winY,
    transparent: true,
    frame: false,
    backgroundColor: '#00000000',
    alwaysOnTop: true,
    resizable: false,
    skipTaskbar: true,
    hasShadow: false,
    fullscreenable: false,
    focusable: true,
    type: process.platform === 'darwin' ? 'panel' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  mainWindow.setIgnoreMouseEvents(true)

  if (process.platform === 'darwin') {
    mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  }

  mainWindow.setAlwaysOnTop(true, 'screen-saver')

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

function openSettingsWindow(tab?: string): void {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    settingsWindow.focus()
    if (tab) {
      settingsWindow.webContents.send('switch-tab', tab)
    }
    return
  }

  settingsWindow = new BrowserWindow({
    width: 580,
    height: 460,
    minWidth: 480,
    minHeight: 380,
    icon,
    frame: false,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#1a1a1a',
    resizable: true,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  settingsWindow.on('ready-to-show', () => {
    settingsWindow?.show()
  })

  settingsWindow.on('closed', () => {
    settingsWindow = null
  })

  const hash = tab ? `#/settings-window?tab=${tab}` : '#/settings-window'

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    settingsWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}${hash}`)
  } else {
    settingsWindow.loadFile(join(__dirname, '../renderer/index.html'), {
      hash: hash.slice(1)
    })
  }
}

function createTray(): void {
  console.log('Tray icon path:', trayIconPath)
  const img = nativeImage.createFromPath(trayIconPath)
  console.log('Tray icon isEmpty:', img.isEmpty(), 'size:', img.getSize())
  const trayIcon = img.isEmpty() ? nativeImage.createFromPath(icon) : img
  const resized = trayIcon.resize({ width: 16, height: 16 })
  console.log('Resized isEmpty:', resized.isEmpty())
  tray = new Tray(resized)
  tray.setToolTip('OmniCue Timer')

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Show/Hide',
      click: (): void => {
        if (mainWindow) {
          mainWindow.isVisible() ? mainWindow.hide() : mainWindow.show()
        }
      }
    },
    { label: 'Settings', click: (): void => openSettingsWindow('settings') },
    { type: 'separator' },
    { label: 'Quit', click: (): void => app.quit() }
  ])

  tray.setContextMenu(contextMenu)
}

/**
 * Lightweight cursor-position polling that replaces the expensive
 * `setIgnoreMouseEvents(true, { forward: true })` Chromium mouse hook.
 *
 * With the small-window architecture, we just check if the cursor is
 * within the window bounds (plus a small padding). When it enters,
 * we switch to capture mode so the renderer gets normal mouse events
 * (and handles leave-detection itself).
 */
function startCursorPolling(win: BrowserWindow): void {
  const POLL_MS = 32 // ~30 fps
  const PAD = 10 // px padding around window
  const COOLDOWN_MS = 200 // minimum time between ignore→capture transitions

  setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return
    if (!overlayState.isIgnoring) return // renderer handles leave detection
    if (overlayState.locked) return // drag in progress
    if (Date.now() - overlayState.lastIgnoreTime < COOLDOWN_MS) return

    // Don't steal focus from other app windows (e.g. settings window)
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && focused !== win) return

    const cursor = screen.getCursorScreenPoint()
    const b = win.getBounds()

    if (
      cursor.x >= b.x - PAD &&
      cursor.x <= b.x + b.width + PAD &&
      cursor.y >= b.y - PAD &&
      cursor.y <= b.y + b.height + PAD
    ) {
      overlayState.isIgnoring = false
      win.setIgnoreMouseEvents(false)
    }
  }, POLL_MS)
}

// Allow audio to play without user gesture (for timer chime)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

app.whenReady().then(() => {
  registerIpcHandlers()

  ipcMain.on('open-settings-window', (_event, tab?: string) => {
    openSettingsWindow(tab)
  })

  ipcMain.on('send-test-alert', () => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('new-notification', {
        id: Math.random().toString(36).substring(2, 9),
        message: 'This is a test full-screen alert',
        title: 'Alarm',
        timeout: 30,
        createdAt: Date.now(),
      })
    }
  })

  createWindow()

  // Start HTTP API server for CLI / Claude Code integration
  if (mainWindow) {
    startServer(mainWindow)
    startCursorPolling(mainWindow)
  }
  // Start background scheduler for alarms and reminders
  startScheduler(() => mainWindow)
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
