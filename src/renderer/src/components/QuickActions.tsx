import { memo, useCallback } from 'react'
import { motion } from 'motion/react'
import { FileText, ShieldCheck, AlignLeft, PenLine, ArrowRight } from 'lucide-react'
import { sendCompanionMessage } from '@/lib/sendMessage'
import { useCompanionStore } from '@/stores/companionStore'

const actions = [
  { label: 'Explain this', prompt: 'Explain what is on my screen.', icon: FileText },
  { label: 'Is this true?', prompt: 'Is the main claim on my screen true? Fact-check it.', icon: ShieldCheck },
  { label: 'Summarize', prompt: 'Summarize what is on my screen.', icon: AlignLeft },
  { label: 'Draft a reply', prompt: 'Draft a reply based on what is on my screen.', icon: PenLine },
  { label: 'What next?', prompt: 'Based on what is on my screen, what should I do next?', icon: ArrowRight },
] as const

export const QuickActions = memo(function QuickActions() {
  const isStreaming = useCompanionStore((s) => s.isStreaming)

  const handleAction = useCallback(async (prompt: string) => {
    if (isStreaming) return
    await sendCompanionMessage(prompt)
  }, [isStreaming])

  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
      <span className="text-[12px] text-[var(--g-text-secondary)] mb-1">
        Ask about what's on your screen
      </span>
      <div className="flex flex-wrap justify-center gap-1.5">
        {actions.map((action, i) => (
          <motion.button
            key={action.label}
            onClick={() => handleAction(action.prompt)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl
              bg-[var(--g-bg-subtle)] border-[0.5px] border-[var(--g-line-subtle)]
              text-[11px] text-[var(--g-text-secondary)]
              hover:bg-[var(--g-bg-hover)] hover:text-[var(--g-text-bright)] hover:border-[var(--g-line)]
              transition-colors cursor-pointer"
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.04, duration: 0.2 }}
          >
            <action.icon size={11} strokeWidth={2} />
            {action.label}
          </motion.button>
        ))}
      </div>
    </div>
  )
})
