import { memo, useState, useEffect, useRef } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { X } from 'lucide-react'
import { glassMenuStyle } from '@/lib/glass'
import { useCountdown } from '@/hooks/useCountdown'
import { useTimerStore } from '@/stores/timerStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSound } from '@/hooks/useSound'
import { formatTime, generateId } from '@/lib/utils'
import { glassStyle } from '@/lib/glass'
import type { ActiveTimer } from '@/lib/types'

const SIZE = 28
const STROKE = 2
const RADIUS = (SIZE - STROKE * 2) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

/** Bare timer content for use inside MorphingPill — no glass background */
export const TimerCircleContent = memo(function TimerCircleContent({
  timer,
  onContextMenu,
}: {
  timer: ActiveTimer
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { removeTimer } = useTimerStore()
  const { add: addHistory } = useHistoryStore()
  const { play } = useSound()
  const didComplete = useRef(false)

  const [menuOpen, setMenuOpen] = useState(false)
  const menuTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const { remaining, progress } = useCountdown(timer.totalSeconds, timer.startedAt)

  useEffect(() => {
    if (remaining <= 0 && !didComplete.current) {
      didComplete.current = true
      play()
      addHistory({
        id: generateId(),
        name: timer.name || 'Timer',
        duration: timer.totalSeconds,
        completedAt: new Date().toISOString(),
        type: 'timer',
      })
    }
  }, [remaining, addHistory, play, timer.name, timer.totalSeconds])

  useEffect(() => {
    if (remaining > 0) return
    const timeout = setTimeout(() => removeTimer(timer.id), 6000)
    return () => clearTimeout(timeout)
  }, [remaining, removeTimer, timer.id])

  // Clean up menu leave timer
  useEffect(() => {
    return () => { if (menuTimer.current) clearTimeout(menuTimer.current) }
  }, [])

  const dashOffset = CIRCUMFERENCE * (1 - progress)
  const isComplete = remaining <= 0

  const handleClick = () => {
    if (isComplete) {
      removeTimer(timer.id)
    } else {
      setMenuOpen((v) => !v)
    }
  }

  const handleDismiss = () => {
    setMenuOpen(false)
    removeTimer(timer.id)
  }

  return (
    <motion.div
      className="relative flex items-center justify-center cursor-pointer group"
      style={{ width: SIZE, height: SIZE }}
      onContextMenu={onContextMenu}
      onClick={handleClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
    >
      <svg className="absolute inset-0" width={SIZE} height={SIZE}>
        <g style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            style={{ stroke: 'var(--g-ring-track)' }}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{
              stroke: isComplete ? 'var(--g-ring-done)' : 'var(--g-ring-progress)',
              transition: 'stroke-dashoffset 1s linear',
            }}
          />
        </g>
      </svg>

      <span className="relative z-10 text-[9px] font-light text-[var(--g-text-primary)] tracking-tight tabular-nums">
        {formatTime(remaining)}
      </span>

      {timer.name && !menuOpen && (
        <div
          className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap
            text-[8px] text-[var(--g-text-muted)] opacity-0 group-hover:opacity-100
            transition-opacity duration-200 pointer-events-none"
        >
          {timer.name}
        </div>
      )}

      {isComplete && (
        <motion.div
          className="absolute inset-0 rounded-full bg-[var(--g-bg-pulse)]"
          animate={{ opacity: [0, 0.35, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}

      {/* Dismiss menu */}
      <AnimatePresence>
        {menuOpen && !isComplete && (
          <motion.div
            className="absolute z-50 p-1 rounded-[10px] backdrop-blur-2xl backdrop-saturate-[1.8]
              bg-[var(--g-bg-hover)] border-[0.5px] border-[var(--g-line)] pointer-events-auto"
            style={{
              top: SIZE + 4,
              left: '50%',
              transform: 'translateX(-50%)',
              transformOrigin: 'top center',
              ...glassMenuStyle,
            }}
            data-interactive
            initial={{ scale: 0.95, opacity: 0, y: -4 }}
            animate={{ scale: 1, opacity: 1, y: 0 }}
            exit={{ scale: 0.95, opacity: 0, y: -4 }}
            transition={{ duration: 0.12, ease: [0.25, 0.1, 0.25, 1] }}
            onClick={(e) => e.stopPropagation()}
            onMouseLeave={() => { menuTimer.current = setTimeout(() => setMenuOpen(false), 300) }}
            onMouseEnter={() => { if (menuTimer.current) clearTimeout(menuTimer.current) }}
          >
            <button
              className="flex items-center gap-2 px-3 py-[5px] rounded-[8px] whitespace-nowrap
                text-[var(--g-text)] text-[12px] font-light
                hover:bg-[var(--g-bg)] hover:text-[var(--g-text-bright)]
                transition-colors duration-150 cursor-pointer outline-none"
              onClick={handleDismiss}
            >
              <X size={12} strokeWidth={2} />
              Dismiss
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
})

export const TimerCircle = memo(function TimerCircle({
  timer,
  onContextMenu
}: {
  timer: ActiveTimer
  onContextMenu: (e: React.MouseEvent) => void
}) {
  const { removeTimer } = useTimerStore()
  const { add: addHistory } = useHistoryStore()
  const { play } = useSound()
  const didComplete = useRef(false)

  const { remaining, progress } = useCountdown(timer.totalSeconds, timer.startedAt)

  // Fire-once: sound + history (ref survives StrictMode double-mount)
  useEffect(() => {
    if (remaining <= 0 && !didComplete.current) {
      didComplete.current = true
      play()
      addHistory({
        id: generateId(),
        name: timer.name || 'Timer',
        duration: timer.totalSeconds,
        completedAt: new Date().toISOString(),
        type: 'timer'
      })
    }
  }, [remaining, addHistory, play, timer.name, timer.totalSeconds])

  // Auto-dismiss after 6s (idempotent, safe with StrictMode)
  useEffect(() => {
    if (remaining > 0) return
    const timeout = setTimeout(() => removeTimer(timer.id), 6000)
    return () => clearTimeout(timeout)
  }, [remaining, removeTimer, timer.id])

  const dashOffset = CIRCUMFERENCE * (1 - progress)
  const isComplete = remaining <= 0

  return (
    <motion.div
      className="relative flex items-center justify-center cursor-pointer group"
      style={{ width: SIZE, height: SIZE }}
      onContextMenu={onContextMenu}
      onClick={() => isComplete && removeTimer(timer.id)}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.97 }}
    >
      <div
        className="absolute inset-0 rounded-full backdrop-blur-2xl backdrop-saturate-[1.8]
          bg-[var(--g-bg)] border-[0.5px] border-[var(--g-line)]
          group-hover:bg-[var(--g-bg-hover)] group-hover:border-[var(--g-line-hover)]
          transition-colors duration-200"
        style={glassStyle}
      />

      <svg className="absolute inset-0" width={SIZE} height={SIZE}>
        <g style={{ transform: 'rotate(-90deg)', transformOrigin: 'center' }}>
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            style={{ stroke: 'var(--g-ring-track)' }}
          />
          <circle
            cx={SIZE / 2}
            cy={SIZE / 2}
            r={RADIUS}
            fill="none"
            strokeWidth={STROKE}
            strokeDasharray={CIRCUMFERENCE}
            strokeDashoffset={dashOffset}
            strokeLinecap="round"
            style={{
              stroke: isComplete ? 'var(--g-ring-done)' : 'var(--g-ring-progress)',
              transition: 'stroke-dashoffset 1s linear'
            }}
          />
        </g>
      </svg>

      <span className="relative z-10 text-[9px] font-light text-[var(--g-text-primary)] tracking-tight tabular-nums">
        {formatTime(remaining)}
      </span>

      {timer.name && (
        <div
          className="absolute -bottom-5 left-1/2 -translate-x-1/2 whitespace-nowrap
            text-[8px] text-[var(--g-text-muted)] opacity-0 group-hover:opacity-100
            transition-opacity duration-200 pointer-events-none"
        >
          {timer.name}
        </div>
      )}

      {isComplete && (
        <motion.div
          className="absolute inset-0 rounded-full bg-[var(--g-bg-pulse)]"
          animate={{ opacity: [0, 0.35, 0], scale: [1, 1.15, 1] }}
          transition={{ duration: 2, repeat: Infinity, ease: 'easeInOut' }}
        />
      )}
    </motion.div>
  )
})
