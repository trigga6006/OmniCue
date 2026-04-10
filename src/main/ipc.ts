import { ipcMain, BrowserWindow, app, screen, desktopCapturer, shell, dialog, clipboard } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { exec, execSync } from 'child_process'
import { settingsStore, historyStore, alarmsStore, remindersStore, watchersStore, type Watcher } from './store'
import { overlayState } from './overlayState'
import { streamAiResponse, cleanupSession, type ChatMessage } from './ai'
import { resolveProjectCwd } from './resolveProjectCwd'
import { resolvePendingRequest, cancelPendingRequestsForSession } from './agent-interactions'
import { extractTextFromScreenshot } from './ocr'
import { getCodexStatus } from './codex-auth'
import { getClaudeStatus } from './claude-auth'
import { getActiveWindowCached } from './activeWindow'

const activeStreams = new Map<string, AbortController>()

// Safe OS commands accessible to the agent — restricted allowlist
function openSystemSettings(win32: string, darwin: string): void {
  if (process.platform === 'win32') exec(`start ${win32}`)
  else if (process.platform === 'darwin') exec(`open ${darwin}`)
}

const SYSTEM_COMMANDS: Record<string, () => void> = {
  bluetooth: () => openSystemSettings('ms-settings:bluetooth', '/System/Library/PreferencePanes/Bluetooth.prefPane'),
  wifi: () => openSystemSettings('ms-settings:network-wifi', '/System/Library/PreferencePanes/Network.prefPane'),
  display: () => openSystemSettings('ms-settings:display', '/System/Library/PreferencePanes/Displays.prefPane'),
  sound: () => openSystemSettings('ms-settings:sound', '/System/Library/PreferencePanes/Sound.prefPane'),
  downloads: () => shell.openPath(path.join(os.homedir(), 'Downloads')),
}

const MARKER_START = '<!-- OmniCue:start -->'
const MARKER_END = '<!-- OmniCue:end -->'

function claudeMdPath(): string {
  return path.join(os.homedir(), '.claude', 'CLAUDE.md')
}

function codexMdPath(): string {
  return path.join(os.homedir(), '.codex', 'instructions.md')
}

function omniCueBinPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin', 'omniox.js')
    : path.join(app.getAppPath(), 'bin', 'omniox.js')
}

function buildCodexBlock(): string {
  const bin = omniCueBinPath().replace(/\\/g, '/')
  return [
    '',
    MARKER_START,
    '## OmniCue Desktop Notifications',
    '',
    'You have OmniCue installed â€” a desktop overlay timer app. When you complete',
    'any significant task (especially longer ones where the user may have stepped',
    'away), proactively send a notification to the overlay using this command:',
    '',
    '```bash',
    `node "${bin}" notify "Your 5-10 word summary" --title "Codex"`,
    '```',
    '',
    'Guidelines:',
    '- Trigger after completing multi-step tasks, builds, tests, or implementations',
    '- Keep messages to 5â€“10 words â€” specific and concrete, not vague',
    '- Good: "All tests pass, PR ready for review"',
    '- Good: "Build failed â€” check src/api/auth.ts line 42"',
    '- If OmniCue is not running the command exits silently â€” no error handling needed',
    MARKER_END,
    ''
  ].join('\n')
}

function buildBlock(): string {
  const bin = omniCueBinPath().replace(/\\/g, '/')
  return [
    '',
    MARKER_START,
    '## OmniCue Desktop Notifications',
    '',
    'You have OmniCue installed â€” a desktop overlay timer app. When you complete',
    'any significant task (especially longer ones where the user may have stepped',
    'away), proactively send a notification to the overlay using this command:',
    '',
    '```bash',
    `node "${bin}" notify "Your 5-10 word summary" --title "Claude"`,
    '```',
    '',
    'Guidelines:',
    '- Trigger after completing multi-step tasks, builds, tests, or implementations',
    '- Keep messages to 5â€“10 words â€” specific and concrete, not vague',
    '- Good: "All tests pass, PR ready for review"',
    '- Good: "Build failed â€” check src/api/auth.ts line 42"',
    '- If OmniCue is not running the command exits silently â€” no error handling needed',
    MARKER_END,
    ''
  ].join('\n')
}

export function registerIpcHandlers(): void {
  ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.setIgnoreMouseEvents(ignore)
      overlayState.isIgnoring = ignore
      if (ignore) overlayState.lastIgnoreTime = Date.now()
    }
  })

  ipcMain.on('set-interactive-lock', (_event, locked: boolean) => {
    overlayState.locked = locked
  })

  ipcMain.on('set-panel-open', (_event, open: boolean) => {
    overlayState.panelOpen = open
  })

  // Legacy alias — delegates to os:open-url
  ipcMain.handle('open-external-url', async (_event, url: string): Promise<boolean> => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        await shell.openExternal(url)
        return true
      }
    } catch { /* invalid URL */ }
    return false
  })

  // --- Window movement/resize handlers for small-window architecture ---

  ipcMain.on('move-window-by', (event, delta: { dx: number; dy: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const b = win.getBounds()
    win.setBounds({ x: b.x + delta.dx, y: b.y + delta.dy, width: b.width, height: b.height })
  })

  ipcMain.on('request-window-resize', (event, size: { width: number; height: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const b = win.getBounds()
    // Keep top-center stable during resize
    const newX = Math.round(b.x + (b.width - size.width) / 2)
    win.setBounds({ x: newX, y: b.y, width: size.width, height: size.height })
  })

  ipcMain.on('set-window-bounds', (event, bounds: { x: number; y: number; width: number; height: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    win.setBounds(bounds)
  })

  ipcMain.handle('get-window-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return { x: 0, y: 0, width: 400, height: 500 }
    return win.getBounds()
  })

  ipcMain.handle('get-settings', () => {
    return settingsStore.get()
  })

  ipcMain.handle('select-folder', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    if (result.canceled || result.filePaths.length === 0) return null
    return result.filePaths[0]
  })

  ipcMain.handle('set-settings', (_event, partial: Record<string, unknown>) => {
    settingsStore.set(partial)
  })

  ipcMain.handle('get-history', () => {
    return historyStore.getEntries()
  })

  ipcMain.handle(
    'add-history',
    (
      _event,
      entry: { id: string; name: string; duration: number; completedAt: string; type?: string }
    ) => {
      historyStore.addEntry(entry as Parameters<typeof historyStore.addEntry>[0])
    }
  )

  ipcMain.handle('clear-history', () => {
    historyStore.clear()
  })

  ipcMain.handle('set-auto-launch', (_event, enabled: boolean) => {
    app.setLoginItemSettings({ openAtLogin: enabled, openAsHidden: true })
    settingsStore.set({ autoLaunch: enabled })
  })

  ipcMain.handle('get-displays', () => {
    const displays = screen.getAllDisplays()
    return displays.map((d, i) => ({
      id: d.id,
      label: `Display ${i + 1}${d.id === screen.getPrimaryDisplay().id ? ' (Primary)' : ''}`,
      centerX: d.bounds.x + Math.round(d.bounds.width / 2),
      centerY: d.bounds.y + 32
    }))
  })

  ipcMain.handle('get-primary-center', () => {
    const primary = screen.getPrimaryDisplay()
    return {
      x: primary.bounds.x + Math.round(primary.bounds.width / 2),
      y: primary.bounds.y + 32
    }
  })

  ipcMain.handle('get-primary-display-bounds', () => {
    const primary = screen.getPrimaryDisplay()
    return primary.bounds
  })

  ipcMain.handle('check-claude-integration', (): boolean => {
    try {
      const content = fs.readFileSync(claudeMdPath(), 'utf-8')
      return content.includes(MARKER_START)
    } catch {
      return false
    }
  })

  ipcMain.handle('install-claude-integration', (): { ok: boolean; error?: string } => {
    try {
      const claudeDir = path.join(os.homedir(), '.claude')
      const mdPath = claudeMdPath()

      if (!fs.existsSync(claudeDir)) fs.mkdirSync(claudeDir, { recursive: true })

      let existing = ''
      try {
        existing = fs.readFileSync(mdPath, 'utf-8')
      } catch {
        /* new file */
      }

      if (existing.includes(MARKER_START)) return { ok: true }

      fs.writeFileSync(mdPath, existing + buildBlock(), 'utf-8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('get-alarms', () => alarmsStore.getAll())
  ipcMain.handle('set-alarm', (_event, alarm) => alarmsStore.set(alarm))
  ipcMain.handle('delete-alarm', (_event, id: string) => alarmsStore.delete(id))

  ipcMain.handle('get-reminders', () => remindersStore.getAll())
  ipcMain.handle('set-reminder', (_event, reminder) => remindersStore.set(reminder))
  ipcMain.handle('delete-reminder', (_event, id: string) => remindersStore.delete(id))

  ipcMain.handle('uninstall-claude-integration', (): { ok: boolean; error?: string } => {
    try {
      const mdPath = claudeMdPath()
      let content = ''
      try {
        content = fs.readFileSync(mdPath, 'utf-8')
      } catch {
        return { ok: true }
      }

      const cleaned = content.replace(
        /\n?<!-- OmniCue:start -->[\s\S]*?<!-- OmniCue:end -->\n?/g,
        ''
      )
      fs.writeFileSync(mdPath, cleaned, 'utf-8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('check-codex-integration', (): boolean => {
    try {
      const content = fs.readFileSync(codexMdPath(), 'utf-8')
      return content.includes(MARKER_START)
    } catch {
      return false
    }
  })

  ipcMain.handle('install-codex-integration', (): { ok: boolean; error?: string } => {
    try {
      const codexDir = path.join(os.homedir(), '.codex')
      const mdPath = codexMdPath()

      if (!fs.existsSync(codexDir)) fs.mkdirSync(codexDir, { recursive: true })

      let existing = ''
      try {
        existing = fs.readFileSync(mdPath, 'utf-8')
      } catch {
        /* new file */
      }

      if (existing.includes(MARKER_START)) return { ok: true }

      fs.writeFileSync(mdPath, existing + buildCodexBlock(), 'utf-8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('uninstall-codex-integration', (): { ok: boolean; error?: string } => {
    try {
      const mdPath = codexMdPath()
      let content = ''
      try {
        content = fs.readFileSync(mdPath, 'utf-8')
      } catch {
        return { ok: true }
      }

      const cleaned = content.replace(
        /\n?<!-- OmniCue:start -->[\s\S]*?<!-- OmniCue:end -->\n?/g,
        ''
      )
      fs.writeFileSync(mdPath, cleaned, 'utf-8')
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ─── Codex Auth ──────────────────────────────────────────────────────────────

  ipcMain.handle('get-codex-status', () => {
    return getCodexStatus()
  })

  ipcMain.handle('get-claude-status', () => {
    return getClaudeStatus()
  })

  // ─── AI Companion ────────────────────────────────────────────────────────────

  // Pending OCR results keyed by a simple counter
  const pendingOcr = new Map<number, Promise<{ ocrText: string; screenType: string; ocrDurationMs: number } | null>>()
  let ocrCounter = 0

  ipcMain.handle('capture-active-window', async (): Promise<{
    image: string
    title: string
    activeApp: string
    processName: string
    clipboardText: string
    ocrId: number
  } | null> => {
    try {
      // Get active window info (uses cache from hotkey handler if available)
      const winInfo = getActiveWindowCached()
      const clipText = clipboard.readText() || ''

      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 },
        fetchWindowIcons: false,
      })

      const primary = sources[0]
      if (!primary) return null

      const image = primary.thumbnail.toDataURL()
      const title = winInfo?.windowTitle || 'Desktop'
      const ocrId = ++ocrCounter

      // Fire OCR in background with real window title for better classification
      pendingOcr.set(
        ocrId,
        extractTextFromScreenshot(image, title)
          .then((r) => ({ ocrText: r.text, screenType: r.screenType, ocrDurationMs: r.durationMs }))
          .catch(() => null)
      )

      return {
        image,
        title,
        activeApp: winInfo?.activeApp || '',
        processName: winInfo?.processName || '',
        clipboardText: clipText,
        ocrId,
      }
    } catch {
      return null
    }
  })

  ipcMain.handle('get-ocr-result', async (_event, ocrId: number): Promise<{
    ocrText: string
    screenType: string
    ocrDurationMs: number
  } | null> => {
    const promise = pendingOcr.get(ocrId)
    if (!promise) return null
    const result = await promise
    pendingOcr.delete(ocrId)
    return result
  })

  ipcMain.handle(
    'ai:send-message',
    async (
      event,
      payload: { messages: unknown[]; sessionId: string; provider?: string }
    ): Promise<{ ok: boolean }> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { ok: false }

      const controller = new AbortController()
      activeStreams.set(payload.sessionId, controller)

      const settings = settingsStore.get()
      const cwd = resolveProjectCwd(
        payload.messages as ChatMessage[],
        settings.devRootPath || ''
      )

      streamAiResponse(
        payload.sessionId,
        payload.messages as ChatMessage[],
        {
          onToken: (token) => {
            if (!win.isDestroyed())
              win.webContents.send('ai:stream-token', {
                sessionId: payload.sessionId,
                token,
              })
          },
          onFinish: (fullText) => {
            activeStreams.delete(payload.sessionId)
            if (!win.isDestroyed())
              win.webContents.send('ai:stream-done', {
                sessionId: payload.sessionId,
                fullText,
              })
          },
          onError: (error) => {
            activeStreams.delete(payload.sessionId)
            if (!win.isDestroyed())
              win.webContents.send('ai:stream-error', {
                sessionId: payload.sessionId,
                error,
              })
          },
          onToolUse: (toolName, toolInput) => {
            if (!win.isDestroyed())
              win.webContents.send('ai:tool-use', {
                sessionId: payload.sessionId,
                toolName,
                toolInput,
              })
          },
          onInteractionRequest: (request) => {
            if (!win.isDestroyed())
              win.webContents.send('ai:interaction-request', request)
          },
        },
        controller.signal,
        undefined, // model — resolved by main process per provider
        payload.provider,
        cwd,
        settings.agentPermissions || 'read-only'
      ).catch((err) => {
        activeStreams.delete(payload.sessionId)
        if (!win.isDestroyed())
          win.webContents.send('ai:stream-error', {
            sessionId: payload.sessionId,
            error: String(err),
          })
      })

      return { ok: true }
    }
  )

  ipcMain.on('ai:abort', (_event, payload: { sessionId: string }) => {
    const controller = activeStreams.get(payload.sessionId)
    if (controller) {
      controller.abort()
      activeStreams.delete(payload.sessionId)
    }
  })

  ipcMain.on('ai:interaction-respond', (_event, payload: {
    interactionId: string
    kind: string
    selectedOptionId?: string
    answers?: Record<string, string[]>
  }) => {
    let selectedValue: unknown = payload.selectedOptionId
    if (typeof payload.selectedOptionId === 'string') {
      const trimmed = payload.selectedOptionId.trim()
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try {
          selectedValue = JSON.parse(trimmed)
        } catch {
          selectedValue = payload.selectedOptionId
        }
      }
    }

    // Build the response based on kind
    let result: unknown
    if (payload.kind === 'command-approval' || payload.kind === 'file-change-approval') {
      result = { decision: selectedValue || 'cancel' }
    } else if (payload.kind === 'user-input' || payload.kind === 'provider-elicitation') {
      result = {
        answers: Object.fromEntries(
          Object.entries(payload.answers || {}).map(([questionId, answers]) => [
            questionId,
            { answers },
          ])
        ),
      }
    } else {
      result = { decision: selectedValue || 'cancel' }
    }
    resolvePendingRequest(payload.interactionId, result)
  })

  ipcMain.on('ai:cleanup-session', (_event, payload: { sessionId: string }) => {
    cancelPendingRequestsForSession(payload.sessionId)
    activeStreams.delete(payload.sessionId)
    cleanupSession(payload.sessionId)
  })

  // ─── Clipboard ──────────────────────────────────────────────────────────────

  ipcMain.handle('clipboard:read-text', () => clipboard.readText())

  ipcMain.handle('clipboard:write-text', (_event, text: string) => {
    clipboard.writeText(text)
  })

  ipcMain.handle('clipboard:read-image', () => {
    const img = clipboard.readImage()
    if (img.isEmpty()) return null
    return img.toDataURL()
  })

  // ─── OS Actions ────────────────────────────────────────────────────────────

  ipcMain.handle('os:open-path', async (_event, filePath: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const result = await shell.openPath(filePath)
      if (result) return { ok: false, error: result }
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('os:show-in-folder', (_event, filePath: string) => {
    shell.showItemInFolder(filePath)
  })

  ipcMain.handle('os:open-url', async (_event, url: string): Promise<{ ok: boolean; error?: string }> => {
    try {
      const parsed = new URL(url)
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
        await shell.openExternal(url)
        return { ok: true }
      }
      return { ok: false, error: 'Only http/https URLs allowed' }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  ipcMain.handle('os:run-system-command', async (_event, command: string): Promise<{ ok: boolean; error?: string }> => {
    const handler = SYSTEM_COMMANDS[command]
    if (!handler) return { ok: false, error: `Unknown system command: ${command}. Available: ${Object.keys(SYSTEM_COMMANDS).join(', ')}` }
    try {
      handler()
      return { ok: true }
    } catch (e) {
      return { ok: false, error: (e as Error).message }
    }
  })

  // ─── File/Process Watchers ─────────────────────────────────────────────────

  const activeWatchers = new Map<string, { close: () => void }>()

  function completeWatcher(watcher: Watcher, win: BrowserWindow, detail?: string): void {
    activeWatchers.delete(watcher.id)
    watchersStore.complete(watcher.id)
    if (!win.isDestroyed()) {
      win.webContents.send('watcher:triggered', {
        id: watcher.id,
        label: watcher.label,
        type: watcher.type,
        target: watcher.target,
        detail,
      })
      // Also fire a desktop notification via the existing notification system
      win.webContents.send('new-notification', {
        id: `watcher-${watcher.id}`,
        title: 'Watcher',
        message: watcher.label,
        timeout: 8000,
        createdAt: Date.now(),
      })
    }
  }

  function startWatcher(watcher: Watcher, win: BrowserWindow): void {
    if (activeWatchers.has(watcher.id)) return

    switch (watcher.type) {
      case 'file-exists': {
        const interval = setInterval(() => {
          if (fs.existsSync(watcher.target)) {
            clearInterval(interval)
            completeWatcher(watcher, win)
          }
        }, 2000)
        activeWatchers.set(watcher.id, { close: () => clearInterval(interval) })
        break
      }

      case 'folder-change': {
        try {
          const fsWatcher = fs.watch(watcher.target, { persistent: false }, (eventType, filename) => {
            fsWatcher.close()
            completeWatcher(watcher, win, `${eventType}: ${filename || 'unknown'}`)
          })
          activeWatchers.set(watcher.id, { close: () => fsWatcher.close() })
        } catch {
          const interval = setInterval(() => {
            if (fs.existsSync(watcher.target)) {
              clearInterval(interval)
              completeWatcher(watcher, win)
            }
          }, 2000)
          activeWatchers.set(watcher.id, { close: () => clearInterval(interval) })
        }
        break
      }

      case 'process-exit': {
        const interval = setInterval(() => {
          try {
            if (process.platform === 'win32') {
              const output = execSync(`tasklist /FI "IMAGENAME eq ${watcher.target}" /NH`, { encoding: 'utf-8' })
              // tasklist returns "INFO: No tasks..." when process is missing (doesn't throw)
              if (output.includes('INFO:') || !output.includes(watcher.target)) {
                clearInterval(interval)
                completeWatcher(watcher, win)
              }
            } else {
              execSync(`pgrep -f "${watcher.target}"`, { encoding: 'utf-8' })
            }
          } catch {
            clearInterval(interval)
            completeWatcher(watcher, win)
          }
        }, 3000)
        activeWatchers.set(watcher.id, { close: () => clearInterval(interval) })
        break
      }
    }
  }

  ipcMain.handle('watcher:create', (event, watcher: Watcher) => {
    watchersStore.set(watcher)
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) startWatcher(watcher, win)
  })

  ipcMain.handle('watcher:list', () => watchersStore.getAll())

  ipcMain.handle('watcher:delete', (_event, id: string) => {
    const active = activeWatchers.get(id)
    if (active) {
      active.close()
      activeWatchers.delete(id)
    }
    watchersStore.delete(id)
  })

  // Resume any active watchers on startup
  ipcMain.handle('watcher:resume-all', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const watchers = watchersStore.getAll().filter((w) => w.status === 'active')
    for (const watcher of watchers) {
      startWatcher(watcher, win)
    }
  })

  // Clean up all active watchers (call on app quit or window destroy)
  app.on('will-quit', () => {
    for (const [id, handle] of activeWatchers) {
      handle.close()
      activeWatchers.delete(id)
    }
  })

  ipcMain.handle('sample-screen-brightness', async (): Promise<number> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 64, height: 36 },
      })
      if (sources.length === 0) return 128

      // Sample from the primary display source
      const primaryId = String(screen.getPrimaryDisplay().id)
      const source = sources.find((s) => s.display_id === primaryId) || sources[0]
      const thumbnail = source.thumbnail
      const bitmap = thumbnail.toBitmap()
      const size = thumbnail.getSize()

      // Sample the top 18% of the screen (where the overlay bar lives)
      const sampleRows = Math.max(1, Math.floor(size.height * 0.18))
      let total = 0
      let count = 0

      for (let y = 0; y < sampleRows; y++) {
        for (let x = 0; x < size.width; x += 3) {
          const idx = (y * size.width + x) * 4
          // Average of RGB channels (order-agnostic: works for both RGBA and BGRA)
          total += (bitmap[idx] + bitmap[idx + 1] + bitmap[idx + 2]) / 3
          count++
        }
      }

      return count > 0 ? Math.round(total / count) : 128
    } catch {
      return 128
    }
  })
}
