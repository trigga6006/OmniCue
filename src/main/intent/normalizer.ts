/**
 * Intent normalizer — Stage 2 of the intent pipeline.
 * Parses raw utterances into a canonical { verb, targetType, surfaceReferent, destination } shape.
 * Pure function, no I/O, <2ms.
 */

import type { IntentVerb, TargetType, NormalizedIntent } from './types'
import { lookupNavigation } from '../navigation'

// ── Verb synonym table ───────────────────────────────────────────────────────

const VERB_SYNONYMS: Array<{ verb: IntentVerb; phrases: string[] }> = [
  {
    verb: 'open',
    phrases: [
      'open', 'show', 'reveal', 'display', 'pull up', 'bring up',
      'launch', 'start', 'run', 'view', 'browse',
    ],
  },
  {
    verb: 'search',
    phrases: [
      'search', 'search for', 'find', 'look up', 'look for', 'google',
      'look into', 'research',
    ],
  },
  {
    verb: 'copy',
    phrases: ['copy', 'clipboard', 'grab'],
  },
  {
    verb: 'type',
    phrases: ['type', 'enter text', 'input', 'write'],
  },
  {
    verb: 'press',
    phrases: ['press', 'hit', 'tap', 'push'],
  },
  {
    verb: 'click',
    phrases: ['click', 'click on', 'tap on', 'select'],
  },
  {
    verb: 'switch',
    phrases: [
      'switch to', 'switch back to', 'go to', 'go back to',
      'focus', 'focus on', 'alt-tab to', 'jump to',
    ],
  },
  {
    verb: 'save',
    phrases: ['save', 'save a', 'remember', 'note', 'jot down', 'make a note'],
  },
  {
    verb: 'delete',
    phrases: ['delete', 'remove', 'trash', 'erase'],
  },
  {
    verb: 'remind',
    phrases: ['remind', 'remind me', 'set a reminder', 'set reminder', 'alert me', 'notify me'],
  },
  {
    verb: 'list',
    phrases: [
      'list', 'show all', 'show me all', 'what are',
      'what are my', 'what apps', 'which apps',
    ],
  },
]

// Sort phrases longest-first so "switch back to" matches before "switch"
for (const group of VERB_SYNONYMS) {
  group.phrases.sort((a, b) => b.length - a.length)
}

// ── Destination patterns ─────────────────────────────────────────────────────

const DESTINATION_PATTERNS: Array<{ pattern: RegExp; destination: string }> = [
  { pattern: /\b(?:in\s+)?(?:the\s+)?(?:file\s*)?explorer\b/i, destination: 'explorer' },
  { pattern: /\b(?:in\s+)?(?:the\s+)?finder\b/i, destination: 'finder' },
  { pattern: /\b(?:in\s+)?(?:the\s+)?file\s*manager\b/i, destination: 'file-manager' },
  { pattern: /\b(?:in\s+)?(?:the\s+)?files?\b$/i, destination: 'explorer' },
  { pattern: /\b(?:in\s+)?(?:the\s+)?browser\b/i, destination: 'browser' },
  { pattern: /\b(?:in\s+)?(?:the\s+)?terminal\b/i, destination: 'terminal' },
  { pattern: /\b(?:in\s+)?(?:the\s+)?editor\b/i, destination: 'editor' },
  { pattern: /\b(?:in\s+)?(?:the\s+)?(?:vs\s*code|vscode)\b/i, destination: 'vscode' },
]

// ── Context phrases (current-context target type) ────────────────────────────

const CONTEXT_PHRASES: Array<{ pattern: RegExp; hint: string }> = [
  { pattern: /\bthis\s+project\b/i, hint: 'project' },
  { pattern: /\bthis\s+folder\b/i, hint: 'folder' },
  { pattern: /\bthis\s+directory\b/i, hint: 'folder' },
  { pattern: /\bcurrent\s+folder\b/i, hint: 'folder' },
  { pattern: /\bcurrent\s+directory\b/i, hint: 'folder' },
  { pattern: /\bthis\s+file\b/i, hint: 'file' },
  { pattern: /\bcurrent\s+file\b/i, hint: 'file' },
  { pattern: /\bthe\s+file\b/i, hint: 'file' },
  { pattern: /\bthis\s+page\b/i, hint: 'page' },
  { pattern: /\bthis\s+site\b/i, hint: 'page' },
  { pattern: /\bcurrent\s+page\b/i, hint: 'page' },
  { pattern: /\bthe\s+repo\b/i, hint: 'project' },
  { pattern: /\bthe\s+repository\b/i, hint: 'project' },
  { pattern: /\bthe\s+project\b/i, hint: 'project' },
]

// ── Referent pronouns ────────────────────────────────────────────────────────

const REFERENT_PRONOUNS = /\b(it|this|that|these|those)\b/i

// ── Path / URL / keyboard detection ──────────────────────────────────────────

const PATH_PATTERN = /(?:^|\s)((?:[A-Za-z]:\\|\/|~\/)[^\s"']+)/
const URL_PATTERN = /(?:^|\s)(https?:\/\/[^\s"']+)/i
const KEYBOARD_COMBO = /\b((?:ctrl|alt|shift|cmd|meta|super|win)(?:\+(?:ctrl|alt|shift|cmd|meta|super|win|[a-z0-9]))+|(?:enter|escape|esc|tab|space|backspace|delete|home|end|pageup|pagedown|up|down|left|right|f[1-9]|f1[0-2]))\b/i
const FILE_LIKE_QUERY = /(?:^|[\\/])?[^\\/\s]+\.[a-z0-9]{1,12}$/i

// ── App name patterns ────────────────────────────────────────────────────────

const APP_NAMES = /\b(chrome|firefox|edge|safari|vs\s*code|vscode|visual\s+studio(?:\s+code)?|terminal|powershell|cmd|notepad|word|excel|slack|discord|spotify|teams|outlook|notion|obsidian)\b/i

// ── Reminder delay pattern ───────────────────────────────────────────────────

const REMINDER_DELAY = /\bin\s+(\d+)\s*(hours?|hrs?|minutes?|mins?|seconds?|secs?)\b/i

// ── Public API ───────────────────────────────────────────────────────────────

export function normalize(utterance: string): NormalizedIntent {
  const raw = utterance
  const lower = utterance.toLowerCase().trim()

  // 1. Detect verb
  let verb: IntentVerb = 'unknown'
  let verbEnd = 0

  for (const group of VERB_SYNONYMS) {
    for (const phrase of group.phrases) {
      if (lower.startsWith(phrase) && (lower.length === phrase.length || /\s/.test(lower[phrase.length]))) {
        verb = group.verb
        verbEnd = phrase.length
        break
      }
    }
    if (verb !== 'unknown') break
  }

  // Also check "what apps are running" style
  if (verb === 'unknown') {
    if (/^(?:what|which)\s+apps?\s+(?:are\s+)?running/i.test(lower)) {
      verb = 'list'
    }
  }

  const rest = utterance.slice(verbEnd).trim()

  // 2. Detect destination (strip it from consideration)
  let destination: string | undefined
  for (const dp of DESTINATION_PATTERNS) {
    if (dp.pattern.test(rest)) {
      destination = dp.destination
      break
    }
  }

  // 3. Detect explicit path
  const pathMatch = rest.match(PATH_PATTERN)
  if (pathMatch) {
    return {
      verb: verb === 'unknown' ? 'open' : verb,
      targetType: 'explicit-path',
      surfaceReferent: pathMatch[1],
      destination,
      raw,
    }
  }

  // 4. Detect URL
  const urlMatch = rest.match(URL_PATTERN)
  if (urlMatch) {
    return {
      verb: verb === 'unknown' ? 'open' : verb,
      targetType: 'url',
      surfaceReferent: urlMatch[1],
      destination,
      raw,
    }
  }

  // 5. Detect keyboard combo
  const keyMatch = rest.match(KEYBOARD_COMBO)
  if (keyMatch && (verb === 'press' || verb === 'unknown')) {
    return {
      verb: 'press',
      targetType: 'keyboard-combo',
      surfaceReferent: keyMatch[1],
      destination,
      raw,
    }
  }

  // 6. Detect reminder
  if (verb === 'remind' || REMINDER_DELAY.test(lower)) {
    return {
      verb: 'remind',
      targetType: 'reminder',
      surfaceReferent: rest,
      destination,
      raw,
    }
  }

  // 6b. Detect system locations (settings, utilities, special folders)
  if (verb === 'open' || verb === 'switch' || verb === 'unknown') {
    // Strip trailing "settings/options/preferences" for lookup, keep it as referent
    const locationQuery = rest
      .replace(/\b(?:the|my)\s+/gi, '')
      .replace(/\s+(?:settings?|options?|preferences?|page)$/i, '')
      .trim()
    if (locationQuery) {
      const result = lookupNavigation(locationQuery)
      if (result && result.confidence >= 0.85) {
        return {
          verb: 'open',
          targetType: 'system-location',
          surfaceReferent: locationQuery,
          destination,
          raw,
        }
      }
    }
  }

  // 7. Detect current-context phrases
  for (const cp of CONTEXT_PHRASES) {
    if (cp.pattern.test(rest)) {
      const targetType: TargetType =
        cp.hint === 'file' ? 'file'
          : cp.hint === 'folder' || cp.hint === 'project' ? 'folder'
            : cp.hint === 'page' ? 'url'
              : 'current-context'
      return {
        verb: verb === 'unknown' ? 'open' : verb,
        targetType,
        surfaceReferent: cp.pattern.exec(rest)?.[0],
        destination,
        raw,
      }
    }
  }

  // 8. Detect referent pronouns ("it", "this", "that")
  if (REFERENT_PRONOUNS.test(rest)) {
    // Infer target type from destination hint
    let targetType: TargetType = 'referent'
    if (destination === 'explorer' || destination === 'finder' || destination === 'file-manager') {
      targetType = 'folder' // "open it in explorer" -> folder
    } else if (destination === 'browser') {
      targetType = 'url'
    }

    return {
      verb: verb === 'unknown' ? 'open' : verb,
      targetType,
      surfaceReferent: REFERENT_PRONOUNS.exec(rest)?.[1],
      destination,
      raw,
    }
  }

  // 9. Detect app name for switch/open
  if (verb === 'switch' || verb === 'open') {
    const appMatch = rest.match(APP_NAMES)
    if (appMatch) {
      return {
        verb: 'switch',
        targetType: 'app',
        surfaceReferent: appMatch[1],
        destination,
        raw,
      }
    }
  }

  // 10. Verb-based defaults
  if (verb === 'list') {
    const targetType: TargetType = /\bnotes?\b/i.test(rest) ? 'note'
      : /\bapps?\b/i.test(rest) ? 'app'
        : 'unknown'
    return { verb, targetType, surfaceReferent: rest || undefined, destination, raw }
  }

  if (verb === 'search') {
    // "search for X" / "google this error"
    const query = rest
      .replace(/^(?:for|about|regarding)\s+/i, '')
      .trim()
    return {
      verb,
      targetType: /\bfiles?\b/i.test(query) || FILE_LIKE_QUERY.test(query) ? 'file' : 'search-query',
      surfaceReferent: query || undefined,
      destination,
      raw,
    }
  }

  if (verb === 'save') {
    return { verb, targetType: 'note', surfaceReferent: rest || undefined, destination, raw }
  }

  if (verb === 'delete') {
    return { verb, targetType: 'file', surfaceReferent: rest || undefined, destination, raw }
  }

  if (verb === 'type') {
    return { verb, targetType: 'ui-element', surfaceReferent: rest || undefined, destination, raw }
  }

  if (verb === 'click') {
    return { verb, targetType: 'ui-element', surfaceReferent: rest || undefined, destination, raw }
  }

  if (verb === 'copy') {
    return { verb, targetType: 'unknown', surfaceReferent: rest || undefined, destination, raw }
  }

  // 11. Fallback: if there's a destination hint, assume open + folder
  if (destination && verb === 'unknown') {
    return { verb: 'open', targetType: 'folder', surfaceReferent: rest || undefined, destination, raw }
  }

  return { verb, targetType: 'unknown', surfaceReferent: rest || undefined, destination, raw }
}
