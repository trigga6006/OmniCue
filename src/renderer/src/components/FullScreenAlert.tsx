import { useEffect } from 'react'
import { motion } from 'motion/react'
import { Bell, Repeat, MessageSquare } from 'lucide-react'
import { useSound } from '@/hooks/useSound'
import claudeLogo from '@/assets/claude-logo.svg'
import codexLogo from '@/assets/codex-logo.svg'

interface FullScreenAlertProps {
  message: string
  source: string // "Alarm" | "Reminder" | "Claude" | "Codex"
  onDismiss: () => void
}

function SourceIcon({ source }: { source: string }) {
  switch (source) {
    case 'Alarm':
      return <Bell size={28} strokeWidth={1.5} className="text-amber-400" />
    case 'Reminder':
      return <Repeat size={28} strokeWidth={1.5} className="text-sky-400" />
    case 'Claude':
      return <img src={claudeLogo} alt="Claude" className="w-7 h-7" />
    case 'Codex':
      return <img src={codexLogo} alt="Codex" className="w-7 h-7" />
    default:
      return <MessageSquare size={28} strokeWidth={1.5} className="text-white/60" />
  }
}

function sourceColor(source: string): string {
  switch (source) {
    case 'Alarm':
      return 'text-amber-400'
    case 'Reminder':
      return 'text-sky-400'
    case 'Claude':
      return 'text-orange-400'
    case 'Codex':
      return 'text-green-400'
    default:
      return 'text-white/60'
  }
}

export function FullScreenAlert({ message, source, onDismiss }: FullScreenAlertProps) {
  const { play } = useSound()

  useEffect(() => {
    play()
  }, [play])

  return (
    <motion.div
      className="fixed inset-0 z-[100] flex items-center justify-center cursor-pointer pointer-events-auto"
      data-interactive
      onClick={onDismiss}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: [0.25, 0.1, 0.25, 1] }}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/70 backdrop-blur-2xl" />

      {/* Content */}
      <motion.div
        className="relative flex flex-col items-center gap-6 max-w-[600px] px-12"
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.9, y: 20 }}
        transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
      >
        {/* Source icon + label */}
        <div className="flex items-center gap-3">
          <SourceIcon source={source} />
          <span className={`text-lg font-medium tracking-[-0.02em] ${sourceColor(source)}`}>
            {source}
          </span>
        </div>

        {/* Message */}
        <p className="text-[32px] font-light leading-[1.3] text-center text-white/90 tracking-[-0.02em]">
          {message}
        </p>

        {/* Dismiss hint */}
        <span className="text-[13px] text-white/25 font-light mt-4">
          click anywhere to dismiss
        </span>
      </motion.div>
    </motion.div>
  )
}
