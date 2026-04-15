import { ipcMain, BrowserWindow, app, screen, desktopCapturer, shell, dialog, clipboard } from 'electron'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { exec, execSync } from 'child_process'
import { settingsStore, historyStore, alarmsStore, remindersStore, watchersStore, type Watcher } from './store'
import { overlayState } from './overlayState'
import { streamAiResponse, cleanupSession, getClaudeControlPlane, type ChatMessage } from './ai'
import { resolveProjectCwd } from './resolveProjectCwd'
import { resolvePendingRequest, cancelPendingRequestsForSession } from './agent-interactions'
import { extractTextFromScreenshot } from './ocr'
import { getCodexStatus } from './codex-auth'
import { getClaudeStatus } from './claude-auth'
import { getActiveWindowCached } from './activeWindow'
import { getCurrentDisplayId, captureDisplayDataUrl } from './desktop-tools'
import { captureRegion } from './regionCapture'
import { executeAction, ACTION_REGISTRY, getActionDefinition } from './actions'
import { resolveIntent } from './intent/resolver'
import { listNotes as listWorkspaceNotes, getNote as getWorkspaceNote, deleteNote as deleteWorkspaceNote } from './workspace-notes'
import { resolvePack } from '../shared/tool-packs/resolver'
import {
  listConversations, loadConversation, saveConversation,
  deleteConversation, renameConversation, clearConversationResumeCapsule,
} from './conversations'
import { onUserMessage, onAssistantFinish, onInteractionRequest, captureManual } from './session-memory/collector'
import { getSessionMemory, listSessions, deleteSessionTimeline } from './session-memory/store'
import { collectSnapshot as collectDesktopSnapshot } from './context/collector'
import type { SessionMemoryQuery } from './session-memory/types'

const activeStreams = new Map<string, AbortController>()

// Cache resolved CWD per session — avoids repeated filesystem walks
const sessionCwdCache = new Map<string, string>()

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
  ipcMain.on('set-ignore-mouse-events', (event, ignore: boolean, opts?: { forward?: boolean }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (win) {
      win.setIgnoreMouseEvents(ignore, opts || {})
      overlayState.isIgnoring = ignore
      overlayState.isForwarding = !!(ignore && opts?.forward)
      if (ignore && !opts?.forward) overlayState.lastIgnoreTime = Date.now()
    }
  })

  ipcMain.on('set-interactive-lock', (_event, locked: boolean) => {
    overlayState.locked = locked
  })

  ipcMain.on('set-panel-open', (_event, open: boolean) => {
    overlayState.panelOpen = open
  })

  ipcMain.on('set-interactive-regions', (_event, regions: Array<{ x: number; y: number; width: number; height: number }>) => {
    overlayState.interactiveRegions = Array.isArray(regions)
      ? regions.filter((region) =>
          Number.isFinite(region?.x) &&
          Number.isFinite(region?.y) &&
          Number.isFinite(region?.width) &&
          Number.isFinite(region?.height) &&
          region.width > 0 &&
          region.height > 0
        )
      : []
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

  ipcMain.handle('request-window-resize', (event, size: { width: number; height: number }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    const b = win.getBounds()
    // Skip if already at requested size
    if (b.width === size.width && b.height === size.height) return
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

  ipcMain.handle('get-current-display-bounds', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) {
      const primary = screen.getPrimaryDisplay()
      return primary.bounds
    }
    const b = win.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: b.x + Math.round(b.width / 2),
      y: b.y + Math.round(b.height / 2),
    })
    return display.bounds
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

  ipcMain.handle('capture-active-window', async (event, displayId?: number): Promise<{
    image: string
    title: string
    activeApp: string
    processName: string
    clipboardText: string
    ocrId: number
    packId?: string
    packName?: string
    packConfidence?: number
    packContext?: Record<string, string>
    packVariant?: string
  } | null> => {
    try {
      const winInfo = await getActiveWindowCached()
      const clipText = clipboard.readText() || ''

      const win = BrowserWindow.fromWebContents(event.sender)
      const capture = await captureDisplayDataUrl(displayId, win)
      if (!capture) return null

      const title = winInfo?.windowTitle || 'Desktop'
      const ocrId = ++ocrCounter

      pendingOcr.set(
        ocrId,
        extractTextFromScreenshot(capture.image, title)
          .then((r) => ({ ocrText: r.text, screenType: r.screenType, ocrDurationMs: r.durationMs }))
          .catch(() => null)
      )

      // Resolve tool pack from active window info
      const pack = resolvePack({
        activeApp: winInfo?.activeApp || '',
        processName: winInfo?.processName || '',
        windowTitle: title,
      })

      return {
        image: capture.image,
        title,
        activeApp: winInfo?.activeApp || '',
        processName: winInfo?.processName || '',
        clipboardText: clipText,
        ocrId,
        ...(pack && {
          packId: pack.packId,
          packName: pack.packName,
          packConfidence: pack.confidence,
          packContext: pack.context,
          packVariant: pack.variant,
        }),
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

  ipcMain.handle('capture-region', async (event): Promise<{
    image: string
    title: string
    ocrId: number
  } | null> => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const wasVisible = !!(win && !win.isDestroyed() && win.isVisible())
    try {
      // Hide the main window before showing the overlay so it doesn't
      // appear through the transparent dim, and stays hidden for the capture.
      if (wasVisible && win) {
        win.hide()
        await new Promise((r) => setTimeout(r, 100))
      }

      const result = await captureRegion(win)

      if (!result) return null

      const title = 'Region capture'
      const ocrId = ++ocrCounter
      pendingOcr.set(
        ocrId,
        extractTextFromScreenshot(result.image, title)
          .then((r) => ({ ocrText: r.text, screenType: r.screenType, ocrDurationMs: r.durationMs }))
          .catch(() => null)
      )

      return { image: result.image, title, ocrId }
    } catch {
      return null
    } finally {
      if (wasVisible && win && !win.isDestroyed()) {
        win.showInactive()
      }
    }
  })

  // Track the most recent tool use per session for capsule updates
  const lastToolUseBySession = new Map<string, { name: string; input?: string }>()

  ipcMain.handle(
    'ai:send-message',
    async (
      event,
      payload: {
        messages: unknown[]
        sessionId: string
        provider?: string
        resumeMode?: 'normal' | 'replay-seed'
        conversationId?: string
      }
    ): Promise<{ ok: boolean }> => {
      const _perfIpc = Date.now()
      const _pI = (label: string): void => console.error(`[PERF] ai:send-message IPC | ${label}: ${Date.now() - _perfIpc}ms`)
      _pI('handler entered')
      const win = BrowserWindow.fromWebContents(event.sender)
      if (!win) return { ok: false }

      const captureSessionMemorySnapshot = async () => {
        try {
          return await collectDesktopSnapshot(win, { skipSystem: true })
        } catch {
          return undefined
        }
      }

      // Kill any existing stream for this session immediately — prevents
      // ghost/duplicate runs from wasting 5+ seconds before the real run starts
      const existing = activeStreams.get(payload.sessionId)
      if (existing) {
        existing.abort()
        activeStreams.delete(payload.sessionId)
      }

      const controller = new AbortController()
      activeStreams.set(payload.sessionId, controller)

      const settings = settingsStore.get()
      // Use cached CWD for this session if available — avoids repeated filesystem walks
      let cwd = sessionCwdCache.get(payload.sessionId)
      if (!cwd) {
        cwd = resolveProjectCwd(
          payload.messages as ChatMessage[],
          settings.devRootPath || ''
        )
        sessionCwdCache.set(payload.sessionId, cwd)
      }
      _pI(`resolveProjectCwd done | cwd=${cwd} cached=${sessionCwdCache.has(payload.sessionId)}`)

      // Capture user-message event for session memory
      if (payload.conversationId && payload.provider) {
        const latestUserMsg = [...(payload.messages as ChatMessage[])]
          .reverse()
          .find((m) => m.role === 'user')
        if (latestUserMsg) {
          const msgText =
            typeof latestUserMsg.content === 'string'
              ? latestUserMsg.content
              : ''
          collectDesktopSnapshot(win, { skipSystem: true })
            .then((snapshot) => {
              onUserMessage({
                conversationId: payload.conversationId!,
                runtimeSessionId: payload.sessionId,
                provider: payload.provider!,
                message: msgText,
                snapshot,
              })
            })
            .catch(() => {
              /* best-effort */
            })
        }
      }

      streamAiResponse(
        payload.sessionId,
        payload.messages as ChatMessage[],
        {
          onInitializing: () => {
            if (!win.isDestroyed())
              win.webContents.send('ai:initializing', {
                sessionId: payload.sessionId,
              })
          },
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

            // Capture assistant-finish event for session memory
            if (payload.conversationId && payload.provider) {
              const lastToolUse = lastToolUseBySession.get(payload.sessionId)
              captureSessionMemorySnapshot()
                .then((snapshot) => {
                  onAssistantFinish({
                    conversationId: payload.conversationId!,
                    runtimeSessionId: payload.sessionId,
                    provider: payload.provider!,
                    message: fullText,
                    lastToolUse,
                    snapshot,
                  })
                })
                .finally(() => {
                  lastToolUseBySession.delete(payload.sessionId)
                })
            }
          },
          onError: (error) => {
            activeStreams.delete(payload.sessionId)
            lastToolUseBySession.delete(payload.sessionId)
            if (!win.isDestroyed())
              win.webContents.send('ai:stream-error', {
                sessionId: payload.sessionId,
                error,
              })
          },
          onToolUse: (toolName, toolInput) => {
            // Track most recent tool use for capsule
            lastToolUseBySession.set(payload.sessionId, {
              name: toolName,
              input: toolInput?.slice(0, 200),
            })

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

            // Capture interaction-request event for session memory
            if (payload.conversationId && payload.provider) {
              captureSessionMemorySnapshot()
                .then((snapshot) => {
                  onInteractionRequest({
                    conversationId: payload.conversationId!,
                    runtimeSessionId: payload.sessionId,
                    provider: payload.provider!,
                    interaction: { kind: request.kind, title: request.title },
                    snapshot,
                  })
                })
                .catch(() => {
                  /* best-effort */
                })
            }
          },
        },
        controller.signal,
        undefined, // model — resolved by main process per provider
        payload.provider,
        cwd,
        settings.agentPermissions || 'read-only',
        payload.resumeMode || 'normal',
        payload.conversationId
      ).catch((err) => {
        activeStreams.delete(payload.sessionId)
        lastToolUseBySession.delete(payload.sessionId)
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
    sessionCwdCache.delete(payload.sessionId)
    cleanupSession(payload.sessionId)
  })

  // ─── Claude Code ControlPlane IPC ─────────────────────────────────────────

  // Respond to a Claude Code permission request (from PermissionServer hook)
  ipcMain.handle('claude:respond-permission', (_event, payload: {
    tabId: string
    questionId: string
    optionId: string
  }) => {
    const cp = getClaudeControlPlane()
    return cp.respondToPermission(payload.tabId, payload.questionId, payload.optionId)
  })

  // Get Claude Code health report
  ipcMain.handle('claude:health', () => {
    const cp = getClaudeControlPlane()
    return cp.getHealth()
  })

  // Set Claude Code permission mode (ask / auto)
  ipcMain.on('claude:set-permission-mode', (_event, mode: string) => {
    const cp = getClaudeControlPlane()
    cp.setPermissionMode(mode as 'ask' | 'auto')
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

  // ─── Conversations ──────────────────────────────────────────────────────────

  ipcMain.handle('conversations:list', () => listConversations())

  ipcMain.handle('conversations:load', (_event, id: string) => loadConversation(id))

  ipcMain.handle('conversations:save', (_event, data: {
    id: string; title: string; provider: string; messages: Record<string, unknown>[]
  }) => {
    saveConversation(data)
  })

  ipcMain.handle('conversations:delete', (_event, id: string) => {
    deleteConversation(id)
  })

  ipcMain.handle('conversations:rename', (_event, id: string, title: string) => {
    renameConversation(id, title)
  })

  // ─── Session Memory ─────────────────────────────────────────────────────────

  ipcMain.handle('session-memory:query', (_event, query: SessionMemoryQuery) => {
    return getSessionMemory(query)
  })

  ipcMain.handle('session-memory:list', () => {
    return listSessions()
  })

  ipcMain.handle('session-memory:capture', async (event, args: {
    conversationId: string
    runtimeSessionId?: string
    provider: string
  }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const snapshot = await collectDesktopSnapshot(win, { includeClipboard: true })
    await captureManual({
      conversationId: args.conversationId,
      runtimeSessionId: args.runtimeSessionId,
      provider: args.provider,
      snapshot,
      includeClipboard: true,
    })
    return { ok: true }
  })

  ipcMain.handle('session-memory:get-capsule', (_event, conversationId: string) => {
    const conversation = loadConversation(conversationId)
    return conversation?.resumeCapsule ?? null
  })

  ipcMain.handle('session-memory:clear', (_event, conversationId: string) => {
    clearConversationResumeCapsule(conversationId)
    deleteSessionTimeline(conversationId)
    return { ok: true }
  })

  // ─── Desktop Context (lightweight, for stale detection) ────────────────────

  ipcMain.handle('desktop:get-live-context', async () => {
    try {
      const winInfo = await getActiveWindowCached()
      return {
        activeApp: winInfo?.activeApp || '',
        processName: winInfo?.processName || '',
        windowTitle: winInfo?.windowTitle || '',
      }
    } catch {
      return { activeApp: '', processName: '', windowTitle: '' }
    }
  })

  // ─── App Actions ────────────────────────────────────────────────────────────

  ipcMain.handle('action:execute', async (event, request: { actionId: string; params: Record<string, unknown>; requestId?: string }) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    return executeAction(request, win)
  })

  ipcMain.handle('action:list', () => ACTION_REGISTRY)

  // ─── Intent resolution ─────────────────────────────────────────────────────

  ipcMain.handle('intent:resolve', async (event, utteranceOrPayload: string | { utterance: string; conversationId?: string }) => {
    const _perfIntent = Date.now()
    const _pInt = (label: string): void => console.error(`[PERF] intent:resolve | ${label}: ${Date.now() - _perfIntent}ms`)
    _pInt('handler entered')
    const win = BrowserWindow.fromWebContents(event.sender)
    const utterance = typeof utteranceOrPayload === 'string' ? utteranceOrPayload : utteranceOrPayload.utterance
    const convId = typeof utteranceOrPayload === 'object' ? utteranceOrPayload.conversationId : undefined

    const snapshot = await collectDesktopSnapshot(win, { includeClipboard: true, skipSystem: true })
    _pInt('collectDesktopSnapshot done')

    // Load resume capsule if conversationId provided
    let capsule: import('./session-memory/types').ResumeCapsule | undefined
    if (convId) {
      const conv = loadConversation(convId)
      capsule = conv?.resumeCapsule ?? undefined
    }
    _pInt('capsule loaded')

    const plan = await resolveIntent(utterance, snapshot, capsule)
    _pInt(`resolveIntent done | resolved=${plan.fallback !== 'ask' && plan.actions.length > 0}`)

    if (plan.fallback === 'ask' || plan.actions.length === 0) {
      return { resolved: false, plan }
    }

    // Only auto-execute safe actions
    const allSafe = plan.actions.every((s) => {
      const def = getActionDefinition(s.actionId)
      return def?.tier === 'safe'
    })

    if (!allSafe || plan.needsConfirmation) {
      return { resolved: true, executed: false, plan }
    }

    const results: Awaited<ReturnType<typeof executeAction>>[] = []
    for (const step of plan.actions) {
      results.push(await executeAction({ actionId: step.actionId, params: step.params }, win))
    }
    return { resolved: true, executed: true, plan, results }
  })

  // ─── Notes ──────────────────────────────────────────────────────────────────

  ipcMain.handle('notes:list', () => listWorkspaceNotes())

  ipcMain.handle('notes:get', (_event, id: string) => getWorkspaceNote(id))

  ipcMain.handle('notes:delete', (_event, id: string) => deleteWorkspaceNote(id))

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

      // Sample from the display where the overlay is (not always primary)
      const overlay = BrowserWindow.getAllWindows().find((w) => w.isAlwaysOnTop()) || null
      const targetDisplayId = String(getCurrentDisplayId(overlay))
      const source = sources.find((s) => s.display_id === targetDisplayId) || sources[0]
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
