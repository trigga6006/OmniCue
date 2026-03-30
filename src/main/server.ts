import { createServer, IncomingMessage, ServerResponse } from 'http'
import type { BrowserWindow } from 'electron'

const PORT = 19191
const HOST = '127.0.0.1'

let mainWin: BrowserWindow | null = null

function parseBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.on('data', (chunk: Buffer) => { body += chunk.toString() })
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

function json(res: ServerResponse, status: number, data: Record<string, unknown>): void {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  })
  res.end(JSON.stringify(data))
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
