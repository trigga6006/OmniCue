import { existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { isAbsolute, join } from 'path'
import type { ActiveWindowInfo } from '../../activeWindow'
import { settingsStore } from '../../store'
import type { EditorContext } from '../types'

const COMMON_DEV_ROOTS = [
  join(homedir(), 'Documents', 'dev'),
  join(homedir(), 'projects'),
  join(homedir(), 'repos'),
  join(homedir(), 'src'),
  join(homedir(), 'code'),
  join(homedir(), 'Desktop'),
]

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function resolveWorkspacePath(projectName?: string): string | undefined {
  if (!projectName) return undefined

  const roots = [
    settingsStore.get().devRootPath,
    ...COMMON_DEV_ROOTS,
  ].filter(Boolean) as string[]

  for (const root of roots) {
    const candidate = join(root, projectName)
    if (existsSync(candidate) && isDirectory(candidate)) {
      return candidate
    }
  }

  return undefined
}

export function extractEditorContext(
  activeWin: ActiveWindowInfo,
  pack: { context: Record<string, string> }
): EditorContext | undefined {
  const fileName = pack.context.fileName?.trim()
  const projectName = pack.context.projectName?.trim()
  const language = pack.context.languageHint?.trim()
  const workspacePath = resolveWorkspacePath(projectName)

  let openFile = fileName
  if (workspacePath && fileName && !isAbsolute(fileName)) {
    openFile = join(workspacePath, fileName)
  }

  if (!workspacePath && !fileName && !projectName) return undefined

  return {
    workspacePath,
    openFile,
    fileName,
    projectName,
    language,
    isDirty: /^(?:\*|●)\s*/.test(activeWin.windowTitle || ''),
  }
}
