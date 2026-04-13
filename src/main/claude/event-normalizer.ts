import type {
  ClaudeEvent,
  NormalizedClaudeEvent,
  InitEvent,
  StreamEvent,
  ResultEvent,
  RateLimitEvent,
  PermissionEvent,
  ContentDelta,
} from '../../shared/claude-types'

/**
 * Maps raw Claude stream-json events to canonical OmniCue events.
 *
 * The normalizer is stateless — it takes one raw event and returns
 * zero or more normalized events.
 */
export function normalize(raw: ClaudeEvent): NormalizedClaudeEvent[] {
  switch (raw.type) {
    case 'system':
      return normalizeSystem(raw as InitEvent)

    case 'stream_event':
      return normalizeStreamEvent(raw as StreamEvent)

    case 'result':
      return normalizeResult(raw as ResultEvent)

    case 'rate_limit_event':
      return normalizeRateLimit(raw as RateLimitEvent)

    case 'permission_request':
      return normalizePermission(raw as PermissionEvent)

    default:
      // Unknown event type — skip silently
      return []
  }
}

function normalizeSystem(event: InitEvent): NormalizedClaudeEvent[] {
  if (event.subtype !== 'init') return []

  return [{
    type: 'session_init',
    sessionId: event.session_id,
    tools: event.tools || [],
    model: event.model || 'unknown',
    mcpServers: event.mcp_servers || [],
    skills: event.skills || [],
    version: event.claude_code_version || 'unknown',
  }]
}

function normalizeStreamEvent(event: StreamEvent): NormalizedClaudeEvent[] {
  const sub = event.event
  if (!sub) return []

  switch (sub.type) {
    case 'content_block_start': {
      if (sub.content_block.type === 'tool_use') {
        return [{
          type: 'tool_call',
          toolName: sub.content_block.name || 'unknown',
          toolId: sub.content_block.id || '',
          index: sub.index,
        }]
      }
      return []
    }

    case 'content_block_delta': {
      const delta = sub.delta as ContentDelta
      if (delta.type === 'text_delta') {
        return [{ type: 'text_chunk', text: delta.text }]
      }
      if (delta.type === 'input_json_delta') {
        return [{
          type: 'tool_call_update',
          toolId: '',
          partialInput: delta.partial_json,
        }]
      }
      return []
    }

    case 'content_block_stop': {
      return [{
        type: 'tool_call_complete',
        index: sub.index,
      }]
    }

    case 'message_start':
    case 'message_delta':
    case 'message_stop':
      return []

    default:
      return []
  }
}

function normalizeResult(event: ResultEvent): NormalizedClaudeEvent[] {
  if (event.is_error || event.subtype === 'error') {
    return [{
      type: 'error',
      message: event.result || 'Unknown error',
      isError: true,
      sessionId: event.session_id,
    }]
  }

  const denials = Array.isArray(event.permission_denials)
    ? event.permission_denials.map((d: unknown) => {
        const denial = d as Record<string, string>
        return {
          toolName: denial.tool_name || '',
          toolUseId: denial.tool_use_id || '',
        }
      })
    : undefined

  return [{
    type: 'task_complete',
    result: event.result || '',
    costUsd: event.total_cost_usd || 0,
    durationMs: event.duration_ms || 0,
    numTurns: event.num_turns || 0,
    usage: event.usage || {},
    sessionId: event.session_id,
    ...(denials && denials.length > 0 ? { permissionDenials: denials } : {}),
  }]
}

function normalizeRateLimit(event: RateLimitEvent): NormalizedClaudeEvent[] {
  const info = event.rate_limit_info
  if (!info) return []

  return [{
    type: 'rate_limit',
    status: info.status,
    resetsAt: info.resetsAt,
    rateLimitType: info.rateLimitType,
  }]
}

function normalizePermission(event: PermissionEvent): NormalizedClaudeEvent[] {
  return [{
    type: 'permission_request',
    questionId: event.question_id,
    toolName: event.tool?.name || 'unknown',
    toolDescription: event.tool?.description,
    toolInput: event.tool?.input,
    options: (event.options || []).map((o) => ({
      id: o.id,
      label: o.label,
      kind: o.kind,
    })),
  }]
}
