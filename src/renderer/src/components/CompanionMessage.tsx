import { memo } from 'react'
import { motion } from 'motion/react'
import { Terminal, FileText, Search, Code, Globe } from 'lucide-react'
import type { ChatMessage, ToolUseEntry } from '@/lib/types'
import oiLogoGlass from '@/assets/oi-logo-glass.svg'
import { MarkdownContent } from './MarkdownContent'

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

  const isThinking = isStreaming && !message.content
  const isStopped = !isUser && message.content === 'Stopped.'

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
        className={`max-w-[85%] px-3 py-2 rounded-2xl text-[13px] leading-relaxed ${
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
        {isUser ? (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        ) : isStopped ? (
          <div className="italic text-[var(--g-text-secondary)]">Stopped.</div>
        ) : (
          <MarkdownContent content={message.content} />
        )}
      </div>
    </div>
  )
})

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
