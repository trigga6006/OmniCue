/** Read terminal buffer via UI Automation, with OCR fallback. */

import type { TerminalBuffer } from './types'
import type { TerminalSession } from './session'
import { ensurePsScript, runPsScript } from '../actions/powershell'
import { getScreenText } from '../desktop-tools'

const MAX_LINES = 200

const PS_READ_BUFFER = [
  'param([string]$Hwnd)',
  'Add-Type -AssemblyName UIAutomationClient',
  'Add-Type -AssemblyName UIAutomationTypes',
  '',
  '$hwndInt = [IntPtr]([long]$Hwnd)',
  'try {',
  '  $el = [System.Windows.Automation.AutomationElement]::FromHandle($hwndInt)',
  '  $textPattern = $el.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)',
  '  $text = $textPattern.DocumentRange.GetText(65535)',
  '  @{ ok=$true; text=$text } | ConvertTo-Json -Compress',
  '} catch {',
  '  try {',
  '    $cond = [System.Windows.Automation.Condition]::TrueCondition',
  '    $children = $el.FindAll([System.Windows.Automation.TreeScope]::Descendants, $cond)',
  '    $texts = @()',
  '    foreach ($child in $children) {',
  '      try {',
  '        $tp = $child.GetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern)',
  '        $t = $tp.DocumentRange.GetText(65535)',
  '        if ($t) { $texts += $t }',
  '      } catch {}',
  '    }',
  '    if ($texts.Count -gt 0) {',
  '      @{ ok=$true; text=($texts -join "`n") } | ConvertTo-Json -Compress',
  '    } else {',
  '      @{ ok=$false; error="No text pattern found" } | ConvertTo-Json -Compress',
  '    }',
  '  } catch {',
  '    @{ ok=$false; error=$_.Exception.Message } | ConvertTo-Json -Compress',
  '  }',
  '}',
].join('\n')

export async function readTerminalBuffer(
  session: TerminalSession,
  mainWin: import('electron').BrowserWindow | null
): Promise<TerminalBuffer> {
  // Try UI Automation if we have a window handle
  if (session.hwnd) {
    try {
      const script = ensurePsScript('read-terminal-buffer', PS_READ_BUFFER)
      const result = await runPsScript(script, [String(session.hwnd)], 5000)

      if (result.exitCode === 0 && result.stdout) {
        const parsed = JSON.parse(result.stdout) as { ok: boolean; text?: string; error?: string }
        if (parsed.ok && parsed.text) {
          const allLines = parsed.text.split(/\r?\n/)
          const truncated = allLines.length > MAX_LINES
          const lines = truncated ? allLines.slice(-MAX_LINES) : allLines

          // Strip trailing empty lines
          while (lines.length > 0 && lines[lines.length - 1].trim() === '') {
            lines.pop()
          }

          return {
            lines,
            visibleLineCount: Math.min(lines.length, 50), // estimate
            totalLines: allLines.length,
            shell: session.shell,
            cwd: session.titleCwd,
            truncated,
            source: 'uia',
          }
        }
      }
    } catch {
      // Fall through to OCR
    }
  }

  // Fallback: OCR the screen
  const ocrResult = await getScreenText(undefined, mainWin)
  if (ocrResult?.screenText) {
    const allLines = ocrResult.screenText.split(/\r?\n/)
    const truncated = allLines.length > MAX_LINES
    const lines = truncated ? allLines.slice(-MAX_LINES) : allLines

    return {
      lines,
      visibleLineCount: lines.length,
      totalLines: null,
      shell: session.shell,
      cwd: session.titleCwd,
      truncated,
      source: 'ocr',
    }
  }

  return {
    lines: [],
    visibleLineCount: 0,
    totalLines: null,
    shell: session.shell,
    cwd: session.titleCwd,
    truncated: false,
    source: 'ocr',
  }
}
