/** Process tree walking and running command detection. */

import type { TerminalProcesses, RunningProcess, RecentCommand } from './types'
import { runPsCommand } from '../actions/powershell'

/** Get the process tree for a terminal host PID. */
export async function getTerminalProcesses(
  hostPid: number | null,
  shell: string,
  cwd: string | null,
  bufferLines?: string[]
): Promise<TerminalProcesses> {
  const running: RunningProcess[] = []

  if (hostPid) {
    try {
      const result = await runPsCommand(
        `Get-CimInstance Win32_Process | Where-Object { $_.ParentProcessId -eq ${hostPid} } | ` +
        `Select-Object ProcessId, Name, CommandLine, CreationDate | ConvertTo-Json -Compress`,
        5000
      )

      if (result.exitCode === 0 && result.stdout.trim()) {
        const parsed = JSON.parse(result.stdout)
        const procs = Array.isArray(parsed) ? parsed : [parsed]

        for (const proc of procs) {
          if (!proc.Name) continue
          // Skip known shell internals
          const nameLc = (proc.Name as string).toLowerCase()
          if (nameLc === 'conhost' || nameLc === 'conhost.exe') continue

          const startedAt = proc.CreationDate
            ? new Date(proc.CreationDate).toISOString()
            : null
          const runtimeSeconds = startedAt
            ? Math.round((Date.now() - new Date(startedAt).getTime()) / 1000)
            : null

          running.push({
            pid: proc.ProcessId,
            name: proc.Name,
            commandLine: proc.CommandLine || proc.Name,
            startedAt,
            runtimeSeconds,
          })
        }
      }
    } catch {
      // Process tree unavailable
    }
  }

  // Parse recent commands from buffer lines
  const recentCommands = bufferLines ? parseRecentCommands(bufferLines, shell) : []

  return {
    shell: { pid: hostPid, name: shell, cwd },
    running,
    recentCommands,
  }
}

/** Extract recent commands from terminal buffer lines using prompt patterns. */
function parseRecentCommands(lines: string[], shell: string): RecentCommand[] {
  const commands: RecentCommand[] = []
  const promptPatterns = getPromptPatterns(shell)

  for (const line of lines) {
    for (const pattern of promptPatterns) {
      const match = line.match(pattern)
      if (match) {
        const cmd = match[1]?.trim()
        if (cmd && cmd.length > 0 && cmd.length < 500) {
          commands.push({ command: cmd, exitCode: null, timestamp: null })
        }
        break
      }
    }
  }

  // Return last 20 commands
  return commands.slice(-20)
}

function getPromptPatterns(shell: string): RegExp[] {
  switch (shell) {
    case 'powershell':
      return [
        /^PS\s+[A-Z]:\\[^>]*>\s*(.+)$/i,  // PS C:\Users\foo> command
      ]
    case 'cmd':
      return [
        /^[A-Z]:\\[^>]*>\s*(.+)$/i,  // C:\Users\foo>command
      ]
    case 'bash':
    case 'zsh':
    case 'sh':
      return [
        /^\$\s+(.+)$/,                // $ command
        /^[^$#]*\$\s+(.+)$/,          // user@host:~$ command
        /^[^$#]*#\s+(.+)$/,           // root prompt
      ]
    default:
      return [
        /^[>$#]\s*(.+)$/,             // Generic prompt
        /^PS\s+[A-Z]:\\[^>]*>\s*(.+)$/i,
        /^[A-Z]:\\[^>]*>\s*(.+)$/i,
      ]
  }
}

/** Get the cwd of a specific process by PID. */
export async function getProcessCwd(pid: number): Promise<string | null> {
  try {
    const result = await runPsCommand(
      `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`,
      3000
    )
    if (result.exitCode !== 0 || !result.stdout.trim()) return null

    // Try to extract directory from command line
    const cmdLine = result.stdout.trim()
    const dirMatch = cmdLine.match(/--working-directory\s+"?([^"]+)"?/i)
      || cmdLine.match(/-wd\s+"?([^"]+)"?/i)
    return dirMatch?.[1] || null
  } catch {
    return null
  }
}
