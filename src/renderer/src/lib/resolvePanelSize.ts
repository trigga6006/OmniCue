import type { PanelSizeMode } from './constants'

const PANEL_SIZE_PRIORITY: Record<PanelSizeMode, number> = {
  compact: 0,
  tall: 1,
  wide: 2,
  large: 3,
  fullscreen: 4,
}

export function preferLargerPanelSize(
  current: PanelSizeMode,
  proposed: PanelSizeMode,
): PanelSizeMode {
  return PANEL_SIZE_PRIORITY[proposed] > PANEL_SIZE_PRIORITY[current] ? proposed : current
}

/**
 * Determine panel size from assistant response content.
 * Pure heuristic - no network calls, no model involvement.
 */
export function resolvePanelSize(content: string): PanelSizeMode {
  const lines = content.split('\n')
  const lineCount = lines.length
  const longestLine = Math.max(...lines.map((line) => line.length))
  const codeFenceCount = (content.match(/^```/gm) || []).length / 2
  const inlineCodeSpans = Array.from(content.matchAll(/`([^`\n]+)`/g), (match) => match[1].length)
  const longestInlineCode = inlineCodeSpans.length > 0 ? Math.max(...inlineCodeSpans) : 0
  const tokens = content.match(/\S+/g) || []
  const longestToken = tokens.reduce((max, token) => Math.max(max, token.length), 0)

  const hasCodeFence = codeFenceCount >= 1
  const hasLongLine = longestLine > 70
  const hasLongInlineCode = longestInlineCode > 36
  const hasLongToken = longestToken > 48
  const hasPathLikeToken = /(?:[A-Za-z]:\\|\\\\|\/)[^\s]{30,}/.test(content)
  const hasUrlLikeToken = /https?:\/\/\S{30,}/.test(content)
  const needsWidth =
    hasLongLine || hasLongInlineCode || hasLongToken || hasPathLikeToken || hasUrlLikeToken
  const isLong = lineCount > 20 || content.length > 1200

  if (
    (hasCodeFence || hasLongInlineCode || hasLongToken || hasPathLikeToken || hasUrlLikeToken) &&
    needsWidth &&
    isLong
  ) {
    return 'large'
  }

  if (needsWidth) return 'wide'
  if (isLong) return 'tall'

  return 'compact'
}
