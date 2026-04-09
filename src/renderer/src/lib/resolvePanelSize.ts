import type { PanelSizeMode } from './constants'

/**
 * Determine panel size from assistant response content.
 * Pure heuristic — no network calls, no model involvement.
 */
export function resolvePanelSize(content: string): PanelSizeMode {
  const lines = content.split('\n')
  const lineCount = lines.length
  const longestLine = Math.max(...lines.map((l) => l.length))
  const codeFenceCount = (content.match(/^```/gm) || []).length / 2 // pairs

  const hasCode = codeFenceCount >= 1
  const hasLongLine = longestLine > 70
  const isLong = lineCount > 20 || content.length > 1200

  // Large: long content with wide code
  if (hasCode && hasLongLine && isLong) return 'large'

  // Wide: code with long lines
  if (hasCode && hasLongLine) return 'wide'

  // Tall: lots of content (lists, paragraphs, multiple code blocks)
  if (isLong) return 'tall'

  return 'compact'
}
