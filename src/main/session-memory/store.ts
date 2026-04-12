/**
 * File-based session memory persistence.
 * Timeline entries stored per-conversation in userData/session-memory/.
 * Lightweight index for fast listing.
 */

import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync, unlinkSync, readdirSync } from 'fs'
import type {
  WorkStateEntry,
  SessionMemorySummary,
  SessionMemoryQuery,
  SessionMemoryResult,
} from './types'

const dataDir = app.getPath('userData')
const memoryDir = join(dataDir, 'session-memory')
const indexPath = join(memoryDir, 'index.json')

const MAX_TIMELINE_FILES = 100
const MAX_ENTRIES_PER_CONVERSATION = 200
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

function ensureDir(): void {
  if (!existsSync(memoryDir)) mkdirSync(memoryDir, { recursive: true })
}

// ── Index ─────────────────────────────────────────────────────────────────────

function readIndex(): SessionMemorySummary[] {
  try {
    const raw = readFileSync(indexPath, 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data.summaries) ? data.summaries : []
  } catch {
    return []
  }
}

function writeIndex(summaries: SessionMemorySummary[]): void {
  ensureDir()
  writeFileSync(indexPath, JSON.stringify({ summaries }, null, 2), 'utf-8')
}

// ── Timeline files ────────────────────────────────────────────────────────────

function timelinePath(conversationId: string): string {
  return join(memoryDir, `${conversationId}.json`)
}

function readTimeline(conversationId: string): WorkStateEntry[] {
  try {
    const raw = readFileSync(timelinePath(conversationId), 'utf-8')
    const data = JSON.parse(raw)
    return Array.isArray(data.entries) ? data.entries : []
  } catch {
    return []
  }
}

function writeTimeline(conversationId: string, entries: WorkStateEntry[]): void {
  ensureDir()
  writeFileSync(
    timelinePath(conversationId),
    JSON.stringify({ entries }, null, 2),
    'utf-8'
  )
}

// ── Public API ────────────────────────────────────────────────────────────────

export function appendEntry(entry: WorkStateEntry): void {
  ensureDir()

  const entries = readTimeline(entry.conversationId)
  entries.push(entry)

  // Ring buffer: drop oldest if over limit
  const trimmed =
    entries.length > MAX_ENTRIES_PER_CONVERSATION
      ? entries.slice(entries.length - MAX_ENTRIES_PER_CONVERSATION)
      : entries

  writeTimeline(entry.conversationId, trimmed)

  // Update index
  const index = readIndex()
  const existing = index.find((s) => s.conversationId === entry.conversationId)

  // Collect unique tags across all entries (capped at 20)
  const allTags = new Set<string>()
  for (const e of trimmed) {
    for (const t of e.tags) {
      allTags.add(t)
      if (allTags.size >= 20) break
    }
    if (allTags.size >= 20) break
  }

  const summary: SessionMemorySummary = {
    conversationId: entry.conversationId,
    title: existing?.title,
    provider: entry.provider,
    lastActivity: entry.timestamp,
    entryCount: trimmed.length,
    latestSummary: entry.summary,
    latestDesktopApp: entry.desktop.activeApp,
    tags: [...allTags],
  }

  if (existing) {
    Object.assign(existing, summary)
  } else {
    index.unshift(summary)
  }

  // Prune old timelines from index
  if (index.length > MAX_TIMELINE_FILES) {
    index.sort((a, b) => b.lastActivity - a.lastActivity)
    const pruned = index.splice(MAX_TIMELINE_FILES)
    for (const p of pruned) {
      try {
        unlinkSync(timelinePath(p.conversationId))
      } catch {
        /* already gone */
      }
    }
  }

  writeIndex(index)
}

export function getSessionEntries(
  conversationId: string,
  opts?: { limit?: number; since?: number }
): WorkStateEntry[] {
  let entries = readTimeline(conversationId)

  if (opts?.since) {
    entries = entries.filter((e) => e.timestamp >= opts.since!)
  }

  if (opts?.limit && entries.length > opts.limit) {
    entries = entries.slice(entries.length - opts.limit)
  }

  return entries
}

export function getSessionMemory(query: SessionMemoryQuery): SessionMemoryResult {
  const index = readIndex()
  let filtered = index

  if (query.conversationId) {
    filtered = filtered.filter((s) => s.conversationId === query.conversationId)
  }
  if (query.provider) {
    filtered = filtered.filter((s) => s.provider === query.provider)
  }
  if (query.since) {
    filtered = filtered.filter((s) => s.lastActivity >= query.since!)
  }
  if (query.app) {
    const appLower = query.app.toLowerCase()
    filtered = filtered.filter((s) => s.latestDesktopApp.toLowerCase().includes(appLower))
  }
  if (query.tags && query.tags.length > 0) {
    filtered = filtered.filter((s) => query.tags!.some((t) => s.tags.includes(t)))
  }

  // Sort newest first
  filtered.sort((a, b) => b.lastActivity - a.lastActivity)

  const limit = query.limit || 10
  const sliced = filtered.slice(0, limit)

  let totalEntries = 0
  const conversations = sliced.map((s) => {
    if (query.summaryOnly) {
      totalEntries += s.entryCount
      return {
        conversationId: s.conversationId,
        title: s.title,
        provider: s.provider,
        lastActivity: s.lastActivity,
        entries: [s.latestSummary] as string[],
      }
    }

    const entries = getSessionEntries(s.conversationId, {
      limit: query.limit,
      since: query.since,
    })
    const resultEntries = query.includeContext
      ? entries
      : entries.map(({ context, ...entry }) => entry)
    totalEntries += resultEntries.length

    return {
      conversationId: s.conversationId,
      title: s.title,
      provider: s.provider,
      lastActivity: s.lastActivity,
      entries: resultEntries,
    }
  })

  return { conversations, totalEntries }
}

export function listSessions(): SessionMemorySummary[] {
  const index = readIndex()
  index.sort((a, b) => b.lastActivity - a.lastActivity)
  return index
}

export function updateSessionTitle(conversationId: string, title: string): void {
  const index = readIndex()
  const entry = index.find((s) => s.conversationId === conversationId)
  if (entry) {
    entry.title = title
    writeIndex(index)
  }
}

export function deleteSessionTimeline(conversationId: string): void {
  // Remove file
  try {
    unlinkSync(timelinePath(conversationId))
  } catch {
    /* already gone */
  }

  // Update index
  const index = readIndex().filter((s) => s.conversationId !== conversationId)
  writeIndex(index)
}

/** Prune entries older than 7 days and remove empty timelines. Call on startup. */
export function pruneStale(): void {
  ensureDir()
  const cutoff = Date.now() - MAX_AGE_MS

  const files = readdirSync(memoryDir).filter(
    (f) => f.endsWith('.json') && f !== 'index.json'
  )

  for (const file of files) {
    try {
      const raw = readFileSync(join(memoryDir, file), 'utf-8')
      const data = JSON.parse(raw)
      if (!Array.isArray(data.entries)) continue

      const fresh = (data.entries as WorkStateEntry[]).filter(
        (e) => e.timestamp >= cutoff
      )

      if (fresh.length === 0) {
        unlinkSync(join(memoryDir, file))
      } else if (fresh.length < data.entries.length) {
        writeFileSync(
          join(memoryDir, file),
          JSON.stringify({ entries: fresh }, null, 2),
          'utf-8'
        )
      }
    } catch {
      /* skip corrupt files */
    }
  }

  // Rebuild index from surviving files
  const index: SessionMemorySummary[] = []
  const remainingFiles = readdirSync(memoryDir).filter(
    (f) => f.endsWith('.json') && f !== 'index.json'
  )

  for (const file of remainingFiles) {
    try {
      const raw = readFileSync(join(memoryDir, file), 'utf-8')
      const data = JSON.parse(raw)
      const entries = data.entries as WorkStateEntry[]
      if (!entries || entries.length === 0) continue

      const latest = entries[entries.length - 1]
      const allTags = new Set<string>()
      for (const e of entries) {
        for (const t of e.tags) {
          allTags.add(t)
          if (allTags.size >= 20) break
        }
        if (allTags.size >= 20) break
      }

      index.push({
        conversationId: latest.conversationId,
        provider: latest.provider,
        lastActivity: latest.timestamp,
        entryCount: entries.length,
        latestSummary: latest.summary,
        latestDesktopApp: latest.desktop.activeApp,
        tags: [...allTags],
      })
    } catch {
      /* skip */
    }
  }

  index.sort((a, b) => b.lastActivity - a.lastActivity)
  writeIndex(index.slice(0, MAX_TIMELINE_FILES))
}
