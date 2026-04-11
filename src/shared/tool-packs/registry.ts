import type { ToolPack } from './types'
import { idePack } from './packs/ide'
import { terminalPack } from './packs/terminal'
import { browserPack } from './packs/browser'
import { fileExplorerPack } from './packs/fileExplorer'

export const registry: ToolPack[] = [
  idePack,
  terminalPack,
  browserPack,
  fileExplorerPack,
]
