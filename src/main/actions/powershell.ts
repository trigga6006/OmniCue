/**
 * PowerShell script runner for App Actions.
 * Follows the activeWindow.ts pattern: write scripts to %TEMP% once, reuse paths.
 */

import { spawn } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

const scriptCache = new Map<string, string>()

/** Write a PS1 script to temp if not already cached. Returns the file path. */
export function ensurePsScript(name: string, content: string): string {
  const cached = scriptCache.get(name)
  if (cached && existsSync(cached)) return cached
  const scriptPath = join(tmpdir(), `omnicue-action-${name}.ps1`)
  writeFileSync(scriptPath, content, 'utf-8')
  scriptCache.set(name, scriptPath)
  return scriptPath
}

/** Run a PowerShell script and return stdout + exit code. */
export function runPsScript(
  scriptPath: string,
  args: string[] = [],
  timeoutMs = 10000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', scriptPath, ...args,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    const timer = setTimeout(() => {
      child.kill()
      resolve({ stdout, stderr: stderr || 'Timed out', exitCode: 1 })
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ stdout: '', stderr: err.message, exitCode: 1 })
    })
  })
}

/** Run an inline PowerShell command and return stdout + exit code. */
export function runPsCommand(
  command: string,
  timeoutMs = 10000
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  return new Promise((resolve) => {
    const child = spawn('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-Command', command,
    ], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (data: Buffer) => { stdout += data.toString() })
    child.stderr.on('data', (data: Buffer) => { stderr += data.toString() })

    const timer = setTimeout(() => {
      child.kill()
      resolve({ stdout, stderr: stderr || 'Timed out', exitCode: 1 })
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ stdout: stdout.trim(), stderr: stderr.trim(), exitCode: code ?? 1 })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({ stdout: '', stderr: err.message, exitCode: 1 })
    })
  })
}

/** Remove all cached temp scripts (call on app quit). */
export function cleanupActionScripts(): void {
  for (const [, filePath] of scriptCache) {
    try { unlinkSync(filePath) } catch { /* best effort */ }
  }
  scriptCache.clear()
}
