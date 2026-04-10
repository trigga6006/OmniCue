import { useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { History, Settings, RotateCcw, Monitor } from 'lucide-react'
import { glassMenuStyle } from '@/lib/glass'

interface DisplayInfo {
  id: number
  label: string
  centerX: number
  centerY: number
}

interface ContextMenuProps {
  x: number
  y: number
  visible: boolean
  onClose: () => void
  onHistory: () => void
  onSettings: () => void
  onResetPosition: () => void
  onMoveToDisplay: (x: number, y: number) => void
}

export function ContextMenu({
  x, y, visible, onClose, onHistory, onSettings, onResetPosition, onMoveToDisplay,
}: ContextMenuProps) {
  const [displays, setDisplays] = useState<DisplayInfo[]>([])
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (visible) {
      window.electronAPI.getDisplays().then(setDisplays)
    }
    // Clear any pending close timer when visibility changes
    return () => {
      if (leaveTimer.current) clearTimeout(leaveTimer.current)
    }
  }, [visible])

  const hasMultipleDisplays = displays.length > 1

  // Close after a short delay when mouse leaves the menu.
  // No full-screen click-away div — that freezes the screen by marking
  // the entire viewport as data-interactive.
  const handleMouseLeave = () => {
    leaveTimer.current = setTimeout(onClose, 300)
  }
  const handleMouseEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }

  return (
    <AnimatePresence>
      {visible && (
          <motion.div
            className="fixed z-[60] min-w-[136px] p-1 rounded-[14px] backdrop-blur-2xl backdrop-saturate-[1.8]
              bg-[var(--g-bg-hover)] border-[0.5px] border-[var(--g-line)] pointer-events-auto"
            style={{
              left: Math.min(x, window.innerWidth - 160),
              top: Math.min(y, window.innerHeight - 240),
              transformOrigin: 'top left',
              ...glassMenuStyle,
            }}
            data-interactive
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
            onMouseLeave={handleMouseLeave}
            onMouseEnter={handleMouseEnter}
          >
            <MenuItem
              icon={<History size={13} strokeWidth={1.8} />}
              label="History"
              onClick={() => { onHistory(); onClose() }}
            />
            <MenuItem
              icon={<Settings size={13} strokeWidth={1.8} />}
              label="Settings"
              onClick={() => { onSettings(); onClose() }}
            />

            <div className="h-px bg-[var(--g-line-subtle)] mx-2 my-0.5" />

            {hasMultipleDisplays && displays.map((d) => (
              <MenuItem
                key={d.id}
                icon={<Monitor size={13} strokeWidth={1.8} />}
                label={d.label}
                onClick={() => { onMoveToDisplay(d.centerX, d.centerY); onClose() }}
              />
            ))}

            <MenuItem
              icon={<RotateCcw size={13} strokeWidth={1.8} />}
              label="Reset position"
              onClick={() => { onResetPosition(); onClose() }}
            />
          </motion.div>
      )}
    </AnimatePresence>
  )
}

function MenuItem({
  icon,
  label,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
}) {
  return (
    <button
      className="w-full flex items-center gap-2.5 px-3 py-[6px] rounded-[10px]
        text-[var(--g-text)] text-[13px] font-light tracking-[-0.01em]
        hover:bg-[var(--g-bg)] hover:text-[var(--g-text-bright)]
        transition-colors duration-150 cursor-pointer outline-none"
      onClick={onClick}
    >
      {icon}
      {label}
    </button>
  )
}
