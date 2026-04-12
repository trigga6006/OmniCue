# Companion Panel Animation Smoothness - Comprehensive Plan

**Branch:** `more-providors`
**Date:** 2026-04-12
**Status:** Revised after Codex review

---

## Problem Statement

The AI companion panel (opened via Ctrl+Shift+Space or the sparkles button) has
intermittent animation glitches during open, close, and resize (enlarge/minimize and
auto-grow). Symptoms include:

- **Open/close:** Brief position jump or stutter about 1 in 10 times
- **Size change:** Flash where the panel appears far to the left or above its correct
  position for one frame
- **General:** Occasional dropped frames during animation, inconsistent smoothness,
  and occasional unresponsive-feeling state transitions

These are not isolated CSS bugs. They stem from timing conflicts between Electron
window management, Framer Motion layout measurement, and the click-through system's
forced synchronous layouts.

---

## Root Cause Analysis

### RC-1: Window resize races with panel animation

**The flow today:**
1. State change (`panelSizeMode` or `visible`) triggers a React re-render
2. Framer Motion reads the new `animate` prop and begins a 300ms animation
3. A `useEffect` fires and calls `requestWindowResize()` via fire-and-forget IPC
4. Main process calls `win.setBounds()` synchronously
5. Browser viewport changes mid-animation, so CSS `left: 50%` recalculates against a
   different viewport width and the panel jumps for one frame

**Why it is intermittent:** the IPC round-trip is short, but not deterministic. If
`setBounds()` lands between frames the panel looks fine. If it lands during a frame,
the resize forces a reflow in the middle of the visual transition.

**Files:** `src/renderer/src/App.tsx:181-214`, `src/main/ipc.ts:168-175`

### RC-2: Framer Motion layout measurement on size change

When `panelSizeMode` changes, the panel's `animate` prop updates `width` and
`maxHeight`. Framer Motion performs layout measurement work before interpolating those
properties. That measurement is the most likely source of the "flash to the wrong
position" during enlarge/minimize.

**Files:** `src/renderer/src/components/CompanionPanel.tsx:149-164`

### RC-3: Forced synchronous layouts during animation

The click-through system's `collectInteractiveRegions()` calls
`getBoundingClientRect()` on every `[data-interactive]` element. That forces layout and
can interrupt otherwise smooth transform/opacity animation.

It is triggered during panel animation by:

- **ResizeObserver:** fires while the panel animates size
- **MutationObserver:** fires when AnimatePresence mounts/unmounts the panel DOM
- **Window `resize` event:** fires when `setBounds()` changes the viewport
- **`republish-interactive-regions` event:** fired after animation completion

Multiple triggers are coalesced into one RAF, but the `getBoundingClientRect()` calls
inside that RAF still force sync layout.

**Files:** `src/renderer/src/hooks/useClickThrough.ts:96-191`

### RC-4: `panelSizeMode` used during exit animation

Resetting `panelSizeMode` during close previously caused the panel to shrink and fade
out at the same time. That specific bug is already mostly fixed because `close()` no
longer resets size immediately, but it confirms that size changes must not overlap with
enter/exit transitions.

**Files:** `src/renderer/src/stores/companionStore.ts:153-164`

### RC-5: LayoutGroup and layoutId overhead

`App.tsx` wraps the UI in `<LayoutGroup>`, and `MorphingPill` uses
`layoutId="omni-pill"`. When the pill width changes, Framer Motion can perform layout
measurements across the group. That extra layout work can interleave with panel
animation even though the pill already animates width directly.

**Files:** `src/renderer/src/App.tsx:282-305`,
`src/renderer/src/components/MorphingPill.tsx:133-143`

### RC-6: Split control flow and async race windows

The current panel has multiple independent ways to change size or visibility:

- `open()` pre-resizes before showing the panel
- `App.tsx` resizes while the panel is already visible
- maximize/minimize buttons call `setPanelSizeMode(...)` directly
- streaming auto-grow also calls `setPanelSizeMode(...)` directly

If the implementation only makes button handlers async, it still misses auto-grow.
If it makes `open()` async without a transition token, rapid open/close/open can apply
stale completions out of order. A single global boolean suppression flag has the same
problem: one transition can unsuppress while another is still active.

**Files:** `src/renderer/src/stores/companionStore.ts:144-164, 308`,
`src/renderer/src/components/CompanionPanel.tsx:61-67, 174-187`,
`src/renderer/src/App.tsx:181-214`

### RC-7: Transition completion and suppression ownership are still too coarse

The current implementation shape uses one global pending-release handle for multiple
transition types and releases it from multiple event sources:

- panel enter animation completion
- panel CSS size transition completion
- superseding transitions calling `beginTransition()`

That means one transition can accidentally consume another transition's suppression
handle. Example: a size transition starts while the enter animation is still running,
then the enter animation's `onAnimationComplete` releases the size transition's
suppression early. The reverse can also happen with bubbling `transitionend` events.

This matches the remaining symptom where the pointer sometimes never switches into the
clickable/capture state even though the panel is visible: interactive regions are being
republished at the wrong time, or suppression is staying active for the wrong owner.

**Files:** `src/renderer/src/stores/companionStore.ts`,
`src/renderer/src/components/CompanionPanel.tsx`

### RC-8: Retry publishing can still force layout during a suppressed window

`useClickThrough.ts` now guards the main publish path with suppression, but its retry
path still calls `collectInteractiveRegions()` on a timer once it has started. That
means forced synchronous layout work can continue during transitions even though the app
believes publishing is suppressed, which lines up with the remaining mouse choppiness.

**Files:** `src/renderer/src/hooks/useClickThrough.ts`

---

## Proposed Architecture

### Principle: separate layout work from visual animation

Window resize is layout work. Panel enter/exit is visual animation. Panel size changes
are layout transitions. These should be sequenced, not overlapped.

Framer Motion should animate only transform/opacity for the panel shell. Width and
height changes should move to CSS transitions so Framer Motion is no longer asked to
measure layout for those properties.

### Overview

```text
BEFORE:
  State change -> Framer Motion layout animation + window resize + region publish all at once

AFTER:
  Open/close  -> suppress region publish -> resize window -> wait one frame -> enter/exit animation
  Size change -> suppress region publish -> resize window -> wait one frame -> CSS width/height transition
```

The one-frame wait is still important after `requestWindowResize()` resolves. The IPC
promise only proves the main process called `setBounds()`. It does not guarantee the
renderer has already reflowed against the new viewport size.

---

## Implementation Steps

### Step 1: Make `requestWindowResize` awaitable

Convert from fire-and-forget `ipcRenderer.send` to `ipcRenderer.invoke` so the renderer
can sequence transitions instead of hoping the resize lands at a good time.

**Files to change:**
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/lib/types.ts`

```ts
// ipc.ts
ipcMain.handle('request-window-resize', (event, size) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return
  const b = win.getBounds()
  const newX = Math.round(b.x + (b.width - size.width) / 2)
  win.setBounds({ x: newX, y: b.y, width: size.width, height: size.height })
})

// preload/index.ts
requestWindowResize: (width: number, height: number): Promise<void> =>
  ipcRenderer.invoke('request-window-resize', { width, height }),
```

### Step 2: Move width/maxHeight out of Framer Motion animate

The panel shell's `width` and `maxHeight` should be plain CSS with CSS transitions, not
Framer Motion `animate` props. Framer Motion should keep only `y`, `opacity`, and
`scale` for enter/exit.

Do the same for the inner scroll area's `maxHeight`.

**Important:** keep `left: 50%` plus `transform: translateX(-50%)`. The earlier failed
attempt changed centering mechanics and broke click-through hit testing.

### Step 3: Centralize all companion size transitions

Do not create a store action that only handles the maximize/minimize buttons. The live
panel also auto-grows during streaming by calling `setPanelSizeMode(...)` directly.

Create one coordinator for every companion size change, for example
`transitionPanelSize(mode)`, and route all callers through it:

- maximize button
- minimize button
- streaming auto-grow
- any future heuristics

That coordinator should:

1. no-op if the target mode is already current
2. acquire a transition token / sequence id
3. acquire region-publish suppression
4. await `requestWindowResize(...)`
5. wait one animation frame
6. if still current, commit `panelSizeMode`
7. release suppression only when the CSS transition really finishes

**Files to change:**
- `src/renderer/src/stores/companionStore.ts`
- `src/renderer/src/components/CompanionPanel.tsx`
- `src/renderer/src/App.tsx`

```ts
transitionPanelSize: async (mode: PanelSizeMode) => {
  const state = get()
  if (state.panelSizeMode === mode) return

  const token = beginPanelTransition('size')
  const releaseRegions = suppressRegionPublish()
  const config = PANEL_SIZES[mode]

  await window.electronAPI.requestWindowResize(config.windowW, config.windowH)
  await nextAnimationFrame()

  if (!isLatestPanelTransition(token)) {
    releaseRegions()
    return
  }

  set({ panelSizeMode: mode })
  registerPendingRegionRelease(token, releaseRegions)
}
```

`App.tsx` should stop resizing in response to companion `panelSizeMode` changes. After
this refactor, the app-level effect should only handle non-companion panels and the
delayed post-close shrink.

### Step 4: Replace the boolean suppression flag with token-based suppression

Do not use a single global boolean such as `regionPublishSuppressed = true/false`.
Open, close, and size transitions can overlap or be superseded.

Instead, `suppressRegionPublish()` should return a release function. Only the final
release should republish regions.

The release handle also needs an **owner token**. A completion callback must only
release the suppression handle that belongs to its own transition, never "whatever
happens to be pending right now".

**Files to change:**
- `src/renderer/src/hooks/useClickThrough.ts`
- `src/renderer/src/stores/companionStore.ts`
- `src/renderer/src/components/CompanionPanel.tsx`

```ts
let regionPublishSuppressionCount = 0

export function suppressRegionPublish(): () => void {
  regionPublishSuppressionCount += 1
  let released = false

  return () => {
    if (released) return
    released = true
    regionPublishSuppressionCount = Math.max(0, regionPublishSuppressionCount - 1)
    if (regionPublishSuppressionCount === 0) {
      lastPublishedRegions = ''
      publishInteractiveRegions()
    }
  }
}
```

### Step 5: Sequence the open flow

Open should become:

```text
1. Begin transition token
2. Acquire region suppression
3. Await compact window resize
4. Wait one animation frame
5. If token still current, set visible=true and panelSizeMode='compact'
6. Enter animation runs
7. Release suppression on enter animation completion
```

The extra frame wait replaces the current fire-and-forget plus RAF approach, but it
should not be removed outright. Without a post-resize barrier, the first visible panel
frame can still render against the old viewport width.

### Step 6: Use the correct completion signal for each transition type

The plan must distinguish between three different completion sources:

- **Enter animation:** release suppression on Framer Motion `onAnimationComplete`
- **Size transition:** release suppression on CSS `transitionend` for `width` or
  `max-height`, with a timeout fallback around 350ms
- **Close flow:** acquire suppression before `visible=false`, let exit run, then shrink
  the window and release suppression after the delayed shrink completes

This matters because once width/maxHeight move out of Framer Motion, size changes will
no longer trigger `onAnimationComplete`. Releasing suppression only there would leave
interactive-region publishing stuck off after maximize/minimize or auto-grow.

Also scope the DOM completion hooks tightly:

- `onTransitionEnd` should ignore bubbled child transitions with
  `if (e.target !== e.currentTarget) return`
- prefer releasing on the outer shell's `width` transition only, not any descendant
  `max-height` transition
- `onAnimationComplete` should release only the matching enter token, not a global
  pending release

### Step 7: Add a lightweight transition-state guard

Because open and size changes become async, use a monotonically increasing transition id
or equivalent "latest request wins" guard. Any late completion must verify it is still
current before:

- mutating visibility or `panelSizeMode`
- releasing shared suppression handles
- scheduling post-close shrink work

This protects rapid open/close/open, repeated maximize/minimize taps, and auto-grow
arriving while the panel is opening or closing.

One extra constraint from the current attempt: do not have `beginTransition()` eagerly
release the previous transition's suppression by triggering an immediate republish. A
superseded transition should be cancelled silently, and the replacement transition
should keep suppression active until its own completion point.

### Step 8: Remove layoutId from MorphingPill (optional but recommended)

`layoutId="omni-pill"` appears unnecessary because the pill already animates its width
directly. Removing it should reduce cross-tree layout measurement while the panel is
animating.

If nothing else in `App.tsx` depends on shared layout animations, remove the enclosing
`<LayoutGroup>` too.

### Step 9: Add a deduplication guard to requestWindowResize

Skip redundant `setBounds()` calls when the window is already at the requested size.

**Files to change:**
- `src/main/ipc.ts`

```ts
ipcMain.handle('request-window-resize', (event, size) => {
  const win = BrowserWindow.fromWebContents(event.sender)
  if (!win) return

  const b = win.getBounds()
  if (b.width === size.width && b.height === size.height) return

  const newX = Math.round(b.x + (b.width - size.width) / 2)
  win.setBounds({ x: newX, y: b.y, width: size.width, height: size.height })
})
```

### Step 10: Make retry publishing suppression-aware

The retry loop in `useClickThrough.ts` should stop or pause while suppression is active.
Otherwise the app continues doing the exact forced-layout work the suppression mechanism
was meant to avoid.

Recommended behavior:

1. if suppression becomes active, cancel any outstanding retry timer
2. when suppression ends, schedule one fresh publish attempt
3. do not call `collectInteractiveRegions()` from retry callbacks while suppressed

---

## Files Modified (Summary)

| File | Change |
|------|--------|
| `src/main/ipc.ts` | `ipcMain.on` -> `ipcMain.handle` for resize; add dedup guard |
| `src/preload/index.ts` | `send` -> `invoke` for resize; update return type |
| `src/renderer/src/lib/types.ts` | Update `requestWindowResize` type to `Promise<void>` |
| `src/renderer/src/stores/companionStore.ts` | Async `open()`, centralized async size-transition action, transition token tracking |
| `src/renderer/src/components/CompanionPanel.tsx` | Move width/maxHeight to CSS transitions, route button and auto-grow through centralized action, release suppression on animation/transition completion |
| `src/renderer/src/hooks/useClickThrough.ts` | Token/ref-count-based suppression API, guard `publishInteractiveRegions`, catch-up republish on final release |
| `src/renderer/src/App.tsx` | Simplify resize effect so companion transitions are centralized; optionally remove `LayoutGroup` |
| `src/renderer/src/components/MorphingPill.tsx` | Remove `layoutId` and maybe global layout participation |

---

## What Not To Change

- Keep `left: 50%` plus `translateX(-50%)` for centering
- Keep Framer Motion for enter/exit `y`, `opacity`, and `scale`
- Keep the 3-state click-through architecture
- Keep ResizeObserver and MutationObserver; just suppress region publishing during known
  transition windows

---

## Testing Checklist

- [ ] Open panel via Ctrl+Shift+Space - smooth slide-in, no position jump
- [ ] Open panel via sparkles button click - same
- [ ] Close panel via X button - smooth slide-out, no flash
- [ ] Close panel via Ctrl+Shift+Space - same
- [ ] Click Maximize - smooth expansion, no flash
- [ ] Click Minimize - smooth shrink, no flash
- [ ] Auto-grow during streaming (compact -> tall / wide / large) - smooth transition
- [ ] Trigger auto-grow while the panel is still opening - no deadlock, no stale state
- [ ] Rapid open/close/open - last request wins, no stuck states
- [ ] Rapid maximize/minimize clicks - no stale completion flashes
- [ ] Click-through still works correctly after transitions complete
- [ ] Panel buttons remain clickable during and after size change
- [ ] Streaming activity bubble animation does not interfere
- [ ] Test with one or more timers active in the pill

---

## Risk Assessment

| Risk | Likelihood | Mitigation |
|------|-----------|------------|
| `await` in store action delays panel open perceptibly | Low | Resize IPC is short; keep only one post-resize frame barrier |
| CSS transitions conflict with Framer Motion | Low | Framer Motion owns transform/opacity only; CSS owns width/max-height only |
| Region publishing is released too early or too late | Medium | Use token-based release plus `transitionend` / `onAnimationComplete` with timeout fallback |
| Async transitions complete out of order | Medium | Use a monotonically increasing transition id and ignore stale completions |
| Breaking other callers of `requestWindowResize` | Low | Existing callers can ignore the returned Promise |
