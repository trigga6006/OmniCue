/** Resolve active terminal session from ActiveWindowInfo. */

import type { ActiveWindowInfo } from '../activeWindow'
import { resolvePack } from '../../shared/tool-packs/resolver'

export interface TerminalSession {
  pid: number | null
  hwnd: number | null
  shell: string
  terminalFamily: string | null
  isAdmin: boolean
  titleCwd: string | null
}

/** Resolve terminal session details from the active window. Returns null if not a terminal. */
export function resolveTerminalSession(win: ActiveWindowInfo): TerminalSession | null {
  const match = resolvePack({
    activeApp: win.activeApp,
    processName: win.processName,
    windowTitle: win.windowTitle,
  })

  if (!match || match.packId !== 'terminal') return null

  return {
    pid: win.processId ?? null,
    hwnd: win.windowHandle ?? null,
    shell: match.context.shellHint || match.variant || 'unknown',
    terminalFamily: match.variant || null,
    isAdmin: match.context.isAdmin === 'true',
    titleCwd: extractCwdFromTitle(win.windowTitle),
  }
}

/** Extract cwd from terminal window title using common patterns. */
function extractCwdFromTitle(title: string): string | null {
  // PowerShell: "PS C:\Users\foo>"
  const psMatch = title.match(/PS\s+([A-Z]:\\[^>]+)>/i)
  if (psMatch?.[1]) return psMatch[1].trim()

  // Git Bash: "MINGW64:/c/Users/foo"
  const bashMatch = title.match(/MINGW\d*:([^\s]+)/i)
  if (bashMatch?.[1]) return normalizeBashPath(bashMatch[1].trim())

  // Generic Windows path
  const pathMatch = title.match(/([A-Z]:\\[^|<>"]+)/i)
  if (pathMatch?.[1]) return pathMatch[1].trim()

  return null
}

function normalizeBashPath(value: string): string {
  return value
    .replace(/^\/([a-z])\//i, (_, drive: string) => `${drive.toUpperCase()}:\\`)
    .replace(/\//g, '\\')
}
