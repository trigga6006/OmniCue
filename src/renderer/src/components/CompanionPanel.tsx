import { memo, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { MessageSquarePlus, X } from 'lucide-react'
import { glassPanelStyle } from '@/lib/glass'
import { useCompanionStore } from '@/stores/companionStore'
import { CompanionMessage } from './CompanionMessage'
import { CompanionInput } from './CompanionInput'
import { ScreenshotChip } from './ScreenshotChip'

interface CompanionPanelProps {
  visible: boolean
  onClose: () => void
  anchorX: number
  anchorY: number
}

const transition = { duration: 0.2, ease: [0.25, 0.1, 0.25, 1] as const }

export const CompanionPanel = memo(function CompanionPanel({
  visible,
  onClose,
  anchorX,
  anchorY,
}: CompanionPanelProps) {
  const messages = useCompanionStore((s) => s.messages)
  const isStreaming = useCompanionStore((s) => s.isStreaming)
  const streamingMessageId = useCompanionStore((s) => s.streamingMessageId)
  const pendingScreenshot = useCompanionStore((s) => s.pendingScreenshot)
  const sessionId = useCompanionStore((s) => s.sessionId)
  const newSession = useCompanionStore((s) => s.newSession)
  const setPendingScreenshot = useCompanionStore((s) => s.setPendingScreenshot)
  const scrollRef = useRef<HTMLDivElement>(null)

  // Wire up AI stream listeners
  useEffect(() => {
    if (!visible) return

    const store = useCompanionStore.getState

    const unsubToken = window.electronAPI.onAiStreamToken((data) => {
      if (data.sessionId === store().sessionId) {
        store().appendToken(data.token)
      }
    })

    const unsubDone = window.electronAPI.onAiStreamDone((data) => {
      if (data.sessionId === store().sessionId) {
        store().finishStreaming(data.fullText)
      }
    })

    const unsubError = window.electronAPI.onAiStreamError((data) => {
      if (data.sessionId === store().sessionId) {
        store().streamError(data.error)
      }
    })

    return () => {
      unsubToken()
      unsubDone()
      unsubError()
    }
  }, [visible, sessionId])

  // Auto-scroll on new content
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [messages])

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="fixed z-50 w-[420px] max-h-[480px] flex flex-col
            backdrop-blur-2xl backdrop-saturate-[1.8]
            bg-[var(--g-bg)] border-[0.5px] border-[var(--g-line)]
            rounded-2xl overflow-hidden"
          style={{
            ...glassPanelStyle,
            top: anchorY + 56,
            left: anchorX,
            transform: 'translateX(-50%)',
          }}
          initial={{ y: -16, opacity: 0, scale: 0.96 }}
          animate={{ y: 0, opacity: 1, scale: 1 }}
          exit={{ y: -16, opacity: 0, scale: 0.96 }}
          transition={transition}
          data-interactive
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--g-line)]">
            <span className="text-[13px] font-medium text-[var(--g-text-bright)]">
              OmniCue
            </span>
            <div className="flex items-center gap-1">
              <button
                onClick={newSession}
                className="w-6 h-6 flex items-center justify-center rounded-md
                  text-[var(--g-text-dim)] hover:text-[var(--g-text)] hover:bg-[var(--g-bg-active)]
                  transition-colors cursor-pointer"
                title="New session"
              >
                <MessageSquarePlus size={14} />
              </button>
              <button
                onClick={onClose}
                className="w-6 h-6 flex items-center justify-center rounded-md
                  text-[var(--g-text-dim)] hover:text-[var(--g-text)] hover:bg-[var(--g-bg-active)]
                  transition-colors cursor-pointer"
                title="Close"
              >
                <X size={14} />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto px-3 py-3 min-h-[120px] max-h-[340px]"
          >
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full text-[12px] text-[var(--g-text-dim)]">
                Ask about what's on your screen
              </div>
            ) : (
              messages.map((msg) => (
                <CompanionMessage
                  key={msg.id}
                  message={msg}
                  isStreaming={isStreaming && msg.id === streamingMessageId}
                />
              ))
            )}
          </div>

          {/* Screenshot chip */}
          {pendingScreenshot && (
            <div className="px-3 pb-1">
              <ScreenshotChip
                image={pendingScreenshot.image}
                title={pendingScreenshot.title}
                onRemove={() => setPendingScreenshot(null)}
              />
            </div>
          )}

          {/* Input */}
          <div className="border-t border-[var(--g-line)]">
            <CompanionInput onClose={onClose} />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  )
})
