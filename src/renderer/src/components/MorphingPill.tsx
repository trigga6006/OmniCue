import { memo, useState, useCallback, useMemo } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { PlusIcon, GripDots } from '@/components/PlusButton'
import { AiIcon } from '@/components/AiButton'
import { TimerPill } from '@/components/TimerPill'
import { TimerCircleContent } from '@/components/TimerCircle'
import { NotificationContent } from '@/components/NotificationBubble'
import { PillDivider } from '@/components/PillDivider'
import { glassStyle } from '@/lib/glass'
import { useTimerStore } from '@/stores/timerStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useCompanionStore } from '@/stores/companionStore'
import {
  PILL_H,
  PILL_PADDING,
  PILL_ICON_SIZE,
  PILL_DIVIDER_W,
  PILL_TIMER_SLOT,
  PILL_NOTIF_COLLAPSED,
  PILL_NOTIF_EXPANDED,
} from '@/lib/constants'

const springTransition = { type: 'spring' as const, stiffness: 300, damping: 28 }
const tweenTransition = { duration: 0.25, ease: [0.25, 0.1, 0.25, 1] as const }
const instantTransition = { duration: 0 }

interface MorphingPillProps {
  onContextMenu: (e: React.MouseEvent) => void
  showGrip: boolean
  onGripMouseDown: (e: React.MouseEvent) => void
  onMouseEnter: () => void
  onMouseLeave: () => void
}

export const MorphingPill = memo(function MorphingPill({
  onContextMenu,
  showGrip,
  onGripMouseDown,
  onMouseEnter,
  onMouseLeave,
}: MorphingPillProps) {
  const timers = useTimerStore((s) => s.timers)
  const isCreating = useTimerStore((s) => s.isCreating)
  const notifications = useNotificationStore((s) => s.notifications)
  const expandedIds = useNotificationStore((s) => s.expandedIds)
  const companionVisible = useCompanionStore((s) => s.visible)

  // TimerPill bare-mode callbacks
  const [timerPillWidth, setTimerPillWidth] = useState(0)
  const [timerPillClipPath, setTimerPillClipPath] = useState<string | undefined>()
  const handleTimerPillWidth = useCallback((w: number) => setTimerPillWidth(w), [])
  const handleTimerPillClipPath = useCallback((p: string | undefined) => setTimerPillClipPath(p), [])

  // Track if we're in timer drag mode (instant transitions, no spring)
  const isDragging = timerPillClipPath !== undefined

  // Compute pill width from state
  const computedWidth = useMemo(() => {
    if (isCreating) {
      // TimerPill drives width + a bit of padding for the plus icon
      return timerPillWidth + PILL_ICON_SIZE + PILL_PADDING
    }

    let w = PILL_PADDING * 2
    w += PILL_ICON_SIZE // plus icon

    if (timers.length > 0) {
      w += PILL_DIVIDER_W
      w += timers.length * PILL_TIMER_SLOT + (timers.length - 1) * 4
    }

    if (notifications.length > 0) {
      w += PILL_DIVIDER_W
      for (const n of notifications) {
        w += expandedIds.has(n.id) ? PILL_NOTIF_EXPANDED : PILL_NOTIF_COLLAPSED
      }
      if (notifications.length > 1) {
        w += (notifications.length - 1) * 4
      }
    }

    if (!companionVisible) {
      w += PILL_DIVIDER_W
      w += PILL_ICON_SIZE // AI sparkles icon
    } else {
      // Mini-bar mode: show close button instead of AI icon
      w += PILL_DIVIDER_W
      w += PILL_ICON_SIZE // close button
    }

    return w
  }, [isCreating, timerPillWidth, timers.length, notifications, expandedIds, companionVisible])

  // Choose transition based on state
  const widthTransition = isDragging
    ? instantTransition
    : notifications.length > 0
      ? tweenTransition
      : springTransition

  // Clip-path: only during timer creation drag
  const clipPathStyle = isCreating && timerPillClipPath
    ? { clipPath: timerPillClipPath, WebkitClipPath: timerPillClipPath }
    : {}

  return (
    <motion.div
      className="relative flex items-center"
      style={{ height: PILL_H }}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      data-interactive
    >
      {/* Grip dots for repositioning — absolutely positioned so the pill never shifts */}
      <AnimatePresence>
        {showGrip && !isCreating && (
          <motion.div
            className="absolute flex items-center justify-center w-5 cursor-grab active:cursor-grabbing pointer-events-auto"
            style={{ height: PILL_H, right: '100%', marginRight: 6 }}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
            onMouseDown={onGripMouseDown}
          >
            <GripDots />
          </motion.div>
        )}
      </AnimatePresence>

      {/* The pill surface */}
      <motion.div
        className="relative pointer-events-auto"
        style={{ height: PILL_H }}
        animate={{ width: computedWidth }}
        transition={widthTransition}
        layoutId="omni-pill"
      >
        {/* Glass background */}
        <div
          className="absolute inset-0 rounded-full backdrop-blur-2xl backdrop-saturate-[1.8]
            bg-[var(--g-bg)] border-[0.5px] border-[var(--g-line)]
            transition-colors duration-200"
          style={{ ...glassStyle, ...clipPathStyle }}
        />

        {/* Notification glow overlay — warm orange zone behind notification slots */}
        <AnimatePresence>
          {notifications.length > 0 && !isCreating && (
            <NotificationGlow
              notifications={notifications}
              expandedIds={expandedIds}
              timers={timers}
            />
          )}
        </AnimatePresence>

        {/* Content row */}
        <div className="absolute inset-0 flex items-center justify-between overflow-visible" style={{ padding: `0 ${PILL_PADDING}px` }}>
          {isCreating ? (
            /* Timer creation mode: plus icon + bare TimerPill */
            <>
              <PlusIcon onContextMenu={onContextMenu} />
              <TimerPill
                bare
                onWidthChange={handleTimerPillWidth}
                onClipPathChange={handleTimerPillClipPath}
              />
            </>
          ) : (
            /* Normal mode: plus | divider | AI/close  (timers/notifs inserted in middle) */
            <>
              {/* Left zone: plus + timers + notifications */}
              <div className="flex items-center">
                <PlusIcon onContextMenu={onContextMenu} />

                {/* Timer circles */}
                {timers.length > 0 && <PillDivider />}
                <AnimatePresence>
                  {timers.map((timer, idx) => (
                    <motion.div
                      key={timer.id}
                      className="flex items-center"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: PILL_TIMER_SLOT, opacity: 1, marginLeft: idx === 0 ? 0 : 4 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={tweenTransition}
                    >
                      <TimerCircleContent timer={timer} onContextMenu={onContextMenu} />
                    </motion.div>
                  ))}
                </AnimatePresence>

                {/* Notifications */}
                {notifications.length > 0 && <PillDivider />}
                <AnimatePresence>
                  {notifications.map((n) => (
                    <motion.div
                      key={n.id}
                      className="flex items-center"
                      initial={{ width: 0, opacity: 0 }}
                      animate={{ width: 'auto', opacity: 1 }}
                      exit={{ width: 0, opacity: 0 }}
                      transition={tweenTransition}
                    >
                      <NotificationContent notification={n} onContextMenu={onContextMenu} />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>

              {/* Center divider */}
              <PillDivider />

              {/* AI icon or close button */}
              {companionVisible ? (
                <motion.button
                  className="relative w-7 h-7 rounded-full
                    text-[var(--g-text)] hover:text-[var(--g-text-bright)]
                    hover:bg-[var(--g-bg-hover)]
                    flex items-center justify-center cursor-pointer
                    transition-colors duration-200 outline-none"
                  whileHover={{ scale: 1.05 }}
                  whileTap={{ scale: 0.97 }}
                  onClick={() => useCompanionStore.getState().close()}
                >
                  <X size={14} strokeWidth={2.5} />
                </motion.button>
              ) : (
                <AiIcon />
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
})

/** Warm orange glow overlay positioned behind the notification zone inside the pill */
const NotificationGlow = memo(function NotificationGlow({
  notifications,
  expandedIds,
  timers,
}: {
  notifications: { id: string }[]
  expandedIds: Set<string>
  timers: unknown[]
}) {
  // Calculate the left offset where notifications start inside the pill
  let left = PILL_PADDING + PILL_ICON_SIZE // plus icon
  if (timers.length > 0) {
    left += PILL_DIVIDER_W + timers.length * PILL_TIMER_SLOT + (timers.length - 1) * 4
  }
  left += PILL_DIVIDER_W // divider before notifications

  // Calculate total width of notification zone
  let width = 0
  for (const n of notifications) {
    width += expandedIds.has(n.id) ? PILL_NOTIF_EXPANDED : PILL_NOTIF_COLLAPSED
  }
  if (notifications.length > 1) {
    width += (notifications.length - 1) * 4
  }

  return (
    <motion.div
      className="absolute rounded-full pointer-events-none"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3 }}
      style={{
        left,
        width,
        top: -2,
        bottom: -2,
        background: `linear-gradient(135deg, var(--n-bg-start) 0%, var(--n-bg-end) 100%)`,
        border: `0.5px solid var(--n-border)`,
        boxShadow: `0 0 20px var(--n-glow-1), 0 0 8px var(--n-glow-2)`,
        transition: 'left 0.25s ease, width 0.25s ease',
      }}
    >
      {/* Pulsing aura */}
      <motion.div
        className="absolute inset-[-3px] rounded-full pointer-events-none"
        style={{ background: `radial-gradient(circle, var(--n-aura) 0%, transparent 70%)` }}
        animate={{ opacity: [0.6, 1, 0.6], scale: [0.97, 1.04, 0.97] }}
        transition={{ duration: 3, repeat: Infinity, ease: 'easeInOut' }}
      />
    </motion.div>
  )
})
