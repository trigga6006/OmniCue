/** Tail log files with filtering and format detection. */

import { createReadStream, statSync, existsSync, readdirSync } from 'fs'
import { join, extname } from 'path'
import type { LogTailResult } from './types'

const MAX_LINES = 500
const MAX_BYTES = 128 * 1024 // 128 KB

export async function tailLogs(options: {
  path?: string
  cwd?: string
  lines?: number
  pattern?: string
}): Promise<LogTailResult> {
  const maxLines = Math.min(options.lines || 50, MAX_LINES)

  // Resolve the log file path
  let logPath: string | undefined = options.path
  if (!logPath && options.cwd) {
    logPath = autoDetectLogFile(options.cwd) || undefined
  }

  if (!logPath || !existsSync(logPath)) {
    return {
      path: logPath || '',
      lines: [],
      lineCount: 0,
      format: 'unknown',
      filtered: false,
      truncated: false,
    }
  }

  // Read the tail of the file
  const lines = await readTail(logPath, maxLines)
  const format = detectLogFormat(lines)

  // Apply pattern filter if provided
  let filtered = false
  let resultLines = lines
  if (options.pattern) {
    try {
      const re = new RegExp(options.pattern, 'i')
      resultLines = lines.filter(l => re.test(l))
      filtered = true
    } catch {
      // Invalid regex, return unfiltered
    }
  }

  return {
    path: logPath,
    lines: resultLines,
    lineCount: resultLines.length,
    format,
    filtered,
    truncated: lines.length >= maxLines,
  }
}

async function readTail(filePath: string, maxLines: number): Promise<string[]> {
  const stat = statSync(filePath)
  const readStart = Math.max(0, stat.size - MAX_BYTES)

  return new Promise((resolve) => {
    const chunks: Buffer[] = []
    const stream = createReadStream(filePath, { start: readStart })

    stream.on('data', (chunk: Buffer | string) => {
      chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk)
    })
    stream.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf-8')
      const lines = text.split(/\r?\n/).filter(Boolean)
      resolve(lines.slice(-maxLines))
    })
    stream.on('error', () => resolve([]))

    // Safety timeout
    setTimeout(() => { stream.destroy(); resolve([]) }, 5000)
  })
}

function detectLogFormat(lines: string[]): 'json' | 'syslog' | 'plain' | 'unknown' {
  if (lines.length === 0) return 'unknown'

  // Sample first few non-empty lines
  const sample = lines.slice(0, 5)

  // JSON lines
  if (sample.every(l => l.startsWith('{') || l.startsWith('['))) return 'json'

  // Syslog format: "Mon DD HH:MM:SS" or ISO8601 prefix
  const syslogPattern = /^(?:[A-Z][a-z]{2}\s+\d{1,2}\s+\d{2}:\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T)/
  if (sample.filter(l => syslogPattern.test(l)).length >= sample.length * 0.6) return 'syslog'

  // Some structured content
  if (sample.some(l => /\b(ERROR|WARN|INFO|DEBUG|TRACE)\b/i.test(l))) return 'plain'

  return 'unknown'
}

function autoDetectLogFile(cwd: string): string | null {
  // Check for common log files in the project root
  const candidates = [
    'npm-debug.log',
    'debug.log',
    'error.log',
    'app.log',
  ]

  for (const name of candidates) {
    const p = join(cwd, name)
    if (existsSync(p)) return p
  }

  // Check for a logs/ directory
  const logsDir = join(cwd, 'logs')
  if (existsSync(logsDir)) {
    try {
      const files = readdirSync(logsDir)
        .filter(f => extname(f) === '.log')
        .sort()
      if (files.length > 0) return join(logsDir, files[files.length - 1])
    } catch { /* ignore */ }
  }

  // Check for any .log file in project root
  try {
    const files = readdirSync(cwd)
      .filter(f => extname(f) === '.log')
      .sort()
    if (files.length > 0) return join(cwd, files[files.length - 1])
  } catch { /* ignore */ }

  return null
}
