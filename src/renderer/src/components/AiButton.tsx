import { memo, useState, useRef } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'motion/react'
import { Sparkles, Settings } from 'lucide-react'
import { glassStyle } from '@/lib/glass'
import { glassMenuStyle } from '@/lib/glass'
import { useCompanionStore } from '@/stores/companionStore'

/** Bare sparkles icon for use inside MorphingPill — no glass background */
export const AiIcon = memo(function AiIcon() {
  const open = useCompanionStore((s) => s.open)
  const visible = useCompanionStore((s) => s.visible)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const leaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const handleClick = () => {
    if (visible) {
      useCompanionStore.getState().close()
      return
    }
    open()
    window.electronAPI.captureActiveWindow().then((result) => {
      if (result) useCompanionStore.getState().captureAndResolve(result)
    })
  }

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setMenu({ x: e.clientX, y: e.clientY })
  }

  const handleMenuLeave = () => {
    leaveTimer.current = setTimeout(() => setMenu(null), 300)
  }
  const handleMenuEnter = () => {
    if (leaveTimer.current) clearTimeout(leaveTimer.current)
  }

  return (
    <>
      <motion.button
        className="relative w-7 h-7 rounded-full
          text-[var(--g-text)] hover:text-[var(--g-text-bright)]
          hover:bg-[var(--g-bg-hover)]
          flex items-center justify-center cursor-pointer
          transition-colors duration-200 outline-none"
        whileHover={{ scale: 1.05 }}
        whileTap={{ scale: 0.97 }}
        onClick={handleClick}
        onContextMenu={handleContextMenu}
      >
        <Sparkles size={14} strokeWidth={2.5} />
      </motion.button>

      {createPortal(
        <AnimatePresence>
          {menu && (
            <motion.div
              className="fixed z-50 min-w-[136px] p-1 rounded-[14px] backdrop-blur-2xl backdrop-saturate-[1.8]
                bg-[var(--g-bg-hover)] border-[0.5px] border-[var(--g-line)] pointer-events-auto"
              style={{
                left: Math.min(menu.x, window.innerWidth - 160),
                top: Math.min(menu.y, window.innerHeight - 80),
                transformOrigin: 'top left',
                ...glassMenuStyle,
              }}
              data-interactive
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              transition={{ duration: 0.15, ease: [0.25, 0.1, 0.25, 1] }}
              onMouseLeave={handleMenuLeave}
              onMouseEnter={handleMenuEnter}
            >
              <button
                className="w-full flex items-center gap-2.5 px-3 py-[6px] rounded-[10px]
                  text-[var(--g-text)] text-[13px] font-light tracking-[-0.01em]
                  hover:bg-[var(--g-bg)] hover:text-[var(--g-text-bright)]
                  transition-colors duration-150 cursor-pointer outline-none"
                onClick={() => {
                  window.electronAPI.openSettingsWindow('ai')
                  setMenu(null)
                }}
              >
                <Settings size={13} strokeWidth={1.8} />
                AI Settings
              </button>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </>
  )
})

export const AiButton = memo(function AiButton() {
  const open = useCompanionStore((s) => s.open)
  const visible = useCompanionStore((s) => s.visible)

  const handleClick = () => {
    if (visible) {
      useCompanionStore.getState().close()
      return
    }

    // Open panel immediately — capture + OCR happen in background (invisible to user)
    open()
    window.electronAPI.captureActiveWindow().then((result) => {
      if (result) useCompanionStore.getState().captureAndResolve(result)
    })
  }

  return (
    <motion.button
      className="relative w-9 h-9 rounded-full backdrop-blur-2xl backdrop-saturate-[1.8]
        bg-[var(--g-bg)] border-[0.5px] border-[var(--g-line)] text-[var(--g-text)]
        hover:bg-[var(--g-bg-active)] hover:border-[var(--g-line-hover)] hover:text-[var(--g-text-bright)]
        flex items-center justify-center cursor-pointer
        transition-colors duration-200 outline-none"
      style={glassStyle}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
      onClick={handleClick}
    >
      <Sparkles size={16} strokeWidth={2.5} />
    </motion.button>
  )
})
