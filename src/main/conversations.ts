/**
 * File-based conversation persistence.
 * One JSON file per conversation in userData/conversations/.
 * Lightweight index in conversations-index.json for fast listing.
 */

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'fs'

const dataDir = app.getPath('userData')
const convoDir = join(dataDir, 'conversations')
const indexPath = join(dataDir, 'conversations-index.json')

const MAX_CONVERSATIONS = 100

function ensureDir(): void {
  if (!existsSync(convoDir)) mkdirSync(convoDir, { recursive: true })
}

// ── Types ────────────────────────────────────────────────────────────────────

export interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  createdAt: number
  toolUses?: Array<{ name: string; input: string }>
  screenshotTitle?: string
  manualScreenshotTitle?: string
  ocrText?: string
  screenType?: string
  activeApp?: string
  processName?: string
  clipboardText?: string
  packId?: string
  packName?: string
  packVariant?: string
  packConfidence?: number
  packContext?: Record<string, string>
}

export interface StoredConversation {
  id: string
  title: string
  provider: string
  createdAt: number
  updatedAt: number
  messageCount: number
  messages: StoredMessage[]
}

export interface ConversationSummary {
  id: string
  title: string
  provider: string
  createdAt: number
  updatedAt: number
  messageCount: number
  firstMessage: string
}

// ── Index management ─────────────────────────────────────────────────────────

function readIndex(): ConversationSummary[] {
  try {
    const raw = readFileSync(indexPath, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data.conversations) ? data.conversations : []
  } catch {
    return []
  }
}

function writeIndex(conversations: ConversationSummary[]): void {
  writeFileSync(indexPath, JSON.stringify({ conversations }, null, 2), 'utf-8')
}

function pruneIndex(index: ConversationSummary[]): ConversationSummary[] {
  if (index.length <= MAX_CONVERSATIONS) return index

  // Sort by updatedAt desc, keep the newest MAX_CONVERSATIONS
  index.sort((a, b) => b.updatedAt - a.updatedAt)
  const pruned = index.slice(MAX_CONVERSATIONS)
  const kept = index.slice(0, MAX_CONVERSATIONS)

  // Delete pruned conversation files
  for (const c of pruned) {
    const filePath = join(convoDir, `${c.id}.json`)
    try { unlinkSync(filePath) } catch { /* file may already be gone */ }
  }

  return kept
}

// ── Strip messages for storage ───────────────────────────────────────────────

function stripMessage(msg: Record<string, unknown>): StoredMessage {
  return {
    id: (msg.id as string) || '',
    role: (msg.role as 'user' | 'assistant') || 'user',
    content: (msg.content as string) || '',
    createdAt: (msg.createdAt as number) || Date.now(),
    // Keep useful metadata, strip large data URLs
    ...(msg.toolUses ? { toolUses: msg.toolUses as StoredMessage['toolUses'] } : {}),
    ...(msg.screenshotTitle ? { screenshotTitle: msg.screenshotTitle as string } : {}),
    ...(msg.manualScreenshotTitle ? { manualScreenshotTitle: msg.manualScreenshotTitle as string } : {}),
    ...(msg.ocrText ? { ocrText: msg.ocrText as string } : {}),
    ...(msg.screenType ? { screenType: msg.screenType as string } : {}),
    ...(msg.activeApp ? { activeApp: msg.activeApp as string } : {}),
    ...(msg.processName ? { processName: msg.processName as string } : {}),
    ...(msg.clipboardText ? { clipboardText: msg.clipboardText as string } : {}),
    ...(msg.packId ? { packId: msg.packId as string } : {}),
    ...(msg.packName ? { packName: msg.packName as string } : {}),
    ...(msg.packVariant ? { packVariant: msg.packVariant as string } : {}),
    ...(msg.packConfidence != null ? { packConfidence: msg.packConfidence as number } : {}),
    ...(msg.packContext ? { packContext: msg.packContext as Record<string, string> } : {}),
    // Explicitly NOT including: screenshot, manualScreenshot, interactions
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export function listConversations(): ConversationSummary[] {
  const index = readIndex()
  // Sort newest first
  index.sort((a, b) => b.updatedAt - a.updatedAt)
  return index
}

export function loadConversation(id: string): StoredConversation | null {
  ensureDir()
  const filePath = join(convoDir, `${id}.json`)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return JSON.parse(raw) as StoredConversation
  } catch {
    return null
  }
}

export function saveConversation(data: {
  id: string
  title: string
  provider: string
  messages: Record<string, unknown>[]
}): void {
  ensureDir()

  const strippedMessages = data.messages.map(stripMessage)
  const now = Date.now()

  // Check if this conversation already exists
  const existing = loadConversation(data.id)
  const createdAt = existing?.createdAt || now

  const conv: StoredConversation = {
    id: data.id,
    title: data.title,
    provider: data.provider,
    createdAt,
    updatedAt: now,
    messageCount: strippedMessages.length,
    messages: strippedMessages,
  }

  // Write conversation file
  const filePath = join(convoDir, `${data.id}.json`)
  writeFileSync(filePath, JSON.stringify(conv, null, 2), 'utf-8')

  // Update index
  const index = readIndex()
  const firstUserMsg = strippedMessages.find(m => m.role === 'user')
  const summary: ConversationSummary = {
    id: data.id,
    title: data.title,
    provider: data.provider,
    createdAt,
    updatedAt: now,
    messageCount: strippedMessages.length,
    firstMessage: firstUserMsg ? firstUserMsg.content.slice(0, 100) : '',
  }

  const existingIdx = index.findIndex(c => c.id === data.id)
  if (existingIdx >= 0) {
    index[existingIdx] = summary
  } else {
    index.unshift(summary)
  }

  writeIndex(pruneIndex(index))
}

export function deleteConversation(id: string): void {
  // Remove file
  const filePath = join(convoDir, `${id}.json`)
  try { unlinkSync(filePath) } catch { /* file may already be gone */ }

  // Update index
  const index = readIndex().filter(c => c.id !== id)
  writeIndex(index)
}

export function renameConversation(id: string, title: string): void {
  ensureDir()

  // Update the conversation file
  const filePath = join(convoDir, `${id}.json`)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    const conv = JSON.parse(raw) as StoredConversation
    conv.title = title
    writeFileSync(filePath, JSON.stringify(conv, null, 2), 'utf-8')
  } catch { /* file may not exist */ }

  // Update index
  const index = readIndex()
  const entry = index.find(c => c.id === id)
  if (entry) {
    entry.title = title
    writeIndex(index)
  }
}

/**
 * Rebuild the index from conversation files on disk.
 * Useful if the index gets out of sync.
 */
export function rebuildIndex(): void {
  ensureDir()
  const files = readdirSync(convoDir).filter(f => f.endsWith('.json'))
  const summaries: ConversationSummary[] = []

  for (const file of files) {
    try {
      const raw = readFileSync(join(convoDir, file), 'utf-8')
      const conv = JSON.parse(raw) as StoredConversation
      const firstUserMsg = conv.messages.find(m => m.role === 'user')
      summaries.push({
        id: conv.id,
        title: conv.title,
        provider: conv.provider,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
        messageCount: conv.messageCount,
        firstMessage: firstUserMsg ? firstUserMsg.content.slice(0, 100) : '',
      })
    } catch { /* skip corrupt files */ }
  }

  summaries.sort((a, b) => b.updatedAt - a.updatedAt)
  writeIndex(pruneIndex(summaries))
}
