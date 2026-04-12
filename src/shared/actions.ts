/** Shared App Actions types — imported by main process and renderer. */

export type ActionTier = 'safe' | 'guided' | 'dangerous'

export interface ActionParam {
  name: string
  type: 'string' | 'number' | 'boolean'
  required: boolean
  description: string
}

export interface ActionDefinition {
  id: string
  name: string
  tier: ActionTier
  description: string
  params: ActionParam[]
  category: string
}

export interface ActionRequest {
  actionId: string
  params: Record<string, unknown>
  requestId?: string
}

export interface ActionResult {
  ok: boolean
  actionId: string
  requestId?: string
  tier: ActionTier
  error?: string
  detail?: string
  durationMs: number
}
