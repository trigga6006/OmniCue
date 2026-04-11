/**
 * Dangerous-tier action handlers. Every invocation requires explicit user confirmation
 * via the existing agent-interactions approval UI.
 */

import { ensurePsScript, runPsScript } from './powershell'
import { ok, fail, type ActionHandler } from './helpers'

const T = 'dangerous' as const

const PS_DELETE_TO_RECYCLE = `param([string]$Path)
Add-Type -AssemblyName Microsoft.VisualBasic
if (-not (Test-Path $Path)) {
  Write-Error "File not found: $Path"
  exit 1
}
[Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(
  $Path,
  [Microsoft.VisualBasic.FileIO.UIOption]::OnlyErrorDialogs,
  [Microsoft.VisualBasic.FileIO.RecycleOption]::SendToRecycleBin
)
Write-Output "recycled"
`

const PS_PRESS_ENTER = `
Add-Type -AssemblyName System.Windows.Forms
Start-Sleep -Milliseconds 100
[System.Windows.Forms.SendKeys]::SendWait("{ENTER}")
Write-Output "ok"
`

async function pressEnterAction(actionId: string): Promise<ReturnType<ActionHandler>> {
  const script = ensurePsScript('press-enter', PS_PRESS_ENTER)
  const result = await runPsScript(script)
  if (result.exitCode !== 0) return fail(actionId, T, result.stderr || 'Failed')
  return ok(actionId, T, 'Pressed Enter')
}

export const dangerousHandlers: Record<string, ActionHandler> = {
  'delete-file': async (params) => {
    const filePath = String(params.path ?? '')
    if (!filePath) return fail('delete-file', T, 'path is required')
    const script = ensurePsScript('delete-to-recycle', PS_DELETE_TO_RECYCLE)
    const result = await runPsScript(script, [filePath])
    if (result.exitCode !== 0) return fail('delete-file', T, result.stderr || 'Delete failed')
    return ok('delete-file', T, `Moved to recycle bin: ${filePath}`)
  },

  'send-input': async (params) => {
    if (params.confirm !== true) return fail('send-input', T, 'confirm must be true')
    return pressEnterAction('send-input')
  },

  'submit-form': async (params) => {
    if (params.confirm !== true) return fail('submit-form', T, 'confirm must be true')
    return pressEnterAction('submit-form')
  },
}
