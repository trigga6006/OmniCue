/** Terminal bridge types — shared across buffer, processes, git, scripts, errors, logs. */

export interface TerminalBuffer {
  lines: string[]
  visibleLineCount: number
  totalLines: number | null
  shell: string
  cwd: string | null
  truncated: boolean
  source: 'uia' | 'ocr'
}

export interface TerminalCwd {
  cwd: string | null
  projectRoot: string | null
  shell: string
  pid: number | null
  source: 'process' | 'prompt' | 'title' | null
}

export interface RunningProcess {
  pid: number
  name: string
  commandLine: string
  startedAt: string | null
  runtimeSeconds: number | null
}

export interface RecentCommand {
  command: string
  exitCode: number | null
  timestamp: string | null
}

export interface TerminalProcesses {
  shell: { pid: number | null; name: string; cwd: string | null }
  running: RunningProcess[]
  recentCommands: RecentCommand[]
}

export interface LogTailResult {
  path: string
  lines: string[]
  lineCount: number
  format: 'json' | 'syslog' | 'plain' | 'unknown'
  filtered: boolean
  truncated: boolean
}

export interface ProjectScript {
  name: string
  command: string
  category: 'test' | 'build' | 'lint' | 'dev' | 'deploy' | 'other'
}

export interface ProjectScripts {
  projectType: string | null
  packageManager: string | null
  scripts: ProjectScript[]
  cwd: string | null
}

export interface ScriptRunResult {
  ok: boolean
  script: string
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  truncated: boolean
}

export interface GitStatus {
  cwd: string
  branch: string
  ahead: number
  behind: number
  staged: Array<{ path: string; status: string }>
  unstaged: Array<{ path: string; status: string }>
  untracked: string[]
}

export interface GitDiff {
  cwd: string
  branch: string
  status: { staged: string[]; unstaged: string[]; untracked: string[] }
  diff: string
  stats: { filesChanged: number; insertions: number; deletions: number }
}

export interface GitLogEntry {
  hash: string
  shortHash: string
  message: string
  author: string
  date: string
  filesChanged: number
}

export interface GitLog {
  cwd: string
  commits: GitLogEntry[]
}

export interface StackFrame {
  raw: string
  file: string | null
  line: number | null
  column: number | null
  function: string | null
  exists: boolean
  isProjectFile: boolean
}

export interface ParsedStackTrace {
  language: string | null
  errorMessage: string | null
  errorType: string | null
  frames: StackFrame[]
}

export interface ErrorPacket {
  detected: boolean
  packet: {
    errorMessage: string
    errorType: string | null
    stackTrace: StackFrame[] | null
    terminalContext: string[]
    sourceContext: {
      file: string
      startLine: number
      endLine: number
      content: string
      language: string | null
    } | null
    gitDiff: string | null
    project: { type: string | null; cwd: string | null }
    suggestedActions: string[]
  } | null
}
