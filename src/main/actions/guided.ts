/**
 * Guided-tier action handlers. Execute with a brief UI indicator, no blocking confirmation.
 * Uses PowerShell for keyboard/mouse/UI-automation on Windows.
 */

import { ensurePsScript, runPsScript } from './powershell'
import { ok, fail, type ActionHandler } from './helpers'

const T = 'guided' as const

// ── PowerShell script sources ───────────────────────────────────────────────

const PS_SEND_KEYS = `param([string]$Text)
Add-Type -AssemblyName System.Windows.Forms
# Small delay so the calling app isn't the foreground target
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait($Text)
Write-Output "ok"
`

const PS_PRESS_HOTKEY = `param([string]$Keys)
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 100

# Parse "ctrl+shift+s" style combos into SendKeys format
$map = @{ 'ctrl'='^'; 'alt'='%'; 'shift'='+'; 'win'='^{ESC}' }
$parts = $Keys.ToLower() -split '\\+'
$prefix = ''
$key = ''
foreach ($p in $parts) {
  $p = $p.Trim()
  if ($map.ContainsKey($p)) {
    $prefix += $map[$p]
  } else {
    # Map named keys to SendKeys tokens
    switch ($p) {
      'enter'     { $key = '{ENTER}' }
      'return'    { $key = '{ENTER}' }
      'tab'       { $key = '{TAB}' }
      'escape'    { $key = '{ESC}' }
      'esc'       { $key = '{ESC}' }
      'backspace' { $key = '{BACKSPACE}' }
      'delete'    { $key = '{DELETE}' }
      'del'       { $key = '{DELETE}' }
      'up'        { $key = '{UP}' }
      'down'      { $key = '{DOWN}' }
      'left'      { $key = '{LEFT}' }
      'right'     { $key = '{RIGHT}' }
      'home'      { $key = '{HOME}' }
      'end'       { $key = '{END}' }
      'pageup'    { $key = '{PGUP}' }
      'pagedown'  { $key = '{PGDN}' }
      'space'     { $key = ' ' }
      'f1'        { $key = '{F1}' }
      'f2'        { $key = '{F2}' }
      'f3'        { $key = '{F3}' }
      'f4'        { $key = '{F4}' }
      'f5'        { $key = '{F5}' }
      'f6'        { $key = '{F6}' }
      'f7'        { $key = '{F7}' }
      'f8'        { $key = '{F8}' }
      'f9'        { $key = '{F9}' }
      'f10'       { $key = '{F10}' }
      'f11'       { $key = '{F11}' }
      'f12'       { $key = '{F12}' }
      default     { $key = $p }
    }
  }
}
$combo = $prefix + '(' + $key + ')'
[System.Windows.Forms.SendKeys]::SendWait($combo)
Write-Output "ok"
`

const PS_CLICK_AT = `param([int]$X, [int]$Y)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OmniClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
"@
Start-Sleep -Milliseconds 100
[OmniClick]::SetCursorPos($X, $Y)
Start-Sleep -Milliseconds 50
[OmniClick]::mouse_event([OmniClick]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
[OmniClick]::mouse_event([OmniClick]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
Write-Output "ok"
`

const PS_CLICK_ELEMENT = `param([string]$Name)
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OmniClick {
  [DllImport("user32.dll")] public static extern bool SetCursorPos(int X, int Y);
  [DllImport("user32.dll")]
  public static extern void mouse_event(uint dwFlags, int dx, int dy, uint dwData, IntPtr dwExtraInfo);
  public const uint MOUSEEVENTF_LEFTDOWN = 0x0002;
  public const uint MOUSEEVENTF_LEFTUP = 0x0004;
}
"@

$root = [System.Windows.Automation.AutomationElement]::RootElement
$cond = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::NameProperty, $Name
)
$el = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $cond)
if ($el) {
  # Try InvokePattern first
  try {
    $invoke = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
    $invoke.Invoke()
    Write-Output "invoked"
    exit 0
  } catch {}
  # Fall back to clicking the bounding rect center
  $rect = $el.Current.BoundingRectangle
  if ($rect -and -not $rect.IsEmpty) {
    $cx = [int]($rect.X + $rect.Width / 2)
    $cy = [int]($rect.Y + $rect.Height / 2)
    [OmniClick]::SetCursorPos($cx, $cy)
    Start-Sleep -Milliseconds 50
    [OmniClick]::mouse_event([OmniClick]::MOUSEEVENTF_LEFTDOWN, 0, 0, 0, [IntPtr]::Zero)
    [OmniClick]::mouse_event([OmniClick]::MOUSEEVENTF_LEFTUP, 0, 0, 0, [IntPtr]::Zero)
    Write-Output "clicked at $cx,$cy"
    exit 0
  }
}
Write-Error "Element '$Name' not found"
exit 1
`

const PS_SWITCH_APP = `param([string]$Target)
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class OmniSwitch {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
  public const int SW_RESTORE = 9;
}
"@

# Try by process name first, then by window title substring
$procs = Get-Process | Where-Object {
  ($_.ProcessName -like "*$Target*" -or $_.MainWindowTitle -like "*$Target*") -and $_.MainWindowHandle -ne [IntPtr]::Zero
}
if ($procs) {
  $proc = @($procs)[0]
  [OmniSwitch]::ShowWindow($proc.MainWindowHandle, [OmniSwitch]::SW_RESTORE) | Out-Null
  [OmniSwitch]::SetForegroundWindow($proc.MainWindowHandle) | Out-Null
  Write-Output "switched to $($proc.ProcessName)"
} else {
  Write-Error "No window found matching '$Target'"
  exit 1
}
`

// ── Handlers ─────────────────────────────────���──────────────────────────────

export const guidedHandlers: Record<string, ActionHandler> = {
  'type-text': async (params) => {
    const text = String(params.text ?? '')
    if (!text) return fail('type-text', T, 'text is required')
    const escaped = text.replace(/([+^%~(){}[\]])/g, '{$1}')
    const script = ensurePsScript('send-keys', PS_SEND_KEYS)
    const result = await runPsScript(script, [escaped])
    if (result.exitCode !== 0) return fail('type-text', T, result.stderr || 'SendKeys failed')
    return ok('type-text', T, `Typed ${text.length} characters`)
  },

  'press-key': async (params) => {
    const keys = String(params.keys ?? '')
    if (!keys) return fail('press-key', T, 'keys is required')
    const script = ensurePsScript('press-hotkey', PS_PRESS_HOTKEY)
    const result = await runPsScript(script, [keys])
    if (result.exitCode !== 0) return fail('press-key', T, result.stderr || 'Hotkey failed')
    return ok('press-key', T, `Pressed ${keys}`)
  },

  'click-element': async (params) => {
    const name = params.name != null ? String(params.name) : null
    const x = typeof params.x === 'number' ? params.x : null
    const y = typeof params.y === 'number' ? params.y : null

    if (name) {
      const script = ensurePsScript('click-element', PS_CLICK_ELEMENT)
      const result = await runPsScript(script, [name])
      if (result.exitCode !== 0) return fail('click-element', T, result.stderr || `Element "${name}" not found`)
      return ok('click-element', T, result.stdout || `Clicked "${name}"`)
    }

    if (x != null && y != null) {
      const script = ensurePsScript('click-at', PS_CLICK_AT)
      const result = await runPsScript(script, [String(x), String(y)])
      if (result.exitCode !== 0) return fail('click-element', T, result.stderr || 'Click failed')
      return ok('click-element', T, `Clicked at (${x}, ${y})`)
    }

    return fail('click-element', T, 'Provide either "name" or both "x" and "y"')
  },

  'switch-app': async (params) => {
    const processName = String(params.processName ?? '')
    if (!processName) return fail('switch-app', T, 'processName is required')
    const script = ensurePsScript('switch-app', PS_SWITCH_APP)
    const result = await runPsScript(script, [processName])
    if (result.exitCode !== 0) return fail('switch-app', T, result.stderr || `App "${processName}" not found`)
    return ok('switch-app', T, result.stdout || `Switched to ${processName}`)
  },
}
