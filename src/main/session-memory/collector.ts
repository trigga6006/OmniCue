/**
 * Session memory collector.
 * Captures work-state entries from explicit conversation events.
 * Generates deterministic summaries and tags (no LLM).
 */

import { randomUUID } from 'crypto'
import type { DesktopSnapshot } from '../context/types'
import type { WorkStateEntry } from './types'
import { appendEntry } from './store'
import { buildResumeCapsule } from './capsule'
import { loadConversation, updateConversationResumeCapsule } from '../conversations'

// ── Summary generation (template-based) ───────────────────────────────────────

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

function generateSummary(
  desktop: WorkStateEntry['desktop'],
  context: WorkStateEntry['context'],
  agent?: WorkStateEntry['agent']
): string {
  if (desktop.packId === 'browser' && context?.browser?.pageTitle) {
    return `Reading '${truncate(context.browser.pageTitle, 60)}' on ${context.browser.site || desktop.activeApp}`
  }
  if (desktop.packId === 'ide' && context?.editor) {
    const file = context.editor.openFile || context.editor.projectName || ''
    return file ? `Editing ${file} in ${desktop.activeApp}` : `Working in ${desktop.activeApp}`
  }
  if (desktop.packId === 'terminal' && context?.terminal?.cwd) {
    return `Terminal at ${context.terminal.cwd}`
  }
  if (desktop.packId === 'fileExplorer' && context?.fileExplorer) {
    return `Browsing ${context.fileExplorer.currentPath || context.fileExplorer.folderLabel || 'files'}`
  }
  if (agent?.lastUserMessage) {
    return `Asked: "${truncate(agent.lastUserMessage, 80)}"`
  }
  if (desktop.activeApp) {
    return `Using ${desktop.activeApp}${desktop.windowTitle ? ': ' + truncate(desktop.windowTitle, 50) : ''}`
  }
  return 'Desktop session'
}

// ── Tag generation (deterministic) ────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'shall',
  'should', 'may', 'might', 'must', 'can', 'could', 'to', 'of', 'in',
  'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through',
  'during', 'before', 'after', 'above', 'below', 'between', 'out',
  'off', 'over', 'under', 'again', 'further', 'then', 'once', 'here',
  'there', 'when', 'where', 'why', 'how', 'all', 'each', 'every',
  'both', 'few', 'more', 'most', 'other', 'some', 'such', 'no', 'nor',
  'not', 'only', 'own', 'same', 'so', 'than', 'too', 'very', 'just',
  'because', 'but', 'and', 'or', 'if', 'while', 'about', 'up', 'it',
  'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'they',
  'this', 'that', 'these', 'those', 'what', 'which', 'who', 'whom',
])

function generateTags(
  desktop: WorkStateEntry['desktop'],
  context: WorkStateEntry['context'],
  agent?: WorkStateEntry['agent'],
  provider?: string
): string[] {
  const tags: string[] = []

  // Pack-based tags
  if (desktop.packId) tags.push(desktop.packId)
  if (provider) tags.push(provider)

  // App family
  const appLower = desktop.activeApp.toLowerCase()
  if (appLower.includes('chrome') || appLower.includes('firefox') || appLower.includes('edge')) {
    tags.push('browser')
  }

  // Browser site hint
  if (context?.browser?.site) {
    const domain = context.browser.site.replace(/^www\./, '').split('.')[0]
    if (domain && domain.length > 2) tags.push(domain)
  }

  // Agent state tags
  if (agent?.waitingOn) tags.push('waiting')
  if (agent?.lastToolUse) tags.push('tool-call')
  if (agent?.pendingInteractions?.length) tags.push('pending-interaction')

  // A few keywords from user message
  if (agent?.lastUserMessage) {
    const words = agent.lastUserMessage
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 3 && !STOP_WORDS.has(w))
    for (const w of words.slice(0, 3)) {
      if (!tags.includes(w)) tags.push(w)
    }
  }

  return tags
}

// ── Snapshot → entry helpers ──────────────────────────────────────────────────

function snapshotToDesktop(snap: DesktopSnapshot): WorkStateEntry['desktop'] {
  return {
    activeApp: snap.activeApp,
    processName: snap.processName,
    windowTitle: snap.windowTitle,
    display: snap.display,
    packId: snap.pack?.id,
    packVariant: snap.pack?.variant,
  }
}

function snapshotToContext(snap: DesktopSnapshot): WorkStateEntry['context'] | undefined {
  const ctx: WorkStateEntry['context'] = {}
  let hasAny = false

  if (snap.browser) {
    ctx.browser = {
      pageTitle: snap.browser.pageTitle,
      site: snap.browser.site,
      browserFamily: snap.browser.browserFamily,
    }
    hasAny = true
  }
  if (snap.editor) {
    ctx.editor = {
      workspacePath: snap.editor.workspacePath,
      openFile: snap.editor.openFile,
      language: snap.editor.language,
      projectName: snap.editor.projectName,
    }
    hasAny = true
  }
  if (snap.terminal) {
    ctx.terminal = {
      cwd: snap.terminal.cwd,
      shell: snap.terminal.shell,
      isAdmin: snap.terminal.isAdmin,
    }
    hasAny = true
  }
  if (snap.fileExplorer) {
    ctx.fileExplorer = {
      currentPath: snap.fileExplorer.currentPath,
      folderLabel: snap.fileExplorer.folderLabel,
    }
    hasAny = true
  }

  return hasAny ? ctx : undefined
}

// ── Debounce state ────────────────────────────────────────────────────────────

let lastEntryTime = 0
let lastEntryKey = ''
const DEBOUNCE_MS = 5000

function shouldDebounce(desktop: WorkStateEntry['desktop'], trigger: WorkStateEntry['trigger']): boolean {
  // Always capture explicit events
  if (trigger === 'user-message' || trigger === 'manual') return false

  const now = Date.now()
  const key = `${desktop.activeApp}|${desktop.windowTitle}`

  if (now - lastEntryTime < DEBOUNCE_MS && key === lastEntryKey) {
    return true
  }

  return false
}

function recordEntry(entry: WorkStateEntry): void {
  lastEntryTime = entry.timestamp
  lastEntryKey = `${entry.desktop.activeApp}|${entry.desktop.windowTitle}`
  appendEntry(entry)
}

// ── Capsule update helper ─────────────────────────────────────────────────────

function maybeUpdateCapsule(conversationId: string): void {
  try {
    const conversation = loadConversation(conversationId)
    if (!conversation) return

    const capsule = buildResumeCapsule({ conversation })
    updateConversationResumeCapsule(conversationId, capsule)
  } catch {
    /* best-effort */
  }
}

// ── Public capture entry points ───────────────────────────────────────────────

export function onUserMessage(args: {
  conversationId: string
  runtimeSessionId: string
  provider: string
  message: string
  snapshot: DesktopSnapshot
}): void {
  const desktop = snapshotToDesktop(args.snapshot)
  const context = snapshotToContext(args.snapshot)
  const agent: WorkStateEntry['agent'] = {
    lastUserMessage: truncate(args.message, 200),
  }
  const tags = generateTags(desktop, context, agent, args.provider)
  const summary = generateSummary(desktop, context, agent)

  const entry: WorkStateEntry = {
    id: randomUUID(),
    timestamp: Date.now(),
    conversationId: args.conversationId,
    runtimeSessionId: args.runtimeSessionId,
    provider: args.provider,
    desktop,
    context,
    agent,
    tags,
    summary,
    trigger: 'user-message',
  }

  recordEntry(entry)
}

export function onAssistantFinish(args: {
  conversationId: string
  runtimeSessionId: string
  provider: string
  message: string
  lastToolUse?: { name: string; input?: string }
  waitingOn?: string
  snapshot?: DesktopSnapshot
}): void {
  const desktop = args.snapshot
    ? snapshotToDesktop(args.snapshot)
    : { activeApp: '', processName: '', windowTitle: '' }
  const context = args.snapshot ? snapshotToContext(args.snapshot) : undefined

  if (shouldDebounce(desktop, 'assistant-finish')) return

  const agent: WorkStateEntry['agent'] = {
    lastAssistantMessage: truncate(args.message, 200),
    lastToolUse: args.lastToolUse,
    waitingOn: args.waitingOn,
  }
  const tags = generateTags(desktop, context, agent, args.provider)
  const summary = generateSummary(desktop, context, agent)

  const entry: WorkStateEntry = {
    id: randomUUID(),
    timestamp: Date.now(),
    conversationId: args.conversationId,
    runtimeSessionId: args.runtimeSessionId,
    provider: args.provider,
    desktop,
    context,
    agent,
    tags,
    summary,
    trigger: 'assistant-finish',
  }

  recordEntry(entry)

  // Update capsule after assistant finishes
  maybeUpdateCapsule(args.conversationId)
}

export function onInteractionRequest(args: {
  conversationId: string
  runtimeSessionId: string
  provider: string
  interaction: { kind: string; title: string }
  snapshot?: DesktopSnapshot
}): void {
  const desktop = args.snapshot
    ? snapshotToDesktop(args.snapshot)
    : { activeApp: '', processName: '', windowTitle: '' }
  const context = args.snapshot ? snapshotToContext(args.snapshot) : undefined

  if (shouldDebounce(desktop, 'interaction-request')) return

  const agent: WorkStateEntry['agent'] = {
    waitingOn: `${args.interaction.kind}: ${args.interaction.title}`,
    pendingInteractions: [args.interaction],
  }
  const tags = generateTags(desktop, context, agent, args.provider)
  tags.push('pending-interaction')
  const summary = `Waiting on ${args.interaction.kind}: ${truncate(args.interaction.title, 60)}`

  const entry: WorkStateEntry = {
    id: randomUUID(),
    timestamp: Date.now(),
    conversationId: args.conversationId,
    runtimeSessionId: args.runtimeSessionId,
    provider: args.provider,
    desktop,
    context,
    agent,
    tags,
    summary,
    trigger: 'interaction-request',
  }

  recordEntry(entry)

  // Update capsule when interaction is requested
  maybeUpdateCapsule(args.conversationId)
}

export async function captureManual(args: {
  conversationId: string
  runtimeSessionId?: string
  provider: string
  snapshot: DesktopSnapshot
  includeClipboard?: boolean
}): Promise<void> {
  const desktop = snapshotToDesktop(args.snapshot)
  const context = snapshotToContext(args.snapshot)
  if (args.includeClipboard && args.snapshot.clipboard) {
    if (!context) {
      // context is undefined, create it
    }
    const ctx = context || {}
    ctx.clipboard = args.snapshot.clipboard
  }

  const tags = generateTags(desktop, context, undefined, args.provider)
  tags.push('pinned')
  const summary = generateSummary(desktop, context)

  const entry: WorkStateEntry = {
    id: randomUUID(),
    timestamp: Date.now(),
    conversationId: args.conversationId,
    runtimeSessionId: args.runtimeSessionId,
    provider: args.provider,
    desktop,
    context,
    tags,
    summary,
    trigger: 'manual',
  }

  recordEntry(entry)
  maybeUpdateCapsule(args.conversationId)
}
