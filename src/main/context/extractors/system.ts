import { runPsCommand } from '../../actions/powershell'
import { getRecentApps } from '../focus-history'
import type { SystemContext } from '../types'

function parseRunningApps(raw: string): string[] {
  if (!raw.trim()) return []

  try {
    const parsed = JSON.parse(raw) as string | string[] | null
    if (Array.isArray(parsed)) {
      return parsed.filter(Boolean)
    }
    return parsed ? [parsed] : []
  } catch {
    return raw
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
  }
}

export async function extractSystemContext(): Promise<SystemContext> {
  let runningApps: string[] = []

  try {
    const result = await runPsCommand(
      'Get-Process | Where-Object { $_.MainWindowTitle -ne "" } | Select-Object -ExpandProperty ProcessName -Unique | Sort-Object | ConvertTo-Json -Compress',
      3000
    )
    if (result.exitCode === 0) {
      runningApps = parseRunningApps(result.stdout)
    }
  } catch {
    runningApps = []
  }

  return {
    runningApps,
    focusHistory: getRecentApps(),
  }
}
