/**
 * Browser selected text extraction.
 *
 * Two methods with different safety tiers:
 * - UIA-only: safe tier (reads selection property from UI Automation)
 * - Clipboard dance: guided tier (sends Ctrl+C, reads clipboard, restores)
 */

import { clipboard } from 'electron'
import { ensurePsScript, runPsScript } from '../actions/powershell'

// ── UIA-based selection (safe) ───────────────────────────────────────────────

const PS_GET_SELECTION = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OmniBrowser {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$hwnd = [OmniBrowser]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output '{"text":null}'
  exit 0
}

try {
  $winEl = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
  $focused = $winEl

  # Try to get the focused element which may have a text selection
  try {
    $focused = [System.Windows.Automation.AutomationElement]::FocusedElement
  } catch {}

  # Try TextPattern for selection
  try {
    $textPattern = $focused.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)
    $selections = $textPattern.GetSelection()
    if ($selections.Length -gt 0) {
      $text = $selections[0].GetText(10000)
      if ($text) {
        @{ text = $text } | ConvertTo-Json -Compress
        exit 0
      }
    }
  } catch {}

  # Try ValuePattern as fallback (for edit controls)
  # This gets the full value, not just selection — less useful
  Write-Output '{"text":null}'
} catch {
  Write-Output '{"text":null}'
}
`

/**
 * Read selected text via UI Automation. Safe tier — no side effects.
 * Returns null if no selection is available or UIA doesn't support it.
 */
export async function getSelectedTextViaUiAutomation(): Promise<string | null> {
  if (process.platform !== 'win32') return null

  try {
    const script = ensurePsScript('browser-selection', PS_GET_SELECTION)
    const result = await runPsScript(script, [], 2500)

    if (result.exitCode !== 0 || !result.stdout.trim()) return null

    const parsed = JSON.parse(result.stdout.trim()) as { text: string | null }
    return parsed.text || null
  } catch {
    return null
  }
}

// ── Clipboard dance (guided) ─────────────────────────────────────────────────

const PS_COPY_SELECTION = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("^(c)")
Start-Sleep -Milliseconds 200
Write-Output "ok"
`

/**
 * Capture selected text by sending Ctrl+C and reading the clipboard.
 * Guided tier — this is invasive because it:
 *   1. Saves current clipboard state
 *   2. Sends Ctrl+C to the focused app
 *   3. Reads the clipboard
 *   4. Restores original clipboard state
 */
export async function captureSelectedTextViaClipboardDance(): Promise<string | null> {
  if (process.platform !== 'win32') return null

  // Save current clipboard
  const originalClipboard = clipboard.readText()

  // Clear clipboard so we can detect new content
  clipboard.writeText('')

  try {
    const script = ensurePsScript('copy-selection', PS_COPY_SELECTION)
    const result = await runPsScript(script, [], 3000)

    if (result.exitCode !== 0) return null

    // Small delay for clipboard to settle
    await new Promise(resolve => setTimeout(resolve, 100))

    const newText = clipboard.readText()
    return newText || null
  } finally {
    // Restore original clipboard
    clipboard.writeText(originalClipboard)
  }
}
