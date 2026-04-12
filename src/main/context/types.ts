export interface SnapshotPack {
  id: string
  variant?: string
  context: Record<string, string>
}

export interface EditorContext {
  workspacePath?: string
  openFile?: string
  fileName?: string
  projectName?: string
  language?: string
  isDirty: boolean
  editorFamily?: string
  selectionAvailable?: boolean
  gitStatus?: 'clean' | 'modified' | 'staged'
}

export interface TerminalContext {
  shell: string
  cwd?: string
  isAdmin: boolean
  cwdSource?: 'process' | 'prompt' | 'title'
  projectRoot?: string
  gitBranch?: string
  projectType?: string
  runningProcesses?: Array<{ name: string; commandLine: string }>
  recentError?: { message: string; type: string | null; hasStackTrace: boolean }
}

export interface BrowserContext {
  pageTitle?: string
  site?: string
  browserFamily?: string
  url?: string
}

export interface FileExplorerContext {
  folderLabel?: string
  currentPath?: string
}

export interface SystemContext {
  runningApps: string[]
  focusHistory: string[]
}

export interface DesktopSnapshot {
  activeApp: string
  processName: string
  windowTitle: string
  display: number
  clipboard?: string
  pack: SnapshotPack | null
  editor?: EditorContext
  terminal?: TerminalContext
  browser?: BrowserContext
  fileExplorer?: FileExplorerContext
  system: SystemContext
}
