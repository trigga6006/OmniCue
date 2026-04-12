import { useEffect } from 'react'

let initialized = false
let lastPublishedRegions = ''

// ── Region publish suppression (refcount-based) ────────────────────────────
// Callers acquire suppression via suppressRegionPublish(), which returns a
// one-shot release function. Region publishing is blocked while any handle
// is outstanding. On final release, a catch-up publish fires immediately.
let regionPublishSuppressionCount = 0

export function suppressRegionPublish(): () => void {
  regionPublishSuppressionCount += 1
  let released = false

  return () => {
    if (released) return
    released = true
    regionPublishSuppressionCount = Math.max(0, regionPublishSuppressionCount - 1)
    if (regionPublishSuppressionCount === 0) {
      // Force a fresh publish so stale signatures don't suppress the catch-up.
      // publishInteractiveRegions lives inside the useEffect closure, so we
      // trigger it via the same custom event the rest of the app uses.
      lastPublishedRegions = ''
      window.dispatchEvent(new Event('republish-interactive-regions'))
    }
  }
}

interface InteractiveRegion {
  x: number
  y: number
  width: number
  height: number
}

/**
 * Current mouse-event state:
 *   'ignore'  – setIgnoreMouseEvents(true)                 – fully click-through
 *   'forward' – setIgnoreMouseEvents(true, {forward:true}) – clicks pass through, events forwarded
 *   'capture' – setIgnoreMouseEvents(false)                – window captures clicks
 */
let mouseState: 'ignore' | 'forward' | 'capture' = 'ignore'

/** Timestamp of the last setIgnoreMouseEvents IPC call — used for throttling. */
let lastTransitionTime = 0

/**
 * No-op kept for API compatibility — click-through is now purely
 * driven by `data-interactive` hit-testing so the companion panel
 * doesn't block the entire window.
 */
export function setClickThroughLock(_locked: boolean): void {
  // intentionally empty
}

/**
 * Minimum interval between setIgnoreMouseEvents IPC calls.
 * Each call toggles a Windows mouse hook which can cause cursor artifacts
 * when toggled too rapidly. 50ms ≈ 3 animation frames — imperceptible
 * delay but eliminates jitter from edge-bouncing.
 */
const MIN_TRANSITION_MS = 50

function setMouseState(state: 'ignore' | 'forward' | 'capture', force = false): void {
  if (state === mouseState) return

  // Throttle transitions to prevent cursor jitter from rapid hook toggling.
  // Force bypass for safety-critical transitions (errors, escape, mouseleave).
  if (!force) {
    const now = performance.now()
    if (now - lastTransitionTime < MIN_TRANSITION_MS) return
    lastTransitionTime = now
  } else {
    lastTransitionTime = performance.now()
  }

  mouseState = state
  try {
    switch (state) {
      case 'ignore':
        window.electronAPI.setIgnoreMouseEvents(true)
        break
      case 'forward':
        window.electronAPI.setIgnoreMouseEvents(true, { forward: true })
        break
      case 'capture':
        window.electronAPI.setIgnoreMouseEvents(false)
        break
    }
  } catch {
    // Best-effort — if IPC is dead the process is going down anyway
  }
}

/**
 * Check whether a point (or its immediate neighborhood) hits a
 * `data-interactive` element. When already in capture mode, we check
 * a small padding around the cursor to provide hysteresis — this
 * prevents edge-bouncing when the cursor is right at the border of
 * an interactive element.
 */
function isPointOverInteractive(x: number, y: number, padded: boolean): boolean {
  const el = document.elementFromPoint(x, y)
  if (el !== null && el.closest('[data-interactive]') !== null) return true
  if (!padded) return false

  // Hysteresis: check a few nearby points (4px in each direction)
  const PAD = 4
  const offsets = [
    [PAD, 0], [-PAD, 0], [0, PAD], [0, -PAD],
  ]
  for (const [dx, dy] of offsets) {
    const nearby = document.elementFromPoint(x + dx, y + dy)
    if (nearby !== null && nearby.closest('[data-interactive]') !== null) return true
  }
  return false
}

function collectInteractiveRegions(): InteractiveRegion[] {
  return Array.from(document.querySelectorAll<HTMLElement>('[data-interactive]'))
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map((rect) => ({
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
    }))
}

/**
 * Global click-through manager — three-state architecture.
 *
 * ENTRY detection: the main process polls cursor position at ~30 fps.
 * When the cursor enters the window zone, it switches to FORWARD mode
 * (clicks pass through, but mouse events are forwarded to the renderer).
 *
 * HIT-TESTING: this hook checks `document.elementFromPoint()` on
 * forwarded mousemove events. Only when the cursor is directly over a
 * `data-interactive` element does it switch to CAPTURE mode. This means
 * clicks are blocked ONLY over visible UI — never over transparent areas.
 *
 * STABILITY: transitions are throttled (50ms minimum interval) and
 * CAPTURE→FORWARD uses a short debounce + hysteresis padding to prevent
 * cursor jitter from rapid Windows mouse-hook toggling.
 *
 * LEAVE detection: when the cursor leaves the window, mouseleave fires
 * and we switch to IGNORE. Main process polling also handles this as a
 * fallback.
 *
 * Mark interactive containers with `data-interactive` attribute.
 */
export function useGlobalClickThrough(): void {
  useEffect(() => {
    if (initialized) return
    initialized = true

    // Ensure we start in full pass-through mode
    setMouseState('ignore', true)

    let rafId = 0
    let lastX = -1
    let lastY = -1
    let leaveTimer = 0
    let regionRafId = 0

    let retryTimer = 0

    const publishInteractiveRegions = (): void => {
      if (regionPublishSuppressionCount > 0) {
        if (retryTimer) {
          clearTimeout(retryTimer)
          retryTimer = 0
        }
        return
      }
      if (regionRafId) return
      regionRafId = requestAnimationFrame(() => {
        regionRafId = 0
        const regions = collectInteractiveRegions()
        const nextSignature = JSON.stringify(regions)
        if (nextSignature === lastPublishedRegions) return
        lastPublishedRegions = nextSignature
        window.electronAPI.setInteractiveRegions(regions)

        // If we published non-empty regions and the cursor is already over
        // an interactive element, transition to capture immediately so the
        // first click works without requiring a mousemove.
        if (regions.length > 0 && lastX >= 0 && lastY >= 0) {
          if (isPointOverInteractive(lastX, lastY, false)) {
            setMouseState('capture', true)
          }
        }

        // If data-interactive elements exist in the DOM but regions are
        // empty (layout not ready yet), retry until we get real geometry.
        if (retryTimer) { clearTimeout(retryTimer); retryTimer = 0 }
        const hasInteractiveElements = document.querySelectorAll('[data-interactive]').length > 0
        if (hasInteractiveElements && regions.length === 0) {
          let attempts = 0
          const retry = (): void => {
            retryTimer = 0
            if (attempts++ >= 10) return // give up after ~1s
            if (regionPublishSuppressionCount > 0) return
            const fresh = collectInteractiveRegions()
            if (fresh.length > 0) {
              const sig = JSON.stringify(fresh)
              if (sig !== lastPublishedRegions) {
                lastPublishedRegions = sig
                window.electronAPI.setInteractiveRegions(fresh)
                if (lastX >= 0 && lastY >= 0 && isPointOverInteractive(lastX, lastY, false)) {
                  setMouseState('capture', true)
                }
              }
            } else {
              retryTimer = window.setTimeout(retry, 100)
            }
          }
          retryTimer = window.setTimeout(retry, 100)
        }
      })
    }

    const resizeObserver = new ResizeObserver(() => {
      publishInteractiveRegions()
    })

    const observeInteractiveElements = (): void => {
      resizeObserver.disconnect()
      document.querySelectorAll('[data-interactive]').forEach((element) => {
        resizeObserver.observe(element)
      })
      publishInteractiveRegions()
    }

    const mutationObserver = new MutationObserver(() => {
      observeInteractiveElements()
    })

    observeInteractiveElements()
    mutationObserver.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'data-interactive'],
    })
    window.addEventListener('resize', publishInteractiveRegions)

    // Components can force a region republish by dispatching this event
    // (e.g. CompanionPanel after its enter animation completes).
    window.addEventListener('republish-interactive-regions', publishInteractiveRegions)

    const handleMouseMove = (e: MouseEvent): void => {
      if (e.clientX === lastX && e.clientY === lastY) return
      lastX = e.clientX
      lastY = e.clientY

      if (rafId) return
      rafId = requestAnimationFrame(() => {
        rafId = 0

        // Use padded hit-test when already capturing (hysteresis)
        const usePadding = mouseState === 'capture'
        const isOverInteractive = isPointOverInteractive(lastX, lastY, usePadding)

        if (isOverInteractive) {
          // Cursor is over a visible interactive element — capture clicks.
          // Cancel any pending leave timer.
          if (leaveTimer) {
            clearTimeout(leaveTimer)
            leaveTimer = 0
          }
          setMouseState('capture')
        } else if (mouseState === 'capture') {
          // Cursor just left an interactive element — debounce the
          // transition back to FORWARD to prevent edge-jitter.
          if (!leaveTimer) {
            leaveTimer = window.setTimeout(() => {
              leaveTimer = 0
              // Re-check in case cursor moved back over interactive
              if (!isPointOverInteractive(lastX, lastY, true)) {
                setMouseState('forward')
              }
            }, 60)
          }
        }
        // If already in FORWARD and not over interactive, stay in FORWARD
        // (no action needed — the main process set FORWARD on zone entry).
      })
    }

    const handleMouseLeave = (): void => {
      // Cursor left the renderer viewport — go fully click-through.
      if (leaveTimer) {
        clearTimeout(leaveTimer)
        leaveTimer = 0
      }
      setMouseState('ignore', true)
    }

    const handleKeyDown = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        if (leaveTimer) {
          clearTimeout(leaveTimer)
          leaveTimer = 0
        }
        setMouseState('ignore', true)
      }
    }

    document.addEventListener('mousemove', handleMouseMove, { passive: true })
    document.addEventListener('mouseleave', handleMouseLeave)
    document.addEventListener('keydown', handleKeyDown)

    const forceIgnore = (): void => {
      if (leaveTimer) {
        clearTimeout(leaveTimer)
        leaveTimer = 0
      }
      setMouseState('ignore', true)
    }
    window.addEventListener('error', forceIgnore)
    window.addEventListener('unhandledrejection', forceIgnore)

    return () => {
      if (rafId) cancelAnimationFrame(rafId)
      if (regionRafId) cancelAnimationFrame(regionRafId)
      if (leaveTimer) clearTimeout(leaveTimer)
      if (retryTimer) clearTimeout(retryTimer)
      mutationObserver.disconnect()
      resizeObserver.disconnect()
      window.removeEventListener('resize', publishInteractiveRegions)
      window.removeEventListener('republish-interactive-regions', publishInteractiveRegions)
      window.electronAPI.setInteractiveRegions([])
      lastPublishedRegions = ''
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseleave', handleMouseLeave)
      document.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('error', forceIgnore)
      window.removeEventListener('unhandledrejection', forceIgnore)
      setMouseState('ignore', true)
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
