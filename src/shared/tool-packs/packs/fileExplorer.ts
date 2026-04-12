import type { ToolPack, PackQuickAction } from '../types'

const PROCESS_NAMES = new Set([
  'explorer', 'finder',
])

const APP_NAMES_LC = [
  'file explorer', 'windows explorer', 'finder',
]

function parseFolderLabel(title: string): string {
  // Explorer titles are typically the folder name, or a full path for pinned/quick-access items.
  // We expose whatever the title says without claiming it's an absolute path.
  return title.trim()
}

export const fileExplorerPack: ToolPack = {
  id: 'fileExplorer',
  name: 'File Explorer',

  match({ activeApp, processName, windowTitle }) {
    const proc = processName.toLowerCase()
    const app = activeApp.toLowerCase()

    // Process name match
    if (PROCESS_NAMES.has(proc)) {
      // On Windows, "explorer" can also be the desktop/taskbar.
      // A real File Explorer window has a meaningful window title.
      const isDesktop = !windowTitle || windowTitle === 'Program Manager' || windowTitle === 'Windows Default Lock Screen'
      if (isDesktop) return null

      const ctx: Record<string, string> = {}
      ctx.explorerFamily = proc === 'finder' ? 'finder' : 'windows-explorer'
      const label = parseFolderLabel(windowTitle)
      if (label) ctx.folderLabel = label

      return { packId: 'fileExplorer', packName: 'File Explorer', confidence: 0.9, context: ctx }
    }

    // App name match
    if (APP_NAMES_LC.some(a => app.includes(a))) {
      const ctx: Record<string, string> = {}
      ctx.explorerFamily = app.includes('finder') ? 'finder' : 'windows-explorer'
      const label = parseFolderLabel(windowTitle)
      if (label) ctx.folderLabel = label

      return { packId: 'fileExplorer', packName: 'File Explorer', confidence: 0.8, context: ctx }
    }

    return null
  },

  getQuickActions(_match) {
    const actions: PackQuickAction[] = [
      { id: 'suggest-org', label: 'Suggest organization', prompt: 'Suggest how I could organize the files visible on screen.', icon: 'FolderOpen' },
      { id: 'explain-folder', label: 'Explain folder', prompt: 'Explain what this folder likely contains based on what is visible.', icon: 'HelpCircle' },
    ]

    return actions
  },

  buildContextNote(match) {
    const parts: string[] = []
    const c = match.context
    if (c.explorerFamily) parts.push(`Explorer: ${c.explorerFamily}`)
    if (c.folderLabel) parts.push(`Folder: ${c.folderLabel}`)
    return parts.length > 0 ? parts.join(', ') : ''
  },
}
