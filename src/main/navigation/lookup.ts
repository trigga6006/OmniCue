/**
 * Navigation lookup — resolves natural-language queries against the catalog.
 *
 * Three-tier matching:
 * 1. Exact alias match → confidence 1.0
 * 2. Prefix match → confidence 0.9
 * 3. Token overlap → confidence 0.7–0.89, scaled by Jaccard similarity
 *
 * Confidence thresholds for callers:
 * - >= 0.85: safe to auto-plan for open-system-location
 * - 0.70–0.84: prefer ask/LLM clarification
 * - < 0.70: no match
 */

import { NAV_CATALOG, type NavEntry } from './catalog'

export interface LookupResult {
  entry: NavEntry
  confidence: number
  matchedAlias: string
  matchType: 'exact' | 'prefix' | 'token'
}

// ── Index ───────────────────────────────────────────────────────────────────

// Inverted index: lowercased alias → NavEntry
const aliasIndex = new Map<string, NavEntry>()
for (const entry of NAV_CATALOG) {
  for (const alias of entry.aliases) {
    aliasIndex.set(alias.toLowerCase(), entry)
  }
}

// ── Tokenizer ───────────────────────────────────────────────────────────────

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'to', 'me', 'my', 'for', 'of', 'in', 'on', 'at',
  'and', 'or', 'is', 'are', 'was', 'this', 'that', 'it', 'i', 'up',
  'go', 'take', 'show', 'open', 'where', 'please', 'can', 'you',
])

function tokenize(text: string): Set<string> {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP_WORDS.has(t))
  return new Set(tokens)
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 0
  let intersection = 0
  for (const token of a) {
    if (b.has(token)) intersection++
  }
  const union = a.size + b.size - intersection
  return union === 0 ? 0 : intersection / union
}

// ── Public API ──────────────────────────────────────────────────────────────

export function lookupNavigation(query: string): LookupResult | null {
  const normalized = query.toLowerCase().trim()
    // Strip trailing "settings", "options", "preferences" for broader matching
    .replace(/\s+(settings?|options?|preferences?|config(?:uration)?)$/, '')
    .trim()

  if (!normalized) return null

  // 1. Exact alias match
  const exact = aliasIndex.get(normalized)
  if (exact) {
    return { entry: exact, confidence: 1.0, matchedAlias: normalized, matchType: 'exact' }
  }

  // Also try with "settings" appended (user said "bluetooth", catalog has "bluetooth settings")
  const withSettings = aliasIndex.get(normalized + ' settings')
  if (withSettings) {
    return { entry: withSettings, confidence: 1.0, matchedAlias: normalized + ' settings', matchType: 'exact' }
  }

  // 2. Prefix match — query is a prefix of an alias
  let bestPrefix: LookupResult | null = null
  for (const entry of NAV_CATALOG) {
    for (const alias of entry.aliases) {
      const lower = alias.toLowerCase()
      if (lower.startsWith(normalized) && lower !== normalized) {
        if (!bestPrefix || alias.length < bestPrefix.matchedAlias.length) {
          bestPrefix = { entry, confidence: 0.9, matchedAlias: alias, matchType: 'prefix' }
        }
      }
    }
  }
  if (bestPrefix) return bestPrefix

  // 3. Token overlap — Jaccard similarity between query tokens and alias + description tokens
  const queryTokens = tokenize(normalized)
  if (queryTokens.size === 0) return null

  let bestToken: LookupResult | null = null
  let bestScore = 0

  for (const entry of NAV_CATALOG) {
    // Build token set from all aliases + description
    const entryTokens = new Set<string>()
    for (const alias of entry.aliases) {
      for (const t of tokenize(alias)) entryTokens.add(t)
    }
    for (const t of tokenize(entry.description)) entryTokens.add(t)

    const score = jaccard(queryTokens, entryTokens)
    if (score > bestScore) {
      bestScore = score
      // Find the closest matching alias for display
      let closestAlias = entry.aliases[0]
      let closestScore = 0
      for (const alias of entry.aliases) {
        const aliasScore = jaccard(queryTokens, tokenize(alias))
        if (aliasScore > closestScore) {
          closestScore = aliasScore
          closestAlias = alias
        }
      }
      bestToken = { entry, confidence: 0, matchedAlias: closestAlias, matchType: 'token' }
    }
  }

  if (bestToken && bestScore > 0.25) {
    // Scale Jaccard (0.25–1.0) into confidence (0.7–0.89)
    bestToken.confidence = 0.7 + Math.min(bestScore, 1) * 0.19
    return bestToken
  }

  return null
}
