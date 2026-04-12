/**
 * Intent resolver — 4-stage pipeline.
 *
 * Stage 1: Pattern fast-path (regex, <5ms)
 * Stage 2: Normalize (canonical shape, <2ms)
 * Stage 3: Ground referents (snapshot + capsule, <10ms)
 * Stage 4: Plan (rule table, then optional LLM fallback)
 */

import type { DesktopSnapshot } from '../context/types'
import type { ResumeCapsule } from '../session-memory/types'
import { matchPatterns } from './patterns'
import { normalize } from './normalizer'
import { groundReferent } from './grounder'
import { planAction } from './planner'
import type { ActionPlan } from './types'

/**
 * Legacy export — still used by patterns.ts internally.
 * Matches a single pattern (first-match semantics).
 */
export function matchPattern(utterance: string, snapshot: DesktopSnapshot): ActionPlan | null {
  return matchPatterns(utterance, snapshot)
}

/**
 * Main entry point. Runs the 4-stage pipeline.
 */
export async function resolveIntent(
  utterance: string,
  snapshot: DesktopSnapshot,
  capsule?: ResumeCapsule
): Promise<ActionPlan> {
  // Stage 1: Fast pattern match
  const patternResult = matchPatterns(utterance, snapshot)
  if (patternResult && (patternResult.confidence ?? 0) >= 0.8) {
    return patternResult
  }

  // Stage 2: Normalize the utterance
  const intent = normalize(utterance)

  // Stage 3: Ground referents
  const referents = groundReferent(intent, snapshot, capsule)

  // Stage 4: Plan (rule-based, then LLM fallback)
  const plan = await planAction(intent, referents, snapshot, capsule)

  // If pattern had a weaker match and planner also failed, prefer the pattern
  if (plan.fallback === 'ask' && patternResult) {
    return patternResult
  }

  return plan
}
