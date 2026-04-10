import { memo, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import {
  FileText, AlignLeft, PenLine, Bug, Code, Search,
  ClipboardList, CheckCircle2, BarChart3, HelpCircle, Zap,
} from 'lucide-react'
import { sendCompanionMessage } from '@/lib/sendMessage'
import { useCompanionStore } from '@/stores/companionStore'
import type { LucideIcon } from 'lucide-react'

interface QuickAction {
  label: string
  prompt: string
  icon: LucideIcon
}

function getActionsForScreen(screenType?: string, ocrText?: string): QuickAction[] {
  const hasError = ocrText && /error|failed|exception|traceback|fatal|panic/i.test(ocrText)

  switch (screenType) {
    case 'terminal':
      if (hasError) {
        return [
          { label: 'Explain error', prompt: 'Explain this error and suggest how to fix it.', icon: Bug },
          { label: 'Search docs', prompt: 'Find relevant documentation for this error.', icon: Search },
          { label: 'Fix it', prompt: 'Write a fix for this error.', icon: Zap },
        ]
      }
      return [
        { label: 'Explain output', prompt: 'Explain what this terminal output means.', icon: FileText },
        { label: 'Next step', prompt: 'What should I do next based on this terminal output?', icon: Zap },
      ]

    case 'code':
      if (hasError) {
        return [
          { label: 'Fix error', prompt: 'Explain and fix this error in the code.', icon: Bug },
          { label: 'Explain code', prompt: 'Explain what this code does.', icon: FileText },
        ]
      }
      return [
        { label: 'Review code', prompt: 'Review this code for bugs, edge cases, and improvements.', icon: Code },
        { label: 'Explain this', prompt: 'Explain what this code does step by step.', icon: FileText },
        { label: 'Write tests', prompt: 'Write tests for the code visible on screen.', icon: CheckCircle2 },
      ]

    case 'article':
    case 'browser':
      return [
        { label: 'Summarize', prompt: 'Summarize what\'s on this page.', icon: AlignLeft },
        { label: 'Key points', prompt: 'Extract the key points from this page.', icon: ClipboardList },
        { label: 'Fact check', prompt: 'Verify the main claims made on this page.', icon: CheckCircle2 },
      ]

    case 'email':
      return [
        { label: 'Summarize', prompt: 'Summarize this email thread.', icon: AlignLeft },
        { label: 'Draft reply', prompt: 'Draft a professional reply to this email.', icon: PenLine },
        { label: 'Action items', prompt: 'What action items are in this email?', icon: ClipboardList },
      ]

    case 'chat':
      return [
        { label: 'Summarize', prompt: 'Summarize this conversation.', icon: AlignLeft },
        { label: 'Draft reply', prompt: 'Draft a reply to this conversation.', icon: PenLine },
      ]

    case 'document':
      return [
        { label: 'Summarize', prompt: 'Summarize this document.', icon: AlignLeft },
        { label: 'Key points', prompt: 'Extract the key points from this document.', icon: ClipboardList },
        { label: 'Simplify', prompt: 'Rewrite this in simpler language.', icon: FileText },
      ]

    case 'dashboard':
      return [
        { label: 'Explain metrics', prompt: 'Explain the metrics and trends shown here.', icon: BarChart3 },
        { label: 'Flag issues', prompt: 'Are there any anomalies or issues in this data?', icon: Bug },
      ]

    case 'form':
      return [
        { label: 'Help fill', prompt: 'Help me understand and fill out this form.', icon: HelpCircle },
        { label: 'Explain this', prompt: 'Explain what this form is asking for.', icon: FileText },
      ]

    default:
      return [
        { label: 'Explain this', prompt: 'Explain what is on my screen.', icon: FileText },
        { label: 'Summarize', prompt: 'Summarize what is on my screen.', icon: AlignLeft },
        { label: 'Draft reply', prompt: 'Draft a reply based on what is on my screen.', icon: PenLine },
      ]
  }
}

export const QuickActions = memo(function QuickActions() {
  const isStreaming = useCompanionStore((s) => s.isStreaming)
  const autoScreenshot = useCompanionStore((s) => s.autoScreenshot)

  // Wait for OCR to resolve before showing chips — prevents flicker
  // between default actions and context-aware ones
  const ocrReady = !autoScreenshot || !!autoScreenshot.screenType
  const actions = useMemo(
    () => ocrReady ? getActionsForScreen(autoScreenshot?.screenType, autoScreenshot?.ocrText) : [],
    [ocrReady, autoScreenshot?.screenType, autoScreenshot?.ocrText]
  )

  const handleAction = useCallback(async (prompt: string) => {
    if (isStreaming) return
    await sendCompanionMessage(prompt)
  }, [isStreaming])

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-3 pb-1.5 min-h-[30px]">
      <AnimatePresence mode="wait">
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
            exit={{ opacity: 0, y: -4 }}
            transition={{ delay: i * 0.03, duration: 0.15 }}
          >
            <action.icon size={10} strokeWidth={2} />
            {action.label}
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
})
