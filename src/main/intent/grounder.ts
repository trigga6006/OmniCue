/**
 * Referent grounder — Stage 3 of the intent pipeline.
 * Resolves "it", "this project", "current file", etc. to concrete values
 * using the desktop snapshot and optionally the resume capsule.
 * Sync, <10ms.
 */

import { existsSync, statSync } from 'fs'
import { dirname, isAbsolute } from 'path'
import type { DesktopSnapshot } from '../context/types'
import type { ResumeCapsule } from '../session-memory/types'
import type { NormalizedIntent, GroundedReferent } from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

function looksLikePath(s: string): boolean {
  if (s.includes('\n') || s.includes('\r')) return false
  return /^[A-Za-z]:\\/.test(s) || /^\//.test(s) || /^~\//.test(s)
}

function pathKind(p: string): 'file' | 'directory' | 'unknown' {
  try {
    const stat = statSync(p)
    if (stat.isFile()) return 'file'
    if (stat.isDirectory()) return 'directory'
  } catch {
    // best-effort only
  }
  return 'unknown'
}

function capsuleStaleness(capsule: ResumeCapsule): number {
  const age = Date.now() - capsule.updatedAt
  if (age < 5 * 60_000) return 1.0         // <5min
  if (age < 30 * 60_000) return 0.8        // 5-30min
  if (age < 2 * 60 * 60_000) return 0.5    // 30min-2h
  return 0.2                                // >2h
}

function isActiveOrRecent(
  processName: string,
  snapshot: DesktopSnapshot
): boolean {
  const active = snapshot.processName?.toLowerCase() || ''
  if (active.includes(processName.toLowerCase())) return true
  // Check focus history
  return snapshot.system?.focusHistory?.some(
    (h) => h.toLowerCase().includes(processName.toLowerCase())
  ) ?? false
}

// ── Public API ───────────────────────────────────────────────────────────────

export function groundReferent(
  intent: NormalizedIntent,
  snapshot: DesktopSnapshot,
  capsule?: ResumeCapsule
): GroundedReferent[] {
  const candidates: GroundedReferent[] = []
  const wantFile = intent.targetType === 'file'
  const wantFolder =
    intent.targetType === 'folder' ||
    intent.targetType === 'referent' ||
    intent.targetType === 'current-context'

  // Explicit path — just validate
  if (intent.targetType === 'explicit-path' && intent.surfaceReferent) {
    const p = intent.surfaceReferent
    let confidence = 0.7
    if (isAbsolute(p)) {
      try {
        confidence = existsSync(p) ? 1.0 : 0.7
      } catch {
        confidence = 0.7
      }
    }
    candidates.push({
      value: p,
      source: 'explicit-path',
      confidence,
      type: 'path',
    })
    return candidates
  }

  // URL from intent
  if (intent.targetType === 'url' && intent.surfaceReferent?.startsWith('http')) {
    candidates.push({
      value: intent.surfaceReferent,
      source: 'browser-url',
      confidence: 1.0,
      type: 'url',
    })
    return candidates
  }

  if (wantFile) {
    if (snapshot.editor?.openFile) {
      candidates.push({
        value: snapshot.editor.openFile,
        source: 'editor-open-file',
        confidence: 0.9,
        type: 'path',
      })
    }

    if (snapshot.clipboard && looksLikePath(snapshot.clipboard.trim())) {
      const clipPath = snapshot.clipboard.trim()
      const kind = pathKind(clipPath)
      if (kind === 'file') {
        candidates.push({
          value: clipPath,
          source: 'clipboard',
          confidence: 0.8,
          type: 'path',
        })
      }
    }

    if (capsule?.context?.editor?.openFile) {
      const staleness = capsuleStaleness(capsule)
      const liveDisagrees =
        snapshot.editor?.openFile &&
        snapshot.editor.openFile !== capsule.context.editor.openFile
      candidates.push({
        value: capsule.context.editor.openFile,
        source: 'resume-capsule',
        confidence: 0.7 * staleness * (liveDisagrees ? 0.3 : 1),
        type: 'path',
      })
    }

    if (snapshot.windowTitle) {
      const titlePath = extractPathFromTitle(snapshot.windowTitle)
      if (titlePath && pathKind(titlePath) === 'file') {
        candidates.push({
          value: titlePath,
          source: 'window-title',
          confidence: 0.4,
          type: 'path',
        })
      }
    }
  }

  if (wantFolder) {
    // Terminal CWD
    if (snapshot.terminal?.cwd) {
      const isTermActive = isActiveOrRecent('terminal', snapshot) ||
        isActiveOrRecent('powershell', snapshot) ||
        isActiveOrRecent('cmd', snapshot) ||
        isActiveOrRecent('bash', snapshot) ||
        isActiveOrRecent('wt', snapshot) // Windows Terminal
      candidates.push({
        value: snapshot.terminal.cwd,
        source: 'terminal-cwd',
        confidence: isTermActive ? 0.9 : 0.7,
        type: 'path',
      })
    }

    // Editor workspace
    if (snapshot.editor?.workspacePath) {
      const isEditorActive = isActiveOrRecent('code', snapshot) ||
        isActiveOrRecent('cursor', snapshot) ||
        isActiveOrRecent('idea', snapshot) ||
        isActiveOrRecent('webstorm', snapshot)
      candidates.push({
        value: snapshot.editor.workspacePath,
        source: 'editor-workspace',
        confidence: isEditorActive ? 0.85 : 0.65,
        type: 'path',
      })
    }

    // Editor open file can still hint at a containing project folder.
    if (snapshot.editor?.openFile) {
      candidates.push({
        value: dirname(snapshot.editor.openFile),
        source: 'editor-open-file',
        confidence: 0.7,
        type: 'path',
      })
    }

    // File explorer path
    if (snapshot.fileExplorer?.currentPath) {
      const isExplorerActive = isActiveOrRecent('explorer', snapshot)
      candidates.push({
        value: snapshot.fileExplorer.currentPath,
        source: 'file-explorer-path',
        confidence: isExplorerActive ? 0.85 : 0.6,
        type: 'path',
      })
    }

    // Clipboard as path — only if it looks like one
    if (snapshot.clipboard && looksLikePath(snapshot.clipboard.trim())) {
      const clipPath = snapshot.clipboard.trim()
      const kind = pathKind(clipPath)
      let confidence = 0.4
      try {
        if (isAbsolute(clipPath) && existsSync(clipPath) && kind !== 'file') {
          confidence = 0.8
        }
      } catch {
        // keep low confidence
      }
      if (kind !== 'file') {
        candidates.push({
          value: clipPath,
          source: 'clipboard',
          confidence,
          type: 'path',
        })
      }
    }

    // Resume capsule
    if (capsule) {
      const staleness = capsuleStaleness(capsule)
      // Check if live snapshot disagrees
      const liveDisagrees =
        snapshot.activeApp !== capsule.desktop.activeApp ||
        (snapshot.terminal?.cwd && capsule.context?.terminal?.cwd &&
          snapshot.terminal.cwd !== capsule.context.terminal.cwd)
      const disagreePenalty = liveDisagrees ? 0.3 : 1.0

      const capsulePath =
        capsule.context?.editor?.workspacePath ||
        capsule.context?.terminal?.cwd ||
        capsule.context?.fileExplorer?.currentPath

      if (capsulePath) {
        candidates.push({
          value: capsulePath,
          source: 'resume-capsule',
          confidence: 0.5 * staleness * disagreePenalty,
          type: 'path',
        })
      }
    }

    // Window title path extraction
    if (snapshot.windowTitle) {
      const titlePath = extractPathFromTitle(snapshot.windowTitle)
      if (titlePath && pathKind(titlePath) !== 'file') {
        candidates.push({
          value: titlePath,
          source: 'window-title',
          confidence: 0.3,
          type: 'path',
        })
      }
    }
  }

  // For URL-targeted intents, include browser context
  if (intent.targetType === 'url' || intent.targetType === 'referent') {
    if (snapshot.browser?.site) {
      candidates.push({
        value: `https://${snapshot.browser.site}`,
        source: 'browser-url',
        confidence: isActiveOrRecent('chrome', snapshot) ||
          isActiveOrRecent('firefox', snapshot) ||
          isActiveOrRecent('edge', snapshot) ? 0.8 : 0.5,
        type: 'url',
      })
    }
    if (snapshot.browser?.pageTitle) {
      candidates.push({
        value: snapshot.browser.pageTitle,
        source: 'browser-page-title',
        confidence: 0.4,
        type: 'text',
      })
    }
  }

  // For search-query targets, prefer clipboard text
  if (intent.targetType === 'search-query') {
    if (intent.surfaceReferent && !REFERENT_RE.test(intent.surfaceReferent)) {
      // User provided explicit query text
      candidates.push({
        value: intent.surfaceReferent,
        source: 'explicit-path', // reuse source, it's the user's own words
        confidence: 1.0,
        type: 'query',
      })
    } else if (snapshot.clipboard?.trim()) {
      candidates.push({
        value: snapshot.clipboard.trim().slice(0, 500),
        source: 'clipboard',
        confidence: 0.6,
        type: 'query',
      })
    }
  }

  // For app switching, extract the app name from surface referent
  if (intent.targetType === 'app' && intent.surfaceReferent) {
    candidates.push({
      value: intent.surfaceReferent,
      source: 'explicit-path',
      confidence: 0.9,
      type: 'app',
    })
  }

  // Sort by confidence descending
  candidates.sort((a, b) => b.confidence - a.confidence)
  return candidates
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const REFERENT_RE = /^(?:it|this|that|these|those)$/i

function extractPathFromTitle(title: string): string | null {
  // Try to find an absolute path in the window title
  const winMatch = title.match(/([A-Za-z]:\\[^\s\-–—|]+)/)
  if (winMatch) return winMatch[1].trim()

  const unixMatch = title.match(/(\/(?:home|Users|tmp|var|opt|usr|etc)\/[^\s\-–—|]+)/)
  if (unixMatch) return unixMatch[1].trim()

  return null
}
