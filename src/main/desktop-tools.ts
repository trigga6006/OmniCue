/**
 * Shared desktop-context helpers used by both ipc.ts and server.ts.
 * Owns: display resolution, screenshot capture, OCR, and lightweight context.
 */

import { BrowserWindow, screen, desktopCapturer, clipboard } from 'electron'
import { extractTextFromScreenshot } from './ocr'
import { getActiveWindowAsync } from './activeWindow'

// ── Display resolution ──────────────────────────────────────────────────────

/** Return the display ID nearest to the given window's center, or the primary. */
export function getCurrentDisplayId(win: BrowserWindow | null): number {
  if (win && !win.isDestroyed()) {
    const b = win.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: b.x + Math.round(b.width / 2),
      y: b.y + Math.round(b.height / 2),
    })
    return display.id
  }
  return screen.getPrimaryDisplay().id
}

export interface DisplayInfo {
  id: number
  label: string
  width: number
  height: number
}

/** List all displays with a label and flag the one the overlay is on. */
export function listDisplays(win: BrowserWindow | null): { displays: DisplayInfo[]; current: number } {
  const primaryId = screen.getPrimaryDisplay().id
  const displays = screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: `Display ${i + 1}${d.id === primaryId ? ' (Primary)' : ''}`,
    width: d.bounds.width,
    height: d.bounds.height,
  }))
  return { displays, current: getCurrentDisplayId(win) }
}

// ── Screenshot capture ──────────────────────────────────────────────────────

/** Capture a screenshot as a data-URL for a given display (or the overlay's display). */
export async function captureDisplayDataUrl(
  displayId?: number,
  win?: BrowserWindow | null,
): Promise<{ image: string; displayId: number } | null> {
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: 1920, height: 1080 },
    fetchWindowIcons: false,
  })
  if (sources.length === 0) return null

  const targetId = String(displayId ?? getCurrentDisplayId(win ?? null))
  const source = sources.find((s) => s.display_id === targetId) || sources[0]

  return {
    image: source.thumbnail.toDataURL(),
    displayId: Number(source.display_id) || Number(targetId),
  }
}

// ── OCR / screen text ───────────────────────────────────────────────────────

export interface ScreenTextResult {
  screenText: string
  screenType: string
  activeApp: string
  windowTitle: string
  display: number
}

/** Capture + OCR a display and return text with metadata. */
export async function getScreenText(
  displayId?: number,
  win?: BrowserWindow | null,
): Promise<ScreenTextResult | null> {
  const capture = await captureDisplayDataUrl(displayId, win)
  if (!capture) return null

  const winInfo = await getActiveWindowAsync()
  const title = winInfo?.windowTitle || 'Desktop'

  const ocr = await extractTextFromScreenshot(capture.image, title)

  return {
    screenText: ocr.text,
    screenType: ocr.screenType,
    activeApp: winInfo?.activeApp || '',
    windowTitle: title,
    display: capture.displayId,
  }
}

// ── Lightweight context (no screenshot / OCR) ───────────────────────────────

export interface DesktopContext {
  activeApp: string
  processName: string
  windowTitle: string
  display: number
  clipboard?: string
}

export async function getDesktopContext(
  win: BrowserWindow | null,
  options?: { includeClipboard?: boolean },
): Promise<DesktopContext> {
  const winInfo = await getActiveWindowAsync()
  const ctx: DesktopContext = {
    activeApp: winInfo?.activeApp || '',
    processName: winInfo?.processName || '',
    windowTitle: winInfo?.windowTitle || '',
    display: getCurrentDisplayId(win),
  }
  if (options?.includeClipboard) {
    ctx.clipboard = clipboard.readText() || ''
  }
  return ctx
}
