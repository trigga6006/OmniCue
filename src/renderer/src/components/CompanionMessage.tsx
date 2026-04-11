import { memo, useEffect, useRef, useState } from 'react'
import { motion } from 'motion/react'
import { Terminal, FileText, Search, Code, Globe } from 'lucide-react'
import type { ChatMessage, ToolUseEntry } from '@/lib/types'
import oiLogoGlass from '@/assets/oi-logo-glass.svg'
import { MarkdownContent } from './MarkdownContent'
import { InteractionCard } from './InteractionCard'

interface CompanionMessageProps {
  message: ChatMessage
  isStreaming: boolean
  onOpenScreenshot?: (image: string, title: string) => void
}

export const CompanionMessage = memo(function CompanionMessage({
  message,
  isStreaming,
  onOpenScreenshot,
}: CompanionMessageProps) {
  const isUser = message.role === 'user'
  const screenshot = message.manualScreenshot
  const screenshotTitle = message.manualScreenshotTitle || 'Screenshot'
  const hasVisibleInteractions = Boolean(message.interactions && message.interactions.length > 0)

  const isThinking = isStreaming && !message.content && !hasVisibleInteractions
  const isStopped = !isUser && message.content === 'Stopped.'

  // Detect token stall: content exists but no new tokens for STALL_MS
  const STALL_MS = 3000
  const contentLenRef = useRef(message.content.length)
  const [stalled, setStalled] = useState(false)

  useEffect(() => {
    if (!isStreaming || !message.content) {
      setStalled(false)
      contentLenRef.current = message.content.length
      return
    }
    // Content just changed — reset
    if (message.content.length !== contentLenRef.current) {
      contentLenRef.current = message.content.length
      setStalled(false)
    }
    const timer = window.setTimeout(() => {
      if (isStreaming && message.content.length === contentLenRef.current) {
        setStalled(true)
      }
    }, STALL_MS)
    return () => clearTimeout(timer)
  }, [isStreaming, message.content])

  // Thinking state — spinning logo with glow pulse
  if (!isUser && isThinking) {
    return (
      <div className="flex justify-start mb-2">
        <div className="flex items-center gap-2.5 px-3 py-2.5">
          <div className="relative w-6 h-6 flex items-center justify-center">
            <motion.div
              className="absolute inset-[-3px] rounded-full"
              style={{ background: 'radial-gradient(circle, rgba(255,255,255,0.08) 0%, transparent 70%)' }}
              animate={{ opacity: [0.4, 0.8, 0.4], scale: [0.9, 1.15, 0.9] }}
              transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
            />
            <motion.img
              src={oiLogoGlass}
              alt=""
              className="w-5 h-5 relative"
              animate={{
                rotate: 360,
                opacity: [0.7, 1, 0.7],
                scale: [0.97, 1.03, 0.97],
              }}
              transition={{
                rotate: { duration: 2.4, repeat: Infinity, ease: 'linear' },
                opacity: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' },
                scale: { duration: 2.8, repeat: Infinity, ease: 'easeInOut' },
              }}
            />
          </div>
          <motion.span
            className="text-[12px] text-[var(--g-text-secondary)]"
            animate={{ opacity: [0.5, 0.85, 0.5] }}
            transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
          >
            Thinking
          </motion.span>
        </div>
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-2`}>
      <div
        className={`min-w-0 max-w-[85%] overflow-hidden px-3 py-2 rounded-2xl text-[13px] leading-relaxed ${
          isUser
            ? 'bg-[var(--g-bg-active)] text-[var(--g-text-bright)]'
            : 'bg-[var(--g-bg)] text-[var(--g-text-primary)]'
        } border-[0.5px] border-[var(--g-line)]`}
      >
        {screenshot && (
          <button
            onClick={() => onOpenScreenshot?.(screenshot, screenshotTitle)}
            className="block rounded overflow-hidden mb-1.5 cursor-pointer outline-none
              ring-0 hover:opacity-92 transition-opacity"
            title="Open screenshot"
          >
            <img
              src={screenshot}
              alt={screenshotTitle}
              className="w-20 h-auto rounded"
            />
          </button>
        )}
        {/* Tool use chips — compact, visually distinct */}
        {!isUser && message.toolUses && message.toolUses.length > 0 && (
          <div className="flex flex-col gap-1 mb-1.5">
            {message.toolUses.map((tool, i) => (
              <ToolUseChip key={i} tool={tool} />
            ))}
          </div>
        )}
        {/* Agent interaction cards (approvals, user-input, etc.) */}
        {!isUser && message.interactions && message.interactions.length > 0 && (
          <div className="flex flex-col gap-1.5 mb-1.5">
            {message.interactions.map((interaction) => (
              <InteractionCard key={interaction.id} interaction={interaction} />
            ))}
          </div>
        )}
        {isUser ? (
          <div className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{message.content}</div>
        ) : isStopped ? (
          <div className="italic text-[var(--g-text-secondary)]">Stopped.</div>
        ) : (
          <MarkdownContent content={message.content} />
        )}
        {/* Still-thinking indicator — shows after token stall while streaming */}
        {stalled && <StallIndicator />}
      </div>
    </div>
  )
})

/** Subtle pulsing dots shown below content when the AI stalls mid-stream */
function StallIndicator() {
  return (
    <motion.div
      className="flex items-center gap-1.5 mt-2 pt-1.5 border-t border-[var(--g-line-faint)]"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
    >
      <div className="flex items-center gap-[3px]">
        {[0, 0.25, 0.5].map((delay) => (
          <motion.span
            key={delay}
            className="block w-[4px] h-[4px] rounded-full bg-[var(--g-text-secondary)]"
            animate={{ opacity: [0.3, 0.9, 0.3], scale: [0.85, 1.15, 0.85] }}
            transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut', delay }}
          />
        ))}
      </div>
      <motion.span
        className="text-[11px] text-[var(--g-text-secondary)]"
        animate={{ opacity: [0.4, 0.75, 0.4] }}
        transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
      >
        Still working…
      </motion.span>
    </motion.div>
  )
}

const TOOL_ICONS: Record<string, typeof Terminal> = {
  Bash: Terminal,
  Read: FileText,
  Grep: Search,
  Glob: Search,
  Edit: Code,
  Write: Code,
  WebSearch: Globe,
  WebFetch: Globe,
}

function ToolUseChip({ tool }: { tool: ToolUseEntry }) {
  const Icon = TOOL_ICONS[tool.name] || Terminal
  const input = tool.input.length > 60 ? tool.input.slice(0, 57) + '...' : tool.input

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-1 rounded-lg
        bg-[var(--g-bg-subtle)] border-[0.5px] border-[var(--g-line-faint)]
        text-[10px] text-[var(--g-text-secondary)] font-mono leading-tight
        overflow-hidden"
    >
      <Icon size={10} strokeWidth={2} className="shrink-0 opacity-60" />
      <span className="font-semibold text-[var(--g-text-muted)] shrink-0">{tool.name}</span>
      {input && (
        <>
          <span className="opacity-30">|</span>
          <span className="truncate opacity-70">{input}</span>
        </>
      )}
    </div>
  )
}
