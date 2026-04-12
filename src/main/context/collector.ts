import { clipboard, type BrowserWindow } from 'electron'
import { resolvePack } from '../../shared/tool-packs/resolver'
import { getActiveWindowAsync } from '../activeWindow'
import { getCurrentDisplayId } from '../desktop-tools'
import { extractBrowserContext } from './extractors/browser'
import { extractEditorContext } from './extractors/editor'
import { extractExplorerContext } from './extractors/explorer'
import { extractSystemContext } from './extractors/system'
import { extractTerminalContext } from './extractors/terminal'
import { getRecentApps } from './focus-history'
import type { DesktopSnapshot, SnapshotPack } from './types'

export async function collectSnapshot(
  win: BrowserWindow | null,
  options?: { includeClipboard?: boolean; skipSystem?: boolean }
): Promise<DesktopSnapshot> {
  const activeWin = await getActiveWindowAsync()
  const resolvedPack = activeWin
    ? resolvePack({
        activeApp: activeWin.activeApp || '',
        processName: activeWin.processName || '',
        windowTitle: activeWin.windowTitle || '',
      })
    : null

  const pack: SnapshotPack | null = resolvedPack
    ? {
        id: resolvedPack.packId,
        variant: resolvedPack.variant,
        context: resolvedPack.context,
      }
    : null

  const editor = activeWin && pack?.id === 'ide' ? extractEditorContext(activeWin, pack) : undefined
  const terminal = activeWin && pack?.id === 'terminal' ? extractTerminalContext(activeWin, pack) : undefined
  const browser = activeWin && pack?.id === 'browser' ? await extractBrowserContext(activeWin, pack) : undefined
  const fileExplorer = activeWin && pack?.id === 'fileExplorer' ? extractExplorerContext(activeWin, pack) : undefined
  const system = options?.skipSystem
    ? { runningApps: [], focusHistory: getRecentApps() }
    : await extractSystemContext()

  return {
    activeApp: activeWin?.activeApp || '',
    processName: activeWin?.processName || '',
    windowTitle: activeWin?.windowTitle || '',
    display: getCurrentDisplayId(win),
    clipboard: options?.includeClipboard ? clipboard.readText() || '' : undefined,
    pack,
    editor,
    terminal,
    browser,
    fileExplorer,
    system,
  }
}
