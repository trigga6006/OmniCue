import { memo, useCallback, useEffect, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { ArrowLeft, Pencil, Trash2, MessageSquare, Check, X } from 'lucide-react'
import { useCompanionStore } from '@/stores/companionStore'
import { timeAgo } from '@/lib/utils'
import { useMemoryPreview } from '@/hooks/useMemoryPreview'
import { MemoryPreviewCard } from './MemoryPreviewCard'
import type { ConversationSummary, ResumeCapsule } from '@/lib/types'

function providerLabel(provider: string): string {
  const map: Record<string, string> = {
    codex: 'Codex', claude: 'Claude', openai: 'OpenAI', opencode: 'OpenCode',
    kimicode: 'Kimi', gemini: 'Gemini', deepseek: 'DeepSeek', groq: 'Groq',
    mistral: 'Mistral', xai: 'xAI', glm: 'GLM', kimi: 'Kimi',
  }
  return map[provider] || provider
}

export const ConversationList = memo(function ConversationList() {
  const [conversations, setConversations] = useState<ConversationSummary[]>([])
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editTitle, setEditTitle] = useState('')
  const editRef = useRef<HTMLInputElement>(null)
  const currentConvoId = useCompanionStore((s) => s.conversationId)
  const isStreaming = useCompanionStore((s) => s.isStreaming)

  // Memory preview state
  const [previewId, setPreviewId] = useState<string | null>(null)
  const [previewCapsule, setPreviewCapsule] = useState<ResumeCapsule | null>(null)
  const [previewLiveContext, setPreviewLiveContext] = useState<{ activeApp: string; processName: string; windowTitle: string } | null>(null)
  const [tooltipPos, setTooltipPos] = useState<{ top: number; left: number; direction: 'above' | 'below' }>({ top: 0, left: 0, direction: 'above' })
  const hoverTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const dismissTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const rowRefs = useRef(new Map<string, HTMLDivElement>())
  const { fetchPreview, clearMemory } = useMemoryPreview()

  // Cancel any pending dismiss (called when cursor enters tooltip or row)
  const cancelDismiss = useCallback(() => {
    if (dismissTimeoutRef.current) {
      clearTimeout(dismissTimeoutRef.current)
      dismissTimeoutRef.current = null
    }
  }, [])

  const refresh = useCallback(async () => {
    const list = await window.electronAPI.listConversations()
    setConversations(list)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const handleLoad = useCallback(async (id: string) => {
    // Dismiss preview on click
    cancelDismiss()
    setPreviewId(null)
    if (isStreaming || id === currentConvoId) return
    await useCompanionStore.getState().loadConversation(id)
  }, [isStreaming, currentConvoId, cancelDismiss])

  const handleDelete = useCallback(async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await useCompanionStore.getState().deleteConversation(id)
    if (previewId === id) setPreviewId(null)
    refresh()
  }, [refresh, previewId])

  const handleStartRename = useCallback((e: React.MouseEvent, id: string, title: string) => {
    e.stopPropagation()
    setEditingId(id)
    setEditTitle(title)
    setTimeout(() => editRef.current?.focus(), 0)
  }, [])

  const handleFinishRename = useCallback(async () => {
    if (!editingId || !editTitle.trim()) {
      setEditingId(null)
      return
    }
    if (editingId === currentConvoId) {
      useCompanionStore.getState().renameConversation(editTitle.trim())
    } else {
      await window.electronAPI.renameConversation(editingId, editTitle.trim())
    }
    setEditingId(null)
    refresh()
  }, [editingId, editTitle, currentConvoId, refresh])

  const handleCancelRename = useCallback(() => {
    setEditingId(null)
  }, [])

  // Hover preview handlers
  const handleMouseEnter = useCallback((id: string) => {
    if (editingId) return
    cancelDismiss()
    // Small delay to avoid flickering on quick mouse passes
    hoverTimeoutRef.current = setTimeout(async () => {
      const result = await fetchPreview(id)
      if (result.capsule) {
        // Calculate tooltip position from the row element
        const el = rowRefs.current.get(id)
        if (el) {
          const rect = el.getBoundingClientRect()
          const spaceAbove = rect.top
          // Prefer showing above the row; fall back to below if not enough space
          if (spaceAbove > 180) {
            setTooltipPos({ top: rect.top - 4, left: rect.left, direction: 'above' })
          } else {
            setTooltipPos({ top: rect.bottom + 4, left: rect.left, direction: 'below' })
          }
        }
        setPreviewId(id)
        setPreviewCapsule(result.capsule)
        setPreviewLiveContext(result.liveContext)
      }
    }, 300)
  }, [editingId, fetchPreview])

  const handleMouseLeave = useCallback(() => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current)
      hoverTimeoutRef.current = null
    }
    // Grace period — lets cursor travel from row to tooltip without dismissing
    dismissTimeoutRef.current = setTimeout(() => {
      setPreviewId(null)
    }, 150)
  }, [])

  const handleClearMemory = useCallback(async (id: string) => {
    await clearMemory(id)
    setPreviewId(null)
    setPreviewCapsule(null)
  }, [clearMemory])

  const handlePin = useCallback(async () => {
    const store = useCompanionStore.getState()
    await window.electronAPI.sessionMemoryCapture({
      conversationId: store.conversationId,
      runtimeSessionId: store.sessionId,
      provider: store.conversationProvider,
    })
  }, [])

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          onClick={() => useCompanionStore.getState().toggleConversationList()}
          className="flex items-center gap-1.5 text-[11px] text-[var(--g-text-secondary)]
            hover:text-[var(--g-text-bright)] transition-colors cursor-pointer"
        >
          <ArrowLeft size={12} />
          Back to chat
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {conversations.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-[var(--g-text-secondary)]">
            <MessageSquare size={24} className="mb-2 opacity-40" />
            <span className="text-[12px]">No saved conversations</span>
          </div>
        ) : (
          conversations.map((conv, i) => (
            <div
              key={conv.id}
              ref={(el) => { if (el) rowRefs.current.set(conv.id, el); else rowRefs.current.delete(conv.id) }}
              onMouseEnter={() => handleMouseEnter(conv.id)}
              onMouseLeave={handleMouseLeave}
            >
              <motion.div
                onClick={() => handleLoad(conv.id)}
                className={`group px-3 py-2.5 rounded-lg mb-1 cursor-pointer transition-colors
                  ${conv.id === currentConvoId
                    ? 'bg-[rgba(255,255,255,0.08)] border-[0.5px] border-[rgba(255,255,255,0.15)]'
                    : 'hover:bg-[rgba(255,255,255,0.05)] border-[0.5px] border-transparent'
                  }`}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.02, duration: 0.15 }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    {editingId === conv.id ? (
                      <div className="flex items-center gap-1">
                        <input
                          ref={editRef}
                          value={editTitle}
                          onChange={(e) => setEditTitle(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleFinishRename()
                            if (e.key === 'Escape') handleCancelRename()
                          }}
                          onClick={(e) => e.stopPropagation()}
                          className="flex-1 bg-[rgba(255,255,255,0.08)] rounded px-1.5 py-0.5
                            text-[12px] text-[var(--g-text-bright)] outline-none
                            border border-[rgba(255,255,255,0.2)] focus:border-[rgba(255,255,255,0.4)]"
                        />
                        <button onClick={(e) => { e.stopPropagation(); handleFinishRename() }}
                          className="text-[var(--g-text-secondary)] hover:text-green-400 cursor-pointer">
                          <Check size={12} />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); handleCancelRename() }}
                          className="text-[var(--g-text-secondary)] hover:text-red-400 cursor-pointer">
                          <X size={12} />
                        </button>
                      </div>
                    ) : (
                      <div className="text-[12px] font-medium text-[var(--g-text-bright)] truncate">
                        {conv.title || conv.firstMessage || 'Untitled'}
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 mt-0.5 text-[10px] text-[var(--g-text-secondary)]">
                      <span>{providerLabel(conv.provider)}</span>
                      <span>·</span>
                      <span>{conv.messageCount} msg{conv.messageCount !== 1 ? 's' : ''}</span>
                      <span>·</span>
                      <span>{timeAgo(conv.updatedAt)}</span>
                    </div>
                  </div>
                  {editingId !== conv.id && (
                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={(e) => handleStartRename(e, conv.id, conv.title)}
                        className="w-5 h-5 flex items-center justify-center rounded
                          text-[var(--g-text-secondary)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
                          transition-colors cursor-pointer"
                        title="Rename"
                      >
                        <Pencil size={10} />
                      </button>
                      <button
                        onClick={(e) => handleDelete(e, conv.id)}
                        className="w-5 h-5 flex items-center justify-center rounded
                          text-[var(--g-text-secondary)] hover:text-red-400 hover:bg-[var(--g-bg-active)]
                          transition-colors cursor-pointer"
                        title="Delete"
                      >
                        <Trash2 size={10} />
                      </button>
                    </div>
                  )}
                </div>
              </motion.div>

            </div>
          ))
        )}
      </div>

      {/* Portal-based tooltip for memory preview */}
      {createPortal(
        <AnimatePresence>
          {previewId && previewCapsule && (
            <motion.div
              className="fixed z-[9999] pointer-events-none"
              style={{
                left: tooltipPos.left,
                ...(tooltipPos.direction === 'above'
                  ? { bottom: window.innerHeight - tooltipPos.top }
                  : { top: tooltipPos.top }),
                width: rowRefs.current.get(previewId)?.getBoundingClientRect().width ?? 280,
              }}
              initial={{ opacity: 0, y: tooltipPos.direction === 'above' ? 6 : -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: tooltipPos.direction === 'above' ? 6 : -6 }}
              transition={{ duration: 0.12 }}
            >
              <div
                className="pointer-events-auto"
                onMouseEnter={cancelDismiss}
                onMouseLeave={handleMouseLeave}
              >
                <MemoryPreviewCard
                  capsule={previewCapsule}
                  isCurrentConversation={previewId === currentConvoId}
                  liveContext={previewLiveContext}
                  onClear={() => handleClearMemory(previewId!)}
                  onPin={previewId === currentConvoId ? handlePin : undefined}
                />
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  )
})
