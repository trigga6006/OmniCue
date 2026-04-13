/**
 * Permission Hook Server
 *
 * A local HTTP server that acts as a Claude Code PreToolUse hook handler.
 * When Claude Code wants to use a tool, it POSTs the tool request here.
 * The server forwards it to the renderer (permission card), waits for the
 * user's decision, and returns the structured hook response.
 *
 * Security:
 *   - Per-launch app secret in URL path (prevents local spoofing)
 *   - Per-run token in URL path (prevents cross-run confusion)
 *   - Deny-by-default on every failure path
 */

import { createServer, IncomingMessage, ServerResponse } from 'http'
import { EventEmitter } from 'events'
import { writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { randomUUID } from 'crypto'
import type { HookToolRequest, PermissionDecision, PermissionOption } from '../../shared/claude-types'
import { debugLog } from './logger'

const PERMISSION_TIMEOUT_MS = 5 * 60 * 1000 // 5 minutes
const DEFAULT_PORT = 19836
const MAX_BODY_SIZE = 1024 * 1024 // 1MB

// Tools that need explicit user approval via the permission card.
const PERMISSION_REQUIRED_TOOLS = ['Bash', 'Edit', 'Write', 'MultiEdit']

// Bash commands that are clearly read-only and safe to auto-approve.
const SAFE_BASH_COMMANDS = new Set([
  'cat', 'head', 'tail', 'less', 'more', 'wc', 'file', 'stat',
  'ls', 'dir', 'pwd', 'echo', 'printf', 'date', 'whoami', 'hostname', 'uname',
  'which', 'where', 'type', 'command',
  'find', 'grep', 'rg', 'ag', 'fd', 'findstr',
  'git',
  'env', 'printenv', 'set',
  'npm', 'yarn', 'pnpm', 'bun', 'cargo', 'pip', 'pip3', 'go',
  'node', 'python', 'python3',
  'df', 'du', 'free', 'ps',
  'tree', 'realpath', 'dirname', 'basename',
  'diff', 'cmp', 'sort', 'uniq', 'cut', 'awk', 'sed',
  'jq', 'yq', 'xargs', 'tr',
  // Windows-specific
  'Get-ChildItem', 'Get-Content', 'Get-Process', 'Get-Location',
  'Test-Path', 'Resolve-Path',
])

// Git subcommands that mutate state
const GIT_MUTATING_SUBCOMMANDS = new Set([
  'push', 'commit', 'merge', 'rebase', 'reset', 'checkout', 'switch',
  'branch', 'tag', 'stash', 'cherry-pick', 'revert', 'am', 'apply',
  'clean', 'rm', 'mv', 'restore', 'pull', 'fetch', 'clone', 'init',
])

// Regex matcher for the hook config
const HOOK_MATCHER = `^(${PERMISSION_REQUIRED_TOOLS.join('|')}|mcp__.*)$`

// Fields in tool_input that should be redacted in logs
const SENSITIVE_FIELD_RE = /token|password|secret|key|auth|credential|api.?key/i

const VALID_ALLOW_DECISIONS = new Set(['allow', 'allow-session', 'allow-domain'])
const VALID_DECISIONS = new Set([...VALID_ALLOW_DECISIONS, 'deny'])

function isSafeBashCommand(command: unknown): boolean {
  if (typeof command !== 'string') return false
  const trimmed = command.trim()
  if (!trimmed) return false

  const segments = trimmed.split(/\s*(?:;|&&|\|\||[|])\s*/)
  for (const segment of segments) {
    const parts = segment.trim().split(/\s+/)
    const cmd = parts[0]
    if (!cmd) continue

    const actualCmd = cmd.includes('=') ? parts[1] : cmd
    if (!actualCmd) continue

    // Strip path prefix
    const base = actualCmd.split(/[/\\]/).pop() || actualCmd

    if (!SAFE_BASH_COMMANDS.has(base)) return false

    if (base === 'git') {
      const subIdx = cmd.includes('=') ? 2 : 1
      const sub = parts[subIdx]
      if (sub && GIT_MUTATING_SUBCOMMANDS.has(sub)) return false
    }

    if (['npm', 'yarn', 'pnpm', 'bun'].includes(base)) {
      const subIdx = cmd.includes('=') ? 2 : 1
      const sub = parts[subIdx]
      if (sub && ['install', 'i', 'add', 'remove', 'uninstall', 'publish', 'run', 'exec', 'dlx', 'npx', 'create', 'init'].includes(sub)) return false
    }

    // Block file-writing redirections
    if (segment.includes('>') && !segment.includes('>/dev/null') && !segment.includes('2>/dev/null') && !segment.includes('2>&1') && !segment.includes('>$null') && !segment.includes('>NUL')) return false
  }

  return true
}

function denyResponse(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'deny',
      permissionDecisionReason: reason,
    },
  }
}

function allowResponse(reason: string) {
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      permissionDecisionReason: reason,
    },
  }
}

interface PendingRequest {
  toolRequest: HookToolRequest
  resolve: (decision: PermissionDecision) => void
  timeout: ReturnType<typeof setTimeout>
  questionId: string
  runToken: string
}

interface RunRegistration {
  tabId: string
  requestId: string
  sessionId: string | null
}

/**
 * PermissionServer: HTTP server for Claude Code PreToolUse hooks.
 *
 * Events:
 *  - 'permission-request' (questionId, toolRequest, tabId, options)
 */
export class PermissionServer extends EventEmitter {
  private server: ReturnType<typeof createServer> | null = null
  private pendingRequests = new Map<string, PendingRequest>()
  private port: number
  private _actualPort: number | null = null
  private appSecret: string
  private runTokens = new Map<string, RunRegistration>()
  private scopedAllows = new Set<string>()
  private settingsFiles = new Map<string, string>()

  constructor(port = DEFAULT_PORT) {
    super()
    this.port = port
    this.appSecret = randomUUID()
  }

  async start(): Promise<number> {
    if (this.server) {
      return this._actualPort || this.port
    }

    return new Promise((resolve, reject) => {
      this.server = createServer((req, res) => this._handleRequest(req, res))

      this.server.on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'EADDRINUSE') {
          debugLog(`PermissionServer: Port ${this.port} in use, trying ${this.port + 1}`)
          this.port++
          this.server!.listen(this.port, '127.0.0.1')
        } else {
          debugLog(`PermissionServer: Server error: ${err.message}`)
          reject(err)
        }
      })

      this.server.listen(this.port, '127.0.0.1', () => {
        this._actualPort = this.port
        debugLog(`PermissionServer: Listening on 127.0.0.1:${this.port}`)
        resolve(this.port)
      })
    })
  }

  stop(): void {
    for (const [qid, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.resolve({ decision: 'deny', reason: 'Server shutting down' })
      this.pendingRequests.delete(qid)
    }

    for (const [, filePath] of this.settingsFiles) {
      try { unlinkSync(filePath) } catch { /* best effort */ }
    }
    this.settingsFiles.clear()

    if (this.server) {
      this.server.close()
      this.server = null
      debugLog('PermissionServer: Stopped')
    }
  }

  getPort(): number | null {
    return this._actualPort
  }

  registerRun(tabId: string, requestId: string, sessionId: string | null): string {
    const runToken = randomUUID()
    this.runTokens.set(runToken, { tabId, requestId, sessionId })
    debugLog(`PermissionServer: Registered run token=${runToken.substring(0, 8)}... tab=${tabId.substring(0, 8)}...`)
    return runToken
  }

  unregisterRun(runToken: string): void {
    const reg = this.runTokens.get(runToken)
    if (!reg) return

    for (const [qid, pending] of this.pendingRequests) {
      if (pending.runToken === runToken) {
        clearTimeout(pending.timeout)
        pending.resolve({ decision: 'deny', reason: 'Run ended' })
        this.pendingRequests.delete(qid)
      }
    }

    const filePath = this.settingsFiles.get(runToken)
    if (filePath) {
      try { unlinkSync(filePath) } catch { /* best effort */ }
      this.settingsFiles.delete(runToken)
    }

    this.runTokens.delete(runToken)
  }

  respondToPermission(questionId: string, decision: string, reason?: string): boolean {
    const pending = this.pendingRequests.get(questionId)
    if (!pending) return false

    clearTimeout(pending.timeout)
    this.pendingRequests.delete(questionId)

    if (!VALID_DECISIONS.has(decision)) {
      pending.resolve({ decision: 'deny', reason: `Unknown decision: ${decision}` })
      return true
    }

    const toolName = pending.toolRequest.tool_name
    const sessionId = pending.toolRequest.session_id

    if (decision === 'allow-session') {
      this.scopedAllows.add(`session:${sessionId}:tool:${toolName}`)
    } else if (decision === 'allow-domain') {
      const domain = extractDomain(pending.toolRequest.tool_input?.url)
      if (domain) {
        this.scopedAllows.add(`session:${sessionId}:webfetch:${domain}`)
      }
    }

    const hookDecision: 'allow' | 'deny' = VALID_ALLOW_DECISIONS.has(decision) ? 'allow' : 'deny'
    debugLog(`PermissionServer: ${toolName} -> ${hookDecision}`)
    pending.resolve({ decision: hookDecision, reason })
    return true
  }

  getOptionsForTool(toolName: string): PermissionOption[] {
    if (toolName === 'Bash') {
      return [
        { id: 'allow', label: 'Allow Once', kind: 'allow' },
        { id: 'deny', label: 'Deny', kind: 'deny' },
      ]
    }

    return [
      { id: 'allow', label: 'Allow Once', kind: 'allow' },
      { id: 'allow-session', label: 'Allow for Session', kind: 'allow' },
      { id: 'deny', label: 'Deny', kind: 'deny' },
    ]
  }

  generateSettingsFile(runToken: string): string {
    const port = this._actualPort || this.port
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: HOOK_MATCHER,
            hooks: [
              {
                type: 'http',
                url: `http://127.0.0.1:${port}/hook/pre-tool-use/${this.appSecret}/${runToken}`,
                timeout: 300,
              },
            ],
          },
        ],
      },
    }

    const dir = join(tmpdir(), 'omnicue-hook-config')
    try { mkdirSync(dir, { recursive: true }) } catch { /* exists */ }

    const filePath = join(dir, `omnicue-hook-${runToken}.json`)
    writeFileSync(filePath, JSON.stringify(settings, null, 2))
    this.settingsFiles.set(runToken, filePath)
    return filePath
  }

  private async _handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(denyResponse('Not found')))
      return
    }

    const segments = (req.url || '').split('/').filter(Boolean)
    if (segments.length !== 4 || segments[0] !== 'hook' || segments[1] !== 'pre-tool-use') {
      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(denyResponse('Invalid path')))
      return
    }

    const urlSecret = segments[2]
    const urlToken = segments[3]

    if (urlSecret !== this.appSecret) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(denyResponse('Invalid credentials')))
      return
    }

    const registration = this.runTokens.get(urlToken)
    if (!registration) {
      res.writeHead(403, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(denyResponse('Unknown run')))
      return
    }

    // Read body with size limit
    let body = ''
    let bodySize = 0
    for await (const chunk of req) {
      bodySize += (chunk as Buffer).length
      if (bodySize > MAX_BODY_SIZE) {
        res.writeHead(413, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(denyResponse('Request too large')))
        return
      }
      body += chunk
    }

    let toolRequest: HookToolRequest
    try {
      toolRequest = JSON.parse(body) as HookToolRequest
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(denyResponse('Invalid JSON')))
      return
    }

    if (!toolRequest.tool_name || !toolRequest.session_id || !toolRequest.hook_event_name) {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(denyResponse('Missing required fields')))
      return
    }

    if (toolRequest.hook_event_name !== 'PreToolUse') {
      res.writeHead(400, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(denyResponse('Unexpected hook event')))
      return
    }

    debugLog(`PermissionServer: Hook ${toolRequest.tool_name} -> tab=${registration.tabId.substring(0, 8)}...`)

    const sessionId = toolRequest.session_id
    const toolName = toolRequest.tool_name

    // Check session-scoped allow
    if (this.scopedAllows.has(`session:${sessionId}:tool:${toolName}`)) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(allowResponse('Allowed for session by user')))
      return
    }

    // Check domain-scoped allow (WebFetch)
    if (toolName === 'WebFetch') {
      const domain = extractDomain(toolRequest.tool_input?.url)
      if (domain && this.scopedAllows.has(`session:${sessionId}:webfetch:${domain}`)) {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(allowResponse(`Domain ${domain} allowed by user`)))
        return
      }
    }

    // Auto-approve safe Bash commands
    if (toolName === 'Bash' && isSafeBashCommand(toolRequest.tool_input?.command)) {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(allowResponse('Safe read-only command')))
      return
    }

    // Wait for user decision
    const questionId = `hook-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`

    const decision = await new Promise<PermissionDecision>((resolve) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(questionId)
        resolve({ decision: 'deny', reason: 'Permission timed out after 5 minutes' })
      }, PERMISSION_TIMEOUT_MS)

      this.pendingRequests.set(questionId, {
        toolRequest,
        resolve,
        timeout,
        questionId,
        runToken: urlToken,
      })

      const options = this.getOptionsForTool(toolName)

      // Mask sensitive fields before sending to renderer
      const safeInput = toolRequest.tool_input
        ? maskSensitiveFields(toolRequest.tool_input)
        : undefined

      this.emit('permission-request', questionId, { ...toolRequest, tool_input: safeInput || toolRequest.tool_input }, registration.tabId, options)
    })

    const hookResponse = decision.decision === 'allow'
      ? allowResponse(decision.reason || 'Approved by user')
      : denyResponse(decision.reason || 'Denied by user')

    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(hookResponse))
  }
}

function extractDomain(url: unknown): string | null {
  if (typeof url !== 'string') return null
  try { return new URL(url).hostname } catch { return null }
}

export function maskSensitiveFields(input: Record<string, unknown>): Record<string, unknown> {
  const masked: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(input)) {
    if (SENSITIVE_FIELD_RE.test(key)) {
      masked[key] = '***'
    } else if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      masked[key] = maskSensitiveFields(value as Record<string, unknown>)
    } else if (Array.isArray(value)) {
      masked[key] = value.map(item =>
        item !== null && typeof item === 'object' && !Array.isArray(item)
          ? maskSensitiveFields(item as Record<string, unknown>)
          : item
      )
    } else {
      masked[key] = value
    }
  }
  return masked
}
