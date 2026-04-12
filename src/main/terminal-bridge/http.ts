/** Terminal bridge HTTP route handlers — mounted in main server.ts */

import type { IncomingMessage, ServerResponse } from 'http'
import type { BrowserWindow } from 'electron'
import { getActiveWindowAsync } from '../activeWindow'
import { resolveTerminalSession } from './session'
import { readTerminalBuffer } from './buffer'
import { getTerminalProcesses } from './processes'
import { getGitStatus, getGitDiff, getGitLog } from './git'
import { tailLogs } from './logs'
import { detectScripts } from './scripts'
import { buildErrorPacket } from './errors'
import { findProjectRoot } from './project-root'
import { parseStackTrace } from '../ide-bridge/stack-trace'

type JsonFn = (res: ServerResponse, status: number, data: Record<string, unknown>) => void

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf('?')
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '')
}

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > 500_000) { req.destroy(); reject(new Error('Body too large')) }
    })
    req.on('end', () => {
      try { resolve(body ? JSON.parse(body) : {}) } catch { reject(new Error('Invalid JSON')) }
    })
    req.on('error', reject)
  })
}

export function handleTerminalRoutes(
  req: IncomingMessage,
  res: ServerResponse,
  url: string,
  localJson: JsonFn,
  mainWin: BrowserWindow | null
): boolean {
  // GET /terminal/buffer
  if (url === '/terminal/buffer' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const win = await getActiveWindowAsync()
      if (!win) return { error: 'No active window' }
      const session = resolveTerminalSession(win)
      if (!session) return { error: 'Active window is not a terminal' }
      return await readTerminalBuffer(session, mainWin) as unknown as Record<string, unknown>
    })
    return true
  }

  // GET /terminal/cwd
  if (url === '/terminal/cwd' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const win = await getActiveWindowAsync()
      if (!win) return { error: 'No active window' }
      const session = resolveTerminalSession(win)
      if (!session) return { error: 'Active window is not a terminal' }

      const projectInfo = session.titleCwd ? findProjectRoot(session.titleCwd) : null

      return {
        cwd: session.titleCwd,
        projectRoot: projectInfo?.root || null,
        shell: session.shell,
        pid: session.pid,
        source: session.titleCwd ? 'title' : null,
      }
    })
    return true
  }

  // GET /terminal/processes
  if (url === '/terminal/processes' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const win = await getActiveWindowAsync()
      if (!win) return { error: 'No active window' }
      const session = resolveTerminalSession(win)
      if (!session) return { error: 'Active window is not a terminal' }
      return await getTerminalProcesses(session.pid, session.shell, session.titleCwd) as unknown as Record<string, unknown>
    })
    return true
  }

  // GET /terminal/logs
  if (url === '/terminal/logs' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const qs = parseQuery(req.url || '')
      return await tailLogs({
        path: qs.get('path') || undefined,
        cwd: qs.get('cwd') || undefined,
        lines: qs.get('lines') ? Number(qs.get('lines')) : undefined,
        pattern: qs.get('pattern') || undefined,
      }) as unknown as Record<string, unknown>
    })
    return true
  }

  // GET /terminal/scripts
  if (url === '/terminal/scripts' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const qs = parseQuery(req.url || '')
      let cwd = qs.get('cwd') || null
      if (!cwd) {
        const win = await getActiveWindowAsync()
        if (win) {
          const session = resolveTerminalSession(win)
          cwd = session?.titleCwd || null
        }
      }
      if (!cwd) return { error: 'No cwd available' }
      return detectScripts(cwd) as unknown as Record<string, unknown>
    })
    return true
  }

  // POST /terminal/parse-stacktrace
  if (url === '/terminal/parse-stacktrace' && req.method === 'POST') {
    handleAsyncBody(req, res, localJson, async (body) => {
      let text = typeof body.text === 'string' ? body.text : ''
      if (text === 'auto') {
        const win = await getActiveWindowAsync()
        if (!win) return { error: 'No active window' }
        const session = resolveTerminalSession(win)
        if (!session) return { error: 'Active window is not a terminal' }
        const buffer = await readTerminalBuffer(session, mainWin)
        text = buffer.lines.join('\n')
      }
      if (!text) return { error: 'No text to parse' }
      const cwd = typeof body.cwd === 'string' ? body.cwd : undefined
      return parseStackTrace(text, cwd) as unknown as Record<string, unknown>
    })
    return true
  }

  // GET /terminal/git-status
  if (url === '/terminal/git-status' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const qs = parseQuery(req.url || '')
      const cwd = await resolveCwd(qs.get('cwd'))
      if (!cwd) return { error: 'No cwd available' }
      const status = await getGitStatus(cwd)
      if (!status) return { error: 'Not a git repository' }
      return status as unknown as Record<string, unknown>
    })
    return true
  }

  // GET /terminal/git-diff
  if (url === '/terminal/git-diff' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const qs = parseQuery(req.url || '')
      const cwd = await resolveCwd(qs.get('cwd'))
      if (!cwd) return { error: 'No cwd available' }
      const diff = await getGitDiff(cwd, {
        staged: qs.get('staged') === '1' ? true : undefined,
        file: qs.get('file') || undefined,
      })
      if (!diff) return { error: 'Not a git repository' }
      return diff as unknown as Record<string, unknown>
    })
    return true
  }

  // GET /terminal/git-log
  if (url === '/terminal/git-log' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const qs = parseQuery(req.url || '')
      const cwd = await resolveCwd(qs.get('cwd'))
      if (!cwd) return { error: 'No cwd available' }
      const count = qs.get('count') ? Number(qs.get('count')) : 10
      const log = await getGitLog(cwd, count)
      if (!log) return { error: 'Not a git repository' }
      return log as unknown as Record<string, unknown>
    })
    return true
  }

  // GET /terminal/error-packet
  if (url === '/terminal/error-packet' && req.method === 'GET') {
    handleAsync(res, localJson, async () => {
      const win = await getActiveWindowAsync()
      if (!win) return { error: 'No active window' }
      const session = resolveTerminalSession(win)
      if (!session) return { error: 'Active window is not a terminal' }
      const buffer = await readTerminalBuffer(session, mainWin)
      return await buildErrorPacket(buffer.lines, session.titleCwd) as unknown as Record<string, unknown>
    })
    return true
  }

  return false
}

// ── Helpers ──────────────────────────────────────────────────────────────────

async function resolveCwd(explicit: string | null): Promise<string | null> {
  if (explicit) return explicit
  const win = await getActiveWindowAsync()
  if (!win) return null
  const session = resolveTerminalSession(win)
  return session?.titleCwd || null
}

function handleAsync(
  res: ServerResponse,
  localJson: JsonFn,
  fn: () => Promise<Record<string, unknown>>
): void {
  fn().then(
    (data) => {
      const status = data.error ? 400 : 200
      localJson(res, status, data)
    },
    () => localJson(res, 500, { error: 'Internal error' })
  )
}

function handleAsyncBody(
  req: IncomingMessage,
  res: ServerResponse,
  localJson: JsonFn,
  fn: (body: Record<string, unknown>) => Promise<Record<string, unknown>>
): void {
  parseBody(req).then(
    (body) => handleAsync(res, localJson, () => fn(body)),
    () => localJson(res, 400, { error: 'Invalid request body' })
  )
}
