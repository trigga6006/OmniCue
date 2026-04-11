import type { ActionResult, ActionTier } from '../../shared/actions'

export type ActionHandler = (params: Record<string, unknown>) => Promise<ActionResult>

export function ok(actionId: string, tier: ActionTier, detail: string): ActionResult {
  return { ok: true, actionId, tier, detail, durationMs: 0 }
}

export function fail(actionId: string, tier: ActionTier, error: string): ActionResult {
  return { ok: false, actionId, tier, error, durationMs: 0 }
}
