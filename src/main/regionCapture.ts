/**
 * Region screenshot capture - fullscreen overlay for click-and-drag selection.
 *
 * Flow:
 *  1. Hide the main window so it doesn't appear in the overlay
 *  2. Show a transparent fullscreen overlay with a dim layer (real screen visible through it)
 *  3. User drags a selection rectangle (bright cutout)
 *  4. Destroy the overlay, capture the display, crop to the selection
 *  5. Return the cropped data URL
 */

import { BrowserWindow, ipcMain, nativeImage, screen } from 'electron'
import { captureDisplayDataUrl, getCurrentDisplayId } from './desktop-tools'

export interface RegionCaptureResult {
  image: string
  displayId: number
}

let captureSequence = 0

/**
 * Launch the region-selection overlay on the display nearest to `refWindow`,
 * wait for the user to draw a rectangle (or cancel), and return the cropped image.
 *
 * The caller is responsible for hiding/showing `refWindow` so it doesn't appear
 * in the transparent overlay or the final capture.
 */
export async function captureRegion(
  refWindow: BrowserWindow | null,
): Promise<RegionCaptureResult | null> {
  const displayId = getCurrentDisplayId(refWindow)
  const display =
    screen.getAllDisplays().find((d) => d.id === displayId) || screen.getPrimaryDisplay()
  const { x, y, width, height } = display.bounds
  const dpr = display.scaleFactor

  const overlay = new BrowserWindow({
    x,
    y,
    width,
    height,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: true,
    fullscreenable: false,
    resizable: false,
    hasShadow: false,
    webPreferences: {
      // Ephemeral internal window loading a data URL.
      contextIsolation: false,
      nodeIntegration: true,
      sandbox: false,
    },
  })

  overlay.setAlwaysOnTop(true, 'screen-saver')

  const requestId = `region-capture-${Date.now()}-${++captureSequence}`
  const completeChannel = `${requestId}:complete`
  const cancelChannel = `${requestId}:cancel`
  const html = buildSelectionHtml(completeChannel, cancelChannel)

  await overlay.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`)
  overlay.show()
  overlay.focus()

  // Wait for user to complete or cancel the selection.
  // Returns the CSS-pixel rect, or null if cancelled.
  const rect = await new Promise<{ x: number; y: number; w: number; h: number } | null>(
    (resolve) => {
      let settled = false

      const settle = (
        result: { x: number; y: number; w: number; h: number } | null,
      ): void => {
        if (settled) return
        settled = true
        ipcMain.removeListener(completeChannel, onComplete)
        ipcMain.removeListener(cancelChannel, onCancel)
        overlay.removeListener('closed', onClosed)
        resolve(result)
      }

      const onComplete = (
        _event: Electron.IpcMainEvent,
        r: { x: number; y: number; w: number; h: number },
      ): void => settle(r)

      const onCancel = (): void => settle(null)
      const onClosed = (): void => settle(null)

      ipcMain.on(completeChannel, onComplete)
      ipcMain.on(cancelChannel, onCancel)
      overlay.on('closed', onClosed)
    },
  )

  // Destroy the overlay (safe even if already closed via Escape/blur)
  if (!overlay.isDestroyed()) overlay.destroy()

  if (!rect) return null

  // Brief delay for the compositor to remove the overlay from screen
  await new Promise((r) => setTimeout(r, 120))

  // Capture the clean screen (main window + overlay are both gone)
  const capture = await captureDisplayDataUrl(displayId, refWindow)
  if (!capture) return null

  // Scale CSS pixels → device pixels for cropping
  const cropRect = {
    x: Math.round(rect.x * dpr),
    y: Math.round(rect.y * dpr),
    width: Math.round(rect.w * dpr),
    height: Math.round(rect.h * dpr),
  }

  const full = nativeImage.createFromDataURL(capture.image)
  const fullSize = full.getSize()

  // Clamp to image bounds
  cropRect.x = Math.max(0, Math.min(cropRect.x, Math.max(0, fullSize.width - 1)))
  cropRect.y = Math.max(0, Math.min(cropRect.y, Math.max(0, fullSize.height - 1)))
  cropRect.width = Math.min(cropRect.width, fullSize.width - cropRect.x)
  cropRect.height = Math.min(cropRect.height, fullSize.height - cropRect.y)

  if (cropRect.width < 1 || cropRect.height < 1) return null

  const cropped = full.crop(cropRect)
  return {
    image: cropped.toDataURL(),
    displayId: capture.displayId,
  }
}

function buildSelectionHtml(completeChannel: string, cancelChannel: string): string {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body {
    width: 100%; height: 100%;
    overflow: hidden;
    cursor: crosshair;
    user-select: none;
    -webkit-user-select: none;
    background: transparent;
  }
  #dim {
    position: fixed; inset: 0;
    background: rgba(0,0,0,0.35);
    pointer-events: none;
  }
  #sel {
    position: fixed;
    display: none;
    border: 2px solid rgba(255,255,255,0.85);
    border-radius: 2px;
    box-shadow: 0 0 0 9999px rgba(0,0,0,0.35);
    background: transparent;
    pointer-events: none;
    z-index: 10;
  }
  #size-label {
    position: fixed;
    display: none;
    padding: 2px 8px;
    background: rgba(0,0,0,0.7);
    color: #fff;
    font: 11px/1.4 system-ui, sans-serif;
    border-radius: 4px;
    pointer-events: none;
    z-index: 20;
    white-space: nowrap;
  }
</style>
</head>
<body>
  <div id="dim"></div>
  <div id="sel"></div>
  <div id="size-label"></div>
<script>
  const { ipcRenderer } = require('electron');
  const completeChannel = ${JSON.stringify(completeChannel)};
  const cancelChannel = ${JSON.stringify(cancelChannel)};

  const dim = document.getElementById('dim');
  const sel = document.getElementById('sel');
  const label = document.getElementById('size-label');
  let drawing = false;
  let startX = 0;
  let startY = 0;

  function sendCancel() {
    ipcRenderer.send(cancelChannel);
  }

  function updateLabelPosition(x, y, w, h) {
    const margin = 8;
    const labelWidth = label.offsetWidth || 56;
    const labelHeight = label.offsetHeight || 20;
    const maxLeft = Math.max(0, window.innerWidth - labelWidth - margin);
    const maxTop = Math.max(0, window.innerHeight - labelHeight - margin);
    label.style.left = Math.min(x + w + margin, maxLeft) + 'px';
    label.style.top = Math.min(y + h + margin, maxTop) + 'px';
  }

  document.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    drawing = true;
    startX = e.clientX;
    startY = e.clientY;
    // Hide the full-screen dim once dragging starts — the selection box-shadow handles dimming
    dim.style.display = 'none';
    sel.style.display = 'block';
    sel.style.left = startX + 'px';
    sel.style.top = startY + 'px';
    sel.style.width = '0px';
    sel.style.height = '0px';
    label.style.display = 'block';
    label.textContent = '0 x 0';
    updateLabelPosition(startX, startY, 0, 0);
  });

  document.addEventListener('mousemove', (e) => {
    if (!drawing) return;
    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);
    sel.style.left = x + 'px';
    sel.style.top = y + 'px';
    sel.style.width = w + 'px';
    sel.style.height = h + 'px';
    label.textContent = w + ' x ' + h;
    updateLabelPosition(x, y, w, h);
  });

  document.addEventListener('mouseup', (e) => {
    if (!drawing) return;
    drawing = false;
    sel.style.display = 'none';
    label.style.display = 'none';

    const x = Math.min(e.clientX, startX);
    const y = Math.min(e.clientY, startY);
    const w = Math.abs(e.clientX - startX);
    const h = Math.abs(e.clientY - startY);

    if (w < 10 || h < 10) {
      sendCancel();
      return;
    }

    ipcRenderer.send(completeChannel, { x, y, w, h });
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      drawing = false;
      sel.style.display = 'none';
      label.style.display = 'none';
      sendCancel();
    }
  });

  window.addEventListener('blur', () => {
    drawing = false;
    sel.style.display = 'none';
    label.style.display = 'none';
    sendCancel();
  });
</script>
</body>
</html>`
}
