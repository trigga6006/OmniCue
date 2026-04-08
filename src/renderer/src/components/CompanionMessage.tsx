import { memo } from 'react'
import { motion } from 'motion/react'
import type { ChatMessage } from '@/lib/types'

interface CompanionMessageProps {
  message: ChatMessage
  isStreaming: boolean
}

export const CompanionMessage = memo(function CompanionMessage({
  message,
  isStreaming,
}: CompanionMessageProps) {
  const isUser = message.role === 'user'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed ${
          isUser
            ? 'bg-[var(--g-bg-active)] text-[var(--g-text-bright)]'
            : 'bg-[var(--g-bg)] text-[var(--g-text)]'
        } border-[0.5px] border-[var(--g-line)]`}
      >
        {message.screenshot && (
          <img
            src={message.screenshot}
            alt={message.screenshotTitle || 'Screenshot'}
            className="w-20 h-auto rounded mb-1.5"
          />
        )}
        <div className="whitespace-pre-wrap break-words">
          {message.content}
          {isStreaming && (
            <motion.span
              className="inline-block ml-0.5 text-[var(--g-text-bright)]"
              animate={{ opacity: [1, 0] }}
              transition={{ duration: 0.8, repeat: Infinity }}
            >
              ▍
            </motion.span>
          )}
        </div>
      </div>
    </div>
  )
})
