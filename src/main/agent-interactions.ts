/**
 * Agent Interaction Manager
 *
 * Tracks pending provider requests (Codex server requests that need a JSON-RPC
 * response) and maps them to the unified AgentInteractionRequest model used by
 * the renderer.
 */

import { randomUUID } from 'crypto'

// ── Types (mirrored from renderer for main-process use) ──────────────────────

export type AgentInteractionKind =
  | 'command-approval'
  | 'file-change-approval'
  | 'user-input'
  | 'provider-elicitation'
  | 'unsupported'

export type AgentInteractionStatus =
  | 'pending'
  | 'submitted'
  | 'resolved'
  | 'declined'
  | 'cancelled'
  | 'failed'

export interface AgentInteractionOption {
  id: string
  label: string
  description?: string
  value: string
  style?: 'primary' | 'secondary' | 'danger'
}

export interface AgentInteractionQuestion {
  id: string
  header: string
  question: string
  isOther?: boolean
  isSecret?: boolean
  options?: AgentInteractionOption[]
}

export interface AgentInteractionRequest {
  id: string
  providerRequestId: string
  provider: 'codex' | 'claude'
  sessionId: string
  turnId?: string
  kind: AgentInteractionKind
  title: string
  description?: string
  detail?: string
  options?: AgentInteractionOption[]
  questions?: AgentInteractionQuestion[]
  requestedAt: number
  status: AgentInteractionStatus
  rawMethod: string
}

export interface AgentInteractionResponse {
  sessionId: string
  interactionId: string
  providerRequestId: string
  kind: AgentInteractionKind
  selectedOptionId?: string
  answers?: Record<string, string[]>
}

function encodeInteractionValue(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value)
}

function decodeInteractionLabel(decision: unknown): string {
  if (typeof decision === 'string') return decisionLabel(decision)
  if (decision && typeof decision === 'object') {
    const [key] = Object.keys(decision as Record<string, unknown>)
    return key ? decisionLabel(key) : 'Approve'
  }
  return 'Approve'
}

// ── Pending request tracking ─────────────────────────────────────────────────

interface PendingProviderRequest {
  interaction: AgentInteractionRequest
  /** Function to write the JSON-RPC response back to the provider */
  respond: (result: unknown) => void
}

const pendingRequests = new Map<string, PendingProviderRequest>()

export function registerPendingRequest(
  interaction: AgentInteractionRequest,
  respond: (result: unknown) => void
): void {
  pendingRequests.set(interaction.id, { interaction, respond })
}

export function resolvePendingRequest(
  interactionId: string,
  result: unknown
): boolean {
  const entry = pendingRequests.get(interactionId)
  if (!entry) return false
  entry.respond(result)
  pendingRequests.delete(interactionId)
  return true
}

export function cancelPendingRequestsForSession(sessionId: string): void {
  for (const [id, entry] of pendingRequests) {
    if (entry.interaction.sessionId === sessionId) {
      if (
        entry.interaction.kind === 'user-input' ||
        entry.interaction.kind === 'provider-elicitation'
      ) {
        entry.respond({ answers: {} })
      } else {
        entry.respond({ decision: 'cancel' })
      }
      pendingRequests.delete(id)
    }
  }
}

// ── Codex normalization helpers ──────────────────────────────────────────────

/** Style a decision button based on its name */
function decisionStyle(decision: string): 'primary' | 'secondary' | 'danger' {
  if (decision === 'decline' || decision === 'cancel') return 'danger'
  if (decision.startsWith('accept')) return 'primary'
  return 'secondary'
}

/** Prettify a camelCase decision name */
function decisionLabel(decision: string): string {
  switch (decision) {
    case 'accept': return 'Approve'
    case 'acceptForSession': return 'Approve for session'
    case 'acceptWithExecpolicyAmendment': return 'Approve + amend policy'
    case 'applyNetworkPolicyAmendment': return 'Allow network'
    case 'decline': return 'Deny'
    case 'cancel': return 'Cancel'
    default: return decision.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase())
  }
}

function getCommandText(params: Record<string, unknown>): string {
  if (typeof params.command === 'string') return params.command
  if (Array.isArray(params.command)) {
    return params.command.map((part) => String(part)).join(' ')
  }

  const command = params.command as Record<string, unknown> | undefined
  if (!command) return ''

  if (typeof command.commandText === 'string') return command.commandText
  if (Array.isArray(command.command)) {
    return command.command.map((part) => String(part)).join(' ')
  }

  return ''
}

export function normalizeCodexCommandApproval(
  sessionId: string,
  providerRequestId: string,
  method: string,
  params: Record<string, unknown>
): AgentInteractionRequest {
  const commandText = getCommandText(params)
  const cwd =
    typeof params.cwd === 'string'
      ? params.cwd
      : typeof (params.command as Record<string, unknown> | undefined)?.cwd === 'string'
        ? String((params.command as Record<string, unknown>).cwd)
        : ''
  const reason = typeof params.reason === 'string' ? params.reason : ''
  const decisions = Array.isArray(params.availableDecisions)
    ? (params.availableDecisions as unknown[])
    : ['accept', 'decline']
  const detailParts = [cwd ? `in ${cwd}` : '', reason].filter(Boolean)

  return {
    id: randomUUID(),
    providerRequestId,
    provider: 'codex',
    sessionId,
    turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
    kind: 'command-approval',
    title: 'Command approval',
    description: commandText || 'Agent wants to run a command',
    detail: detailParts.length > 0 ? detailParts.join(' • ') : undefined,
    options: decisions.map((d) => ({
      id: encodeInteractionValue(d),
      label: decodeInteractionLabel(d),
      value: encodeInteractionValue(d),
      style: decisionStyle(typeof d === 'string' ? d : Object.keys(d as Record<string, unknown>)[0] || ''),
    })),
    requestedAt: Date.now(),
    status: 'pending',
    rawMethod: method,
  }
}

export function normalizeCodexFileChangeApproval(
  sessionId: string,
  providerRequestId: string,
  method: string,
  params: Record<string, unknown>
): AgentInteractionRequest {
  const fileChanges = params.fileChanges as Record<string, unknown> | undefined
  const filePaths = fileChanges ? Object.keys(fileChanges) : []
  const grantRoot = typeof params.grantRoot === 'string' ? params.grantRoot : ''
  const reason = typeof params.reason === 'string' ? params.reason : ''
  const decisions = Array.isArray(params.availableDecisions)
    ? (params.availableDecisions as unknown[])
    : ['accept', 'decline']
  const description =
    filePaths.length > 0
      ? filePaths.slice(0, 3).join(', ') + (filePaths.length > 3 ? ` +${filePaths.length - 3} more` : '')
      : grantRoot || 'Agent wants to change files'
  const detailParts = [reason, grantRoot ? `grant root: ${grantRoot}` : ''].filter(Boolean)

  return {
    id: randomUUID(),
    providerRequestId,
    provider: 'codex',
    sessionId,
    turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
    kind: 'file-change-approval',
    title: 'File change',
    description,
    detail: detailParts.length > 0 ? detailParts.join(' • ') : undefined,
    options: decisions.map((d) => ({
      id: encodeInteractionValue(d),
      label: decodeInteractionLabel(d),
      value: encodeInteractionValue(d),
      style: decisionStyle(typeof d === 'string' ? d : Object.keys(d as Record<string, unknown>)[0] || ''),
    })),
    requestedAt: Date.now(),
    status: 'pending',
    rawMethod: method,
  }
}

export function normalizeCodexUserInput(
  sessionId: string,
  providerRequestId: string,
  method: string,
  params: Record<string, unknown>
): AgentInteractionRequest {
  const rawQuestions = Array.isArray(params.questions) ? params.questions : []
  const header = typeof params.header === 'string' ? params.header : 'Agent needs input'

  const questions: AgentInteractionQuestion[] = rawQuestions.map(
    (q: Record<string, unknown>, i: number) => {
      const qId = typeof q.id === 'string' ? q.id : `q${i}`
      const rawOptions = Array.isArray(q.options) ? q.options : []
      return {
        id: qId,
        header: typeof q.header === 'string' ? q.header : '',
        question: typeof q.question === 'string' ? q.question : '',
        isOther: q.isOther === true,
        isSecret: q.isSecret === true,
        options: rawOptions.map((o: Record<string, unknown>, oi: number) => ({
          id: typeof o.id === 'string' ? o.id : `o${oi}`,
          label: typeof o.label === 'string' ? o.label : `Option ${oi + 1}`,
          value:
            typeof o.value === 'string'
              ? o.value
              : typeof o.label === 'string'
                ? o.label
                : `Option ${oi + 1}`,
          description: typeof o.description === 'string' ? o.description : undefined,
        })),
      }
    }
  )

  return {
    id: randomUUID(),
    providerRequestId,
    provider: 'codex',
    sessionId,
    turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
    kind: 'user-input',
    title: header || questions[0]?.header || 'Agent needs input',
    description:
      questions.length === 1 ? questions[0]?.question : questions.length > 1 ? `${questions.length} questions` : undefined,
    questions,
    requestedAt: Date.now(),
    status: 'pending',
    rawMethod: method,
  }
}

export function normalizeCodexUnsupported(
  sessionId: string,
  providerRequestId: string,
  method: string,
  params: Record<string, unknown>
): AgentInteractionRequest {
  return {
    id: randomUUID(),
    providerRequestId,
    provider: 'codex',
    sessionId,
    turnId: typeof params.turnId === 'string' ? params.turnId : undefined,
    kind: 'unsupported',
    title: `Agent request: ${method}`,
    description: JSON.stringify(params, null, 2).slice(0, 300),
    options: [
      { id: 'cancel', label: 'Cancel', value: 'cancel', style: 'danger' },
    ],
    requestedAt: Date.now(),
    status: 'pending',
    rawMethod: method,
  }
}
