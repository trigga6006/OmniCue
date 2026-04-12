import type { PackMatchResult } from './types'
import { registry } from './registry'

/**
 * Resolve the active window to a tool pack.
 * Returns the highest-confidence match, or null if nothing matches.
 */
export function resolvePack(input: {
  activeApp: string
  processName: string
  windowTitle: string
  ocrText?: string
}): PackMatchResult | null {
  let best: PackMatchResult | null = null

  for (const pack of registry) {
    const result = pack.match(input)
    if (result && (best === null || result.confidence > best.confidence)) {
      best = result
    }
  }

  return best
}
