import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { homedir } from 'os'
import { StreamParser } from './stream-parser'
import { normalize } from './event-normalizer'
import { findClaudeBinary, getCliEnv, needsShell } from './cli-env'
import { debugLog } from './logger'
import type { ClaudeEvent, ClaudeRunOptions, EnrichedError } from '../../shared/claude-types'

const MAX_RING_LINES = 100

// Tools auto-approved via --allowedTools (never trigger the permission card).
const SAFE_TOOLS = [
  'Read', 'Glob', 'Grep', 'LS',
  'TodoRead', 'TodoWrite',
  'Agent', 'Task', 'TaskOutput',
  'Notebook',
  'WebSearch', 'WebFetch',
]

// All tools to pre-approve when no hook server is available (fallback path).
const DEFAULT_ALLOWED_TOOLS = [
  'Bash', 'Edit', 'Write', 'MultiEdit',
  ...SAFE_TOOLS,
]

// System prompt appended to tell Claude it's inside OmniCue
const OMNICUE_SYSTEM_HINT = [
  'IMPORTANT: You are running inside OmniCue, a desktop overlay application.',
  'OmniCue is a GUI wrapper around Claude Code — the user sees your output in a',
  'styled conversation view with full markdown rendering.',
  '',
  'Use rich formatting when it helps:',
  '- Use clickable markdown links: [label](https://url)',
  '- Use tables, bold, headers, and bullet lists freely.',
  '- Use code blocks with language tags for syntax highlighting.',
  '',
  'You are still a software engineering assistant. Keep using your tools (Read, Edit, Bash, etc.)',
  'normally. When presenting information, take advantage of the rich UI.',
].join('\n')

export interface RunHandle {
  runId: string
  sessionId: string | null
  process: ChildProcess
  pid: number | null
  startedAt: number
  stderrTail: string[]
  stdoutTail: string[]
  toolCallCount: number
  sawPermissionRequest: boolean
  permissionDenials: Array<{ tool_name: string; tool_use_id: string }>
}

/**
 * RunManager: spawns one `claude -p` process per run, parses NDJSON,
 * emits normalized events, handles cancel, and keeps diagnostic ring buffers.
 *
 * Uses --input-format stream-json for bidirectional communication:
 * prompts are sent as JSON objects via stdin, stdin stays open for
 * follow-up messages (permission responses, etc).
 *
 * Events emitted:
 *  - 'normalized' (runId, NormalizedClaudeEvent)
 *  - 'raw' (runId, ClaudeEvent)
 *  - 'exit' (runId, code, signal, sessionId)
 *  - 'error' (runId, Error)
 */
export class ClaudeRunManager extends EventEmitter {
  private activeRuns = new Map<string, RunHandle>()
  private _finishedRuns = new Map<string, RunHandle>()
  private claudeBinary: string

  constructor() {
    super()
    this.claudeBinary = findClaudeBinary()
    debugLog(`RunManager: Claude binary: ${this.claudeBinary}`)
  }

  private _getEnv(): NodeJS.ProcessEnv {
    const env = getCliEnv()
    // Ensure our claude binary's directory is in PATH
    const sep = process.platform === 'win32' ? '\\' : '/'
    const binDir = this.claudeBinary.substring(0, this.claudeBinary.lastIndexOf(sep))
    const pathSep = process.platform === 'win32' ? ';' : ':'
    if (env.PATH && !env.PATH.includes(binDir)) {
      env.PATH = `${binDir}${pathSep}${env.PATH}`
    }
    return env
  }

  startRun(requestId: string, options: ClaudeRunOptions): RunHandle {
    const cwd = options.projectPath === '~' ? homedir() : options.projectPath

    const args: string[] = [
      '-p',
      '--input-format', 'stream-json',
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]

    // Permission mode: full-access uses --dangerously-skip-permissions,
    // otherwise use --permission-mode with the appropriate value.
    if (options.permissionMode === 'full-access') {
      args.push('--dangerously-skip-permissions')
    } else if (options.permissionMode === 'workspace-write') {
      args.push('--permission-mode', 'plan')
    } else {
      args.push('--permission-mode', 'default')
    }

    if (options.sessionId) {
      args.push('--resume', options.sessionId)
    }
    if (options.model) {
      args.push('--model', options.model)
    }
    if (options.addDirs && options.addDirs.length > 0) {
      for (const dir of options.addDirs) {
        args.push('--add-dir', dir)
      }
    }

    if (options.hookSettingsPath) {
      // CLUI-scoped hook settings: the PreToolUse HTTP hook handles permissions.
      // Auto-approve safe tools so they don't trigger the permission card.
      args.push('--settings', options.hookSettingsPath)
      const safeAllowed = [
        ...SAFE_TOOLS,
        ...(options.allowedTools || []),
      ]
      args.push('--allowedTools', safeAllowed.join(','))
    } else {
      // Fallback: no hook server available.
      const allAllowed = [
        ...DEFAULT_ALLOWED_TOOLS,
        ...(options.allowedTools || []),
      ]
      args.push('--allowedTools', allAllowed.join(','))
    }

    if (options.maxTurns) {
      args.push('--max-turns', String(options.maxTurns))
    }
    if (options.maxBudgetUsd) {
      args.push('--max-budget-usd', String(options.maxBudgetUsd))
    }
    if (options.systemPrompt) {
      args.push('--system-prompt', options.systemPrompt)
    }

    // Always tell Claude it's inside OmniCue, plus any caller-provided system context
    const systemParts = [OMNICUE_SYSTEM_HINT]
    if (options.appendSystemPrompt) {
      systemParts.push(options.appendSystemPrompt)
    }
    args.push('--append-system-prompt', systemParts.join('\n\n'))

    debugLog(`RunManager: Starting run ${requestId}: ${this.claudeBinary} (cwd: ${cwd})`)
    debugLog(`RunManager: Args: ${args.map((a, i) => `[${i}]=${a.substring(0, 80)}`).join(' ')}`)

    // Determine if we need shell:true (only for .cmd shims on Windows)
    const useShell = needsShell(this.claudeBinary)

    const child = spawn(this.claudeBinary, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      cwd,
      env: this._getEnv(),
      windowsHide: true,
      shell: useShell,
    })

    debugLog(`RunManager: Spawned PID: ${child.pid} (shell: ${useShell})`)

    const handle: RunHandle = {
      runId: requestId,
      sessionId: options.sessionId || null,
      process: child,
      pid: child.pid || null,
      startedAt: Date.now(),
      stderrTail: [],
      stdoutTail: [],
      toolCallCount: 0,
      sawPermissionRequest: false,
      permissionDenials: [],
    }

    // ─── stdout -> NDJSON parser -> normalizer -> events ───
    const parser = StreamParser.fromStream(child.stdout!)

    parser.on('event', (raw: ClaudeEvent) => {
      // Track session ID from init event
      if (raw.type === 'system' && 'subtype' in raw && (raw as any).subtype === 'init') {
        handle.sessionId = (raw as any).session_id
      }

      // Track permission_request events
      if (raw.type === 'permission_request') {
        handle.sawPermissionRequest = true
      }

      // Extract permission_denials from result event
      if (raw.type === 'result') {
        const denials = (raw as any).permission_denials
        if (Array.isArray(denials) && denials.length > 0) {
          handle.permissionDenials = denials.map((d: any) => ({
            tool_name: d.tool_name || '',
            tool_use_id: d.tool_use_id || '',
          }))
        }
      }

      // Ring buffer stdout lines
      this._ringPush(handle.stdoutTail, JSON.stringify(raw).substring(0, 300))

      // Emit raw event for debugging
      this.emit('raw', requestId, raw)

      // Normalize and emit canonical events
      const normalized = normalize(raw)
      for (const evt of normalized) {
        if (evt.type === 'tool_call') handle.toolCallCount++
        this.emit('normalized', requestId, evt)
      }

      // Close stdin after result — each run is one process.
      // Session continuity is via --resume, not stdin reuse.
      if (raw.type === 'result') {
        debugLog(`RunManager: Run complete [${requestId}]`)
        try { child.stdin?.end() } catch { /* ignore */ }
      }
    })

    parser.on('parse-error', (line: string) => {
      debugLog(`RunManager: Parse error [${requestId}]: ${line.substring(0, 200)}`)
      this._ringPush(handle.stderrTail, `[parse-error] ${line.substring(0, 200)}`)
    })

    // ─── stderr ring buffer ───
    child.stderr?.setEncoding('utf-8')
    child.stderr?.on('data', (data: string) => {
      const lines = data.split('\n').filter((l: string) => l.trim())
      for (const line of lines) {
        this._ringPush(handle.stderrTail, line)
      }
      debugLog(`RunManager: Stderr [${requestId}]: ${data.trim().substring(0, 500)}`)
    })

    // ─── Process lifecycle ───
    child.on('close', (code, signal) => {
      const stderrSummary = handle.stderrTail.slice(-10).join('\n')
      debugLog(`RunManager: Process closed [${requestId}]: code=${code} signal=${signal}`)
      if (code !== 0 && stderrSummary) {
        debugLog(`RunManager: Stderr on exit [${requestId}]: ${stderrSummary.substring(0, 500)}`)
      }
      this._finishedRuns.set(requestId, handle)
      this.activeRuns.delete(requestId)
      this.emit('exit', requestId, code, signal, handle.sessionId)
      setTimeout(() => this._finishedRuns.delete(requestId), 5000)
    })

    child.on('error', (err) => {
      debugLog(`RunManager: Process error [${requestId}]: ${err.message}`)
      this._finishedRuns.set(requestId, handle)
      this.activeRuns.delete(requestId)
      this.emit('error', requestId, err)
      setTimeout(() => this._finishedRuns.delete(requestId), 5000)
    })

    // ─── Write prompt to stdin (stream-json format) ───
    const userMessage = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: options.prompt }],
      },
    })
    child.stdin!.write(userMessage + '\n')

    this.activeRuns.set(requestId, handle)
    return handle
  }

  /**
   * Write a message to a running process's stdin (for follow-up prompts, permission responses, etc.)
   */
  writeToStdin(requestId: string, message: object): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false
    if (!handle.process.stdin || handle.process.stdin.destroyed) return false

    const json = JSON.stringify(message)
    debugLog(`RunManager: Writing to stdin [${requestId}]: ${json.substring(0, 200)}`)
    handle.process.stdin.write(json + '\n')
    return true
  }

  /**
   * Cancel a running process: SIGINT, then force-kill after 5s.
   */
  cancel(requestId: string): boolean {
    const handle = this.activeRuns.get(requestId)
    if (!handle) return false

    debugLog(`RunManager: Cancelling run ${requestId}`)

    if (process.platform === 'win32' && handle.pid) {
      // On Windows, use taskkill for reliable process tree kill
      try {
        spawn('taskkill', ['/T', '/F', '/PID', String(handle.pid)], {
          windowsHide: true,
          stdio: 'ignore',
        })
      } catch { /* best effort */ }
    } else {
      handle.process.kill('SIGINT')
      // Fallback: SIGKILL if process hasn't exited after 5s
      setTimeout(() => {
        if (handle.process.exitCode === null) {
          debugLog(`RunManager: Force killing run ${requestId}`)
          handle.process.kill('SIGKILL')
        }
      }, 5000)
    }

    return true
  }

  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    const handle = this.activeRuns.get(requestId) || this._finishedRuns.get(requestId)
    return {
      message: `Run failed with exit code ${exitCode}`,
      stderrTail: handle?.stderrTail.slice(-20) || [],
      stdoutTail: handle?.stdoutTail.slice(-20) || [],
      exitCode,
      elapsedMs: handle ? Date.now() - handle.startedAt : 0,
      toolCallCount: handle?.toolCallCount || 0,
      sawPermissionRequest: handle?.sawPermissionRequest || false,
      permissionDenials: handle?.permissionDenials || [],
    }
  }

  isRunning(requestId: string): boolean {
    return this.activeRuns.has(requestId)
  }

  getHandle(requestId: string): RunHandle | undefined {
    return this.activeRuns.get(requestId)
  }

  getActiveRunIds(): string[] {
    return Array.from(this.activeRuns.keys())
  }

  private _ringPush(buffer: string[], line: string): void {
    buffer.push(line)
    if (buffer.length > MAX_RING_LINES) {
      buffer.shift()
    }
  }
}
