/**
 * Active window detection via PowerShell + Win32 API.
 * Captures the foreground window title and process info before Electron steals focus.
 */

import { spawnSync } from 'child_process'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'

export interface ActiveWindowInfo {
  activeApp: string      // e.g. "Visual Studio Code"
  processName: string    // e.g. "Code"
  windowTitle: string    // e.g. "index.ts — OmniCue — Visual Studio Code"
}

// PowerShell script — must preserve real newlines for here-string (@"..."@) syntax
const PS_SCRIPT = `Add-Type @"
using System;
using System.Runtime.InteropServices;
using System.Diagnostics;
using System.Text;
public class OmniWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll", CharSet=CharSet.Unicode)]
  public static extern int GetWindowText(IntPtr hWnd, StringBuilder text, int count);
  [DllImport("user32.dll")]
  public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
$h = [OmniWin]::GetForegroundWindow()
$sb = New-Object System.Text.StringBuilder 512
[void][OmniWin]::GetWindowText($h, $sb, 512)
$pid2 = [uint32]0
[void][OmniWin]::GetWindowThreadProcessId($h, [ref]$pid2)
try {
  $p = [System.Diagnostics.Process]::GetProcessById($pid2)
  $desc = $p.MainModule.FileVersionInfo.FileDescription
  if (-not $desc) { $desc = $p.ProcessName }
  @{t=$sb.ToString();p=$p.ProcessName;a=$desc} | ConvertTo-Json -Compress
} catch {
  @{t=$sb.ToString();p="unknown";a="unknown"} | ConvertTo-Json -Compress
}
`

// Write the script to a temp file once on module load
const SCRIPT_PATH = join(tmpdir(), 'omnicue-activewin.ps1')

function ensureScript(): void {
  if (!existsSync(SCRIPT_PATH)) {
    writeFileSync(SCRIPT_PATH, PS_SCRIPT, 'utf-8')
  }
}

/**
 * Get the currently focused window's title and process info.
 * Returns null on non-Windows platforms or on failure.
 */
export function getActiveWindow(): ActiveWindowInfo | null {
  if (process.platform !== 'win32') return null

  try {
    ensureScript()

    const result = spawnSync('powershell', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
      '-File', SCRIPT_PATH,
    ], {
      encoding: 'utf-8',
      timeout: 3000,
      windowsHide: true,
    })

    const raw = (result.stdout || '').trim()
    if (!raw || result.status !== 0) return null

    const parsed = JSON.parse(raw) as { t: string; p: string; a: string }
    if (!parsed.t && !parsed.p) return null

    return {
      windowTitle: parsed.t || '',
      processName: parsed.p || 'unknown',
      activeApp: parsed.a || parsed.p || 'unknown',
    }
  } catch {
    return null
  }
}

/**
 * Clean up the temp script file (call on app quit).
 */
export function cleanupActiveWindowScript(): void {
  try { unlinkSync(SCRIPT_PATH) } catch { /* best effort */ }
}

// ── Cached active window for hotkey race condition ──────────────────────────

let cachedWindow: { info: ActiveWindowInfo | null; capturedAt: number } | null = null
const CACHE_TTL_MS = 2000

/**
 * Capture and cache the active window. Called from the hotkey handler
 * in the main process BEFORE the Electron window takes focus.
 */
export function cacheActiveWindow(): void {
  cachedWindow = { info: getActiveWindow(), capturedAt: Date.now() }
}

/**
 * Consume the cached active window info if it's fresh enough.
 * Falls back to a live call if the cache is stale or empty.
 */
export function getActiveWindowCached(): ActiveWindowInfo | null {
  if (cachedWindow && Date.now() - cachedWindow.capturedAt < CACHE_TTL_MS) {
    const info = cachedWindow.info
    cachedWindow = null // consume once
    return info
  }
  return getActiveWindow()
}
