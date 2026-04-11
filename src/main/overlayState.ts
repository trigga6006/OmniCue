/**
 * Shared mutable state used by both the cursor-polling loop (index.ts)
 * and the IPC handlers (ipc.ts) to coordinate click-through toggling.
 */

export const overlayState = {
  /** Whether the overlay window is currently ignoring mouse events (click-through). */
  isIgnoring: true,

  /** Whether we're in forward mode (ignore + forward: clicks pass through, mouse events forwarded). */
  isForwarding: false,

  /** When true, the polling loop will not toggle back to ignore mode (e.g. during drag). */
  locked: false,

  /** When true, cursor polling checks the full window height (panel is open). */
  panelOpen: false,

  /** Timestamp of the last transition to full-ignore mode (not forwarding) — used for cooldown. */
  lastIgnoreTime: 0
}
