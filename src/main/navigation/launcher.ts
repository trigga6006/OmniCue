/**
 * Navigation launcher — executes structured LaunchSpec entries safely.
 *
 * Each LaunchSpec kind has a dedicated code path:
 * - uri: shell.openExternal (ms-settings:, x-apple.systempreferences:)
 * - path: expand env vars, then shell.openPath
 * - shell-folder: Windows explorer + shell: protocol
 * - command: spawn/execFile with explicit args
 * - app: macOS `open -a` app name
 */

import { shell } from 'electron'
import { homedir } from 'os'
import { execFile, exec } from 'child_process'
import type { NavEntry, LaunchSpec } from './catalog'

export interface LaunchResult {
  ok: boolean
  error?: string
}

/**
 * Expand Windows-style %ENV_VAR% and Unix ~ in path strings.
 */
function expandPath(target: string): string {
  // Expand %VAR% on Windows
  let result = target.replace(/%([^%]+)%/g, (_match, varName: string) => {
    return process.env[varName] || ''
  })
  // Expand ~ to home directory
  if (result.startsWith('~/') || result === '~') {
    result = homedir() + result.slice(1)
  }
  // Expand $USER on macOS/Linux
  result = result.replace(/\$USER/g, process.env.USER || process.env.USERNAME || '')
  return result
}

/**
 * Execute a LaunchSpec. Resolves with success/failure.
 */
async function executeLaunchSpec(spec: LaunchSpec): Promise<LaunchResult> {
  switch (spec.kind) {
    case 'uri': {
      try {
        await shell.openExternal(spec.target)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: `Failed to open URI: ${(e as Error).message}` }
      }
    }

    case 'path': {
      const expanded = expandPath(spec.target)
      try {
        const result = await shell.openPath(expanded)
        if (result) return { ok: false, error: result }
        return { ok: true }
      } catch (e) {
        return { ok: false, error: `Failed to open path: ${(e as Error).message}` }
      }
    }

    case 'shell-folder': {
      // Windows shell: protocol — open via explorer.exe
      return new Promise((resolve) => {
        if (process.platform !== 'win32') {
          resolve({ ok: false, error: 'Shell folders are Windows-only' })
          return
        }
        execFile('explorer.exe', [spec.target], (err) => {
          // explorer.exe often returns exit code 1 even on success
          if (err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
            resolve({ ok: false, error: 'explorer.exe not found' })
          } else {
            resolve({ ok: true })
          }
        })
      })
    }

    case 'command': {
      return new Promise((resolve) => {
        if (process.platform === 'win32') {
          // Use 'start' to detach the process from our console
          const fullCommand = spec.args
            ? `start "" "${spec.command}" ${spec.args.join(' ')}`
            : `start "" "${spec.command}"`
          exec(fullCommand, (err) => {
            if (err) {
              resolve({ ok: false, error: `Command failed: ${err.message}` })
            } else {
              resolve({ ok: true })
            }
          })
        } else {
          // macOS/Linux: execFile directly
          const args = spec.args || []
          execFile(spec.command, args, (err) => {
            if (err) {
              resolve({ ok: false, error: `Command failed: ${err.message}` })
            } else {
              resolve({ ok: true })
            }
          })
        }
      })
    }

    case 'app': {
      return new Promise((resolve) => {
        if (process.platform === 'darwin') {
          execFile('open', ['-a', spec.name], (err) => {
            if (err) {
              resolve({ ok: false, error: `Failed to open ${spec.name}: ${err.message}` })
            } else {
              resolve({ ok: true })
            }
          })
        } else {
          resolve({ ok: false, error: `'app' launch kind is macOS-only` })
        }
      })
    }

    default:
      return { ok: false, error: `Unknown launch spec kind` }
  }
}

/**
 * Launch a navigation entry for the current platform.
 */
export async function launchSystemLocation(entry: NavEntry): Promise<LaunchResult> {
  const platform = process.platform as 'win32' | 'darwin' | 'linux'
  const spec = entry[platform]

  if (!spec) {
    return { ok: false, error: `${entry.description} is not supported on ${platform}` }
  }

  return executeLaunchSpec(spec)
}
