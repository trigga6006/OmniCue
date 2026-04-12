import type { ActiveWindowInfo } from '../../activeWindow'
import type { TerminalContext } from '../types'

function normalizeBashPath(value: string): string {
  return value
    .replace(/^\/([a-z])\//i, (_, drive: string) => `${drive.toUpperCase()}:\\`)
    .replace(/\//g, '\\')
}

export function extractTerminalContext(
  activeWin: ActiveWindowInfo,
  pack: { variant?: string; context: Record<string, string> }
): TerminalContext | undefined {
  const title = activeWin.windowTitle || ''
  const shell = pack.context.shellHint || pack.variant || 'unknown'
  const isAdmin = pack.context.isAdmin === 'true' || /administrator|elevated/i.test(title)

  let cwd: string | undefined

  const psMatch = title.match(/PS\s+([A-Z]:\\[^>]+)>/i)
  if (psMatch?.[1]) cwd = psMatch[1].trim()

  if (!cwd) {
    const bashMatch = title.match(/MINGW\d*:([^\s]+)/i)
    if (bashMatch?.[1]) cwd = normalizeBashPath(bashMatch[1].trim())
  }

  if (!cwd) {
    const pathMatch = title.match(/([A-Z]:\\[^|<>"]+)/i)
    if (pathMatch?.[1]) cwd = pathMatch[1].trim()
  }

  return { shell, cwd, isAdmin }
}
