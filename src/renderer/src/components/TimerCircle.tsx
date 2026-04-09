import { memo, useEffect, useRef } from 'react'
import { motion } from 'motion/react'
import { useCountdown } from '@/hooks/useCountdown'
import { useTimerStore } from '@/stores/timerStore'
import { useHistoryStore } from '@/stores/historyStore'
import { useSound } from '@/hooks/useSound'
import { formatTime, generateId } from '@/lib/utils'
import { glassStyle } from '@/lib/glass'
import type { ActiveTimer } from '@/lib/types'

const SIZE = 36
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
