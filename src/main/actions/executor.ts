/**
 * Action dispatcher — validates, enforces tier gating, and dispatches to handlers.
 */

import { randomUUID } from 'crypto'
import type { BrowserWindow } from 'electron'
import type { ActionRequest, ActionResult, ActionDefinition } from '../../shared/actions'
import { ACTION_REGISTRY } from './registry'
import { safeHandlers } from './safe'
import { guidedHandlers } from './guided'
import { dangerousHandlers } from './dangerous'
import { registerPendingRequest } from '../agent-interactions'
import type { AgentInteractionRequest } from '../agent-interactions'

const allHandlers: Record<string, (params: Record<string, unknown>) => Promise<ActionResult>> = {
  ...safeHandlers,
  ...guidedHandlers,
  ...dangerousHandlers,
}

/** Look up an action definition by ID. */
export function getActionDefinition(actionId: string): ActionDefinition | undefined {
  return ACTION_REGISTRY.find((a) => a.id === actionId)
}

/** Execute an action, enforcing tier-based confirmation for dangerous actions. */
export async function executeAction(
  request: ActionRequest,
  mainWin: BrowserWindow | null
): Promise<ActionResult> {
  const definition = getActionDefinition(request.actionId)
  if (!definition) {
    return {
      ok: false,
      actionId: request.actionId,
      requestId: request.requestId,
      tier: 'safe',
      error: `Unknown action: ${request.actionId}`,
      durationMs: 0,
    }
  }

  // Validate required params
  for (const param of definition.params) {
    if (param.required && (request.params[param.name] == null || request.params[param.name] === '')) {
      return {
        ok: false,
        actionId: request.actionId,
        requestId: request.requestId,
        tier: definition.tier,
        error: `Missing required parameter: ${param.name}`,
        durationMs: 0,
      }
    }
  }

  // Dangerous tier — require user confirmation via interaction UI
  if (definition.tier === 'dangerous') {
    const confirmed = await requestConfirmation(definition, request, mainWin)
    if (!confirmed) {
      return {
        ok: false,
        actionId: request.actionId,
        requestId: request.requestId,
        tier: 'dangerous',
        error: 'User declined',
        durationMs: 0,
      }
    }
  }

  // Guided tier — send brief UI indicator (non-blocking)
  if (definition.tier === 'guided' && mainWin && !mainWin.isDestroyed()) {
    mainWin.webContents.send('action:executing', {
      actionId: request.actionId,
      name: definition.name,
    })
  }

  const handler = allHandlers[request.actionId]
  if (!handler) {
    return {
      ok: false,
      actionId: request.actionId,
      requestId: request.requestId,
      tier: definition.tier,
      error: `No handler for action: ${request.actionId}`,
      durationMs: 0,
    }
  }

  const start = Date.now()
  const result = await handler(request.params)
  result.durationMs = Date.now() - start
  result.requestId = request.requestId
  return result
}

// ── Dangerous action confirmation ───────────────────────────────────────────

function formatDescription(def: ActionDefinition, params: Record<string, unknown>): string {
  const parts = [def.description]
  for (const p of def.params) {
    if (params[p.name] != null) {
      parts.push(`${p.name}: ${String(params[p.name])}`)
    }
  }
  return parts.join('\n')
}

function requestConfirmation(
  definition: ActionDefinition,
  request: ActionRequest,
  mainWin: BrowserWindow | null
): Promise<boolean> {
  return new Promise((resolve) => {
    const interaction: AgentInteractionRequest = {
      id: randomUUID(),
      providerRequestId: request.requestId || randomUUID(),
      provider: 'codex',
      sessionId: 'action-system',
      kind: 'action-confirmation',
      title: `Confirm: ${definition.name}`,
      description: formatDescription(definition, request.params),
      options: [
        { id: 'approve', label: 'Approve', value: 'approve', style: 'primary' },
        { id: 'deny', label: 'Deny', value: 'deny', style: 'danger' },
      ],
      requestedAt: Date.now(),
      status: 'pending',
      rawMethod: `action/${request.actionId}`,
    }

    registerPendingRequest(interaction, (result: unknown) => {
      const decision = (result as Record<string, unknown>)?.decision
      resolve(decision === 'approve')
    })

    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('ai:interaction-request', interaction)
    } else {
      resolve(false)
    }
  })
}
