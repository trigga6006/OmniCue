/**
 * Diff-aware resume context graft.
 * Compares saved capsule state against live desktop snapshot
 * and produces a deterministic <resume-context> block for injection.
 */

import type { ResumeCapsule } from './types'
import type { DesktopSnapshot } from '../context/types'

export interface ResumeGraft {
  /** Formatted <resume-context> XML block for injection */
  text: string
  /** Whether desktop state changed since save */
  hasChanges: boolean
  /** Specific fields that changed */
  staleFields: string[]
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${Math.round(ms / 1000)}s`
  if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`
  const hours = Math.round(ms / 3_600_000)
  return `${hours}h`
}

function truncate(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) + '...' : s
}

/**
 * Generate a diff-aware resume graft from a saved capsule and live snapshot.
 */
export function generateResumeGraft(
  capsule: ResumeCapsule,
  live: DesktopSnapshot
): ResumeGraft {
  const diffs: string[] = []

  // Compare active app
  if (capsule.desktop.activeApp && live.activeApp) {
    if (capsule.desktop.activeApp !== live.activeApp) {
      diffs.push(
        `Active app changed from "${capsule.desktop.activeApp}" to "${live.activeApp}"`
      )
    }
  }

  // Compare pack type
  if (capsule.desktop.packId && live.pack?.id && capsule.desktop.packId !== live.pack.id) {
    diffs.push(`App type changed from ${capsule.desktop.packId} to ${live.pack.id}`)
  }

  // Compare workspace / CWD
  const savedCwd =
    capsule.context?.editor?.workspacePath || capsule.context?.terminal?.cwd
  const liveCwd = live.editor?.workspacePath || live.terminal?.cwd
  if (savedCwd && liveCwd && savedCwd !== liveCwd) {
    diffs.push(`Working directory changed: ${savedCwd} → ${liveCwd}`)
  } else if (savedCwd && !liveCwd) {
    diffs.push(`Previously in ${savedCwd}, no workspace detected now`)
  }

  // Compare open file
  const savedFile = capsule.context?.editor?.openFile
  const liveFile = live.editor?.openFile
  if (savedFile && liveFile && savedFile !== liveFile) {
    diffs.push(`Open file changed: ${savedFile} → ${liveFile}`)
  } else if (savedFile && !liveFile) {
    diffs.push(`File ${savedFile} is no longer open`)
  }

  // Compare browser page
  const savedPage = capsule.context?.browser?.pageTitle
  const livePage = live.browser?.pageTitle
  if (savedPage && livePage && savedPage !== livePage) {
    diffs.push(
      `Browser page changed: "${truncate(savedPage, 50)}" → "${truncate(livePage, 50)}"`
    )
  } else if (savedPage && !livePage) {
    diffs.push(`Browser page "${truncate(savedPage, 50)}" is no longer visible`)
  }

  // Compare browser site
  const savedSite = capsule.context?.browser?.site
  const liveSite = live.browser?.site
  if (savedSite && liveSite && savedSite !== liveSite) {
    diffs.push(`Browser site changed: ${savedSite} → ${liveSite}`)
  }

  // Elapsed time
  const elapsed = Date.now() - capsule.updatedAt
  const elapsedStr = formatElapsed(elapsed)

  // Build the XML block
  const lines: string[] = ['<resume-context>']

  // Saved state section
  lines.push(`  <saved-state when="${new Date(capsule.updatedAt).toISOString()}" elapsed="${elapsedStr} ago">`)
  if (capsule.goal) {
    lines.push(`    <goal>${escapeXml(capsule.goal)}</goal>`)
  }
  lines.push(`    <summary>${escapeXml(capsule.summary)}</summary>`)
  if (capsule.lastUserMessage) {
    lines.push(
      `    <last-user-message>${escapeXml(truncate(capsule.lastUserMessage, 200))}</last-user-message>`
    )
  }
  if (capsule.lastAssistantMessage) {
    lines.push(
      `    <last-assistant-message>${escapeXml(truncate(capsule.lastAssistantMessage, 200))}</last-assistant-message>`
    )
  }
  if (capsule.lastAssistantAction) {
    lines.push(
      `    <last-assistant-action>${escapeXml(capsule.lastAssistantAction)}</last-assistant-action>`
    )
  }
  if (capsule.pending?.waitingOn) {
    lines.push(`    <pending>${escapeXml(capsule.pending.waitingOn)}</pending>`)
  }
  if (capsule.pending?.lastToolUse) {
    lines.push(
      `    <last-tool-use>${escapeXml(capsule.pending.lastToolUse.name)}</last-tool-use>`
    )
  }
  lines.push('  </saved-state>')

  // Current live state section
  const liveApp = live.activeApp || 'unknown'
  const liveProcess = live.processName || ''
  let liveSummary = `Using ${liveApp}`
  if (live.pack?.id === 'browser' && live.browser?.pageTitle) {
    liveSummary = `Reading "${truncate(live.browser.pageTitle, 60)}" on ${live.browser.site || liveApp}`
  } else if (live.pack?.id === 'ide' && live.editor) {
    const file = live.editor.openFile || live.editor.projectName || ''
    liveSummary = file ? `Editing ${file} in ${liveApp}` : `Working in ${liveApp}`
  } else if (live.pack?.id === 'terminal' && live.terminal?.cwd) {
    liveSummary = `Terminal at ${live.terminal.cwd}`
  }

  lines.push(
    `  <current-state app="${escapeXml(liveApp)}" process="${escapeXml(liveProcess)}">`
  )
  lines.push(`    ${escapeXml(liveSummary)}`)
  lines.push('  </current-state>')

  // Changes section
  if (diffs.length > 0) {
    lines.push('  <changes>')
    for (const diff of diffs) {
      lines.push(`    <change>${escapeXml(diff)}</change>`)
    }
    lines.push('  </changes>')
  }

  // Instructions
  lines.push('  <instructions>')
  if (diffs.length > 0) {
    lines.push(
      '    This conversation is being resumed. The user\'s desktop state has changed since the last session.'
    )
    lines.push(
      '    Acknowledge the context briefly, note what changed, and ask if they want to continue where they left off or start from their current context.'
    )
  } else {
    lines.push(
      '    This conversation is being resumed. The user\'s desktop state appears unchanged.'
    )
    lines.push('    Continue seamlessly from where you left off.')
  }
  if (elapsed > 7 * 24 * 60 * 60 * 1000) {
    lines.push(
      `    Note: This session is from ${elapsedStr} ago. Context may be significantly different.`
    )
  }
  lines.push('  </instructions>')

  lines.push('</resume-context>')

  return {
    text: lines.join('\n'),
    hasChanges: diffs.length > 0,
    staleFields: diffs,
  }
}
