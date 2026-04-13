import { app, BrowserWindow, Tray, Menu, nativeImage, screen, ipcMain, globalShortcut } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import { fixPath } from './fixPath'
import { registerIpcHandlers } from './ipc'
import { startServer } from './server'
import { startScheduler } from './scheduler'
import { overlayState } from './overlayState'
import { settingsStore } from './store'
import { cleanupAllTempImages, activeChildPids, shutdownClaudeControlPlane } from './ai'
import { cacheActiveWindow, cleanupActiveWindowScript, getActiveWindowAsync } from './activeWindow'
import { cleanupActionScripts } from './actions'
import { recordFocus } from './context/focus-history'
import { pruneStale as pruneSessionMemory } from './session-memory/store'
import icon from '../../resources/icon.png?asset'
import trayIconPath from '../../resources/tray-icon.png?asset'

// Fix PATH before any child processes are spawned.
// Packaged Electron apps on Windows may inherit a stale PATH from Explorer
// that doesn't include directories like ~/.local/bin or %APPDATA%/npm.
fixPath()

let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let tray: Tray | null = null

// Default small window dimensions
const DEFAULT_WIDTH = 1000
const DEFAULT_HEIGHT = 700

function createWindow(): void {
  // Load saved bar position (screen coordinates) or default to primary center
  const settings = settingsStore.get() as unknown as Record<string, unknown>
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
 * Cursor-position polling — three-state mouse event system.
 *
 * States:
 *   IGNORE   – setIgnoreMouseEvents(true)                  – fully click-through, no events
 *   FORWARD  – setIgnoreMouseEvents(true, {forward:true})  – clicks pass through, mouse events forwarded
 *   CAPTURE  – setIgnoreMouseEvents(false)                 – window captures clicks (renderer sets this)
 *
 * The polling loop only transitions IGNORE → FORWARD when the cursor enters
 * the window zone. The renderer then does precise data-interactive hit-testing
 * and transitions FORWARD ↔ CAPTURE. When the cursor leaves all interactive
 * elements, the renderer goes back to FORWARD. When the cursor leaves the
 * window entirely, the renderer goes back to IGNORE.
 *
 * This ensures clicks are ONLY blocked when the cursor is directly over a
 * visible, interactive UI element — never over transparent areas.
 */
function startCursorPolling(win: BrowserWindow): void {
  const POLL_MS = 32 // ~30 fps
  const ENTRY_PAD = 12
  const COOLDOWN_MS = 200 // minimum time between ignore→forward transitions
  // Only check the narrow bar region when panels are closed.
  const EXIT_PAD = 28
  // Extra inward padding for "exit zone" — the cursor must move further
  // OUT than the distance required to trigger entry. This prevents
  // boundary-jitter when the cursor sits right at the edge.
  const isInRegions = (
    cursor: Electron.Point,
    windowBounds: Electron.Rectangle,
    pad: number
  ): boolean =>
    overlayState.interactiveRegions.some((region) =>
      cursor.x >= windowBounds.x + region.x - pad &&
      cursor.x <= windowBounds.x + region.x + region.width + pad &&
      cursor.y >= windowBounds.y + region.y - pad &&
      cursor.y <= windowBounds.y + region.y + region.height + pad
    )

  setInterval(() => {
    if (win.isDestroyed() || !win.isVisible()) return
    if (overlayState.locked) return // drag in progress

    // Don't steal focus from other app windows (e.g. settings window)
    const focused = BrowserWindow.getFocusedWindow()
    if (focused && focused !== win) return

    const cursor = screen.getCursorScreenPoint()
    const bounds = win.getBounds()
    if (overlayState.interactiveRegions.length === 0) {
      if (overlayState.isForwarding || !overlayState.isIgnoring) {
        overlayState.isIgnoring = true
        overlayState.isForwarding = false
        overlayState.lastIgnoreTime = Date.now()
        win.setIgnoreMouseEvents(true)
      }
      return
    }

    // Entry zone — slightly padded around the window
    const inEntryZone = isInRegions(cursor, bounds, ENTRY_PAD)

    // Exit zone — wider margin so cursor must move further out before
    // we disable forwarding. This creates hysteresis at the boundary.
    const inExitZone = isInRegions(cursor, bounds, EXIT_PAD)

    if (inEntryZone) {
      // Cursor is in the window zone — ensure forwarding is active so the
      // renderer receives mouse events for hit-testing (clicks still pass through).
      if (overlayState.isIgnoring && !overlayState.isForwarding) {
        if (Date.now() - overlayState.lastIgnoreTime < COOLDOWN_MS) return
        overlayState.isIgnoring = true
        overlayState.isForwarding = true
        win.setIgnoreMouseEvents(true, { forward: true })
      }
    } else if (!inExitZone) {
      // Cursor is well outside the zone — go fully click-through.
      // We only do this when outside the wider exit zone (hysteresis).
      if (overlayState.isForwarding || !overlayState.isIgnoring) {
        overlayState.isIgnoring = true
        overlayState.isForwarding = false
        overlayState.lastIgnoreTime = Date.now()
        win.setIgnoreMouseEvents(true)
      }
    }
    // If cursor is between entry and exit zones, maintain current state
    // (no toggling — this is the hysteresis band).
  }, POLL_MS)
}

// Allow audio to play without user gesture (for timer chime)
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required')

// ── Single-instance lock ──────────────────────────────────────────────────
// Prevent duplicate overlay windows when the installed app is launched again
// while already running in the tray.
const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  // Another instance is already running — quit immediately
  app.quit()
} else {
  app.on('second-instance', () => {
    // Focus the existing overlay when a second launch is attempted
    if (mainWindow && !mainWindow.isDestroyed()) {
      if (!mainWindow.isVisible()) mainWindow.show()
      mainWindow.focus()
    }
  })
}

app.whenReady().then(() => {
  // Prune stale session memory on startup
  try { pruneSessionMemory() } catch { /* best-effort */ }

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

  // Register global hotkey for AI companion (dynamic — reads from settings)
  let lastHotkeyTime = 0
  const HOTKEY_COOLDOWN_MS = 400
  let currentHotkey: string | null = null

  function companionHotkeyCallback(): void {
    const now = Date.now()
    if (now - lastHotkeyTime < HOTKEY_COOLDOWN_MS) return
    lastHotkeyTime = now

    cacheActiveWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      const isOpening = !overlayState.panelOpen
      mainWindow.webContents.send('toggle-companion')
      if (!mainWindow.isVisible()) mainWindow.show()
      // Use forward mode so clicks pass through until cursor reaches interactive UI
      mainWindow.setIgnoreMouseEvents(true, { forward: true })
      overlayState.isIgnoring = true
      overlayState.isForwarding = true
      // Focus the window when opening so the input textarea receives keyboard focus
      if (isOpening) mainWindow.focus()
    }
  }

  function registerCompanionHotkey(accelerator: string): boolean {
    if (currentHotkey) {
      globalShortcut.unregister(currentHotkey)
      currentHotkey = null
    }
    const ok = globalShortcut.register(accelerator, companionHotkeyCallback)
    if (ok) currentHotkey = accelerator
    return ok
  }

  const savedHotkey = settingsStore.get().companionHotkey || 'Ctrl+Shift+Space'
  registerCompanionHotkey(savedHotkey)

  // Allow renderer to re-register the companion hotkey at runtime
  ipcMain.handle('update-companion-hotkey', (_event, accelerator: string) => {
    const ok = registerCompanionHotkey(accelerator)
    if (ok) {
      settingsStore.set({ companionHotkey: accelerator })
    }
    return ok
  })

  // Start HTTP API server for CLI / Claude Code integration
  if (mainWindow) {
    startServer(mainWindow)
    startCursorPolling(mainWindow)
  }

  setInterval(() => {
    void getActiveWindowAsync().then((info) => recordFocus(info))
  }, 3000)

  // Start background scheduler for alarms and reminders
  startScheduler(() => mainWindow)
  createTray()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  cleanupAllTempImages().catch(() => {})
  cleanupActiveWindowScript()
  cleanupActionScripts()
  // Shut down Claude Code ControlPlane (kills active runs, stops permission server)
  shutdownClaudeControlPlane()
  // Kill any surviving CLI child processes to prevent orphans
  for (const pid of activeChildPids) {
    try {
      if (process.platform === 'win32') {
        require('child_process').spawn('taskkill', ['/T', '/F', '/PID', String(pid)], {
          windowsHide: true, stdio: 'ignore',
        })
      } else {
        process.kill(pid)
      }
    } catch { /* process already exited */ }
  }
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})
