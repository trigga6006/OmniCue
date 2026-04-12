/** Best-effort editor state from active window info and pack context. */

import type { ActiveWindowInfo } from '../activeWindow'
import type { IdeState } from './types'
import { resolvePack } from '../../shared/tool-packs/resolver'
import { existsSync, statSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { settingsStore } from '../store'

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
  kt: 'kotlin', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
  swift: 'swift', php: 'php', lua: 'lua', sh: 'shell', bash: 'shell',
  yml: 'yaml', yaml: 'yaml', json: 'json', toml: 'toml', md: 'markdown',
  html: 'html', css: 'css', scss: 'scss', sql: 'sql', graphql: 'graphql',
}

const COMMON_DEV_ROOTS = [
  join(homedir(), 'Documents', 'dev'),
  join(homedir(), 'projects'),
  join(homedir(), 'repos'),
  join(homedir(), 'src'),
  join(homedir(), 'code'),
  join(homedir(), 'Desktop'),
]

/** Get best-effort editor state from the active window. Returns null if not an IDE. */
export function getIdeState(win: ActiveWindowInfo): IdeState | null {
  const match = resolvePack({
    activeApp: win.activeApp,
    processName: win.processName,
    windowTitle: win.windowTitle,
  })

  if (!match || match.packId !== 'ide') return null

  const editorFamily = match.context.editorFamily || match.variant || null
  const fileName = match.context.fileName || null
  const projectName = match.context.projectName || null

  // Resolve workspace path
  let workspacePath: string | null = null
  if (projectName) {
    const roots = [
      settingsStore.get().devRootPath,
      ...COMMON_DEV_ROOTS,
    ].filter(Boolean) as string[]

    for (const root of roots) {
      const candidate = join(root, projectName)
      try {
        if (existsSync(candidate) && statSync(candidate).isDirectory()) {
          workspacePath = candidate
          break
        }
      } catch { /* ignore */ }
    }
  }

  // Derive language from file extension
  let language: string | null = null
  if (fileName) {
    const dot = fileName.lastIndexOf('.')
    if (dot >= 0) {
      const ext = fileName.slice(dot + 1).toLowerCase()
      language = LANG_MAP[ext] || null
    }
  }

  // Detect dirty state from window title
  const isDirty = /^(?:\*|●)\s*/.test(win.windowTitle || '')

  // Resolve open file path
  let openFile: string | null = null
  if (workspacePath && fileName) {
    const candidate = join(workspacePath, fileName)
    if (existsSync(candidate)) openFile = candidate
  }

  return {
    editor: editorFamily,
    workspacePath,
    openFile,
    language,
    isDirty,
  }
}
