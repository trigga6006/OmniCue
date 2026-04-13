import { appendFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const LOG_DIR = join(process.env.APPDATA || homedir(), 'omnicue')
const LOG_PATH = join(LOG_DIR, 'omnicue-claude.log')
try { mkdirSync(LOG_DIR, { recursive: true }) } catch { /* exists */ }

export function debugLog(msg: string): void {
  const line = `[${new Date().toISOString()}] ${msg}\n`
  console.log(line.trimEnd())
  try { appendFileSync(LOG_PATH, line) } catch { /* best effort */ }
}
