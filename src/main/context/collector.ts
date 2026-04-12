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
import type { DesktopSnapshot, SnapshotPack, TerminalContext, EditorContext } from './types'
import { cachedCall } from '../terminal-bridge/cache'
import { findProjectRoot } from '../terminal-bridge/project-root'
import { getGitStatus } from '../terminal-bridge/git'

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

  let editor = activeWin && pack?.id === 'ide' ? extractEditorContext(activeWin, pack) : undefined
  let terminal = activeWin && pack?.id === 'terminal' ? extractTerminalContext(activeWin, pack) : undefined
  const browser = activeWin && pack?.id === 'browser' ? await extractBrowserContext(activeWin, pack) : undefined
  const fileExplorer = activeWin && pack?.id === 'fileExplorer' ? extractExplorerContext(activeWin, pack) : undefined
  const system = options?.skipSystem
    ? { runningApps: [], focusHistory: getRecentApps() }
    : await extractSystemContext()

  // Enrich terminal context with cached bridge data (non-blocking, short timeout)
  if (terminal?.cwd) {
    terminal = await enrichTerminalContext(terminal)
  }

  // Enrich editor context with cached bridge data
  if (editor?.workspacePath) {
    editor = await enrichEditorContext(editor)
  }

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

/** Merge cached bridge enrichments into terminal context. */
async function enrichTerminalContext(base: TerminalContext): Promise<TerminalContext> {
  if (!base.cwd) return base

  const projectInfo = await cachedCall(
    `project:${base.cwd}`,
    () => Promise.resolve(findProjectRoot(base.cwd!)),
    5000, // longer TTL — project root doesn't change often
    1000,
  )

  let gitBranch: string | undefined
  if (projectInfo?.root) {
    const status = await cachedCall(
      `git-branch:${projectInfo.root}`,
      () => getGitStatus(projectInfo.root),
      2000,
      2000,
    )
    gitBranch = status?.branch
  }

  return {
    ...base,
    cwdSource: 'title',
    projectRoot: projectInfo?.root,
    projectType: projectInfo?.type || undefined,
    gitBranch,
  }
}

/** Merge cached bridge enrichments into editor context. */
async function enrichEditorContext(base: EditorContext): Promise<EditorContext> {
  if (!base.workspacePath) return base

  const status = await cachedCall(
    `git-status:${base.workspacePath}`,
    () => getGitStatus(base.workspacePath!),
    2000,
    2000,
  )

  let gitStatus: EditorContext['gitStatus']
  if (status) {
    if (status.staged.length > 0) gitStatus = 'staged'
    else if (status.unstaged.length > 0) gitStatus = 'modified'
    else gitStatus = 'clean'
  }

  return {
    ...base,
    gitStatus,
  }
}
