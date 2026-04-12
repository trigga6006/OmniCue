/**
 * Browser URL extraction via PowerShell UI Automation.
 * Reads the address bar value from Chrome, Edge, and Firefox on Windows.
 */

import { ensurePsScript, runPsScript } from '../actions/powershell'

export interface BrowserUrlResult {
  url: string | null
  browserFamily?: string
  pageTitle?: string
}

// Chromium browsers (Chrome, Edge, Brave, Arc, Opera, Vivaldi) share the same
// UI Automation tree. The address bar is an Edit control whose
// AutomationId or Name can vary by locale, so we search for Edit controls
// within the top-level browser window and pick the one whose Value looks
// like a URL.
//
// Firefox uses a different tree: the address bar is a ToolBar > Edit.
//
// Strategy: find the foreground window, walk descendants for Edit controls,
// return the first Value that looks like a URL or domain.

const PS_EXTRACT_URL = `param([string]$BrowserFamily)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement

# Get foreground window handle
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OmniBrowser {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
}
"@

$hwnd = [OmniBrowser]::GetForegroundWindow()
if ($hwnd -eq [IntPtr]::Zero) {
  Write-Output '{"url":null,"error":"no foreground window"}'
  exit 0
}

# Find the browser window element
try {
  $winEl = [System.Windows.Automation.AutomationElement]::FromHandle($hwnd)
} catch {
  Write-Output '{"url":null,"error":"cannot get window element"}'
  exit 0
}

$title = $winEl.Current.Name

# Search for Edit controls (address bar candidates)
$editCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
  [System.Windows.Automation.ControlType]::Edit
)

$edits = $winEl.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  $editCondition
)

$bestUrl = $null

foreach ($edit in $edits) {
  try {
    $valPattern = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
    $val = $valPattern.Current.Value
    if ($val -and ($val -match '^https?://' -or $val -match '^[a-zA-Z0-9][-a-zA-Z0-9]*\.[a-zA-Z]{2,}')) {
      $bestUrl = $val
      break
    }
  } catch {
    # Not all edits support ValuePattern — skip
  }
}

# Normalize: if it looks like a bare domain, prepend https://
if ($bestUrl -and $bestUrl -notmatch '^https?://') {
  $bestUrl = "https://$bestUrl"
}

$result = @{ url = $bestUrl; title = $title } | ConvertTo-Json -Compress
Write-Output $result
`

/**
 * Extract the current URL from the focused browser's address bar.
 * Returns null URL if the browser isn't focused or extraction fails.
 */
export async function extractBrowserUrl(browserFamily?: string): Promise<BrowserUrlResult> {
  if (process.platform !== 'win32') {
    return { url: null, browserFamily }
  }

  try {
    const script = ensurePsScript('browser-url', PS_EXTRACT_URL)
    const result = await runPsScript(script, [browserFamily || ''], 2500)

    if (result.exitCode !== 0 || !result.stdout.trim()) {
      return { url: null, browserFamily }
    }

    const parsed = JSON.parse(result.stdout.trim()) as { url: string | null; title?: string }
    return {
      url: parsed.url || null,
      browserFamily,
      pageTitle: parsed.title || undefined,
    }
  } catch {
    return { url: null, browserFamily }
  }
}
