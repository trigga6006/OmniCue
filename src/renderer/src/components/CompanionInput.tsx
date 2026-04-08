import { memo, useState, useRef, useCallback } from 'react'
import { ArrowUp, Square, Camera } from 'lucide-react'
import { useCompanionStore } from '@/stores/companionStore'
import { generateId } from '@/lib/utils'
import type { ChatMessage } from '@/lib/types'

interface CompanionInputProps {
  onClose: () => void
}

export const CompanionInput = memo(function CompanionInput({ onClose }: CompanionInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isStreaming = useCompanionStore((s) => s.isStreaming)
  const sessionId = useCompanionStore((s) => s.sessionId)
  const messages = useCompanionStore((s) => s.messages)
  const pendingScreenshot = useCompanionStore((s) => s.pendingScreenshot)

  const handleSend = useCallback(() => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return

    const store = useCompanionStore.getState()
    const screenshot = store.pendingScreenshot
    store.addUserMessage(trimmed, screenshot || undefined)

    // Build CoreMessage array from conversation
    const allMessages = [...store.messages]
    // The addUserMessage call above already added the new message
    const updatedMessages = useCompanionStore.getState().messages

    const coreMessages = updatedMessages.map((m: ChatMessage) => {
      if (m.role === 'user' && m.screenshot) {
        return {
          role: 'user' as const,
          content: [
            { type: 'image' as const, image: m.screenshot },
            { type: 'text' as const, text: m.content },
          ],
        }
      }
      return { role: m.role, content: m.content }
    })

    const streamMsgId = generateId()
    store.startStreaming(streamMsgId)

    window.electronAPI.sendAiMessage({
      messages: coreMessages,
      sessionId: store.sessionId,
    })

    setText('')
  }, [text, isStreaming])

  const handleAbort = useCallback(() => {
    window.electronAPI.abortAiStream(sessionId)
  }, [sessionId])

  const handleRetakeScreenshot = useCallback(async () => {
    const result = await window.electronAPI.captureActiveWindow()
    if (result) useCompanionStore.getState().setPendingScreenshot(result)
  }, [])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      } else if (e.key === 'Escape') {
        onClose()
      }
    },
    [handleSend, onClose]
  )

  return (
    <div className="flex items-center gap-2 px-3 py-2">
      <button
        onClick={handleRetakeScreenshot}
        className="w-7 h-7 flex items-center justify-center rounded-full
          text-[var(--g-text-dim)] hover:text-[var(--g-text)] hover:bg-[var(--g-bg-active)]
          transition-colors cursor-pointer shrink-0"
        title="Capture screen"
      >
        <Camera size={14} />
      </button>

      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your screen..."
        className="flex-1 bg-transparent text-[13px] text-[var(--g-text-bright)]
          placeholder:text-[var(--g-text-dim)] outline-none"
        autoFocus
      />

      {isStreaming ? (
        <button
          onClick={handleAbort}
          className="w-7 h-7 flex items-center justify-center rounded-full
            bg-red-500/20 text-red-400 hover:bg-red-500/30
            transition-colors cursor-pointer shrink-0"
          title="Stop"
        >
          <Square size={12} fill="currentColor" />
        </button>
      ) : (
        <button
          onClick={handleSend}
          disabled={!text.trim()}
          className={`w-7 h-7 flex items-center justify-center rounded-full shrink-0
            transition-colors cursor-pointer ${
              text.trim()
                ? 'bg-[var(--g-text-bright)] text-[var(--g-bg)] hover:opacity-90'
                : 'text-[var(--g-text-dim)] opacity-40 cursor-default'
            }`}
          title="Send"
        >
          <ArrowUp size={14} strokeWidth={2.5} />
        </button>
      )}
    </div>
  )
})
