/**
 * Resume capsule builder.
 * Derives a compact resumable state from timeline entries + conversation data.
 */

import type { ResumeCapsule, WorkStateEntry } from './types'
import type { StoredConversation } from '../conversations'
import { getSessionEntries } from './store'

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

/**
 * Build a resume capsule from the most recent timeline entries and conversation metadata.
 * Falls back to conversation messages if no timeline entries exist.
 */
export function buildResumeCapsule(args: {
  conversation: StoredConversation
  recentEntries?: WorkStateEntry[]
}): ResumeCapsule {
  const { conversation } = args
  const entries =
    args.recentEntries ?? getSessionEntries(conversation.id, { limit: 5 })
  const latest = entries.length > 0 ? entries[entries.length - 1] : null

  // Derive goal from conversation title or first user message
  const firstUserMsg = conversation.messages.find((m) => m.role === 'user')
  const goal =
    conversation.title && conversation.title !== 'New conversation'
      ? conversation.title
      : firstUserMsg
        ? truncate(firstUserMsg.content, 200)
        : undefined

  // Last user and assistant messages
  const lastUserMsg = [...conversation.messages]
    .reverse()
    .find((m) => m.role === 'user')
  const lastAssistantMsg = [...conversation.messages]
    .reverse()
    .find((m) => m.role === 'assistant')

  // Desktop state: prefer latest timeline entry, fall back to message metadata
  const desktop = latest?.desktop ?? {
    activeApp: lastUserMsg?.activeApp || '',
    processName: lastUserMsg?.processName || '',
    windowTitle: lastUserMsg?.screenshotTitle || '',
    packId: lastUserMsg?.packId,
    packVariant: lastUserMsg?.packVariant,
  }

  // Context: only from timeline entries (messages don't have structured context)
  const context = latest?.context

  // Pending state from latest entry
  const pending = latest?.agent
    ? {
        waitingOn: latest.agent.waitingOn,
        pendingInteractions: latest.agent.pendingInteractions,
        lastToolUse: latest.agent.lastToolUse,
      }
    : undefined

  // Collect tags from recent entries
  const tagSet = new Set<string>()
  for (const e of entries) {
    for (const t of e.tags) {
      tagSet.add(t)
      if (tagSet.size >= 10) break
    }
    if (tagSet.size >= 10) break
  }

  // Summary: prefer latest entry summary, else derive from desktop
  const summary = latest?.summary ?? deriveSummary(desktop, context)

  return {
    updatedAt: Date.now(),
    conversationId: conversation.id,
    provider: conversation.provider,
    goal,
    lastUserMessage: lastUserMsg ? truncate(lastUserMsg.content, 200) : undefined,
    lastAssistantMessage: lastAssistantMsg
      ? truncate(lastAssistantMsg.content, 200)
      : undefined,
    lastAssistantAction: latest?.agent?.lastToolUse
      ? `Used ${latest.agent.lastToolUse.name}`
      : undefined,
    desktop,
    context,
    pending: pending?.waitingOn || pending?.pendingInteractions?.length || pending?.lastToolUse
      ? pending
      : undefined,
    tags: [...tagSet],
    summary,
  }
}

function deriveSummary(
  desktop: ResumeCapsule['desktop'],
  context?: ResumeCapsule['context']
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
  if (desktop.activeApp) {
    return `Using ${desktop.activeApp}${desktop.windowTitle ? ': ' + truncate(desktop.windowTitle, 50) : ''}`
  }
  return 'Desktop session'
}
