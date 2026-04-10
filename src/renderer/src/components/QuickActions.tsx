import { memo, useCallback } from 'react'
import { motion } from 'motion/react'
import { FileText, AlignLeft, PenLine } from 'lucide-react'
import { sendCompanionMessage } from '@/lib/sendMessage'
import { useCompanionStore } from '@/stores/companionStore'

const actions = [
  { label: 'Explain this', prompt: 'Explain what is on my screen.', icon: FileText },
  { label: 'Summarize', prompt: 'Summarize what is on my screen.', icon: AlignLeft },
  { label: 'Draft reply', prompt: 'Draft a reply based on what is on my screen.', icon: PenLine },
] as const

export const QuickActions = memo(function QuickActions() {
  const isStreaming = useCompanionStore((s) => s.isStreaming)

  const handleAction = useCallback(async (prompt: string) => {
    if (isStreaming) return
    await sendCompanionMessage(prompt)
  }, [isStreaming])

  return (
    <div className="flex items-center gap-1.5 px-3 pb-1.5">
      {actions.map((action, i) => (
        <motion.button
          key={action.label}
          onClick={() => handleAction(action.prompt)}
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg
            bg-[var(--g-bg-subtle)] border-[0.5px] border-[var(--g-line-subtle)]
            text-[10.5px] text-[var(--g-text-secondary)]
            hover:bg-[var(--g-bg-hover)] hover:text-[var(--g-text-bright)] hover:border-[var(--g-line)]
            transition-colors cursor-pointer whitespace-nowrap"
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: i * 0.03, duration: 0.15 }}
        >
          <action.icon size={10} strokeWidth={2} />
          {action.label}
        </motion.button>
      ))}
    </div>
  )
})
