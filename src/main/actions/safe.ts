/**
 * Safe-tier action handlers. Execute immediately, no confirmation needed.
 */

import { clipboard, shell } from 'electron'
import { saveNote as saveNoteToWorkspace, listNotes, getNote, deleteNote } from '../workspace-notes'
import { ok, fail, type ActionHandler } from './helpers'

const T = 'safe' as const

export const safeHandlers: Record<string, ActionHandler> = {
  'clipboard-write': async (params) => {
    const text = String(params.text ?? '')
    if (!text) return fail('clipboard-write', T, 'text is required')
    clipboard.writeText(text)
    return ok('clipboard-write', T, `Copied ${text.length} characters to clipboard`)
  },

  'open-url': async (params) => {
    const url = String(params.url ?? '')
    try {
      const parsed = new URL(url)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        return fail('open-url', T, 'Only http/https URLs allowed')
      }
      await shell.openExternal(url)
      return ok('open-url', T, `Opened ${parsed.hostname}`)
    } catch {
      return fail('open-url', T, `Invalid URL: ${url}`)
    }
  },

  'open-file': async (params) => {
    const filePath = String(params.path ?? '')
    if (!filePath) return fail('open-file', T, 'path is required')
    const result = await shell.openPath(filePath)
    if (result) return fail('open-file', T, result)
    return ok('open-file', T, `Opened ${filePath}`)
  },

  'reveal-in-folder': async (params) => {
    const filePath = String(params.path ?? '')
    if (!filePath) return fail('reveal-in-folder', T, 'path is required')
    shell.showItemInFolder(filePath)
    return ok('reveal-in-folder', T, `Revealed ${filePath}`)
  },

  'save-note': async (params) => {
    const result = await saveNoteToWorkspace(params)
    if (!result.ok) return fail('save-note', T, result.error || 'Failed to save note')
    return ok('save-note', T, `Note saved (${result.id})`)
  },

  'list-notes': async () => {
    const notes = listNotes()
    return ok('list-notes', T, JSON.stringify(notes))
  },

  'get-note': async (params) => {
    const id = String(params.id ?? '')
    if (!id) return fail('get-note', T, 'id is required')
    const note = getNote(id)
    if (!note) return fail('get-note', T, `Note not found: ${id}`)
    return ok('get-note', T, JSON.stringify(note))
  },

  'delete-note': async (params) => {
    const id = String(params.id ?? '')
    if (!id) return fail('delete-note', T, 'id is required')
    const result = deleteNote(id)
    if (!result.ok) return fail('delete-note', T, result.error || 'Failed to delete note')
    return ok('delete-note', T, `Deleted note: ${id}`)
  },
}
