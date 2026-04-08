import { ipcMain, BrowserWindow, app, screen, desktopCapturer } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { settingsStore, historyStore, alarmsStore, remindersStore } from './store'
import { overlayState } from './overlayState'
import { streamAiResponse } from './ai'
import type { CoreMessage } from 'ai'

const activeStreams = new Map<string, AbortController>()

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

  // ─── AI Companion ────────────────────────────────────────────────────────────

  ipcMain.handle('capture-active-window', async (): Promise<{ image: string; title: string } | null> => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1280, height: 720 },
        fetchWindowIcons: false,
      })

      const ownIds = new Set(BrowserWindow.getAllWindows().map((w) => w.getMediaSourceId()))
      const active = sources.find((s) => !ownIds.has(s.id))
      if (!active) return null

      return {
        image: active.thumbnail.toDataURL(),
        title: active.name,
      }
    } catch {
      return null
    }
  })

  ipcMain.handle(
    'ai:send-message',
    async (
      event,
      payload: { messages: CoreMessage[]; sessionId: string }
    ): Promise<{ ok: boolean }> => {
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { ok: false }

      const controller = new AbortController()
      activeStreams.set(payload.sessionId, controller)

      streamAiResponse(
        payload.messages,
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
        },
        controller.signal
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
