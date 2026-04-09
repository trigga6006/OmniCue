import { memo, useState, useRef, useCallback } from 'react'
import { ArrowUp, Square, Camera } from 'lucide-react'
import { useCompanionStore } from '@/stores/companionStore'
import { sendCompanionMessage } from '@/lib/sendMessage'

interface CompanionInputProps {
  onClose: () => void
}

export const CompanionInput = memo(function CompanionInput({ onClose }: CompanionInputProps) {
  const [text, setText] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const isStreaming = useCompanionStore((s) => s.isStreaming)
  const sessionId = useCompanionStore((s) => s.sessionId)

  const handleSend = useCallback(async () => {
    const trimmed = text.trim()
    if (!trimmed || isStreaming) return
    setText('')
    // Reset textarea height
    if (inputRef.current) inputRef.current.style.height = 'auto'
    await sendCompanionMessage(trimmed)
  }, [text, isStreaming])

  const handleAbort = useCallback(() => {
    window.electronAPI.abortAiStream(sessionId)
    // Immediately reset UI — don't wait for backend callback
    const store = useCompanionStore.getState()
    if (store.isStreaming && store.streamingMessageId) {
      const currentMsg = store.messages.find((m) => m.id === store.streamingMessageId)
      if (currentMsg && !currentMsg.content) {
        // No tokens received yet (thinking state) — show stopped message
        store.finishStreaming('Stopped.')
      } else {
        // Partial response — just end the stream, keep what we have
        store.finishStreaming(currentMsg?.content || '')
      }
    }
  }, [sessionId])

  const handleManualCapture = useCallback(async () => {
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
    <div className="flex items-end gap-2 px-3 py-2">
      <button
        onClick={handleManualCapture}
        className="w-7 h-7 flex items-center justify-center rounded-full
          text-[var(--g-text-bright)] hover:text-[var(--g-text-bright)] hover:bg-[var(--g-bg-active)]
          transition-colors cursor-pointer shrink-0"
        title="Capture screen"
      >
        <Camera size={14} />
      </button>

      <textarea
        ref={inputRef as React.RefObject<HTMLTextAreaElement>}
        value={text}
        onChange={(e) => {
          setText(e.target.value)
          // Auto-grow height
          e.target.style.height = 'auto'
          e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px'
        }}
        onKeyDown={handleKeyDown}
        placeholder="Ask about your screen..."
        rows={1}
        className="flex-1 bg-transparent text-[13px] text-[var(--g-text-bright)]
          placeholder:text-[var(--g-text-secondary)] outline-none resize-none
          leading-[1.4] max-h-[120px] overflow-y-auto"
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
                ? 'bg-[var(--g-bg-active)] text-[var(--g-text-bright)] hover:bg-[var(--g-bg-hover)]'
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
