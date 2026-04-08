import { useState, useEffect, useCallback, useRef } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { PlusButton } from '@/components/PlusButton'
import { TimerPill } from '@/components/TimerPill'
import { TimerCircle } from '@/components/TimerCircle'
import { NotificationBubble } from '@/components/NotificationBubble'
import { AnimatedSlot } from '@/components/AnimatedSlot'
import { ContextMenu } from '@/components/ContextMenu'
import { HistoryPanel } from '@/components/HistoryPanel'
import { SettingsPanel } from '@/components/SettingsPanel'
import { useTimerStore } from '@/stores/timerStore'
import { useNotificationStore } from '@/stores/notificationStore'
import { useSettingsStore } from '@/stores/settingsStore'
import { useHistoryStore } from '@/stores/historyStore'
import type { HistoryEntry } from '@/lib/types'
import { generateId } from '@/lib/utils'
import { useGlobalClickThrough } from '@/hooks/useClickThrough'
import { useBrightnessSampler } from '@/hooks/useBrightnessSampler'
import { FullScreenAlert } from '@/components/FullScreenAlert'
import { AiButton } from '@/components/AiButton'
import { CompanionPanel } from '@/components/CompanionPanel'
import { useCompanionStore } from '@/stores/companionStore'
import { COMPANION_HEIGHT } from '@/lib/constants'
import type { AppNotification, ActiveTimer } from '@/lib/types'

// Bar top offset inside the window (px from top edge)
const BAR_TOP = 10
// Fixed window width — generous enough for typical bar content (timers + notifications).
// Using a fixed width avoids constant setBounds() during AnimatedSlot animations.
// 800px covers ~5 timers + 3 expanded notifications comfortably.
const WIN_WIDTH = 800
// Base height when panels are closed vs open
const BASE_HEIGHT = 500
const PANEL_HEIGHT = 500

export default function App() {
  useGlobalClickThrough()
  useBrightnessSampler()

  const timers = useTimerStore((s) => s.timers)
  const addTimer = useTimerStore((s) => s.addTimer)
  const isCreating = useTimerStore((s) => s.isCreating)
  const notifications = useNotificationStore((s) => s.notifications)
  const addNotification = useNotificationStore((s) => s.add)
  const loadSettings = useSettingsStore((s) => s.load)
  const loadHistory = useHistoryStore((s) => s.load)
  const addHistoryLocal = useHistoryStore((s) => s.addLocal)

  const settings = useSettingsStore((s) => s.settings)
  const companionVisible = useCompanionStore((s) => s.visible)

  const [contextMenu, setContextMenu] = useState({ x: 0, y: 0, visible: false })
  const [showHistory, setShowHistory] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [fullScreenAlert, setFullScreenAlert] = useState<{ message: string; source: string } | null>(null)
  // Stash normal window bounds so we can restore after full-screen alert
  const savedBoundsRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null)

  // pos stores the bar's screen coordinate (where it should appear on the desktop)
  // It's used to position the BrowserWindow, NOT for CSS layout.
  const [pos, setPos] = useState({ x: 0, y: 0 })
  const [isDragging, setIsDragging] = useState(false)
  const [isHoveringBar, setIsHoveringBar] = useState(false)
  const dragRef = useRef<{ lastScreenX: number; lastScreenY: number } | null>(null)
  const posRef = useRef(pos)
  posRef.current = pos
  const lastHeight = useRef(BASE_HEIGHT)

  // --- Initialization ---
  useEffect(() => {
    loadSettings()
    loadHistory()

    // The main process positions the window based on saved barPos.
    // Read it back so our local `pos` state is in sync.
    window.electronAPI.getWindowBounds().then((b) => {
      setPos({ x: b.x + Math.round(b.width / 2), y: b.y + BAR_TOP })
    })

    // Listen for notifications from CLI / HTTP API
    const unsubNotify = window.electronAPI.onNotification((data: unknown) => {
      const n = data as AppNotification
      const s = useSettingsStore.getState().settings

      // Determine if this source should trigger a full-screen alert
      const isAlarm = n.title === 'Alarm'
      const isReminder = n.title === 'Reminder'
      const isClaude = n.title === 'Claude' || n.title === 'Codex'
      const wantFullScreen =
        (isAlarm && s.fullScreenAlarms) ||
        (isReminder && s.fullScreenReminders) ||
        (isClaude && s.fullScreenClaude)

      // Log to history regardless of display mode
      if (isClaude) {
        useHistoryStore.getState().add({
          id: generateId(),
          name: n.message,
          duration: 0,
          completedAt: new Date().toISOString(),
          type: n.title === 'Codex' ? 'codex' : 'claude',
        })
      }

      if (wantFullScreen) {
        // Fire-and-forget: expand window to primary display, then show alert
        // Use .then() instead of async/await to avoid IPC listener issues
        Promise.all([
          window.electronAPI.getWindowBounds(),
          window.electronAPI.getPrimaryDisplayBounds(),
        ]).then(([currentBounds, displayBounds]) => {
          savedBoundsRef.current = currentBounds
          window.electronAPI.setWindowBounds(displayBounds)
          window.electronAPI.setInteractiveLock(true)
          window.electronAPI.setIgnoreMouseEvents(false)
          setFullScreenAlert({ message: n.message, source: n.title || 'Notification' })
        })
      } else {
        addNotification(n)
      }
    })

    const unsubTimer = window.electronAPI.onRemoteTimer((data: unknown) => {
      addTimer(data as ActiveTimer)
    })

    const unsubHistory = window.electronAPI.onNewHistoryEntry((entry: unknown) => {
      addHistoryLocal(entry as HistoryEntry)
    })

    // Listen for global hotkey toggle
    const unsubCompanion = window.electronAPI.onToggleCompanion(() => {
      const companion = useCompanionStore.getState()
      if (!companion.visible) {
        setShowHistory(false)
        setShowSettings(false)
        window.electronAPI.captureActiveWindow().then((result) => {
          if (result) useCompanionStore.getState().setPendingScreenshot(result)
        })
        companion.open()
      } else {
        companion.close()
        window.electronAPI.setInteractiveLock(false)
      }
    })

    const handler = (e: MouseEvent) => e.preventDefault()
    document.addEventListener('contextmenu', handler)
    return () => {
      document.removeEventListener('contextmenu', handler)
      unsubNotify()
      unsubTimer()
      unsubHistory()
      unsubCompanion()
    }
  }, [])

  // --- Window resize on panel open/close only ---
  // Width is fixed (WIN_WIDTH) to avoid setBounds() during content animations.
  // Only height changes when panels open/close (a discrete user action).
  // Mutual exclusivity: companion closes other panels, other panels close companion
  useEffect(() => {
    if (companionVisible) {
      setShowHistory(false)
      setShowSettings(false)
      window.electronAPI.setInteractiveLock(true)
    } else {
      window.electronAPI.setInteractiveLock(false)
    }
  }, [companionVisible])

  useEffect(() => {
    if (showHistory || showSettings) {
      useCompanionStore.getState().close()
    }
  }, [showHistory, showSettings])

  useEffect(() => {
    const height = companionVisible
      ? COMPANION_HEIGHT
      : (showHistory || showSettings) ? PANEL_HEIGHT : BASE_HEIGHT
    if (height !== lastHeight.current) {
      lastHeight.current = height
      window.electronAPI.requestWindowResize(WIN_WIDTH, height)
    }
  }, [showHistory, showSettings, companionVisible])

  // --- Drag: move the BrowserWindow itself ---
  const handleGripMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
    window.electronAPI.setInteractiveLock(true)
    dragRef.current = {
      lastScreenX: e.screenX,
      lastScreenY: e.screenY,
    }

    const handleMove = (ev: MouseEvent) => {
      if (!dragRef.current) return
      const dx = ev.screenX - dragRef.current.lastScreenX
      const dy = ev.screenY - dragRef.current.lastScreenY
      dragRef.current.lastScreenX = ev.screenX
      dragRef.current.lastScreenY = ev.screenY
      window.electronAPI.moveWindowBy(dx, dy)
    }

    const handleUp = async () => {
      setIsDragging(false)
      dragRef.current = null
      document.removeEventListener('mousemove', handleMove)
      document.removeEventListener('mouseup', handleUp)
      window.electronAPI.setInteractiveLock(false)

      // Read final window position and persist as bar screen coordinate
      const b = await window.electronAPI.getWindowBounds()
      const newPos = { x: b.x + Math.round(b.width / 2), y: b.y + BAR_TOP }
      setPos(newPos)
      // Persist to main-process settings store so it survives restart
      window.electronAPI.setSettings({ barPosX: newPos.x, barPosY: newPos.y })
    }

    document.addEventListener('mousemove', handleMove)
    document.addEventListener('mouseup', handleUp)
  }, [])

  const resetPosition = useCallback(async () => {
    const center = await window.electronAPI.getPrimaryCenter()
    setPos(center)
    const h = (showHistory || showSettings) ? PANEL_HEIGHT : BASE_HEIGHT
    window.electronAPI.setWindowBounds({
      x: center.x - Math.round(WIN_WIDTH / 2),
      y: center.y - BAR_TOP,
      width: WIN_WIDTH,
      height: h,
    })
    window.electronAPI.setSettings({ barPosX: center.x, barPosY: center.y })
  }, [showHistory, showSettings])

  const moveToDisplay = useCallback((x: number, y: number) => {
    const newPos = { x, y }
    setPos(newPos)
    const h = (showHistory || showSettings) ? PANEL_HEIGHT : BASE_HEIGHT
    window.electronAPI.setWindowBounds({
      x: x - Math.round(WIN_WIDTH / 2),
      y: y - BAR_TOP,
      width: WIN_WIDTH,
      height: h,
    })
    window.electronAPI.setSettings({ barPosX: x, barPosY: y })
  }, [showHistory, showSettings])

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setContextMenu({ x: e.clientX, y: e.clientY, visible: true })
  }, [])

  const dismissFullScreenAlert = useCallback(() => {
    setFullScreenAlert(null)
    // Restore click-through and unlock interactive mode
    window.electronAPI.setIgnoreMouseEvents(true)
    window.electronAPI.setInteractiveLock(false)
    // Restore the window to its previous bar-sized bounds
    if (savedBoundsRef.current) {
      window.electronAPI.setWindowBounds(savedBoundsRef.current)
      savedBoundsRef.current = null
    }
  }, [])

  const showGrip = isHoveringBar && timers.length === 0 && !isCreating && !isDragging

  // Bar is always centered horizontally in the window, BAR_TOP from the top.
  // The BrowserWindow itself is positioned so this maps to the correct screen location.
  return (
    <div className="w-full h-full pointer-events-none select-none">
      <div
        className="fixed flex items-center pointer-events-none"
        style={{
          left: '50%',
          top: BAR_TOP,
          transform: 'translateX(-50%)',
        }}
        onMouseEnter={() => setIsHoveringBar(true)}
        onMouseLeave={() => !isDragging && setIsHoveringBar(false)}
      >
        <div className="pointer-events-auto" data-interactive>
          <PlusButton
            onContextMenu={handleContextMenu}
            showGrip={showGrip}
            onGripMouseDown={handleGripMouseDown}
          />
        </div>

        <AnimatePresence>
          {isCreating && (
            <motion.div
              key="pill"
              className="pointer-events-auto shrink-0 overflow-visible"
              data-interactive
              initial={{ width: 0, opacity: 0, marginLeft: 0 }}
              animate={{ width: 'auto', opacity: 1, marginLeft: 8 }}
              exit={{ width: 0, opacity: 0, marginLeft: 0 }}
              transition={{ duration: 0.25, ease: [0.25, 0.1, 0.25, 1] }}
            >
              <TimerPill />
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {timers.map((timer) => (
            <AnimatedSlot key={timer.id} className="pointer-events-auto" dataInteractive>
              <TimerCircle timer={timer} onContextMenu={handleContextMenu} />
            </AnimatedSlot>
          ))}
        </AnimatePresence>

        <AnimatePresence>
          {notifications.map((n) => (
            <AnimatedSlot key={n.id} className="pointer-events-auto" dataInteractive>
              <NotificationBubble notification={n} onContextMenu={handleContextMenu} />
            </AnimatedSlot>
          ))}
        </AnimatePresence>

        <div className="pointer-events-auto ml-2" data-interactive>
          <AiButton />
        </div>
      </div>

      {/* Context menu */}
      <ContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        visible={contextMenu.visible}
        onClose={() => setContextMenu((c) => ({ ...c, visible: false }))}
        onHistory={() => setShowHistory(true)}
        onSettings={() => window.electronAPI.openSettingsWindow('settings')}
        onResetPosition={resetPosition}
        onMoveToDisplay={moveToDisplay}
      />

      {/* Full-screen alert overlay */}
      <AnimatePresence>
        {fullScreenAlert && (
          <FullScreenAlert
            key="fs-alert"
            message={fullScreenAlert.message}
            source={fullScreenAlert.source}
            onDismiss={dismissFullScreenAlert}
          />
        )}
      </AnimatePresence>

      {/* Panels — anchored to window center, below the bar */}
      <HistoryPanel
        visible={showHistory}
        onClose={() => setShowHistory(false)}
        anchorX={Math.round(window.innerWidth / 2)}
        anchorY={BAR_TOP}
      />
      <SettingsPanel
        visible={showSettings}
        onClose={() => setShowSettings(false)}
        anchorX={Math.round(window.innerWidth / 2)}
        anchorY={BAR_TOP}
      />
      <CompanionPanel
        visible={companionVisible}
        onClose={() => useCompanionStore.getState().close()}
        anchorX={Math.round(window.innerWidth / 2)}
        anchorY={BAR_TOP}
      />
    </div>
  )
}
