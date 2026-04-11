import type { ToolPack, PackQuickAction } from '../types'

const PROCESS_NAMES = new Set([
  'code', 'code - insiders', 'cursor', 'windsurf',
  'devenv', // Visual Studio
  'idea64', 'idea', 'webstorm64', 'webstorm', 'pycharm64', 'pycharm',
  'goland64', 'goland', 'phpstorm64', 'phpstorm', 'rubymine64', 'rubymine',
  'rider64', 'rider', 'clion64', 'clion', 'datagrip64', 'datagrip',
  'sublime_text',
  'vim', 'nvim', 'gvim',
  'zed',
])

const APP_NAMES_LC = [
  'visual studio code', 'vs code', 'vscode',
  'cursor', 'windsurf',
  'intellij', 'webstorm', 'pycharm', 'goland', 'phpstorm', 'rubymine',
  'rider', 'clion', 'datagrip',
  'sublime text',
  'zed',
]

const LANG_MAP: Record<string, string> = {
  ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
  py: 'python', rb: 'ruby', rs: 'rust', go: 'go', java: 'java',
  kt: 'kotlin', cs: 'csharp', cpp: 'cpp', c: 'c', h: 'c',
  swift: 'swift', php: 'php', lua: 'lua', sh: 'shell', bash: 'shell',
  yml: 'yaml', yaml: 'yaml', json: 'json', toml: 'toml', md: 'markdown',
  html: 'html', css: 'css', scss: 'scss', sql: 'sql', graphql: 'graphql',
}

function detectEditorFamily(app: string, proc: string): string | undefined {
  const a = app.toLowerCase()
  const p = proc.toLowerCase()
  if (a.includes('cursor') || p === 'cursor') return 'cursor'
  if (a.includes('windsurf') || p === 'windsurf') return 'windsurf'
  if (a.includes('visual studio code') || a.includes('vscode') || p === 'code' || p === 'code - insiders') return 'vscode'
  if (a.includes('intellij') || a.includes('webstorm') || a.includes('pycharm') ||
      a.includes('goland') || a.includes('phpstorm') || a.includes('rubymine') ||
      a.includes('rider') || a.includes('clion') || a.includes('datagrip')) return 'jetbrains'
  if (a.includes('sublime') || p === 'sublime_text') return 'sublime'
  if (p === 'vim' || p === 'nvim' || p === 'gvim') return 'vim'
  if (a.includes('zed') || p === 'zed') return 'zed'
  if (a.includes('visual studio') || p === 'devenv') return 'visualstudio'
  return undefined
}

/**
 * Parse VS Code style title: "filename - projectName - Visual Studio Code"
 * Also handles Cursor/Windsurf which use the same format.
 */
function parseVsCodeTitle(title: string): { fileName?: string; projectName?: string } {
  // Strip trailing " - Visual Studio Code" / " - Cursor" / etc.
  const cleaned = title
    .replace(/\s*[-–—]\s*(Visual Studio Code|VS Code|Cursor|Windsurf|Code - Insiders)\s*$/i, '')
    .trim()

  const parts = cleaned.split(/\s+[-–—]\s+/)
  if (parts.length >= 2) {
    return { fileName: parts[0].trim(), projectName: parts[1].trim() }
  }
  if (parts.length === 1 && parts[0]) {
    // Could be just a project name (Welcome tab) or just a file
    const seg = parts[0].trim()
    return seg.includes('.') ? { fileName: seg } : { projectName: seg }
  }
  return {}
}

/**
 * Parse JetBrains style title: "projectName – filename" or "filename – projectName [path]"
 */
function parseJetBrainsTitle(title: string): { fileName?: string; projectName?: string } {
  // Strip trailing IDE name
  const cleaned = title
    .replace(/\s*[-–—]\s*(IntelliJ IDEA|WebStorm|PyCharm|GoLand|PhpStorm|RubyMine|Rider|CLion|DataGrip).*$/i, '')
    .trim()

  const parts = cleaned.split(/\s+[–—]\s+/)
  if (parts.length >= 2) {
    // JetBrains typically: "project – file" but varies
    const first = parts[0].trim()
    const second = parts[1].trim().replace(/\s*\[.*\]$/, '')
    // If second has a dot extension, it's the file
    if (second.includes('.')) return { projectName: first, fileName: second }
    if (first.includes('.')) return { fileName: first, projectName: second }
    return { projectName: first, fileName: second }
  }
  return {}
}

function parseSublimeTitle(title: string): { fileName?: string; projectName?: string } {
  const cleaned = title.replace(/\s*[-–—]\s*Sublime Text\s*$/i, '').trim()
  const parts = cleaned.split(/\s+[-–—]\s+/)
  if (parts.length >= 2) {
    return { fileName: parts[0].trim(), projectName: parts[1].trim() }
  }
  if (parts[0]?.includes('.')) return { fileName: parts[0].trim() }
  return {}
}

function getLanguageHint(fileName?: string): string | undefined {
  if (!fileName) return undefined
  const dot = fileName.lastIndexOf('.')
  if (dot < 0) return undefined
  const ext = fileName.slice(dot + 1).toLowerCase()
  return LANG_MAP[ext]
}

export const idePack: ToolPack = {
  id: 'ide',
  name: 'IDE',

  match({ activeApp, processName, windowTitle }) {
    const proc = processName.toLowerCase()
    const app = activeApp.toLowerCase()

    // Process name match — high confidence
    if (PROCESS_NAMES.has(proc)) {
      const editorFamily = detectEditorFamily(activeApp, processName)
      const parsed = editorFamily === 'jetbrains'
        ? parseJetBrainsTitle(windowTitle)
        : editorFamily === 'sublime'
          ? parseSublimeTitle(windowTitle)
          : parseVsCodeTitle(windowTitle)

      const ctx: Record<string, string> = {}
      if (editorFamily) ctx.editorFamily = editorFamily
      if (parsed.fileName) ctx.fileName = parsed.fileName
      if (parsed.projectName) ctx.projectName = parsed.projectName
      const lang = getLanguageHint(parsed.fileName)
      if (lang) ctx.languageHint = lang

      return { packId: 'ide', packName: 'IDE', confidence: 0.95, context: ctx, variant: editorFamily }
    }

    // App name match — slightly lower confidence
    if (APP_NAMES_LC.some(a => app.includes(a))) {
      const editorFamily = detectEditorFamily(activeApp, processName)
      const parsed = parseVsCodeTitle(windowTitle)

      const ctx: Record<string, string> = {}
      if (editorFamily) ctx.editorFamily = editorFamily
      if (parsed.fileName) ctx.fileName = parsed.fileName
      if (parsed.projectName) ctx.projectName = parsed.projectName
      const lang = getLanguageHint(parsed.fileName)
      if (lang) ctx.languageHint = lang

      return { packId: 'ide', packName: 'IDE', confidence: 0.85, context: ctx, variant: editorFamily }
    }

    return null
  },

  getQuickActions(match, ocrText) {
    const actions: PackQuickAction[] = []
    const hasError = ocrText && /error|failed|exception|traceback|fatal|panic/i.test(ocrText)
    const fileName = match.context.fileName

    if (hasError) {
      actions.push(
        { id: 'fix-error', label: 'Fix error', prompt: 'Explain and fix the error visible in my editor.', icon: 'Bug' },
        { id: 'explain-error', label: 'Explain error', prompt: 'Explain what this error means and how to resolve it.', icon: 'HelpCircle' },
      )
    } else {
      actions.push(
        { id: 'review-code', label: 'Review code', prompt: 'Review the code visible on my screen for bugs, edge cases, and improvements.', icon: 'Code' },
        { id: 'explain-code', label: 'Explain this', prompt: 'Explain what the code on my screen does step by step.', icon: 'FileText' },
      )
    }

    // File-specific actions
    if (fileName && /\.(test|spec)\./i.test(fileName)) {
      actions.push(
        { id: 'add-tests', label: 'Add test cases', prompt: 'Suggest additional test cases for this test file.', icon: 'CheckCircle2' },
      )
    } else if (fileName) {
      actions.push(
        { id: 'write-tests', label: 'Write tests', prompt: 'Write tests for the code visible on screen.', icon: 'CheckCircle2' },
      )
    }

    return actions
  },

  buildContextNote(match) {
    const parts: string[] = []
    const c = match.context
    if (c.editorFamily) parts.push(`Editor: ${c.editorFamily}`)
    if (c.fileName) parts.push(`File: ${c.fileName}`)
    if (c.projectName) parts.push(`Project: ${c.projectName}`)
    if (c.languageHint) parts.push(`Language: ${c.languageHint}`)
    return parts.length > 0 ? parts.join(', ') : ''
  },
}
