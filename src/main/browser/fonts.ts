/**
 * Font sniping — identify and optionally download fonts used on a webpage.
 * Core CSS parsing logic adapted from font-sniper-raycast.
 * Uses brace-counting parsers (not regex) for nested CSS safety.
 */

import { writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, extname } from 'path'
import { fetchHtml, fetchCss, headResource } from './fetch'

export interface SnipedFont {
  family: string
  weight?: string
  style?: string
  format: 'woff2' | 'woff' | 'ttf' | 'otf' | 'eot' | 'unknown'
  url: string
  size?: number
  accessible: boolean
  usedOn: string[]
  isDataUri: boolean
}

// ── Skip patterns: icon/library fonts to ignore ──────────────────────────────

const SKIP_FAMILIES = new Set([
  'font awesome', 'fontawesome', 'fa ', 'material icons', 'material symbols',
  'codicon', 'devicon', 'icomoon', 'glyphicons', 'bootstrap-icons',
  'remixicon', 'boxicons', 'feather', 'ionicons', 'typicons',
  'katex', 'mathjax', 'prismjs',
])

function shouldSkipFamily(family: string): boolean {
  const lower = family.toLowerCase().trim()
  for (const skip of SKIP_FAMILIES) {
    if (lower.includes(skip)) return true
  }
  return false
}

// ── CSS parsing ──────────────────────────────────────────────────────────────

/** Extract all @import URLs from CSS text. */
function extractImports(css: string): string[] {
  const imports: string[] = []
  const re = /@import\s+(?:url\()?['"]?([^'");\s]+)['"]?\)?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(css)) !== null) {
    if (m[1]) imports.push(m[1])
  }
  return imports
}

/** Brace-counting parser: extract blocks matching a top-level at-rule. */
function extractAtBlocks(css: string, atRule: string): string[] {
  const blocks: string[] = []
  let idx = 0

  while (idx < css.length) {
    const start = css.indexOf(atRule, idx)
    if (start === -1) break

    // Find opening brace
    const braceStart = css.indexOf('{', start)
    if (braceStart === -1) break

    // Count braces to find matching close
    let depth = 1
    let pos = braceStart + 1
    while (pos < css.length && depth > 0) {
      if (css[pos] === '{') depth++
      else if (css[pos] === '}') depth--
      pos++
    }

    blocks.push(css.slice(start, pos))
    idx = pos
  }

  return blocks
}

interface FontFaceDecl {
  family: string
  weight?: string
  style?: string
  src: string
}

/** Parse a single @font-face block into its declarations. */
function parseFontFace(block: string): FontFaceDecl | null {
  const inner = block.slice(block.indexOf('{') + 1, block.lastIndexOf('}'))

  let family: string | undefined
  let weight: string | undefined
  let style: string | undefined
  let src: string | undefined

  for (const line of inner.split(';')) {
    const trimmed = line.trim()
    const colonIdx = trimmed.indexOf(':')
    if (colonIdx === -1) continue

    const prop = trimmed.slice(0, colonIdx).trim().toLowerCase()
    const val = trimmed.slice(colonIdx + 1).trim()

    switch (prop) {
      case 'font-family':
        family = val.replace(/['"]/g, '').trim()
        break
      case 'font-weight':
        weight = val.trim()
        break
      case 'font-style':
        style = val.trim()
        break
      case 'src':
        src = val
        break
    }
  }

  if (!family || !src) return null
  return { family, weight, style, src }
}

/** Extract font URLs from a src declaration. */
function parseSrcUrls(src: string): Array<{ url: string; format: string }> {
  const results: Array<{ url: string; format: string }> = []

  // Match url(...) with optional format(...)
  const re = /url\(\s*['"]?([^'")]+)['"]?\s*\)(?:\s*format\(\s*['"]?([^'")]+)['"]?\s*\))?/g
  let m: RegExpExecArray | null
  while ((m = re.exec(src)) !== null) {
    const url = m[1]?.trim()
    if (!url) continue
    let format = m[2]?.trim().toLowerCase() || ''
    if (!format) {
      // Infer from extension
      const ext = extname(url.split('?')[0]).toLowerCase()
      format = ext === '.woff2' ? 'woff2'
        : ext === '.woff' ? 'woff'
        : ext === '.ttf' ? 'truetype'
        : ext === '.otf' ? 'opentype'
        : ext === '.eot' ? 'eot'
        : ''
    }
    results.push({ url, format })
  }

  return results
}

function normalizeFormat(format: string): SnipedFont['format'] {
  switch (format.toLowerCase()) {
    case 'woff2': return 'woff2'
    case 'woff': return 'woff'
    case 'truetype': case 'ttf': return 'ttf'
    case 'opentype': case 'otf': return 'otf'
    case 'embedded-opentype': case 'eot': return 'eot'
    default: return 'unknown'
  }
}

function normalizeWeight(weight?: string): string | undefined {
  if (!weight) return undefined
  const w = weight.toLowerCase().trim()
  const map: Record<string, string> = {
    'normal': '400', 'bold': '700', 'lighter': '300', 'bolder': '800',
    '100': '100', '200': '200', '300': '300', '400': '400',
    '500': '500', '600': '600', '700': '700', '800': '800', '900': '900',
  }
  return map[w] || weight
}

// ── CSS selector extraction (which fonts are actually used) ──────────────────

const PRIMARY_SELECTORS = [
  'body', 'html', 'p', 'span', 'div', 'a', 'li', 'td', 'th',
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'article', 'section', 'main', 'header', 'footer', 'nav',
  'blockquote', 'pre', 'code', 'label', 'input', 'button', 'textarea',
]

/** Find which font-family values are referenced in CSS selectors. */
function extractUsedFamilies(css: string): Map<string, string[]> {
  const usage = new Map<string, string[]>()

  // Strip @font-face blocks so we only look at rules
  const stripped = css.replace(/@font-face\s*\{[^}]*\}/g, '')

  // Simple regex for font-family in declarations
  const re = /([^{}]+)\{[^}]*font-family\s*:\s*([^;}"']+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(stripped)) !== null) {
    const selector = m[1]?.trim() || ''
    const familyVal = m[2]?.trim() || ''

    // Parse comma-separated family list
    for (let fam of familyVal.split(',')) {
      fam = fam.replace(/['"]/g, '').trim()
      if (!fam) continue

      const selectors = usage.get(fam) || []
      // Check if this selector matches any primary elements
      for (const primary of PRIMARY_SELECTORS) {
        if (selector.includes(primary) || selector === '*') {
          if (!selectors.includes(primary)) selectors.push(primary)
        }
      }
      // Also include the raw selector if it matched
      if (selectors.length === 0 && selector) {
        selectors.push(selector.slice(0, 60))
      }
      if (selectors.length > 0) usage.set(fam, selectors)
    }
  }

  return usage
}

// ── Main extraction ──────────────────────────────────────────────────────────

const MAX_STYLESHEETS = 10

/** Collect all CSS from a page (inline + external + @import). */
async function collectCss(html: string, pageUrl: string): Promise<string> {
  const dom = await import('jsdom').then(m => new m.JSDOM(html, { url: pageUrl }))
  const doc = dom.window.document
  const cssParts: string[] = []

  // Inline <style> tags
  for (const style of doc.querySelectorAll('style')) {
    const text = style.textContent?.trim()
    if (text) cssParts.push(text)
  }

  // External <link rel="stylesheet">
  const linkEls = doc.querySelectorAll('link[rel="stylesheet"]')
  const hrefs: string[] = []
  for (const link of linkEls) {
    const href = link.getAttribute('href')
    if (href && hrefs.length < MAX_STYLESHEETS) {
      try {
        hrefs.push(new URL(href, pageUrl).href)
      } catch { /* skip invalid */ }
    }
  }

  dom.window.close()

  // Fetch external stylesheets in parallel
  const fetched = await Promise.allSettled(
    hrefs.map(href => fetchCss(href, pageUrl))
  )
  for (const result of fetched) {
    if (result.status === 'fulfilled') cssParts.push(result.value)
  }

  // Follow @import declarations (one level deep for safety)
  const allCss = cssParts.join('\n')
  const imports = extractImports(allCss)
  if (imports.length > 0) {
    const importFetches = await Promise.allSettled(
      imports.slice(0, MAX_STYLESHEETS).map(imp => {
        try {
          return fetchCss(new URL(imp, pageUrl).href, pageUrl)
        } catch {
          return Promise.resolve('')
        }
      })
    )
    for (const result of importFetches) {
      if (result.status === 'fulfilled' && result.value) cssParts.push(result.value)
    }
  }

  return cssParts.join('\n')
}

/** Identify all fonts used on a webpage. */
export async function snipeFonts(url: string): Promise<SnipedFont[]> {
  const { url: finalUrl, html } = await fetchHtml(url)
  const css = await collectCss(html, finalUrl)

  // Extract @font-face blocks
  const fontFaceBlocks = extractAtBlocks(css, '@font-face')
  const usedFamilies = extractUsedFamilies(css)

  const fonts: SnipedFont[] = []
  const seen = new Set<string>()

  for (const block of fontFaceBlocks) {
    const decl = parseFontFace(block)
    if (!decl) continue
    if (shouldSkipFamily(decl.family)) continue

    const srcEntries = parseSrcUrls(decl.src)
    // Prefer woff2 > woff > others
    const sorted = srcEntries.sort((a, b) => {
      const order = ['woff2', 'woff', 'truetype', 'opentype', 'eot']
      return order.indexOf(a.format) - order.indexOf(b.format)
    })

    const entry = sorted[0]
    if (!entry) continue

    const isDataUri = entry.url.startsWith('data:')
    const resolvedUrl = isDataUri ? entry.url : resolveUrl(entry.url, finalUrl)
    if (!resolvedUrl) continue

    const weight = normalizeWeight(decl.weight)
    const dedupeKey = `${decl.family}|${weight}|${decl.style}|${normalizeFormat(entry.format)}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)

    const usedOn = usedFamilies.get(decl.family) || []

    fonts.push({
      family: decl.family,
      weight,
      style: decl.style,
      format: normalizeFormat(entry.format),
      url: resolvedUrl,
      accessible: false, // will be checked below
      usedOn,
      isDataUri,
    })
  }

  // Check accessibility in parallel
  await Promise.allSettled(
    fonts.map(async (font) => {
      if (font.isDataUri) {
        font.accessible = true
        return
      }
      try {
        const head = await headResource(font.url)
        font.accessible = head.ok
        if (head.size) font.size = head.size
      } catch {
        font.accessible = false
      }
    })
  )

  return fonts
}

function resolveUrl(url: string, base: string): string | null {
  if (url.startsWith('data:')) return url
  try {
    return new URL(url, base).href
  } catch {
    return null
  }
}

/** Build a human-readable summary of identified fonts. */
export function summarizeFonts(fonts: SnipedFont[]): string {
  const byFamily = new Map<string, string[]>()
  for (const f of fonts) {
    const weights = byFamily.get(f.family) || []
    if (f.weight && !weights.includes(f.weight)) weights.push(f.weight)
    byFamily.set(f.family, weights)
  }

  const parts: string[] = []
  for (const [family, weights] of byFamily) {
    const w = weights.sort().join(', ')
    parts.push(w ? `${family} (${w})` : family)
  }

  return `${byFamily.size} font ${byFamily.size === 1 ? 'family' : 'families'}: ${parts.join(', ')}`
}

// ── Font download + conversion ───────────────────────────────────────────────

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80)
}

function formatExtension(format: SnipedFont['format']): string {
  switch (format) {
    case 'woff2': return '.woff2'
    case 'woff': return '.woff'
    case 'ttf': return '.ttf'
    case 'otf': return '.otf'
    case 'eot': return '.eot'
    default: return '.font'
  }
}

/** Download a font and optionally convert WOFF/WOFF2 to TTF/OTF. */
export async function downloadFont(
  font: SnipedFont,
  destDir: string,
  convert = true,
): Promise<{ path: string; convertedFrom?: string }> {
  if (!existsSync(destDir)) {
    mkdirSync(destDir, { recursive: true })
  }

  let buffer: Buffer

  if (font.isDataUri) {
    // Parse data URI
    const commaIdx = font.url.indexOf(',')
    if (commaIdx === -1) throw new Error('Invalid data URI')
    const b64 = font.url.slice(commaIdx + 1)
    buffer = Buffer.from(b64, 'base64')
  } else {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 15000)
    try {
      const res = await fetch(font.url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' },
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      buffer = Buffer.from(await res.arrayBuffer())
    } finally {
      clearTimeout(timer)
    }
  }

  const weight = font.weight || 'regular'
  const style = font.style || 'normal'
  const baseName = sanitizeFilename(`${font.family}-${weight}-${style}`)

  // Try to convert web formats to desktop formats
  let convertedFrom: string | undefined
  if (convert && (font.format === 'woff2' || font.format === 'woff')) {
    try {
      const fontverter = await import('fontverter')
      const converted = await fontverter.convert(buffer, 'ttf')
      const outPath = resolveUniquePath(destDir, baseName, '.ttf')
      writeFileSync(outPath, converted)
      return { path: outPath, convertedFrom: font.format }
    } catch {
      // Conversion failed — save original format
    }
  }

  const ext = formatExtension(font.format)
  const outPath = resolveUniquePath(destDir, baseName, ext)
  writeFileSync(outPath, buffer)
  return { path: outPath, convertedFrom }
}

function resolveUniquePath(dir: string, baseName: string, ext: string): string {
  let candidate = join(dir, `${baseName}${ext}`)
  let counter = 1
  while (existsSync(candidate)) {
    candidate = join(dir, `${baseName}-${counter}${ext}`)
    counter++
  }
  return candidate
}
