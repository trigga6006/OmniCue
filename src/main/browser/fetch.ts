/**
 * Shared bounded fetch helpers for browser enrichments.
 * Enforces timeouts, size limits, and content-type checks.
 */

const MAX_HTML_BYTES = 5_000_000    // 5 MB
const MAX_CSS_BYTES = 2_000_000     // 2 MB
const FETCH_TIMEOUT_MS = 8000
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'

interface FetchHtmlResult {
  url: string
  html: string
  contentType?: string
}

interface HeadResult {
  ok: boolean
  size?: number
  contentType?: string
}

function buildHeaders(referer?: string): Record<string, string> {
  const headers: Record<string, string> = { 'User-Agent': USER_AGENT }
  if (referer) headers['Referer'] = referer
  return headers
}

async function boundedFetch(
  url: string,
  maxBytes: number,
  opts?: { referer?: string }
): Promise<{ text: string; contentType?: string; finalUrl: string }> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: buildHeaders(opts?.referer),
      redirect: 'follow',
    })

    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`)
    }

    const contentType = res.headers.get('content-type') || undefined

    // Stream-read with size cap
    const reader = res.body?.getReader()
    if (!reader) throw new Error('No response body')

    const chunks: Uint8Array[] = []
    let totalBytes = 0

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > maxBytes) {
        reader.cancel()
        break
      }
      chunks.push(value)
    }

    const decoder = new TextDecoder('utf-8', { fatal: false })
    const text = decoder.decode(Buffer.concat(chunks))

    return { text, contentType, finalUrl: res.url || url }
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch an HTML page with size and timeout limits. */
export async function fetchHtml(url: string): Promise<FetchHtmlResult> {
  const result = await boundedFetch(url, MAX_HTML_BYTES)
  return { url: result.finalUrl, html: result.text, contentType: result.contentType }
}

/** Fetch a CSS stylesheet with size and timeout limits. */
export async function fetchCss(url: string, referer?: string): Promise<string> {
  const result = await boundedFetch(url, MAX_CSS_BYTES, { referer })
  return result.text
}

/** HEAD request to check resource accessibility and size. */
export async function headResource(url: string): Promise<HeadResult> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 5000)

  try {
    const res = await fetch(url, {
      method: 'HEAD',
      signal: controller.signal,
      headers: buildHeaders(),
      redirect: 'follow',
    })

    const size = res.headers.get('content-length')
    return {
      ok: res.ok,
      size: size ? parseInt(size, 10) : undefined,
      contentType: res.headers.get('content-type') || undefined,
    }
  } catch {
    return { ok: false }
  } finally {
    clearTimeout(timer)
  }
}
