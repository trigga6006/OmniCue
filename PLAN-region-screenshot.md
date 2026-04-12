# Plan: Region Screenshot Capture

## Overview
Add a click-and-drag region screenshot tool alongside the existing full-screen capture. User clicks a new icon, the screen dims, they drag a rectangle, and the cropped screenshot is inserted into the chat (not sent) with OCR.

---

## UI Trigger

**Location:** New icon button to the **right** of the existing Camera button in `CompanionInput.tsx`.

**Layout change:** The Camera (full capture) and new Crop icon share a slightly wider combined zone. The `placeholder` text ("Ask about your screen...") shifts right to accommodate.

```
[ 📷 | ✂️ ]  Ask about your screen...          [Send]
```

- Use `Crop` or `Scissors` icon from lucide-react (likely `ScanLine` or `Maximize2` — will pick the clearest one)
- Both buttons sit in a shared `flex` group with a subtle divider between them

---

## Region Selection Flow

### Step 1: User clicks the region-capture button

**Renderer → Main (IPC invoke):** `capture-region-start`

### Step 2: Main process prepares the overlay

1. **Hide the companion panel** — send `companion-hide-for-capture` event to the main overlay window so it collapses to just the pill bar (no panel). The pill stays visible so the user can press Escape to cancel.
2. **Capture a full-screen screenshot** immediately via `desktopCapturer` (same as existing) — this becomes the frozen background the user draws on. Capturing now (before showing the overlay) means the overlay itself won't appear in the screenshot.
3. **Create a new fullscreen BrowserWindow** (the selection overlay):
   - `fullscreen: true` (or sized to the display bounds)
   - `transparent: true`, `frame: false`, `alwaysOnTop: true` (above even the pill — `level: 'screen-saver'`)
   - `skipTaskbar: true`, `focusable: true`
   - Loads a minimal HTML page (inline or a dedicated route) that:
     - Displays the captured screenshot as a full-screen background image
     - Applies a dark semi-transparent overlay (~30% black dim) on top
     - Sets `cursor: crosshair` on the entire surface

### Step 3: User draws a selection rectangle

The selection overlay page handles all mouse interaction:

- **mousedown:** Record start point `(x1, y1)`, begin drawing
- **mousemove:** Draw a selection rectangle. The area **inside** the rectangle shows the original screenshot at full brightness (no dim). The area **outside** stays dimmed. This is achieved with a CSS `clip-path` or a `box-shadow: 0 0 0 9999px rgba(0,0,0,0.4)` on the selection rect.
- **mouseup:** Record end point `(x2, y2)`, finalize selection
- **Escape key:** Cancel — close the overlay, restore companion panel, no screenshot taken
- **Minimum size guard:** If the selection is < 10×10px, treat as a cancel (accidental click)

### Step 4: Crop and return

1. Selection overlay sends the rect coordinates `{ x, y, width, height }` back to main via IPC (`capture-region-complete`)
2. Main process:
   - Takes the pre-captured full screenshot `nativeImage`
   - Calls `nativeImage.crop({ x, y, width, height })` using the coordinates (scaled for device pixel ratio)
   - Converts to data URL
   - Fires background OCR (same `extractTextFromScreenshot` path, gets an `ocrId`)
   - Closes/destroys the selection overlay window
3. Main sends the result back to the renderer: `{ image: string, title: 'Region capture', ocrId: number }`

### Step 5: Insert into chat

- Renderer receives the result and calls `setPendingScreenshot(result)` — same as the existing manual capture
- The screenshot chip appears above the input, **not auto-sent**
- OCR runs in background and is available when the user eventually sends

---

## File Changes

### `src/main/ipc.ts`
- Add `ipcMain.handle('capture-region-start', ...)` handler:
  - Captures full screen via `desktopCapturer` (reuse existing logic)
  - Hides companion panel via `mainWindow.webContents.send('companion-hide-for-capture')`
  - Creates the fullscreen selection overlay `BrowserWindow`
  - Loads the selection UI (inline data URL or a dedicated HTML file)
  - Waits for the selection result via a Promise that resolves from an IPC message from the overlay window
  - On result: crops the image, fires OCR, destroys overlay, tells main window to restore companion (`companion-restore-after-capture`)
  - Returns `{ image, title, ocrId }` or `null` if cancelled

### `src/main/index.ts`
- No changes needed — the selection overlay is ephemeral, created/destroyed in the IPC handler

### `src/preload/index.ts`
- Add `captureRegion` to the context bridge:
  ```ts
  captureRegion: (): Promise<{ image: string; title: string; ocrId: number } | null> =>
    ipcRenderer.invoke('capture-region-start'),
  ```
- Add listeners for `companion-hide-for-capture` and `companion-restore-after-capture`:
  ```ts
  onCaptureHideCompanion: (cb: () => void) => ipcRenderer.on('companion-hide-for-capture', cb),
  onCaptureRestoreCompanion: (cb: () => void) => ipcRenderer.on('companion-restore-after-capture', cb),
  ```

### `src/renderer/src/components/CompanionInput.tsx`
- Import a crop/region icon (e.g., `ScanLine` from lucide-react)
- Add `handleRegionCapture` callback that calls `window.electronAPI.captureRegion()` and sets `setPendingScreenshot(result)`
- Restructure the button area: group Camera + Region icons in a shared flex container with a thin divider
- Both buttons same size (`w-7 h-7`), side by side

### `src/renderer/src/components/CompanionPanel.tsx` (or `App.tsx`)
- Listen for `companion-hide-for-capture` → temporarily hide the panel (set a local `captureInProgress` flag)
- Listen for `companion-restore-after-capture` → restore the panel
- The pill bar remains visible throughout

### New file: `src/main/regionCapture.ts` (optional, for cleanliness)
- Encapsulates the overlay window creation, selection UI HTML, and coordinate handling
- Exports a single function: `captureRegion(mainWindow: BrowserWindow): Promise<CropResult | null>`

### New file: `src/main/region-overlay.html` (or inline in the JS)
- Minimal HTML/CSS/JS for the selection UI
- Full-screen canvas or div with the screenshot as background
- Mouse event handlers for drawing the selection rectangle
- Posts result back via `ipcRenderer.send('capture-region-result', { x, y, w, h })` or via a preload bridge

---

## Selection Overlay UI Spec

```html
<!-- Fullscreen, transparent BrowserWindow content -->
<body style="margin:0; cursor:crosshair; overflow:hidden;">
  <!-- Screenshot as frozen background -->
  <img id="bg" src="[dataURL]" style="position:fixed; inset:0; width:100%; height:100%;">
  
  <!-- Dim overlay (covers everything) -->
  <div id="dim" style="position:fixed; inset:0; background:rgba(0,0,0,0.35);"></div>
  
  <!-- Selection rectangle (bright cutout) -->
  <div id="selection" style="position:fixed; display:none;
    border: 2px solid rgba(255,255,255,0.8);
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.35);
    pointer-events: none;">
  </div>
</body>
```

The `box-shadow` trick on the selection div creates the "dim everything except the selection" effect without needing clip-path math.

---

## DPR / Coordinate Scaling

`desktopCapturer` captures at device pixel ratio. The selection overlay runs in CSS pixels. When cropping:

```ts
const dpr = screen.getPrimaryDisplay().scaleFactor
const cropRect = {
  x: Math.round(selectionX * dpr),
  y: Math.round(selectionY * dpr),
  width: Math.round(selectionW * dpr),
  height: Math.round(selectionH * dpr),
}
const cropped = fullScreenshot.crop(cropRect)
```

---

## Multi-Monitor Consideration

- Detect which display the overlay pill is on (from saved `barPosX/barPosY`)
- Create the selection overlay on **that** display (set `x`, `y`, `width`, `height` to that display's bounds instead of using `fullscreen: true`)
- Capture source should match that display

---

## Edge Cases

- **Escape cancels:** Overlay listens for `keydown` Escape → sends cancel IPC, overlay destroyed, companion restored
- **Tiny selection (< 10px either dimension):** Treat as cancel
- **User clicks without dragging:** Cancel
- **Overlay window loses focus:** Cancel (user clicked away)
- **Multiple monitors:** Selection overlay only covers the display the pill is on

---

## Summary of IPC Channels

| Channel | Direction | Purpose |
|---------|-----------|---------|
| `capture-region-start` | renderer → main (invoke) | Initiate region capture |
| `companion-hide-for-capture` | main → renderer (send) | Hide panel, keep pill |
| `companion-restore-after-capture` | main → renderer (send) | Restore panel after capture |
| `capture-region-result` | overlay → main (send) | Selection coordinates |
| `capture-region-cancel` | overlay → main (send) | User cancelled |
