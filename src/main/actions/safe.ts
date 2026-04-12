/**
 * Safe-tier action handlers. Execute immediately, no confirmation needed.
 */

import { BrowserWindow, clipboard, shell } from 'electron'
import { homedir } from 'os'
import { historyStore } from '../store'
import { saveNote as saveNoteToWorkspace, listNotes, getNote, deleteNote } from '../workspace-notes'
import { ok, fail, type ActionHandler } from './helpers'
import { runPsCommand } from './powershell'
import {
  extractBrowserUrl,
  fetchPageContent,
  fetchReadableContent,
  snipeFonts,
  summarizeFonts,
  getSelectedTextViaUiAutomation,
} from '../browser'
import { getActiveWindowAsync } from '../activeWindow'
import { getNavEntry, launchSystemLocation } from '../navigation'
import {
  resolveTerminalSession,
  readTerminalBuffer,
  getTerminalProcesses,
  getGitStatus,
  getGitDiff,
  getGitLog,
  tailLogs,
  detectScripts,
  buildErrorPacket,
  findProjectRoot,
} from '../terminal-bridge'
import { parseStackTrace } from '../ide-bridge/stack-trace'
import { getIdeState } from '../ide-bridge/state'
import { readIdeSelection } from '../ide-bridge/selection'

const T = 'safe' as const

function escapePsSingleQuoted(value: string): string {
  return value.replace(/'/g, "''")
}

function parseJsonLines(raw: string): string[] {
  if (!raw.trim()) return []

  try {
    const parsed = JSON.parse(raw) as string | string[] | null
    if (Array.isArray(parsed)) return parsed.filter(Boolean)
    return parsed ? [parsed] : []
  } catch {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }
}

function sendReminderNotification(message: string): void {
  const target = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed())
  if (!target) return

  target.webContents.send('new-notification', {
    id: Math.random().toString(36).substring(2, 9),
    message,
    title: 'Reminder',
    timeout: 30,
    createdAt: Date.now(),
  })

  historyStore.addEntry({
    id: Math.random().toString(36).substring(2, 9),
    name: message,
    duration: 0,
    completedAt: new Date().toISOString(),
    type: 'reminder',
  })
}

export const safeHandlers: Record<string, ActionHandler> = {
  'clipboard-write': async (params) => {
    const text = String(params.text ?? '')
    if (!text) return fail('clipboard-write', T, 'text is required')
    clipboard.writeText(text)
    return ok('clipboard-write', T, `Copied ${text.length} characters to clipboard`)
  },

  'open-url': async (params) => {
    const url = String(params.url ?? '')
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return fail('open-url', T, 'Only http/https URLs allowed')
      }
      await shell.openExternal(url)
      return ok('open-url', T, `Opened ${parsed.hostname}`)
    } catch {
      return fail('open-url', T, `Invalid URL: ${url}`)
    }
  },

  'open-file': async (params) => {
    const filePath = String(params.path ?? '')
    if (!filePath) return fail('open-file', T, 'path is required')
    const result = await shell.openPath(filePath)
    if (result) return fail('open-file', T, result)
    return ok('open-file', T, `Opened ${filePath}`)
  },

  'reveal-in-folder': async (params) => {
    const filePath = String(params.path ?? '')
    if (!filePath) return fail('reveal-in-folder', T, 'path is required')
    shell.showItemInFolder(filePath)
    return ok('reveal-in-folder', T, `Revealed ${filePath}`)
  },

  'save-note': async (params) => {
    const result = await saveNoteToWorkspace(params)
    if (!result.ok) return fail('save-note', T, result.error || 'Failed to save note')
    return ok('save-note', T, `Note saved (${result.id})`)
  },

  'list-notes': async () => {
    const notes = listNotes()
    return ok('list-notes', T, JSON.stringify(notes))
  },

  'get-note': async (params) => {
    const id = String(params.id ?? '')
    if (!id) return fail('get-note', T, 'id is required')
    const note = getNote(id)
    if (!note) return fail('get-note', T, `Note not found: ${id}`)
    return ok('get-note', T, JSON.stringify(note))
  },

  'delete-note': async (params) => {
    const id = String(params.id ?? '')
    if (!id) return fail('delete-note', T, 'id is required')
    const result = deleteNote(id)
    if (!result.ok) return fail('delete-note', T, result.error || 'Failed to delete note')
    return ok('delete-note', T, `Deleted note: ${id}`)
  },

  'set-reminder': async (params) => {
    const message = String(params.message ?? '').trim()
    const delaySeconds = Number(params.delaySeconds ?? 0)
    if (!message) return fail('set-reminder', T, 'message is required')
    if (!Number.isFinite(delaySeconds) || delaySeconds <= 0) {
      return fail('set-reminder', T, 'delaySeconds must be greater than 0')
    }

    // TODO: persist to scheduler/alarms store for reminders > 5min so they survive app restart
    setTimeout(() => sendReminderNotification(message), delaySeconds * 1000)
    return ok('set-reminder', T, `Reminder set for ${delaySeconds}s from now: ${message}`)
  },

  'search-web': async (params) => {
    const query = String(params.query ?? '').trim()
    if (!query) return fail('search-web', T, 'query is required')

    await shell.openExternal(`https://www.google.com/search?q=${encodeURIComponent(query)}`)
    return ok('search-web', T, `Searching the web for: ${query}`)
  },

  'find-file': async (params) => {
    const rawPattern = String(params.pattern ?? '').trim()
    if (!rawPattern) return fail('find-file', T, 'pattern is required')

    const startDir = String(params.startDir ?? '').trim() || homedir()
    const pattern = rawPattern.includes('*') || rawPattern.includes('?') ? rawPattern : `*${rawPattern}*`
    const command = [
      `$startDir = '${escapePsSingleQuoted(startDir)}'`,
      `$pattern = '${escapePsSingleQuoted(pattern)}'`,
      'Get-ChildItem -Path $startDir -Recurse -File -Depth 5 -ErrorAction SilentlyContinue |',
      '  Where-Object { $_.Name -like $pattern } |',
      '  Select-Object -First 10 -ExpandProperty FullName |',
      '  ConvertTo-Json -Compress',
    ].join(' ')

    const result = await runPsCommand(command, 5000)
    if (result.exitCode !== 0) {
      return fail('find-file', T, result.stderr || 'File search failed')
    }

    const matches = parseJsonLines(result.stdout)
    return ok('find-file', T, matches.length > 0 ? matches.join('\n') : 'No matching files found')
  },

  'list-running-apps': async () => {
    const result = await runPsCommand(
      'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -ExpandProperty ProcessName -Unique | Sort-Object | ConvertTo-Json -Compress',
      3000
    )
    if (result.exitCode !== 0) {
      return fail('list-running-apps', T, result.stderr || 'Failed to list running apps')
    }

    const apps = parseJsonLines(result.stdout)
    return ok('list-running-apps', T, apps.length > 0 ? apps.join('\n') : 'No visible apps found')
  },

  // ── Navigation actions ──────────────────────────────────────────────────

  'open-system-location': async (params) => {
    const locationId = String(params.locationId ?? '').trim()
    if (!locationId) return fail('open-system-location', T, 'locationId is required')

    const entry = getNavEntry(locationId)
    if (!entry) return fail('open-system-location', T, `Unknown location: ${locationId}`)

    const result = await launchSystemLocation(entry)
    return result.ok
      ? ok('open-system-location', T, `Opened ${entry.description}`)
      : fail('open-system-location', T, result.error || `Failed to open ${entry.description}`)
  },

  // ── Browser enrichment actions ──────────────────────────────────────────

  'browser-url': async () => {
    const result = await extractBrowserUrl()
    if (!result.url) return fail('browser-url', T, 'Could not extract browser URL')
    return ok('browser-url', T, JSON.stringify(result))
  },

  'browser-page-content': async (params) => {
    const url = await resolveUrlParam(params)
    if (!url) return fail('browser-page-content', T, 'No URL available')
    try {
      const content = await fetchPageContent(url)
      return ok('browser-page-content', T, JSON.stringify(content))
    } catch (e) {
      return fail('browser-page-content', T, `Failed to fetch page: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  'browser-readable': async (params) => {
    const url = await resolveUrlParam(params)
    if (!url) return fail('browser-readable', T, 'No URL available')
    try {
      const content = await fetchReadableContent(url)
      return ok('browser-readable', T, JSON.stringify(content))
    } catch (e) {
      return fail('browser-readable', T, `Failed to fetch page: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  'browser-headings': async (params) => {
    const url = await resolveUrlParam(params)
    if (!url) return fail('browser-headings', T, 'No URL available')
    try {
      const content = await fetchPageContent(url)
      return ok('browser-headings', T, JSON.stringify({ url: content.url, title: content.title, headings: content.headings }))
    } catch (e) {
      return fail('browser-headings', T, `Failed to fetch page: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  'browser-links': async (params) => {
    const url = await resolveUrlParam(params)
    if (!url) return fail('browser-links', T, 'No URL available')
    try {
      const content = await fetchPageContent(url)
      return ok('browser-links', T, JSON.stringify({ url: content.url, title: content.title, links: content.links }))
    } catch (e) {
      return fail('browser-links', T, `Failed to fetch page: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  'browser-fonts': async (params) => {
    const url = await resolveUrlParam(params)
    if (!url) return fail('browser-fonts', T, 'No URL available')
    try {
      const fonts = await snipeFonts(url)
      const summary = summarizeFonts(fonts)
      return ok('browser-fonts', T, JSON.stringify({ url, fonts, summary }))
    } catch (e) {
      return fail('browser-fonts', T, `Failed to inspect fonts: ${e instanceof Error ? e.message : String(e)}`)
    }
  },

  'browser-selected-text': async () => {
    const text = await getSelectedTextViaUiAutomation()
    if (!text) return fail('browser-selected-text', T, 'No selected text found via UI Automation')
    return ok('browser-selected-text', T, text)
  },

  // ── Terminal bridge actions ──────────────────────────────────────────────

  'terminal-read-buffer': async () => {
    const win = await getActiveWindowAsync()
    if (!win) return fail('terminal-read-buffer', T, 'No active window')
    const session = resolveTerminalSession(win)
    if (!session) return fail('terminal-read-buffer', T, 'Active window is not a terminal')
    const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null
    const buffer = await readTerminalBuffer(session, mainWin)
    return ok('terminal-read-buffer', T, JSON.stringify(buffer))
  },

  'terminal-get-cwd': async () => {
    const win = await getActiveWindowAsync()
    if (!win) return fail('terminal-get-cwd', T, 'No active window')
    const session = resolveTerminalSession(win)
    if (!session) return fail('terminal-get-cwd', T, 'Active window is not a terminal')

    const projectInfo = session.titleCwd ? findProjectRoot(session.titleCwd) : null

    return ok('terminal-get-cwd', T, JSON.stringify({
      cwd: session.titleCwd,
      projectRoot: projectInfo?.root || null,
      shell: session.shell,
      pid: session.pid,
      source: session.titleCwd ? 'title' : null,
    }))
  },

  'terminal-list-processes': async () => {
    const win = await getActiveWindowAsync()
    if (!win) return fail('terminal-list-processes', T, 'No active window')
    const session = resolveTerminalSession(win)
    if (!session) return fail('terminal-list-processes', T, 'Active window is not a terminal')
    const procs = await getTerminalProcesses(session.pid, session.shell, session.titleCwd)
    return ok('terminal-list-processes', T, JSON.stringify(procs))
  },

  'terminal-tail-logs': async (params) => {
    const result = await tailLogs({
      path: params.path ? String(params.path) : undefined,
      cwd: params.cwd ? String(params.cwd) : undefined,
      lines: typeof params.lines === 'number' ? params.lines : undefined,
      pattern: params.pattern ? String(params.pattern) : undefined,
    })
    return ok('terminal-tail-logs', T, JSON.stringify(result))
  },

  'terminal-list-scripts': async (params) => {
    let cwd = params.cwd ? String(params.cwd) : null
    if (!cwd) {
      const win = await getActiveWindowAsync()
      if (win) {
        const session = resolveTerminalSession(win)
        cwd = session?.titleCwd || null
      }
    }
    if (!cwd) return fail('terminal-list-scripts', T, 'No cwd available')
    const scripts = detectScripts(cwd)
    return ok('terminal-list-scripts', T, JSON.stringify(scripts))
  },

  'terminal-parse-stacktrace': async (params) => {
    let text = String(params.text ?? '')

    if (text === 'auto') {
      const win = await getActiveWindowAsync()
      if (!win) return fail('terminal-parse-stacktrace', T, 'No active window')
      const session = resolveTerminalSession(win)
      if (!session) return fail('terminal-parse-stacktrace', T, 'Active window is not a terminal')
      const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null
      const buffer = await readTerminalBuffer(session, mainWin)
      text = buffer.lines.join('\n')
    }

    if (!text) return fail('terminal-parse-stacktrace', T, 'No text to parse')
    const cwd = params.cwd ? String(params.cwd) : undefined
    const result = parseStackTrace(text, cwd)
    return ok('terminal-parse-stacktrace', T, JSON.stringify(result))
  },

  'terminal-git-status': async (params) => {
    const cwd = await resolveCwd(params.cwd)
    if (!cwd) return fail('terminal-git-status', T, 'No cwd available')
    const status = await getGitStatus(cwd)
    if (!status) return fail('terminal-git-status', T, 'Not a git repository')
    return ok('terminal-git-status', T, JSON.stringify(status))
  },

  'terminal-git-diff': async (params) => {
    const cwd = await resolveCwd(params.cwd)
    if (!cwd) return fail('terminal-git-diff', T, 'No cwd available')
    const diff = await getGitDiff(cwd, {
      staged: params.staged === true ? true : undefined,
      file: params.file ? String(params.file) : undefined,
    })
    if (!diff) return fail('terminal-git-diff', T, 'Not a git repository')
    return ok('terminal-git-diff', T, JSON.stringify(diff))
  },

  'terminal-git-log': async (params) => {
    const cwd = await resolveCwd(params.cwd)
    if (!cwd) return fail('terminal-git-log', T, 'No cwd available')
    const count = typeof params.count === 'number' ? params.count : 10
    const log = await getGitLog(cwd, count)
    if (!log) return fail('terminal-git-log', T, 'Not a git repository')
    return ok('terminal-git-log', T, JSON.stringify(log))
  },

  'terminal-error-packet': async () => {
    const win = await getActiveWindowAsync()
    if (!win) return fail('terminal-error-packet', T, 'No active window')
    const session = resolveTerminalSession(win)
    if (!session) return fail('terminal-error-packet', T, 'Active window is not a terminal')
    const mainWin = BrowserWindow.getAllWindows().find(w => !w.isDestroyed()) || null
    const buffer = await readTerminalBuffer(session, mainWin)
    const packet = await buildErrorPacket(buffer.lines, session.titleCwd)
    return ok('terminal-error-packet', T, JSON.stringify(packet))
  },

  // ── IDE bridge actions (safe) ────────────────────────────────────────────

  'ide-get-state': async () => {
    const win = await getActiveWindowAsync()
    if (!win) return fail('ide-get-state', T, 'No active window')
    const state = getIdeState(win)
    if (!state) return fail('ide-get-state', T, 'Active window is not an IDE')
    return ok('ide-get-state', T, JSON.stringify(state))
  },

  'ide-read-selection': async () => {
    const win = await getActiveWindowAsync()
    if (!win) return fail('ide-read-selection', T, 'No active window')
    const sel = await readIdeSelection(win)
    return ok('ide-read-selection', T, JSON.stringify(sel))
  },
}

/** Resolve cwd from params or active terminal session. */
async function resolveCwd(cwdParam: unknown): Promise<string | null> {
  if (cwdParam) return String(cwdParam)
  const win = await getActiveWindowAsync()
  if (!win) return null
  const session = resolveTerminalSession(win)
  if (session?.titleCwd) return session.titleCwd
  // Try IDE workspace
  const state = getIdeState(win)
  return state?.workspacePath || null
}

/** Resolve the URL param: use explicit url if provided, otherwise extract from browser. */
async function resolveUrlParam(params: Record<string, unknown>): Promise<string | null> {
  const explicit = params.url ? String(params.url).trim() : ''
  if (explicit) {
    try {
      new URL(explicit)
      return explicit
    } catch {
      return null
    }
  }
  const result = await extractBrowserUrl()
  return result.url
}
