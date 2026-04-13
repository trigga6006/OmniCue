/**
 * CLI environment resolution for Claude Code binary.
 *
 * On Windows, packaged Electron apps inherit their environment from
 * Explorer.exe which may have a stale PATH. This module builds a
 * complete PATH and resolves the claude binary location.
 */

import { execSync } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'
import { debugLog } from './logger'

let cachedPath: string | null = null
let cachedBinary: string | null = null

/**
 * Build a comprehensive PATH that includes:
 * 1. Current process.env.PATH
 * 2. Fresh registry PATH on Windows (catches stale Explorer env)
 * 3. Well-known CLI tool directories
 */
export function getCliPath(): string {
  if (cachedPath) return cachedPath

  const entries: string[] = []
  const seen = new Set<string>()

  function addEntries(rawPath: string | undefined, sep = delimiter): void {
    if (!rawPath) return
    for (const entry of rawPath.split(sep)) {
      const p = entry.trim()
      const key = p.toLowerCase()
      if (!p || seen.has(key)) continue
      seen.add(key)
      entries.push(p)
    }
  }

  // Start from current process PATH
  addEntries(process.env.PATH)

  // On Windows, read fresh PATH from registry (catches post-login installs)
  if (process.platform === 'win32') {
    try {
      const result = execSync(
        'powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\',\'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'PATH\',\'User\')"',
        { encoding: 'utf-8', timeout: 5000, windowsHide: true }
      ).trim()
      addEntries(result, ';')
    } catch { /* best effort */ }
  }

  // Add well-known CLI directories
  const home = homedir()
  const knownDirs = process.platform === 'win32'
    ? [
        join(home, '.local', 'bin'),                       // Claude Code standalone installer
        join(home, 'AppData', 'Roaming', 'npm'),           // npm global (Windows)
        join(home, '.cargo', 'bin'),                       // Rust / cargo-installed tools
        join(home, 'AppData', 'Local', '.volta', 'bin'),   // Volta shims
        join(home, 'scoop', 'shims'),                      // Scoop
      ]
    : [
        join(home, '.local', 'bin'),
        '/usr/local/bin',
        '/opt/homebrew/bin',
        join(home, '.cargo', 'bin'),
        join(home, '.volta', 'bin'),
        join(home, '.npm-global', 'bin'),
      ]

  for (const dir of knownDirs) {
    if (existsSync(dir)) {
      addEntries(dir)
    }
  }

  cachedPath = entries.join(delimiter)
  return cachedPath
}

/**
 * Get a complete environment for spawning CLI tools.
 */
export function getCliEnv(): NodeJS.ProcessEnv {
  return {
    ...process.env,
    PATH: getCliPath(),
  }
}

/**
 * Find the claude binary. Checks known locations, then falls back
 * to system lookup. Caches the result.
 */
export function findClaudeBinary(): string {
  if (cachedBinary) return cachedBinary

  const home = homedir()

  if (process.platform === 'win32') {
    // Windows: check known locations for .exe and .cmd shims
    const candidates = [
      join(home, '.local', 'bin', 'claude.exe'),
      join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
      join(home, 'AppData', 'Roaming', 'npm', 'claude'),
      join(home, 'scoop', 'shims', 'claude.exe'),
      join(home, 'scoop', 'shims', 'claude.cmd'),
    ]

    for (const c of candidates) {
      if (existsSync(c)) {
        debugLog(`Claude binary found: ${c}`)
        cachedBinary = c
        return c
      }
    }

    // Fall back to `where` on the augmented PATH
    try {
      const result = execSync('where claude', {
        encoding: 'utf-8',
        timeout: 5000,
        windowsHide: true,
        env: getCliEnv(),
      }).trim()
      const firstLine = result.split(/\r?\n/)[0]?.trim()
      if (firstLine) {
        debugLog(`Claude binary via where: ${firstLine}`)
        cachedBinary = firstLine
        return firstLine
      }
    } catch { /* not found */ }
  } else {
    // macOS/Linux
    const candidates = [
      '/usr/local/bin/claude',
      '/opt/homebrew/bin/claude',
      join(home, '.npm-global', 'bin', 'claude'),
      join(home, '.local', 'bin', 'claude'),
    ]

    for (const c of candidates) {
      if (existsSync(c)) {
        debugLog(`Claude binary found: ${c}`)
        cachedBinary = c
        return c
      }
    }

    // Try interactive login shell
    const shellCommands = [
      '/bin/zsh -ilc "whence -p claude"',
      '/bin/bash -lc "which claude"',
    ]
    for (const cmd of shellCommands) {
      try {
        const result = execSync(cmd, { encoding: 'utf-8', timeout: 3000, env: getCliEnv() }).trim()
        if (result) {
          debugLog(`Claude binary via shell: ${result}`)
          cachedBinary = result
          return result
        }
      } catch { /* keep trying */ }
    }
  }

  debugLog('Claude binary not found in known locations, using bare "claude"')
  cachedBinary = 'claude'
  return 'claude'
}

/**
 * Determine if a resolved binary path is a .cmd shim (Windows npm global).
 * .cmd shims need shell:true to execute; .exe files can be spawned directly.
 */
export function needsShell(binaryPath: string): boolean {
  return binaryPath.toLowerCase().endsWith('.cmd')
}
