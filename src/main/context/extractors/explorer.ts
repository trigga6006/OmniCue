import { homedir } from 'os'
import { join } from 'path'
import type { ActiveWindowInfo } from '../../activeWindow'
import type { FileExplorerContext } from '../types'

const SPECIAL_FOLDERS: Record<string, string> = {
  desktop: join(homedir(), 'Desktop'),
  documents: join(homedir(), 'Documents'),
  downloads: join(homedir(), 'Downloads'),
  music: join(homedir(), 'Music'),
  pictures: join(homedir(), 'Pictures'),
  videos: join(homedir(), 'Videos'),
}

export function extractExplorerContext(
  activeWin: ActiveWindowInfo,
  pack: { context: Record<string, string> }
): FileExplorerContext | undefined {
  const title = activeWin.windowTitle?.trim() || ''
  const folderLabel = pack.context.folderLabel?.trim() || title

  let currentPath: string | undefined
  const pathMatch = title.match(/^([A-Z]:\\.+)$/i)
  if (pathMatch?.[1]) {
    currentPath = pathMatch[1]
  } else {
    currentPath = SPECIAL_FOLDERS[title.toLowerCase()]
  }

  if (!folderLabel && !currentPath) return undefined

  return { folderLabel, currentPath }
}
