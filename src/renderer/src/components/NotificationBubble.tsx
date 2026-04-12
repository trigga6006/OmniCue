import { memo, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { useNotificationStore } from '@/stores/notificationStore'
import claudeLogo from '@/assets/claude-logo.svg'
import { useSound } from '@/hooks/useSound'
import type { AppNotification } from '@/lib/types'

const SIZE = 36

/** Bare notification content for use inside MorphingPill — no standalone glass background */
export const NotificationContent = memo(function NotificationContent({
  notification,
  onContextMenu,
}: {
  notification: AppNotification
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { remove, setExpanded } = useNotificationStore()
  const { play } = useSound()
  const didChime = useRef(false)
  const [expanded, setLocalExpanded] = useState(false)

  useEffect(() => {
    if (!didChime.current) {
      didChime.current = true
      play()
    }

    const t1 = setTimeout(() => {
      setLocalExpanded(true)
      setExpanded(notification.id, true)
    }, 350)
    const t2 = setTimeout(() => {
      setLocalExpanded(false)
      setExpanded(notification.id, false)
    }, 4200)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [play, notification.id, setExpanded])

  useEffect(() => {
    if (notification.timeout <= 0) return undefined
    const timer = setTimeout(() => remove(notification.id), notification.timeout * 1000)
    return () => clearTimeout(timer)
  }, [notification.id, notification.timeout, remove])

  const displayText = notification.title
    ? `${notification.title}: ${notification.message}`
    : notification.message

  return (
    <motion.div
      className="relative flex items-center cursor-pointer group"
      style={{ height: SIZE }}
      onContextMenu={onContextMenu}
      onClick={() => remove(notification.id)}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
    >
      <div
        className="relative z-10 flex items-center justify-center shrink-0"
        style={{ width: SIZE, height: SIZE }}
      >
        <img src={claudeLogo} alt="" style={{ width: 16, height: 16 }} />
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            className="overflow-hidden relative z-10"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <span
              className="block whitespace-nowrap text-[11px] font-light pr-3 pl-0.5 max-w-[220px] truncate"
              style={{ color: 'var(--n-text)' }}
            >
              {displayText}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {!expanded && (
        <div
          className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap
            max-w-[180px] truncate px-2 py-0.5 rounded-md
            text-[9px] tracking-wide
            opacity-0 group-hover:opacity-100 pointer-events-none
            transition-opacity duration-200"
          style={{
            background: 'var(--n-tooltip-bg)',
            backdropFilter: 'blur(12px)',
            color: 'var(--n-tooltip-text)',
            border: '0.5px solid var(--n-tooltip-border)',
          }}
        >
          {displayText}
        </div>
      )}
    </motion.div>
  )
})

export const NotificationBubble = memo(function NotificationBubble({
  notification,
  onContextMenu
}: {
  notification: AppNotification
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { remove } = useNotificationStore()
  const { play } = useSound()
  const didChime = useRef(false)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (!didChime.current) {
      didChime.current = true
      play()
    }

    const t1 = setTimeout(() => setExpanded(true), 350)
    const t2 = setTimeout(() => setExpanded(false), 4200)

    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
    }
  }, [play])

  useEffect(() => {
    if (notification.timeout <= 0) return undefined
    const timer = setTimeout(() => remove(notification.id), notification.timeout * 1000)
    return () => clearTimeout(timer)
  }, [notification.id, notification.timeout, remove])

  const displayText = notification.title
    ? `${notification.title}: ${notification.message}`
    : notification.message

  return (
    <motion.div
      className="relative flex items-center rounded-full cursor-pointer group"
      style={{ height: SIZE }}
      onContextMenu={onContextMenu}
      onClick={() => remove(notification.id)}
      whileHover={{ scale: 1.04 }}
      whileTap={{ scale: 0.97 }}
    >
      <motion.div
        className="absolute inset-[-5px] rounded-full pointer-events-none"
        style={{
          background: `radial-gradient(circle, var(--n-aura) 0%, transparent 70%)`
        }}
        animate={{ opacity: [0.6, 1, 0.6], scale: [0.97, 1.04, 0.97] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div
        className="absolute inset-0 rounded-full backdrop-blur-2xl backdrop-saturate-[1.8]
          transition-all duration-300"
        style={{
          background: `linear-gradient(135deg, var(--n-bg-start) 0%, var(--n-bg-end) 100%)`,
          border: `0.5px solid var(--n-border)`,
          boxShadow: `
            0 0 20px var(--n-glow-1),
            0 0 8px var(--n-glow-2),
            0 4px 24px rgba(0, 0, 0, 0.2),
            inset 0 0.5px 0 var(--n-glow-inset)
          `
        }}
      />

      <div
        className="relative z-10 flex items-center justify-center shrink-0"
        style={{ width: SIZE, height: SIZE }}
      >
        <img src={claudeLogo} alt="" style={{ width: 16, height: 16 }} />
      </div>

      <AnimatePresence>
        {expanded && (
          <motion.div
            className="overflow-hidden relative z-10"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: 'auto', opacity: 1 }}
            exit={{ width: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
          >
            <span
              className="block whitespace-nowrap text-[11px] font-light pr-3 pl-0.5 max-w-[220px] truncate"
              style={{ color: 'var(--n-text)' }}
            >
              {displayText}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {!expanded && (
        <div
          className="absolute -bottom-7 left-1/2 -translate-x-1/2 whitespace-nowrap
            max-w-[180px] truncate px-2 py-0.5 rounded-md
            text-[9px] tracking-wide
            opacity-0 group-hover:opacity-100 pointer-events-none
            transition-opacity duration-200"
          style={{
            background: 'var(--n-tooltip-bg)',
            backdropFilter: 'blur(12px)',
            color: 'var(--n-tooltip-text)',
            border: '0.5px solid var(--n-tooltip-border)'
          }}
        >
          {displayText}
        </div>
      )}
    </motion.div>
  )
})
