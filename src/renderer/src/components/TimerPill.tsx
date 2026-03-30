import { useState, useRef, useEffect, useCallback } from 'react'
import { motion, AnimatePresence } from 'motion/react'
import { Timer, Bell, Repeat } from 'lucide-react'
import { useTimerStore } from '@/stores/timerStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { generateId, formatClockTime } from '@/lib/utils'
import { parseDuration } from '@/lib/parseDuration'
import { glassStyle } from '@/lib/glass'

type Mode = 'timer' | 'alarm' | 'reminder'

// Time steps per mode
const TIMER_STEPS = [60, 120, 180, 300, 600, 900, 1200, 1800, 2700, 3600, 5400, 7200, 10800]
const REMINDER_STEPS = [5, 10, 15, 30, 45, 60, 90, 120, 180, 240]
const PX_PER_STEP = 28 // tighter — each step is ~28px of drag

const PILL_H = 36
const REST_W = 114
const LABEL_W = 220

function getAlarmStart(): number {
  const now = new Date()
  const mins = now.getHours() * 60 + now.getMinutes()
  return Math.ceil(mins / 5) * 5
}

function modeIcon(mode: Mode, size = 13) {
  switch (mode) {
    case 'timer':
      return <Timer size={size} strokeWidth={1.8} />
    case 'alarm':
      return <Bell size={size} strokeWidth={1.8} />
    case 'reminder':
      return <Repeat size={size} strokeWidth={1.8} />
  }
}

function getInitialValue(mode: Mode, defaultDuration: number): number {
  switch (mode) {
    case 'timer':
      return defaultDuration
    case 'alarm':
      return getAlarmStart()
    case 'reminder':
      return 30
  }
}

/** Find the index of the closest step to the given value */
function findStepIndex(steps: number[], value: number): number {
  let best = 0
  let bestDist = Math.abs(steps[0] - value)
  for (let i = 1; i < steps.length; i++) {
    const dist = Math.abs(steps[i] - value)
    if (dist < bestDist) {
      best = i
      bestDist = dist
    }
  }
  return best
}

/** Compute new value from drag, starting from the base value's step index */
function valueFromDrag(mode: Mode, baseValue: number, dragPx: number): number {
  const stepsDelta = Math.round(dragPx / PX_PER_STEP)

  if (mode === 'timer') {
    const baseIdx = findStepIndex(TIMER_STEPS, baseValue)
    const idx = Math.max(0, Math.min(TIMER_STEPS.length - 1, baseIdx + stepsDelta))
    return TIMER_STEPS[idx]
  }
  if (mode === 'alarm') {
    const inc = Math.max(0, stepsDelta) * 5
    return (baseValue + inc) % 1440
  }
  // reminder
  const baseIdx = findStepIndex(REMINDER_STEPS, baseValue)
  const idx = Math.max(0, Math.min(REMINDER_STEPS.length - 1, baseIdx + stepsDelta))
  return REMINDER_STEPS[idx]
}

/** Short display: just the key number, no units */
function shortDisplay(mode: Mode, value: number): string {
  if (mode === 'timer') {
    const mins = Math.round(value / 60)
    if (mins >= 60) {
      const h = mins / 60
      return h === Math.floor(h) ? `${h}h` : `${h.toFixed(1)}h`
    }
    return String(mins)
  }
  if (mode === 'alarm') {
    return formatClockTime(value)
  }
  // reminder — just the number
  if (value >= 60) {
    const h = value / 60
    return h === Math.floor(h) ? `${h}h` : `${h.toFixed(1)}h`
  }
  return String(value)
}

export function TimerPill() {
  const { setCreating, addTimer } = useTimerStore()
  const { settings } = useSettingsStore()

  const [mode, setMode] = useState<Mode>('timer')
  const [value, setValue] = useState(() => getInitialValue('timer', settings.defaultDuration))
  const [phase, setPhase] = useState<'drag' | 'label' | 'editTime'>('drag')
  const [label, setLabel] = useState('')
  const [dragOffset, setDragOffset] = useState(0)
  const [timeInput, setTimeInput] = useState('')

  const labelRef = useRef<HTMLInputElement>(null)
  const timeInputRef = useRef<HTMLInputElement>(null)
  const dragStartRef = useRef<{ x: number; baseValue: number } | null>(null)

  const cycleMode = useCallback(() => {
    const next: Mode = mode === 'timer' ? 'alarm' : mode === 'alarm' ? 'reminder' : 'timer'
    setMode(next)
    setValue(getInitialValue(next, settings.defaultDuration))
  }, [mode, settings.defaultDuration])

  useEffect(() => {
    if (phase === 'label') {
      setTimeout(() => labelRef.current?.focus(), 100)
    }
    if (phase === 'editTime') {
      setTimeout(() => {
        timeInputRef.current?.focus()
        timeInputRef.current?.select()
      }, 50)
    }
  }, [phase])

  // Click on time badge → enter manual time edit mode
  const handleTimeBadgeClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation()
      setTimeInput(shortDisplay(mode, value))
      setPhase('editTime')
    },
    [mode, value]
  )

  // Confirm manual time entry
  const confirmTimeInput = useCallback(() => {
    if (mode === 'timer') {
      const seconds = parseDuration(timeInput)
      if (seconds && seconds > 0) setValue(seconds)
    } else if (mode === 'alarm') {
      // Try parsing as HH:MM or H:MM AM/PM
      const match = timeInput.match(/^(\d{1,2}):?(\d{2})?\s*(am|pm)?$/i)
      if (match) {
        let h = parseInt(match[1])
        const m = parseInt(match[2] || '0')
        const ampm = match[3]?.toLowerCase()
        if (ampm === 'pm' && h < 12) h += 12
        if (ampm === 'am' && h === 12) h = 0
        if (h >= 0 && h < 24 && m >= 0 && m < 60) {
          setValue(h * 60 + m)
        }
      }
    } else {
      // reminder — parse as minutes
      const n = parseInt(timeInput)
      if (n > 0) setValue(n)
    }
    setPhase('label')
  }, [mode, timeInput])

  // Drag handlers
  const handleGripPointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault()
      e.stopPropagation()
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      dragStartRef.current = { x: e.clientX, baseValue: value }
    },
    [value]
  )

  const handleGripPointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!dragStartRef.current) return
      // Cap drag so pill stays within the visible window
      const maxStretch = Math.max(0, window.innerWidth / 2 - REST_W - 60)
      const dx = Math.max(0, Math.min(e.clientX - dragStartRef.current.x, maxStretch))
      setDragOffset(dx)
      setValue(valueFromDrag(mode, dragStartRef.current.baseValue, dx))
    },
    [mode]
  )

  const handleGripPointerUp = useCallback(() => {
    if (!dragStartRef.current) return
    dragStartRef.current = null
    setDragOffset(0)
    setPhase('label')
  }, [])

  // Submit
  const handleSubmit = useCallback(() => {
    const trimmed = label.trim()

    if (mode === 'timer') {
      addTimer({
        id: generateId(),
        name: trimmed,
        totalSeconds: value,
        startedAt: Date.now(),
        paused: false,
      })
    } else if (mode === 'alarm') {
      const hh = String(Math.floor(value / 60)).padStart(2, '0')
      const mm = String(value % 60).padStart(2, '0')
      window.electronAPI.setAlarm({
        id: generateId(),
        label: trimmed || 'Alarm',
        time: `${hh}:${mm}`,
        repeat: false,
        enabled: true,
      })
    } else {
      window.electronAPI.setReminder({
        id: generateId(),
        label: trimmed || 'Reminder',
        intervalMinutes: value,
        enabled: true,
        nextFireAt: Date.now() + value * 60_000,
      })
    }

    setCreating(false)
  }, [mode, value, label, addTimer, setCreating])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      if (phase === 'drag') setPhase('label')
      else if (phase === 'editTime') confirmTimeInput()
      else handleSubmit()
    }
    if (e.key === 'Escape') setCreating(false)
  }

  const currentW = phase === 'label' || phase === 'editTime' ? LABEL_W : REST_W + dragOffset

  // Concave pinch: top/bottom edges curve inward during stretch
  // Starts just past the time badge (~75px) so it doesn't squish the icon/badge
  const pinchDepth = Math.min(dragOffset * 0.04, 8) // max 8px inward curve
  const pinchStartPct = currentW > 0 ? Math.min(75 / currentW * 100, 50) : 50
  const pinchMidPct = pinchStartPct + (100 - pinchStartPct) * 0.45
  const pinchTopY = pinchDepth / PILL_H * 100 // how far inward from top (%)
  const pinchBotY = 100 - pinchTopY // how far inward from bottom (%)
  const clipPath = dragOffset > 5
    ? `polygon(
        0% 0%,
        ${pinchStartPct}% 0%,
        ${pinchMidPct}% ${pinchTopY}%,
        100% 0%,
        100% 100%,
        ${pinchMidPct}% ${pinchBotY}%,
        ${pinchStartPct}% 100%,
        0% 100%
      )`
    : undefined

  return (
    <motion.div
      className="relative"
      style={{ height: PILL_H }}
      onKeyDown={handleKeyDown}
      tabIndex={-1}
      animate={{ width: currentW }}
      transition={
        phase === 'label' || phase === 'editTime'
          ? { type: 'spring', stiffness: 300, damping: 28 }
          : { duration: 0 }
      }
    >
      {/* Pill background */}
      <div
        className="absolute inset-0 rounded-full backdrop-blur-2xl backdrop-saturate-[1.8]
          bg-[var(--g-bg)] border-[0.5px] border-[var(--g-line)]"
        style={{
          ...glassStyle,
          ...(clipPath ? { clipPath, WebkitClipPath: clipPath } : {}),
        }}
      />

      {/* Content */}
      <div className="absolute inset-0 flex items-center px-2">
        {/* Mode icon */}
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (phase === 'drag') cycleMode()
          }}
          className="shrink-0 w-6 h-6 flex items-center justify-center rounded-full
            text-[var(--g-text-secondary)] hover:text-[var(--g-text-primary)]
            hover:bg-[var(--g-bg-hover)] transition-colors duration-150
            cursor-pointer outline-none z-10"
        >
          <AnimatePresence mode="wait">
            <motion.span
              key={mode}
              initial={{ scale: 0.6, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.6, opacity: 0 }}
              transition={{ duration: 0.15 }}
              className="flex items-center justify-center"
            >
              {modeIcon(mode)}
            </motion.span>
          </AnimatePresence>
        </button>

        {/* Time circle — click to manually edit */}
        <AnimatePresence mode="wait">
          {phase === 'editTime' ? (
            <motion.div
              key="time-input"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="shrink-0 h-7 ml-1 z-10"
            >
              <input
                ref={timeInputRef}
                type="text"
                value={timeInput}
                onChange={(e) => setTimeInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={confirmTimeInput}
                className="h-7 w-16 px-2 rounded-full text-center
                  bg-white/[0.15] border border-white/[0.12]
                  text-[12px] font-medium text-[var(--g-text-primary)] tabular-nums
                  outline-none"
              />
            </motion.div>
          ) : (
            <motion.div
              key="time-badge"
              initial={{ scale: 0.9, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.9, opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="shrink-0 h-7 w-7 ml-1 rounded-full
                bg-white/[0.12] border border-white/[0.08]
                flex items-center justify-center z-10
                cursor-pointer hover:bg-white/[0.18] transition-colors duration-100"
              style={{ minWidth: mode === 'alarm' ? 64 : 28 }}
              onClick={handleTimeBadgeClick}
            >
              <span className="text-[11px] font-medium text-[var(--g-text-primary)] tabular-nums whitespace-nowrap">
                {shortDisplay(mode, value)}
              </span>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Right: grip or label input */}
        <AnimatePresence mode="wait">
          {phase === 'drag' ? (
            <motion.div
              key="grip"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.12 }}
              className="shrink-0 w-6 h-full flex flex-col items-center justify-center gap-[3px]
                cursor-ew-resize select-none touch-none z-10"
              onPointerDown={handleGripPointerDown}
              onPointerMove={handleGripPointerMove}
              onPointerUp={handleGripPointerUp}
              onPointerCancel={handleGripPointerUp}
            >
              <div className="w-2.5 h-[1.5px] rounded-full bg-[var(--g-text-muted)]" />
              <div className="w-2.5 h-[1.5px] rounded-full bg-[var(--g-text-muted)]" />
              <div className="w-2.5 h-[1.5px] rounded-full bg-[var(--g-text-muted)]" />
            </motion.div>
          ) : (
            <motion.div
              key="label-input"
              initial={{ opacity: 0, width: 0 }}
              animate={{ opacity: 1, width: 'auto' }}
              transition={{ duration: 0.2 }}
              className="flex items-center gap-1.5 min-w-0 overflow-hidden z-10"
            >
              <div className="w-px h-3.5 bg-[var(--g-line-subtle)] shrink-0" />
              <input
                ref={labelRef}
                type="text"
                value={label}
                onChange={(e) => setLabel(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="label"
                className="min-w-0 w-20 bg-transparent text-[var(--g-text-primary)] text-[12px] font-light
                  placeholder:text-[var(--g-text-faint)] outline-none border-none"
              />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
