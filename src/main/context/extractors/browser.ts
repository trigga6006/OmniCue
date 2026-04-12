import type { ActiveWindowInfo } from '../../activeWindow'
import type { BrowserContext } from '../types'
import { extractBrowserUrl } from '../../browser/url'

export async function extractBrowserContext(
  activeWin: ActiveWindowInfo,
  pack: { context: Record<string, string> }
): Promise<BrowserContext | undefined> {
  const pageTitle = pack.context.pageTitle?.trim() || activeWin.windowTitle?.trim()
  const site = pack.context.siteHint?.trim()
  const browserFamily = pack.context.browserFamily?.trim()

  if (!pageTitle && !site && !browserFamily) return undefined

  // Best-effort URL extraction — don't block snapshot if it fails
  let url: string | undefined
  try {
    const urlResult = await extractBrowserUrl(browserFamily)
    url = urlResult.url || undefined
  } catch {
    // Degrade gracefully
  }

  return {
    pageTitle,
    site,
    browserFamily,
    url,
  }
}
