/**
 * Agent workspace — note storage.
 * Notes live as markdown with YAML frontmatter under ~/OmniCue/notes/.
 * All I/O is sandboxed to the notes directory.
 */

import { app } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { settingsStore } from './store'
import { getActiveWindowAsync } from './activeWindow'

// ── Types ───────────────────────────────────────────────────────────────────

export interface Note {
  id: string
  title: string
  content: string
  savedFrom?: string
  source?: string
  createdAt: number
  updatedAt?: number
}

export type NoteSummary = Omit<Note, 'content' | 'updatedAt'>

// ── Path helpers ────────────────────────────────────────────────────────────

export function getAgentWorkspaceRoot(): string {
  const settings = settingsStore.get()
  if (settings.agentWorkspacePath) {
    if (path.isAbsolute(settings.agentWorkspacePath)) return path.resolve(settings.agentWorkspacePath)
  }
  return path.join(app.getPath('home'), 'OmniCue')
}

export function getNotesDir(): string {
  return path.join(getAgentWorkspaceRoot(), 'notes')
}

export function ensureNotesDir(): void {
  const dir = getNotesDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

/**
 * Check that a candidate path is safely within the given root.
 * Uses path.relative() to avoid startsWith prefix collisions
 * (e.g. ~/OmniCue2 matching ~/OmniCue).
 */
function isWithinRoot(root: string, candidate: string): boolean {
  const normalizedRoot = path.resolve(root)
  const normalizedCandidate = path.resolve(candidate)
  if (normalizedCandidate === normalizedRoot) return true
  const relative = path.relative(normalizedRoot, normalizedCandidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}

/** Slugify a string into a safe filename component. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}

/** Map a note ID to a safe file path within the notes directory. */
function noteFilePath(id: string): string | null {
  // IDs should be alphanumeric + hyphens (slugified titles)
  if (!/^[a-z0-9-]+$/i.test(id)) return null
  const filePath = path.join(getNotesDir(), `${id}.md`)
  if (!isWithinRoot(getNotesDir(), filePath)) return null
  return filePath
}

// ── Frontmatter parsing ─────────────────────────────────────────────────────

function parseFrontmatter(raw: string): { meta: Record<string, string>; content: string } {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/)
  if (!match) return { meta: {}, content: raw }

  const meta: Record<string, string> = {}
  for (const line of match[1].split('\n')) {
    const colon = line.indexOf(':')
    if (colon < 0) continue
    const key = line.slice(0, colon).trim()
    let value = line.slice(colon + 1).trim()
    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    meta[key] = value
  }

  return { meta, content: match[2].trim() }
}

function buildFrontmatter(note: {
  id: string
  title: string
  savedFrom?: string
  source?: string
  createdAt: number
}): string {
  const lines = [
    '---',
    `id: ${note.id}`,
    `title: "${note.title.replace(/"/g, '\\"')}"`,
  ]
  if (note.source) lines.push(`source: ${note.source}`)
  if (note.savedFrom) lines.push(`savedFrom: ${note.savedFrom}`)
  lines.push(`created: ${new Date(note.createdAt).toISOString()}`)
  lines.push('---')
  return lines.join('\n')
}

// ── CRUD ────────────────────────────────────────────────────────────────────

export function listNotes(): NoteSummary[] {
  const dir = getNotesDir()
  if (!fs.existsSync(dir)) return []

  const files = fs.readdirSync(dir).filter((f) => f.endsWith('.md'))
  const notes: NoteSummary[] = []

  for (const file of files) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8')
      const { meta } = parseFrontmatter(raw)
      const id = meta.id || path.basename(file, '.md')
      notes.push({
        id,
        title: meta.title || 'Untitled',
        savedFrom: meta.savedFrom,
        source: meta.source,
        createdAt: meta.created ? new Date(meta.created).getTime() : 0,
      })
    } catch {
      // Malformed file — skip rather than crash
    }
  }

  // Newest first
  notes.sort((a, b) => b.createdAt - a.createdAt)
  return notes
}

export function getNote(id: string): Note | null {
  const filePath = noteFilePath(id)
  if (!filePath || !fs.existsSync(filePath)) return null

  try {
    const raw = fs.readFileSync(filePath, 'utf-8')
    const { meta, content } = parseFrontmatter(raw)
    return {
      id: meta.id || id,
      title: meta.title || 'Untitled',
      content,
      savedFrom: meta.savedFrom,
      source: meta.source,
      createdAt: meta.created ? new Date(meta.created).getTime() : 0,
    }
  } catch {
    return null
  }
}

export interface SaveNoteParams {
  text: string
  title?: string
  source?: string
}

export async function saveNote(params: SaveNoteParams | Record<string, unknown>): Promise<{ ok: boolean; id?: string; error?: string }> {
  const text = String(params.text ?? '')
  if (!text) return { ok: false, error: 'text is required' }

  ensureNotesDir()

  const winInfo = await getActiveWindowAsync()
  const title = String(params.title || '') || winInfo?.windowTitle || 'Untitled'
  const slug = slugify(title) || 'note'
  const suffix = Math.random().toString(36).slice(2, 6)
  const id = `${slug}-${suffix}`

  const filePath = noteFilePath(id)
  if (!filePath) return { ok: false, error: 'Invalid note ID generated' }

  const frontmatter = buildFrontmatter({
    id,
    title,
    savedFrom: winInfo?.activeApp,
    source: params.source ? String(params.source) : undefined,
    createdAt: Date.now(),
  })

  const markdown = `${frontmatter}\n\n${text}\n`
  fs.writeFileSync(filePath, markdown, 'utf-8')

  return { ok: true, id }
}

export function deleteNote(id: string): { ok: boolean; error?: string } {
  const filePath = noteFilePath(id)
  if (!filePath) return { ok: false, error: 'Invalid note ID' }
  if (!fs.existsSync(filePath)) return { ok: false, error: 'Note not found' }

  try {
    fs.unlinkSync(filePath)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: (e as Error).message }
  }
}
