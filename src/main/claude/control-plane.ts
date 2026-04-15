import { EventEmitter } from 'events'
import { randomUUID } from 'crypto'
import { ClaudeRunManager } from './run-manager'
import { PermissionServer, maskSensitiveFields } from './permission-server'
import { debugLog } from './logger'
import type {
  ClaudeTabStatus,
  ClaudeTabRegistryEntry,
  ClaudeHealthReport,
  NormalizedClaudeEvent,
  ClaudeRunOptions,
  EnrichedError,
  PermissionOption,
  HookToolRequest,
} from '../../shared/claude-types'

const MAX_QUEUE_DEPTH = 32

interface QueuedRequest {
  requestId: string
  tabId: string
  options: ClaudeRunOptions
  resolve: (value: void) => void
  reject: (reason: Error) => void
  enqueuedAt: number
  extraWaiters: Array<{ resolve: (value: void) => void; reject: (reason: Error) => void }>
}

interface InflightRequest {
  requestId: string
  tabId: string
  promise: Promise<void>
  resolve: (value: void) => void
  reject: (reason: Error) => void
}

/**
 * ClaudeControlPlane: the single backend authority for Claude Code tab/session lifecycle.
 *
 * Responsibilities:
 *  1. Tab/session registry
 *  2. Request queue + backpressure
 *  3. RequestId idempotency
 *  4. Session resume via --resume
 *  5. Run lifecycle state transitions
 *  6. Health reporting for renderer reconciliation
 *  7. Permission hook server integration
 *
 * Events emitted:
 *  - 'event' (tabId, NormalizedClaudeEvent)
 *  - 'tab-status-change' (tabId, newStatus, oldStatus)
 *  - 'error' (tabId, EnrichedError)
 */
export class ClaudeControlPlane extends EventEmitter {
  private tabs = new Map<string, ClaudeTabRegistryEntry>()
  private inflightRequests = new Map<string, InflightRequest>()
  private requestQueue: QueuedRequest[] = []
  private runManager: ClaudeRunManager
  private permissionServer: PermissionServer
  private runTokens = new Map<string, string>()
  private permissionMode: 'ask' | 'auto' = 'ask'
  private hookServerReady: Promise<void>
  private initRequestIds = new Set<string>()

  constructor() {
    super()
    const _perfCP = Date.now()
    const _pCP = (label: string): void => console.error(`[PERF] ControlPlane constructor | ${label}: ${Date.now() - _perfCP}ms`)
    _pCP('start')
    this.runManager = new ClaudeRunManager()
    _pCP('RunManager created (findClaudeBinary + getCliPath)')
    this.permissionServer = new PermissionServer()
    _pCP('PermissionServer created')

    // Start the permission hook server
    this.hookServerReady = this.permissionServer.start()
      .then((port) => {
        _pCP(`Permission hook server ready on port ${port}`)
        debugLog(`ControlPlane: Permission hook server ready on port ${port}`)
      })
      .catch((err) => {
        debugLog(`ControlPlane: Failed to start permission hook server: ${(err as Error).message}`)
      })

    // Wire permission server events -> normalized events for renderer
    this.permissionServer.on('permission-request', (questionId: string, toolRequest: HookToolRequest, tabId: string, options: PermissionOption[]) => {
      if (!this.tabs.has(tabId)) {
        debugLog(`ControlPlane: Permission request for closed tab ${tabId.substring(0, 8)}... — auto-denying`)
        this.permissionServer.respondToPermission(questionId, 'deny', 'Tab closed')
        return
      }

      debugLog(`ControlPlane: Permission request [${questionId}]: tool=${toolRequest.tool_name} tab=${tabId.substring(0, 8)}... mode=${this.permissionMode}`)

      // Auto mode: immediately allow
      if (this.permissionMode === 'auto') {
        this.permissionServer.respondToPermission(questionId, 'allow', 'Auto mode')
        return
      }

      const safeInput = toolRequest.tool_input
        ? maskSensitiveFields(toolRequest.tool_input)
        : undefined

      const permEvent: NormalizedClaudeEvent = {
        type: 'permission_request',
        questionId,
        toolName: toolRequest.tool_name,
        toolDescription: undefined,
        toolInput: safeInput,
        options,
      }
      this.emit('event', tabId, permEvent)
    })

    // ─── Wire RunManager events -> ControlPlane routing ───

    this.runManager.on('normalized', (requestId: string, event: NormalizedClaudeEvent) => {
      const tabId = this._findTabByRequest(requestId)
      if (!tabId) return

      const tab = this.tabs.get(tabId)
      if (!tab) return

      tab.lastActivityAt = Date.now()

      // Handle session init
      if (event.type === 'session_init') {
        tab.claudeSessionId = event.sessionId

        if (this.initRequestIds.has(requestId)) {
          // Warmup init — don't change status
          return
        }

        if (tab.status === 'connecting') {
          this._setTabStatus(tabId, 'running')
        }
      }

      // Suppress events from init requests
      if (this.initRequestIds.has(requestId)) return

      this.emit('event', tabId, event)
    })

    this.runManager.on('exit', (requestId: string, code: number | null, signal: string | null, sessionId: string | null) => {
      // Clean up per-run token
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }

      const tabId = this._findTabByRequest(requestId)
      const inflight = this.inflightRequests.get(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!
      tab.activeRequestId = null
      tab.runPid = null
      if (sessionId) tab.claudeSessionId = sessionId

      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.resolve()
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      if (code === 0) {
        this._setTabStatus(tabId, 'completed')
      } else if (signal === 'SIGINT' || signal === 'SIGKILL') {
        this._setTabStatus(tabId, 'failed')
      } else {
        const enriched = this.runManager.getEnrichedError(requestId, code)
        this.emit('error', tabId, enriched)
        this._setTabStatus(tabId, code === null ? 'dead' : 'failed')
      }

      if (inflight) {
        inflight.resolve()
        this.inflightRequests.delete(requestId)
      }

      this._processQueue(tabId)
    })

    this.runManager.on('error', (requestId: string, err: Error) => {
      const runToken = this.runTokens.get(requestId)
      if (runToken) {
        this.permissionServer.unregisterRun(runToken)
        this.runTokens.delete(requestId)
      }

      const tabId = this._findTabByRequest(requestId)
      const inflight = this.inflightRequests.get(requestId)

      if (!tabId || !this.tabs.get(tabId)) {
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        return
      }

      const tab = this.tabs.get(tabId)!
      tab.activeRequestId = null
      tab.runPid = null

      if (this.initRequestIds.has(requestId)) {
        this.initRequestIds.delete(requestId)
        this._setTabStatus(tabId, 'idle')
        if (inflight) {
          inflight.reject(err)
          this.inflightRequests.delete(requestId)
        }
        this._processQueue(tabId)
        return
      }

      this._setTabStatus(tabId, 'dead')

      const enriched = this.runManager.getEnrichedError(requestId, null)
      enriched.message = err.message
      this.emit('error', tabId, enriched)

      if (inflight) {
        inflight.reject(err)
        this.inflightRequests.delete(requestId)
      }
    })
  }

  // ─── Tab Lifecycle ───

  createTab(): string {
    const tabId = randomUUID()
    const entry: ClaudeTabRegistryEntry = {
      tabId,
      claudeSessionId: null,
      status: 'idle',
      activeRequestId: null,
      runPid: null,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      promptCount: 0,
    }
    this.tabs.set(tabId, entry)
    debugLog(`ControlPlane: Tab created: ${tabId}`)
    return tabId
  }

  /**
   * Eagerly initialize a session for a tab by running a minimal prompt.
   */
  initSession(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    const requestId = `init-${tabId}`
    this.initRequestIds.add(requestId)

    this.submitPrompt(tabId, requestId, {
      prompt: 'hi',
      projectPath: process.cwd(),
      maxTurns: 1,
    }).catch((err) => {
      this.initRequestIds.delete(requestId)
      debugLog(`ControlPlane: Init session failed for tab ${tabId}: ${(err as Error).message}`)
    })
  }

  resetTabSession(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return
    debugLog(`ControlPlane: Resetting session for tab ${tabId} (was: ${tab.claudeSessionId})`)
    tab.claudeSessionId = null
  }

  setPermissionMode(mode: 'ask' | 'auto'): void {
    debugLog(`ControlPlane: Permission mode set to: ${mode}`)
    this.permissionMode = mode
  }

  closeTab(tabId: string): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    if (tab.activeRequestId) {
      this.cancel(tab.activeRequestId)

      const inflight = this.inflightRequests.get(tab.activeRequestId)
      if (inflight) {
        inflight.reject(new Error('Tab closed'))
        this.inflightRequests.delete(tab.activeRequestId)
      }
    }

    // Remove queued requests for this tab
    this.requestQueue = this.requestQueue.filter((r) => {
      if (r.tabId === tabId) {
        const reason = new Error('Tab closed')
        r.reject(reason)
        for (const w of r.extraWaiters) w.reject(reason)
        return false
      }
      return true
    })

    this.tabs.delete(tabId)
    debugLog(`ControlPlane: Tab closed: ${tabId}`)
  }

  // ─── Submit Prompt ───

  async submitPrompt(
    tabId: string,
    requestId: string,
    options: ClaudeRunOptions,
  ): Promise<void> {
    if (!tabId) {
      throw new Error('No tabId provided')
    }

    const tab = this.tabs.get(tabId)
    if (!tab) {
      throw new Error(`Tab ${tabId} does not exist`)
    }

    // RequestId idempotency
    const existing = this.inflightRequests.get(requestId)
    if (existing) {
      return existing.promise
    }

    const queued = this.requestQueue.find((r) => r.requestId === requestId)
    if (queued) {
      return new Promise<void>((resolve, reject) => {
        queued.extraWaiters.push({ resolve, reject })
      })
    }

    // If tab has an active run, queue the request
    if (tab.activeRequestId) {
      if (this.requestQueue.length >= MAX_QUEUE_DEPTH) {
        throw new Error('Request queue full — back-pressure')
      }

      debugLog(`ControlPlane: Tab ${tabId} busy — queuing request ${requestId}`)
      return new Promise<void>((resolve, reject) => {
        this.requestQueue.push({
          requestId,
          tabId,
          options,
          resolve,
          reject,
          enqueuedAt: Date.now(),
          extraWaiters: [],
        })
      })
    }

    return this._dispatch(tabId, requestId, options)
  }

  private async _dispatch(tabId: string, requestId: string, options: ClaudeRunOptions): Promise<void> {
    const _perfD = Date.now()
    const _pD = (label: string): void => console.error(`[PERF] _dispatch | ${label}: ${Date.now() - _perfD}ms`)
    _pD('entered')
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} disappeared`)

    // Wait for the permission hook server to be ready
    await this.hookServerReady
    _pD('hookServerReady resolved')

    // Use stored session ID for resume if available and not overridden
    if (tab.claudeSessionId && !options.sessionId) {
      options = { ...options, sessionId: tab.claudeSessionId }
    }

    // Per-run token lifecycle — skip the permission hook when full-access,
    // otherwise the PreToolUse hook overrides --dangerously-skip-permissions.
    if (this.permissionServer.getPort() && options.permissionMode !== 'full-access') {
      const runToken = this.permissionServer.registerRun(tabId, requestId, options.sessionId || null)
      this.runTokens.set(requestId, runToken)
      const hookSettingsPath = this.permissionServer.generateSettingsFile(runToken)
      options = { ...options, hookSettingsPath }
    }
    _pD('hook settings generated')

    tab.activeRequestId = requestId
    if (!this.initRequestIds.has(requestId)) tab.promptCount++
    tab.lastActivityAt = Date.now()

    const newStatus: ClaudeTabStatus = tab.claudeSessionId ? 'running' : 'connecting'
    this._setTabStatus(tabId, newStatus)

    let pid: number | null = null
    try {
      const handle = this.runManager.startRun(requestId, options)
      _pD(`process spawned | pid=${handle.pid}`)
      pid = handle.pid
      tab.runPid = pid
    } catch (err) {
      tab.activeRequestId = null
      tab.runPid = null
      this._setTabStatus(tabId, 'failed')
      throw err
    }

    // Create inflight promise
    let resolve!: (value: void) => void
    let reject!: (reason: Error) => void
    const promise = new Promise<void>((res, rej) => {
      resolve = res
      reject = rej
    })

    this.inflightRequests.set(requestId, { requestId, tabId, promise, resolve, reject })
    return promise
  }

  // ─── Cancel ───

  cancel(requestId: string): boolean {
    const queueIdx = this.requestQueue.findIndex((r) => r.requestId === requestId)
    if (queueIdx !== -1) {
      const req = this.requestQueue.splice(queueIdx, 1)[0]
      const reason = new Error('Request cancelled')
      req.reject(reason)
      for (const w of req.extraWaiters) w.reject(reason)
      return true
    }

    return this.runManager.cancel(requestId)
  }

  cancelTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId)
    if (!tab?.activeRequestId) return false
    return this.cancel(tab.activeRequestId)
  }

  // ─── Retry ───

  async retry(tabId: string, requestId: string, options: ClaudeRunOptions): Promise<void> {
    const tab = this.tabs.get(tabId)
    if (!tab) throw new Error(`Tab ${tabId} does not exist`)

    if (tab.status === 'dead') {
      tab.claudeSessionId = null
      this._setTabStatus(tabId, 'idle')
    }

    return this.submitPrompt(tabId, requestId, options)
  }

  // ─── Permission Response ───

  respondToPermission(tabId: string, questionId: string, optionId: string): boolean {
    // Route to hook server if this is a hook-based permission request
    if (questionId.startsWith('hook-')) {
      return this.permissionServer.respondToPermission(questionId, optionId)
    }

    const tab = this.tabs.get(tabId)
    if (!tab?.activeRequestId) return false

    // Stream-json transport: send structured permission response via stdin
    const msg = {
      type: 'permission_response',
      question_id: questionId,
      option_id: optionId,
    }

    return this.runManager.writeToStdin(tab.activeRequestId, msg)
  }

  // ─── Health ───

  getHealth(): ClaudeHealthReport {
    const tabEntries: ClaudeHealthReport['tabs'] = []

    for (const [tabId, tab] of this.tabs) {
      let alive = false
      if (tab.activeRequestId) {
        alive = this.runManager.isRunning(tab.activeRequestId)
      }

      tabEntries.push({
        tabId,
        status: tab.status,
        activeRequestId: tab.activeRequestId,
        claudeSessionId: tab.claudeSessionId,
        alive,
      })
    }

    return {
      tabs: tabEntries,
      queueDepth: this.requestQueue.length,
    }
  }

  getTabStatus(tabId: string): ClaudeTabRegistryEntry | undefined {
    return this.tabs.get(tabId)
  }

  getEnrichedError(requestId: string, exitCode: number | null): EnrichedError {
    return this.runManager.getEnrichedError(requestId, exitCode)
  }

  // ─── Queue Processing ───

  private _processQueue(tabId: string): void {
    const idx = this.requestQueue.findIndex((r) => r.tabId === tabId)
    if (idx === -1) return

    const req = this.requestQueue.splice(idx, 1)[0]
    debugLog(`ControlPlane: Processing queued request ${req.requestId} for tab ${tabId}`)

    this._dispatch(tabId, req.requestId, req.options)
      .then((v) => {
        req.resolve(v)
        for (const w of req.extraWaiters) w.resolve(v)
      })
      .catch((e) => {
        req.reject(e)
        for (const w of req.extraWaiters) w.reject(e)
      })
  }

  // ─── Internal ───

  private _findTabByRequest(requestId: string): string | null {
    const inflight = this.inflightRequests.get(requestId)
    if (inflight) return inflight.tabId

    for (const [tabId, tab] of this.tabs) {
      if (tab.activeRequestId === requestId) return tabId
    }

    return null
  }

  private _setTabStatus(tabId: string, newStatus: ClaudeTabStatus): void {
    const tab = this.tabs.get(tabId)
    if (!tab) return

    const oldStatus = tab.status
    if (oldStatus === newStatus) return

    tab.status = newStatus
    debugLog(`ControlPlane: Tab ${tabId}: ${oldStatus} -> ${newStatus}`)
    this.emit('tab-status-change', tabId, newStatus, oldStatus)
  }

  // ─── Shutdown ───

  shutdown(): void {
    debugLog('ControlPlane: Shutting down')
    this.permissionServer.stop()
    for (const [tabId] of this.tabs) {
      this.closeTab(tabId)
    }
  }
}
