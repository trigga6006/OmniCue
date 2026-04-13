/**
 * Ensure the CLI tools (claude, codex, etc.) are discoverable in PATH.
 *
 * Packaged Electron apps on Windows inherit their environment from
 * Explorer.exe, which may have a stale PATH that doesn't include
 * directories added after the user logged in (e.g. ~/.local/bin from
 * the Claude Code standalone installer, or %APPDATA%\npm).
 *
 * This module resolves the issue by:
 * 1. Adding well-known CLI directories to process.env.PATH at startup
 * 2. Optionally resolving the user's full shell PATH (reads latest
 *    registry values directly rather than relying on the inherited env)
 *
 * Must be called before any child_process spawns.
 */

import { existsSync } from 'fs'
import { homedir } from 'os'
import { delimiter, join } from 'path'

/** Directories that commonly contain CLI tools OmniCue needs. */
function getKnownCliDirs(): string[] {
  const home = homedir()
  const dirs: string[] = []

  if (process.platform === 'win32') {
    dirs.push(
      join(home, '.local', 'bin'),                       // Claude Code standalone installer
      join(home, 'AppData', 'Roaming', 'npm'),           // npm global (Windows)
      join(home, '.cargo', 'bin'),                       // Rust / cargo-installed tools
      join(home, 'AppData', 'Local', '.volta', 'bin'),   // Volta shims
      join(home, 'scoop', 'shims'),                      // Scoop
    )
  } else {
    dirs.push(
      join(home, '.local', 'bin'),
      '/usr/local/bin',
      join(home, '.cargo', 'bin'),
      join(home, '.volta', 'bin'),
    )
  }

  return dirs
}

/**
 * On Windows, read the *current* Machine + User PATH directly from the
 * registry rather than trusting the inherited `process.env.PATH`.
 * This catches modifications made after the Explorer session started.
 */
function getRegistryPath(): string | null {
  if (process.platform !== 'win32') return null

  try {
    const { execSync } = require('child_process') as typeof import('child_process')
    // PowerShell one-liner that reads Machine + User PATH from the registry
    const result = execSync(
      'powershell.exe -NoProfile -Command "[Environment]::GetEnvironmentVariable(\'PATH\',\'Machine\') + \';\' + [Environment]::GetEnvironmentVariable(\'PATH\',\'User\')"',
      { encoding: 'utf-8', timeout: 5000, windowsHide: true }
    ).trim()

    return result || null
  } catch {
    return null
  }
}

/**
 * Augment `process.env.PATH` so that CLI tools are discoverable.
 * Call this once at app startup, before `app.whenReady()`.
 */
export function fixPath(): void {
  const currentPath = process.env.PATH || ''
  const pathEntries = new Set(currentPath.split(delimiter).map(p => p.toLowerCase()))

  // Step 1: Merge in the latest registry PATH (catches stale Explorer env)
  const registryPath = getRegistryPath()
  if (registryPath) {
    for (const entry of registryPath.split(';')) {
      const trimmed = entry.trim()
      if (trimmed && !pathEntries.has(trimmed.toLowerCase())) {
        pathEntries.add(trimmed.toLowerCase())
        process.env.PATH = trimmed + delimiter + (process.env.PATH || '')
      }
    }
  }

  // Step 2: Ensure well-known CLI directories are present
  for (const dir of getKnownCliDirs()) {
    if (existsSync(dir) && !pathEntries.has(dir.toLowerCase())) {
      process.env.PATH = dir + delimiter + (process.env.PATH || '')
      pathEntries.add(dir.toLowerCase())
    }
  }

  console.log('[OmniCue] PATH fixed. Key dirs present:',
    getKnownCliDirs()
      .filter(d => existsSync(d))
      .map(d => `${d} (${pathEntries.has(d.toLowerCase()) ? 'yes' : 'NO'})`)
      .join(', ')
  )
}
