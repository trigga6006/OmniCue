import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { BrowserWindow } from 'electron'
import { listDisplays, getDesktopContext, getScreenText } from './desktop-tools'
import { handlePackToolsList, handlePackToolsActive } from './tool-pack-server'
import { executeAction, ACTION_REGISTRY } from './actions'
import { listNotes, getNote } from './workspace-notes'

const PORT = 19191
const HOST = '127.0.0.1'

let mainWin: BrowserWindow | null = null

const MAX_BODY_BYTES = 1_000_000

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => {
      body += chunk.toString()
      if (body.length > MAX_BODY_BYTES) { req.destroy(); reject(new Error('Body too large')) }
    })
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {})
      } catch {
        reject(new Error('Invalid JSON'))
      }
    })
    req.on('error', reject)
  })
}

/** Public JSON response — includes CORS headers (for harmless endpoints). */
function json(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
}

/** Local-only JSON response — no CORS, for sensitive desktop-context endpoints. */
function localJson(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.writeHead(status, { 'Content-Type': 'application/json' })
  res.end(JSON.stringify(data))
}

function parseQuery(url: string): URLSearchParams {
  const idx = url.indexOf('?')
  return new URLSearchParams(idx >= 0 ? url.slice(idx + 1) : '')
}

const server = createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    json(res, 204, {})
    return
  }

  const url = req.url?.split('?')[0]

  // Health check
  if (url === '/health' && req.method === 'GET') {
    json(res, 200, { status: 'ok', version: '1.0.0' })
    return
  }

  // Send notification
  if (url === '/notify' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      const message = typeof body.message === 'string' ? body.message : ''
      if (!message) {
        json(res, 400, { error: 'message is required' })
        return
      }
      const notification = {
        id: Math.random().toString(36).substring(2, 9),
        message,
        title: typeof body.title === 'string' ? body.title : undefined,
        timeout: typeof body.timeout === 'number' ? body.timeout : 30,
        createdAt: Date.now(),
      }
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('new-notification', notification)
      }
      json(res, 200, { ok: true, id: notification.id })
    } catch {
      json(res, 400, { error: 'Invalid request body' })
    }
    return
  }

  // Create timer remotely
  if (url === '/timer' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      const duration = typeof body.duration === 'number' ? body.duration : 0
      if (duration <= 0) {
        json(res, 400, { error: 'duration (in seconds) is required and must be > 0' })
        return
      }
      const timer = {
        id: Math.random().toString(36).substring(2, 9),
        name: typeof body.name === 'string' ? body.name : '',
        totalSeconds: duration,
        startedAt: Date.now(),
        paused: false,
      }
      if (mainWin && !mainWin.isDestroyed()) {
        mainWin.webContents.send('new-timer', timer)
      }
      json(res, 200, { ok: true, id: timer.id })
    } catch {
      json(res, 400, { error: 'Invalid request body' })
    }
    return
  }

  // ── Desktop tool endpoints (local-only, no CORS) ──────────────────────────

  // List connected displays
  if (url === '/displays' && req.method === 'GET') {
    const result = listDisplays(mainWin)
    localJson(res, 200, result as unknown as Record<string, unknown>)
    return
  }

  // Lightweight desktop context
  if (url?.startsWith('/context') && req.method === 'GET') {
    try {
      const qs = parseQuery(req.url || '')
      const includeClipboard = qs.get('includeClipboard') === '1'
      const ctx = await getDesktopContext(mainWin, { includeClipboard })
      localJson(res, 200, ctx as unknown as Record<string, unknown>)
    } catch {
      localJson(res, 500, { error: 'Failed to get desktop context' })
    }
    return
  }

  // OCR screen text
  if (url?.startsWith('/screen-text') && req.method === 'GET') {
    try {
      const qs = parseQuery(req.url || '')
      const displayParam = qs.get('display')
      const displayId = displayParam ? Number(displayParam) : undefined
      const result = await getScreenText(displayId, mainWin)
      if (!result) {
        localJson(res, 500, { error: 'Failed to capture screen' })
        return
      }
      localJson(res, 200, result as unknown as Record<string, unknown>)
    } catch {
      localJson(res, 500, { error: 'Failed to get screen text' })
    }
    return
  }

  // ── Tool pack discovery endpoints (local-only, no CORS) ────────────────────

  if (url === '/pack-tools' && req.method === 'GET') {
    await handlePackToolsList(res, localJson)
    return
  }

  if (url === '/pack-tools/active' && req.method === 'GET') {
    try {
      await handlePackToolsActive(res, localJson)
    } catch {
      localJson(res, 500, { error: 'Failed to resolve active pack' })
    }
    return
  }

  // ── Notes endpoints (local-only, no CORS) ──────────────────────────────

  if (url === '/notes' && req.method === 'GET') {
    const qs = parseQuery(req.url || '')
    const id = qs.get('id')
    if (id) {
      const note = getNote(id)
      if (!note) { localJson(res, 404, { error: 'Note not found' }); return }
      localJson(res, 200, { note } as unknown as Record<string, unknown>)
    } else {
      const notes = listNotes()
      localJson(res, 200, { notes } as unknown as Record<string, unknown>)
    }
    return
  }

  // ── App Action endpoints (local-only, no CORS) ─────────────────────────

  // List all available actions
  if (url === '/actions' && req.method === 'GET') {
    localJson(res, 200, { actions: ACTION_REGISTRY } as unknown as Record<string, unknown>)
    return
  }

  // Execute an action
  if (url === '/action' && req.method === 'POST') {
    try {
      const body = await parseBody(req)
      const actionId = typeof body.actionId === 'string' ? body.actionId : ''
      if (!actionId) {
        localJson(res, 400, { error: 'actionId is required' })
        return
      }
      const params = (body.params && typeof body.params === 'object' ? body.params : {}) as Record<string, unknown>
      const requestId = typeof body.requestId === 'string' ? body.requestId : undefined

      const result = await executeAction({ actionId, params, requestId }, mainWin)
      localJson(res, result.ok ? 200 : 400, result as unknown as Record<string, unknown>)
    } catch {
      localJson(res, 400, { error: 'Invalid request body' })
    }
    return
  }

  json(res, 404, { error: 'Not found' })
})

export function startServer(win: BrowserWindow): void {
  mainWin = win

  server.listen(PORT, HOST, () => {
    console.log(`OmniCue API listening on http://${HOST}:${PORT}`)
  })

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`Port ${PORT} in use — OmniCue API server not started`)
    } else {
      console.error('Server error:', err)
    }
  })
}

export function updateServerWindow(win: BrowserWindow): void {
  mainWin = win
}
