import type { ActionTier } from '../../shared/actions'
import type { DesktopSnapshot } from '../context/types'

// ── Action Plan (unchanged) ──────────────────────────────────────────────────

export interface ActionStep {
  actionId: string
  params: Record<string, unknown>
}

export interface ActionPlan {
  actions: ActionStep[]
  explanation?: string
  confidence?: number
  needsConfirmation?: boolean
  fallback?: 'ask'
  question?: string
}

export interface IntentPattern {
  id: string
  priority?: number // lower = more specific / preferred. Default 50.
  patterns: RegExp[]
  resolve: (match: RegExpMatchArray, snapshot: DesktopSnapshot) => ActionPlan | null
}

export interface ExecutionPolicy {
  autoExecutableTiers: ActionTier[]
}

// ── Normalized Intent ────────────────────────────────────────────────────────

export type IntentVerb =
  | 'open'
  | 'search'
  | 'copy'
  | 'type'
  | 'press'
  | 'click'
  | 'switch'
  | 'save'
  | 'delete'
  | 'remind'
  | 'list'
  | 'unknown'

export type TargetType =
  | 'file'
  | 'folder'
  | 'url'
  | 'app'
  | 'search-query'
  | 'note'
  | 'keyboard-combo'
  | 'ui-element'
  | 'reminder'
  | 'explicit-path'
  | 'referent'
  | 'current-context'
  | 'unknown'

export interface NormalizedIntent {
  verb: IntentVerb
  targetType: TargetType
  surfaceReferent?: string
  destination?: string
  raw: string
}

// ── Grounded Referent ────────────────────────────────────────────────────────

export type ReferentSource =
  | 'explicit-path'
  | 'terminal-cwd'
  | 'editor-workspace'
  | 'editor-open-file'
  | 'browser-url'
  | 'browser-page-title'
  | 'file-explorer-path'
  | 'clipboard'
  | 'resume-capsule'
  | 'window-title'

export interface GroundedReferent {
  value: string
  source: ReferentSource
  confidence: number
  type: 'path' | 'url' | 'app' | 'query' | 'text'
}
