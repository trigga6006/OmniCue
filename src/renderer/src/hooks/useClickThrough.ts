import { useEffect } from 'react'

let initialized = false
let currentlyIgnoring = true

/**
 * No-op kept for API compatibility — click-through is now purely
 * driven by `data-interactive` hit-testing so the companion panel
 * doesn't block the entire window.
 */
export function setClickThroughLock(_locked: boolean): void {
  // intentionally empty
}

/**
 * Force the overlay back into click-through mode.
 * Called on cleanup, errors, and as a keyboard escape hatch.
 */
function forceClickThrough(): void {
  if (!currentlyIgnoring) {
    currentlyIgnoring = true
    try {
      window.electronAPI.setIgnoreMouseEvents(true)
    } catch {
      // Best-effort — if IPC is dead the process is going down anyway
    }
  }
}

/**
 * Global click-through manager — hybrid architecture.
 *
 * ENTRY detection is handled by the main process, which polls
 * `screen.getCursorScreenPoint()` at ~30 fps and checks if the cursor
 * is within the (now small) window bounds. When it enters, the main
 * process calls `setIgnoreMouseEvents(false)` and the renderer starts
 * receiving normal mouse events.
 *
 * LEAVE detection is handled here: when the cursor moves off interactive
 * elements, we debounce 150ms then switch back to click-through.
 *
 * Mark interactive containers with `data-interactive` attribute.
 */
export function useGlobalClickThrough(): void {
  useEffect(() => {
    if (initialized) return
    initialized = true

    // Ensure we start in pass-through mode
    window.electronAPI.setIgnoreMouseEvents(true)
    currentlyIgnoring = true

    let rafId = 0
    let lastX = -1
    let lastY = -1
    let leaveTimer = 0

    const handleMouseMove = (e: MouseEvent): void => {
      if (e.clientX === lastX && e.clientY === lastY) return
      lastX = e.clientX
      lastY = e.clientY

      // If we thought we were ignoring but received a mousemove, the main
      // process has enabled capture mode. Sync our local state.
      if (currentlyIgnoring) {
        currentlyIgnoring = false
      }

      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0

        const el = document.elementFromPoint(lastX, lastY)
        const isOverInteractive = el !== null && el.closest('[data-interactive]') !== null

        if (isOverInteractive) {
          if (leaveTimer) {
            clearTimeout(leaveTimer)
            leaveTimer = 0
          }
        } else if (!leaveTimer) {
          // Debounce the transition back to click-through
          leaveTimer = window.setTimeout(() => {
            leaveTimer = 0
            currentlyIgnoring = true
            window.electronAPI.setIgnoreMouseEvents(true)
          }, 150)
        }
      })
    }

    const handleMouseLeave = (): void => {
      if (leaveTimer) {
        clearTimeout(leaveTimer)
        leaveTimer = 0
      }
      forceClickThrough()
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (leaveTimer) {
          clearTimeout(leaveTimer)
          leaveTimer = 0
        }
        forceClickThrough()
      }
    }

    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseleave', handleMouseLeave)
    document.addEventListener('keydown', handleKeyDown)

    window.addEventListener('error', forceClickThrough)
    window.addEventListener('unhandledrejection', forceClickThrough)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (leaveTimer) clearTimeout(leaveTimer)
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('error', forceClickThrough)
      window.removeEventListener('unhandledrejection', forceClickThrough)
      forceClickThrough()
      initialized = false
    }
  }, [])
}

/**
 * @deprecated Use useGlobalClickThrough() once in App + data-interactive attributes instead
 */
export function useClickThrough(): Record<string, unknown> {
  return {} as Record<string, unknown>
}
