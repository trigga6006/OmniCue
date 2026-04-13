/**
 * OCR preprocessing layer — extracts text from screenshots using Windows native OCR.
 * Spec ref: Section 5.3 (Screen Understanding), Section 6.1 (Preprocessing Layer)
 * Performance target: under 400ms (Section 7.1)
 */

import { promises as fs } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { randomUUID } from 'crypto'

interface OcrLine {
  text: string
  words: Array<{
    text: string
    boundingRect: { x: number; y: number; width: number; height: number }
  }>
}

export interface OcrResult {
  text: string
  lines: OcrLine[]
  screenType: ScreenType
  durationMs: number
}

export type ScreenType =
  | 'article'
  | 'chat'
  | 'email'
  | 'code'
  | 'terminal'
  | 'document'
  | 'dashboard'
  | 'form'
  | 'browser'
  | 'unknown'

/**
 * Basic screen-type classification from OCR text.
 * Spec ref: Section 5.3 — screen-type classification
 */
function classifyScreen(text: string, windowTitle: string): ScreenType {
  const lower = text.toLowerCase()
  const title = windowTitle.toLowerCase()

  // Terminals
  if (
    title.includes('terminal') ||
    title.includes('powershell') ||
    title.includes('cmd.exe') ||
    title.includes('command prompt') ||
    title.includes('warp') ||
    title.includes('iterm') ||
    title.includes('windows terminal') ||
    title.includes('alacritty') ||
    title.includes('hyper') ||
    /\$\s|>\s|❯|error:|failed|exit code/i.test(lower)
  ) {
    return 'terminal'
  }

  // Code editors
  if (
    title.includes('visual studio') ||
    title.includes('vs code') ||
    title.includes('vscode') ||
    title.includes('intellij') ||
    title.includes('sublime') ||
    title.includes('vim') ||
    title.includes('nvim') ||
    /function\s|const\s|import\s|class\s|def\s|return\s/.test(lower)
  ) {
    return 'code'
  }

  // Chat apps
  if (
    title.includes('slack') ||
    title.includes('discord') ||
    title.includes('teams') ||
    title.includes('whatsapp') ||
    title.includes('telegram') ||
    title.includes('messages')
  ) {
    return 'chat'
  }

  // Email
  if (
    title.includes('gmail') ||
    title.includes('outlook') ||
    title.includes('mail') ||
    lower.includes('subject:') ||
    lower.includes('from:') ||
    lower.includes('reply all')
  ) {
    return 'email'
  }

  // Document editors
  if (
    title.includes('word') ||
    title.includes('docs') ||
    title.includes('notion') ||
    title.includes('.docx') ||
    title.includes('.pdf')
  ) {
    return 'document'
  }

  // Dashboard / analytics
  if (
    title.includes('dashboard') ||
    title.includes('analytics') ||
    title.includes('grafana') ||
    title.includes('datadog')
  ) {
    return 'dashboard'
  }

  // Browser — general fallback for browser titles
  if (
    title.includes('chrome') ||
    title.includes('firefox') ||
    title.includes('edge') ||
    title.includes('safari') ||
    title.includes('brave')
  ) {
    // Check if it's an article (long text blocks)
    const wordCount = lower.split(/\s+/).length
    if (wordCount > 100) return 'article'
    return 'browser'
  }

  // Form detection
  if (
    lower.includes('submit') &&
    (lower.includes('name') || lower.includes('email') || lower.includes('password'))
  ) {
    return 'form'
  }

  return 'unknown'
}

/**
 * Extract text from a screenshot data URL using Windows native OCR.
 * Falls back gracefully if OCR is unavailable (returns empty result).
 */
export async function extractTextFromScreenshot(
  dataUrl: string,
  windowTitle: string
): Promise<OcrResult> {
  const start = Date.now()

  // Write the image to a temp file for the OCR engine
  const match = dataUrl.match(/^data:image\/([a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    return { text: '', lines: [], screenType: 'unknown', durationMs: Date.now() - start }
  }

  const extension = match[1] === 'jpeg' ? 'jpg' : match[1] === 'webp' ? 'webp' : 'png'
  const tempPath = join(tmpdir(), `omnicue-ocr-${randomUUID()}.${extension}`)

  try {
    await fs.writeFile(tempPath, Buffer.from(match[2], 'base64'))

    // Dynamic import to avoid crash on non-Windows platforms
    const ocr = await import('node-windows-ocr')
    // In packaged builds, the OCR exe is inside app.asar.unpacked but the
    // bundled __dirname resolves to app.asar. Use a runtime require.resolve
    // (not the bundler-transformed one) to find the real path and fix it.
    const rr = typeof globalThis.require?.resolve === 'function'
      ? globalThis.require.resolve
      : require.resolve
    const resolved = rr('node-windows-ocr')
    const moduleRoot = resolved.replace('app.asar', 'app.asar.unpacked').replace(/[\\/]dist[\\/]index\.\w+$/, '')
    const results = await ocr.recognizeBatchFromPath([tempPath], { moduleRoot })

    if (!results || results.length === 0 || !results[0].Result) {
      return { text: '', lines: [], screenType: 'unknown', durationMs: Date.now() - start }
    }

    const result = results[0].Result
    const lines: OcrLine[] = result.Lines.map((line) => ({
      text: line.Text,
      words: line.Words.map((w) => ({
        text: w.Text,
        boundingRect: {
          x: w.BoundingRect.X,
          y: w.BoundingRect.Y,
          width: w.BoundingRect.Width,
          height: w.BoundingRect.Height,
        },
      })),
    }))

    const text = result.Text || lines.map((l) => l.text).join('\n')
    const screenType = classifyScreen(text, windowTitle)

    return {
      text,
      lines,
      screenType,
      durationMs: Date.now() - start,
    }
  } catch (err) {
    console.warn('[OmniCue] OCR failed, continuing without text extraction:', err)
    return { text: '', lines: [], screenType: 'unknown', durationMs: Date.now() - start }
  } finally {
    // Clean up temp file
    fs.unlink(tempPath).catch(() => {})
  }
}
