import { memo, useCallback, useEffect, useState } from 'react'
import { motion } from 'motion/react'
import { ArrowLeft, Trash2, FileText, ChevronDown, ChevronRight } from 'lucide-react'
import { useCompanionStore } from '@/stores/companionStore'
import { timeAgo } from '@/lib/utils'
import type { NoteSummary, Note } from '@/lib/types'

export const NotesList = memo(function NotesList() {
  const [notes, setNotes] = useState<NoteSummary[]>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [expandedContent, setExpandedContent] = useState<string>('')

  const refresh = useCallback(async () => {
    const list = await window.electronAPI.listNotes()
    setNotes(list)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleExpand = useCallback(async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null)
      return
    }
    const note: Note | null = await window.electronAPI.getNote(id)
    if (note) {
      setExpandedId(id)
      setExpandedContent(note.content)
    }
  }, [expandedId])

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await window.electronAPI.deleteNote(id)
    if (expandedId === id) setExpandedId(null)
    refresh()
  }, [expandedId, refresh])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => useCompanionStore.getState().toggleNotesList()}
          className="flex items-center gap-1.5 text-[11px] text-[var(--g-text-secondary)]
            hover:text-[var(--g-text-bright)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={12} />
          Back to chat
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {notes.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--g-text-secondary)]">
            <FileText size={24} className="mb-2 opacity-40" />
            <span className="text-[12px]">No saved notes</span>
            <span className="text-[10px] mt-1 opacity-60">Ask the companion to save a note</span>
          </div>
        ) : (
          notes.map((note, i) => (
            <motion.div
              key={note.id}
              onClick={() => handleExpand(note.id)}
              className="group px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-colors
                hover:bg-[rgba(255,255,255,0.05)] border-[0.5px] border-transparent"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.02, duration: 0.15 }}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-1.5 flex-1 min-w-0">
                  {expandedId === note.id
                    ? <ChevronDown size={12} className="mt-0.5 shrink-0 text-[var(--g-text-secondary)]" />
                    : <ChevronRight size={12} className="mt-0.5 shrink-0 text-[var(--g-text-secondary)]" />
                  }
                  <div className="flex-1 min-w-0">
                    <div className="text-[12px] font-medium text-[var(--g-text-bright)] truncate">
                      {note.title}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[var(--g-text-secondary)]">
                      {note.savedFrom && <span>{note.savedFrom}</span>}
                      {note.savedFrom && note.source && <span>·</span>}
                      {note.source && <span>{note.source}</span>}
                      {(note.savedFrom || note.source) && <span>·</span>}
                      <span>{timeAgo(note.createdAt)}</span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button
                    onClick={(e) => handleDelete(e, note.id)}
                    className="w-5 h-5 flex items-center justify-center rounded
                      text-[var(--g-text-secondary)] hover:text-red-400 hover:bg-[var(--g-bg-active)]
                      transition-colors cursor-pointer"
                    title="Delete"
                  >
                    <Trash2 size={10} />
                  </button>
                </div>
              </div>

              {/* Expanded content */}
              {expandedId === note.id && (
                <motion.div
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  transition={{ duration: 0.15 }}
                  className="mt-2 ml-4 text-[11px] text-[var(--g-text)] leading-relaxed
                    whitespace-pre-wrap border-l-2 border-[rgba(255,255,255,0.1)] pl-2"
                >
                  {expandedContent}
                </motion.div>
              )}
            </motion.div>
          ))
        )}
      </div>
    </div>
  )
})
