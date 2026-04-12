/**
 * Action planner — Stage 4 of the intent pipeline.
 * Maps normalized + grounded intent to an ActionPlan.
 * Rule-based first (<1ms), LLM fallback second (async).
 */

import type { DesktopSnapshot } from '../context/types'
import type { ResumeCapsule } from '../session-memory/types'
import type { ActionPlan, NormalizedIntent, GroundedReferent } from './types'
import { getActionDefinition } from '../actions'
import { resolveLLM } from './llm-resolver'
import { lookupNavigation } from '../navigation'

// ── Rule table ───────────────────────────────────────────────────────────────

// Maps (verb:targetType) to actionId. Wildcard '*' matches any targetType for that verb.
const VERB_TARGET_MAP: Record<string, string> = {
  'open:folder': 'reveal-in-folder',
  'open:file': 'open-file',
  'open:url': 'open-url',
  'open:app': 'switch-app',
  'open:explicit-path': 'reveal-in-folder',
  'open:referent': 'reveal-in-folder',        // default for "open it" — override if referent is URL
  'open:current-context': 'reveal-in-folder',
  'open:system-location': 'open-system-location',
  'search:search-query': 'search-web',
  'search:file': 'find-file',
  'search:unknown': 'search-web',
  'copy:unknown': 'clipboard-write',
  'type:ui-element': 'type-text',
  'type:unknown': 'type-text',
  'press:keyboard-combo': 'press-key',
  'click:ui-element': 'click-element',
  'switch:app': 'switch-app',
  'save:note': 'save-note',
  'delete:file': 'delete-file',
  'remind:reminder': 'set-reminder',
  'list:note': 'list-notes',
  'list:app': 'list-running-apps',
}

// Minimum confidence to use the rule planner without LLM
const CONFIDENCE_THRESHOLD = 0.6

// ── Rule-based param builder ─────────────────────────────────────────────────

function buildParams(
  actionId: string,
  intent: NormalizedIntent,
  referent: GroundedReferent | undefined
): Record<string, unknown> | null {
  switch (actionId) {
    case 'reveal-in-folder': {
      const path = referent?.value
      if (!path) return null
      return { path }
    }
    case 'open-file': {
      const path = referent?.value
      if (!path) return null
      return { path }
    }
    case 'open-url': {
      const url = referent?.value
      if (!url) return null
      return { url }
    }
    case 'switch-app': {
      const processName = referent?.value || intent.surfaceReferent
      if (!processName) return null
      return { processName }
    }
    case 'search-web': {
      const query = referent?.value || intent.surfaceReferent
      if (!query) return null
      return { query: String(query).slice(0, 200) }
    }
    case 'find-file': {
      const pattern = intent.surfaceReferent
      if (!pattern) return null
      return {
        pattern,
        ...(referent?.type === 'path' ? { startDir: referent.value } : {}),
      }
    }
    case 'clipboard-write': {
      const text = intent.surfaceReferent
      if (!text) return null
      return { text }
    }
    case 'type-text': {
      const text = intent.surfaceReferent
      if (!text) return null
      return { text }
    }
    case 'press-key': {
      const keys = referent?.value || intent.surfaceReferent
      if (!keys) return null
      return { keys }
    }
    case 'click-element': {
      const name = intent.surfaceReferent
      if (!name) return null
      return { name }
    }
    case 'save-note': {
      const text = intent.surfaceReferent
      if (!text) return null
      return { text }
    }
    case 'delete-file': {
      const path = referent?.value
      if (!path) return null
      return { path }
    }
    case 'open-system-location': {
      const query = intent.surfaceReferent
      if (!query) return null
      const result = lookupNavigation(query)
      if (!result || result.confidence < 0.85) return null
      return { locationId: result.entry.id }
    }
    case 'set-reminder': {
      // Reminder parsing is complex — pattern stage handles it better
      return null
    }
    case 'list-notes':
    case 'list-running-apps':
      return {}
    default:
      return null
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function planAction(
  intent: NormalizedIntent,
  referents: GroundedReferent[],
  snapshot: DesktopSnapshot,
  capsule?: ResumeCapsule
): Promise<ActionPlan> {
  const topReferent = referents.length > 0 ? referents[0] : undefined

  // Resolve the action ID from the rule table
  let actionId = VERB_TARGET_MAP[`${intent.verb}:${intent.targetType}`]

  // Try wildcard if no exact match
  if (!actionId) {
    actionId = VERB_TARGET_MAP[`${intent.verb}:unknown`]
  }

  // Special case: if "open referent" and the top referent is a URL, switch to open-url
  if (actionId === 'reveal-in-folder' && topReferent?.type === 'url') {
    actionId = 'open-url'
  }

  // Special case: if "open explicit-path" and the path has a file extension, use open-file
  if (actionId === 'reveal-in-folder' && intent.targetType === 'explicit-path' && intent.surfaceReferent) {
    const ext = intent.surfaceReferent.match(/\.([a-z0-9]{1,8})$/i)
    if (ext && !['', 'exe', 'bat', 'cmd', 'sh'].includes(ext[1].toLowerCase())) {
      // Has a non-executable file extension — open it with default app
      actionId = 'open-file'
    }
  }

  // Check if we have a rule match with sufficient confidence
  if (actionId && topReferent && topReferent.confidence >= CONFIDENCE_THRESHOLD) {
    const definition = getActionDefinition(actionId)
    if (definition) {
      const params = buildParams(actionId, intent, topReferent)
      if (params !== null) {
        // Validate required params
        const missingRequired = definition.params.filter(
          (p) => p.required && (params[p.name] === undefined || params[p.name] === '')
        )

        if (missingRequired.length === 0) {
          return {
            actions: [{ actionId, params }],
            explanation: `${definition.name}: ${topReferent.value}`,
            confidence: topReferent.confidence,
            needsConfirmation: definition.tier === 'dangerous' || definition.tier === 'guided',
          }
        }
      }
    }
  }

  // Rule match but no referent — paramless actions can still proceed
  if (actionId) {
    const definition = getActionDefinition(actionId)
    if (definition && definition.params.every((p) => !p.required)) {
      return {
        actions: [{ actionId, params: {} }],
        explanation: definition.name,
        confidence: 0.9,
        needsConfirmation: definition.tier === 'dangerous' || definition.tier === 'guided',
      }
    }
  }

  // Fall through to LLM resolver
  return resolveLLM(intent, referents, snapshot, capsule)
}
