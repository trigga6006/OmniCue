import type { ActiveWindowInfo } from '../activeWindow'

interface FocusEntry {
  activeApp: string
  processName: string
  windowTitle: string
  timestamp: number
}

const MAX_HISTORY = 20
const history: FocusEntry[] = []
let lastProcessName = ''
let lastWindowTitle = ''

export function recordFocus(info: ActiveWindowInfo | null): void {
  if (!info) return

  const nextProcess = info.processName || ''
  const nextTitle = info.windowTitle || ''
  if (nextProcess === lastProcessName && nextTitle === lastWindowTitle) return

  lastProcessName = nextProcess
  lastWindowTitle = nextTitle

  history.push({
    activeApp: info.activeApp || '',
    processName: nextProcess,
    windowTitle: nextTitle,
    timestamp: Date.now(),
  })

  if (history.length > MAX_HISTORY) {
    history.shift()
  }
}

export function getFocusHistory(): FocusEntry[] {
  return [...history]
}

export function getRecentApps(): string[] {
  const seen = new Set<string>()
  const recent: string[] = []

  for (const entry of [...history].reverse()) {
    const key = entry.processName || entry.activeApp
    if (!key || seen.has(key)) continue
    seen.add(key)
    recent.push(entry.activeApp || entry.processName)
  }

  return recent
}
