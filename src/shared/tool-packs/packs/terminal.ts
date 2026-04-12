import type { ToolPack, PackQuickAction } from '../types'

const PROCESS_NAMES = new Set([
  'windowsterminal', 'powershell', 'pwsh', 'cmd',
  'warp', 'iterm2', 'alacritty', 'hyper', 'terminal',
  'wezterm', 'kitty', 'conhost',
  'bash', 'zsh', 'fish', 'sh',
  'mintty', // Git Bash on Windows
])

const APP_NAMES_LC = [
  'windows terminal', 'command prompt', 'powershell',
  'warp', 'iterm', 'alacritty', 'hyper', 'terminal',
  'wezterm', 'kitty',
]

const TITLE_PATTERNS_LC = [
  'terminal', 'powershell', 'cmd.exe', 'command prompt',
  'mingw64', 'mingw32', 'msys2', 'git bash',
]

function detectShellHint(title: string, proc: string): string | undefined {
  const t = title.toLowerCase()
  const p = proc.toLowerCase()
  if (t.includes('powershell') || p === 'powershell' || p === 'pwsh') return 'powershell'
  if (t.includes('cmd.exe') || t.includes('command prompt') || p === 'cmd') return 'cmd'
  if (t.includes('mingw') || t.includes('git bash') || p === 'mintty') return 'bash'
  if (t.includes('msys2')) return 'bash'
  if (p === 'bash' || p === 'zsh' || p === 'fish' || p === 'sh') return p
  if (t.includes('zsh')) return 'zsh'
  if (t.includes('bash')) return 'bash'
  if (t.includes('fish')) return 'fish'
  return undefined
}

function detectTerminalFamily(app: string, proc: string): string | undefined {
  const a = app.toLowerCase()
  const p = proc.toLowerCase()
  if (p === 'windowsterminal' || a.includes('windows terminal')) return 'windows-terminal'
  if (a.includes('warp') || p === 'warp') return 'warp'
  if (a.includes('iterm') || p === 'iterm2') return 'iterm'
  if (a.includes('alacritty') || p === 'alacritty') return 'alacritty'
  if (a.includes('hyper') || p === 'hyper') return 'hyper'
  if (a.includes('wezterm') || p === 'wezterm') return 'wezterm'
  if (a.includes('kitty') || p === 'kitty') return 'kitty'
  if (p === 'mintty') return 'git-bash'
  if (p === 'cmd' || p === 'conhost') return 'cmd'
  if (p === 'powershell' || p === 'pwsh') return 'powershell'
  return undefined
}

function detectAdmin(title: string): boolean {
  return /administrator|elevated|sudo/i.test(title)
}

export const terminalPack: ToolPack = {
  id: 'terminal',
  name: 'Terminal',

  match({ activeApp, processName, windowTitle }) {
    const proc = processName.toLowerCase()
    const app = activeApp.toLowerCase()
    const title = windowTitle.toLowerCase()

    // Process name match
    if (PROCESS_NAMES.has(proc)) {
      const ctx: Record<string, string> = {}
      const family = detectTerminalFamily(activeApp, processName)
      if (family) ctx.terminalFamily = family
      const shell = detectShellHint(windowTitle, processName)
      if (shell) ctx.shellHint = shell
      if (detectAdmin(windowTitle)) ctx.isAdmin = 'true'

      return { packId: 'terminal', packName: 'Terminal', confidence: 0.95, context: ctx, variant: family }
    }

    // App name match
    if (APP_NAMES_LC.some(a => app.includes(a))) {
      const ctx: Record<string, string> = {}
      const family = detectTerminalFamily(activeApp, processName)
      if (family) ctx.terminalFamily = family
      const shell = detectShellHint(windowTitle, processName)
      if (shell) ctx.shellHint = shell
      if (detectAdmin(windowTitle)) ctx.isAdmin = 'true'

      return { packId: 'terminal', packName: 'Terminal', confidence: 0.85, context: ctx, variant: family }
    }

    // Title pattern match — lower confidence
    if (TITLE_PATTERNS_LC.some(p => title.includes(p))) {
      const ctx: Record<string, string> = {}
      const shell = detectShellHint(windowTitle, processName)
      if (shell) ctx.shellHint = shell
      if (detectAdmin(windowTitle)) ctx.isAdmin = 'true'

      return { packId: 'terminal', packName: 'Terminal', confidence: 0.7, context: ctx }
    }

    return null
  },

  getQuickActions(_match, ocrText) {
    const actions: PackQuickAction[] = []
    const hasError = ocrText && /error|failed|exception|traceback|fatal|panic|denied|not found|command not found/i.test(ocrText)

    if (hasError) {
      actions.push(
        { id: 'explain-error', label: 'Explain error', prompt: 'Explain this error and suggest how to fix it.', icon: 'Bug' },
        { id: 'fix-it', label: 'Fix it', prompt: 'Write a fix for the error visible in my terminal.', icon: 'Zap' },
      )
    } else {
      actions.push(
        { id: 'explain-output', label: 'Explain output', prompt: 'Explain what this terminal output means.', icon: 'FileText' },
        { id: 'next-step', label: 'Next step', prompt: 'What should I do next based on this terminal output?', icon: 'Zap' },
      )
    }

    actions.push(
      { id: 'suggest-cmd', label: 'Suggest command', prompt: 'Suggest a useful command I could run next.', icon: 'Terminal' },
    )

    // Bridge-powered actions when terminal context is available
    if (hasError) {
      actions.push(
        { id: 'jump-to-error', label: 'Jump to source', prompt: 'Parse the stack trace and open the source file at the error location.', icon: 'ExternalLink' },
      )
    }

    actions.push(
      { id: 'review-changes', label: 'Review changes', prompt: 'Show and review my uncommitted git changes in this project.', icon: 'GitBranch' },
      { id: 'run-tests', label: 'Run tests', prompt: 'Find and run the test script for this project.', icon: 'CheckCircle2' },
    )

    return actions
  },

  buildContextNote(match) {
    const parts: string[] = []
    const c = match.context
    if (c.terminalFamily) parts.push(`Terminal: ${c.terminalFamily}`)
    if (c.shellHint) parts.push(`Shell: ${c.shellHint}`)
    if (c.isAdmin === 'true') parts.push('Elevated')
    return parts.length > 0 ? parts.join(', ') : ''
  },
}
