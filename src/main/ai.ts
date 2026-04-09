import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn, type ChildProcessWithoutNullStreams } from 'child_process'
import Anthropic from '@anthropic-ai/sdk'
import { settingsStore } from './store'
import { getCodexModel, getCodexStatus } from './codex-auth'
import { getClaudeStatus } from './claude-auth'

export interface AiStreamCallbacks {
  onToken: (token: string) => void
  onFinish: (fullText: string) => void
  onError: (error: string) => void
  onToolUse?: (toolName: string, toolInput: string) => void
}

const SYSTEM_PROMPT = `You are OmniCue, a concise desktop AI companion. Be helpful, brief, and specific. Prefer bullet points and short paragraphs over walls of text. You may use Markdown formatting: bold, italic, inline code, fenced code blocks with language tags, lists, and headers. Keep formatting purposeful and avoid unnecessary decoration for simple answers.

You may receive a screenshot of the user's screen and extracted text as context with each message. This context is captured automatically — the user may or may not be asking about it. Only reference the screen context if the user's question clearly relates to what's visible. For general questions unrelated to the screen, respond normally without mentioning the screenshot or screen text.`

interface MessagePart {
  type: string
  text?: string
  image_url?: { url: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | MessagePart[]
}

interface PreparedImage {
  path: string
}

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: number
  method: string
  params?: unknown
}

interface SessionState {
  threadId: string
  turnId: string | null
  callbacks: AiStreamCallbacks | null
  accumulatedText: string
  tempImages: PreparedImage[]
}

function getTextContent(content: ChatMessage['content']): string {
  if (typeof content === 'string') return content.trim()

  return content
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text?.trim() || '')
    .filter(Boolean)
    .join('\n')
}

function getImageDataUrl(content: ChatMessage['content']): string | null {
  if (typeof content === 'string') return null

  const imagePart = content.find(
    (part) => part.type === 'image_url' && typeof part.image_url?.url === 'string'
  )
  return imagePart?.image_url?.url || null
}

function normalizeLineBreaks(value: string): string {
  return value.replace(/\r\n/g, '\n').trim()
}

function buildCodexPrompt(messages: ChatMessage[]): string {
  const conversation = messages
    .map((message) => {
      const text = getTextContent(message.content) || '[No text content]'
      const hasImage = Boolean(getImageDataUrl(message.content))
      const role =
        message.role === 'assistant'
          ? 'Assistant'
          : message.role === 'system'
            ? 'System'
            : 'User'

      return `${role}${hasImage ? ' (attached screenshot)' : ''}:\n${normalizeLineBreaks(text)}`
    })
    .join('\n\n')

  return [
    SYSTEM_PROMPT,
    '',
    'You are replying inside a compact desktop chat panel.',
    'Respond to the latest user message, keep the answer concise, and use any attached screenshot as context.',
    '',
    'Conversation:',
    conversation,
  ].join('\n')
}

async function writeDataUrlToTempFile(dataUrl: string): Promise<PreparedImage> {
  const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (!match) {
    throw new Error('Unsupported screenshot format.')
  }

  const mimeType = match[1]
  const base64Payload = match[2]
  const extension =
    mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png'
  const filePath = join(tmpdir(), `omnicue-codex-${randomUUID()}.${extension}`)

  await fs.writeFile(filePath, Buffer.from(base64Payload, 'base64'))
  return { path: filePath }
}

async function cleanupTempImages(images: PreparedImage[]): Promise<void> {
  await Promise.all(
    images.map(async (image) => {
      try {
        await fs.unlink(image.path)
      } catch {
        // Ignore cleanup failures for temp files.
      }
    })
  )
}

function getCodexExecCommand(): { command: string; args: string[] } {
  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', 'codex app-server --listen stdio://'],
    }
  }

  return {
    command: 'codex',
    args: ['app-server', '--listen', 'stdio://'],
  }
}

class CodexAppServerClient {
  private child: ChildProcessWithoutNullStreams | null = null
  private stdoutBuffer = ''
  private nextRequestId = 1
  private initialized = false
  private initPromise: Promise<void> | null = null
  private pending = new Map<number, { resolve: (value: unknown) => void; reject: (error: Error) => void }>()
  private sessions = new Map<string, SessionState>()

  async streamSession(
    sessionId: string,
    messages: ChatMessage[],
    callbacks: AiStreamCallbacks,
    abortSignal?: AbortSignal,
    model?: string
  ): Promise<void> {
    await this.ensureInitialized()

    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    if (!latestUserMessage) {
      throw new Error('No user message to send.')
    }

    const tempImages: PreparedImage[] = []
    const latestImageDataUrl = getImageDataUrl(latestUserMessage.content)
    if (latestImageDataUrl) {
      tempImages.push(await writeDataUrlToTempFile(latestImageDataUrl))
    }

    const threadId = await this.ensureThread(sessionId)
    const session = this.sessions.get(sessionId)
    if (!session) {
      await cleanupTempImages(tempImages)
      throw new Error('Failed to initialize Codex session.')
    }

    if (session.turnId) {
      await cleanupTempImages(tempImages)
      throw new Error('Codex session is already processing a turn.')
    }

    session.callbacks = callbacks
    session.accumulatedText = ''
    session.tempImages = tempImages

    const inputs: Array<{ type: string; text?: string; path?: string }> = []
    const text = getTextContent(latestUserMessage.content)
    if (text) {
      inputs.push({
        type: 'text',
        text: `${SYSTEM_PROMPT}\n\nUser:\n${text}`,
      })
    }

    for (const image of tempImages) {
      inputs.push({
        type: 'localImage',
        path: image.path,
      })
    }

    if (inputs.length === 0) {
      await this.resetSessionTurn(sessionId)
      throw new Error('Nothing to send to Codex.')
    }

    const turnModel = model || resolveBackendModel()

    const turnResponse = (await this.request('turn/start', {
      threadId,
      cwd: process.cwd(),
      approvalPolicy: 'never',
      model: turnModel,
      sandboxPolicy: {
        type: 'readOnly',
        access: { type: 'fullAccess' },
        networkAccess: false,
      },
      input: inputs,
    })) as { turn?: { id?: string } }

    session.turnId = turnResponse.turn?.id || null
    if (!session.turnId) {
      await this.resetSessionTurn(sessionId)
      throw new Error('Codex app server did not return a turn id.')
    }

    const handleAbort = (): void => {
      void this.interruptTurn(sessionId)
    }

    abortSignal?.addEventListener('abort', handleAbort, { once: true })
  }

  removeSession(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (!session) return
    void cleanupTempImages(session.tempImages)
    this.sessions.delete(sessionId)
  }

  async interruptTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session?.turnId) return

    try {
      await this.request('turn/interrupt', {
        threadId: session.threadId,
        turnId: session.turnId,
      })
    } catch {
      // Ignore interrupt failures; the UI already requested cancellation.
    }
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = (async () => {
      this.startProcess()
      await this.request('initialize', {
        clientInfo: { name: 'omniox', version: '1.0.0' },
        capabilities: { experimentalApi: true },
      })
      this.notify('initialized')
      this.initialized = true
    })()

    try {
      await this.initPromise
    } finally {
      this.initPromise = null
    }
  }

  private startProcess(): void {
    if (this.child) return

    const { command, args } = getCodexExecCommand()
    const child = spawn(command, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    })

    this.child = child
    this.stdoutBuffer = ''

    child.stdout.on('data', (chunk: Buffer) => {
      this.stdoutBuffer += chunk.toString('utf8')
      const lines = this.stdoutBuffer.split(/\r?\n/)
      this.stdoutBuffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) continue
        this.handleLine(trimmed)
      }
    })

    child.stderr.on('data', () => {
      // Ignore Codex CLI warnings on stderr; protocol data is on stdout.
    })

    child.on('error', (error) => {
      this.rejectPending(error instanceof Error ? error : new Error(String(error)))
      this.failAllSessions(error instanceof Error ? error.message : String(error))
      this.child = null
      this.initialized = false
    })

    child.on('close', () => {
      this.rejectPending(new Error('Codex app server exited unexpectedly.'))
      this.failAllSessions('Codex app server exited unexpectedly.')
      this.child = null
      this.initialized = false
    })
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    if (typeof message.id === 'number') {
      const pending = this.pending.get(message.id)
      if (!pending) return

      this.pending.delete(message.id)
      if ('error' in message && message.error) {
        pending.reject(new Error(this.extractRpcError(message.error)))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    const method = typeof message.method === 'string' ? message.method : ''
    const params = (message.params as Record<string, unknown> | undefined) || {}

    if (method === 'item/agentMessage/delta') {
      const turnId = typeof params.turnId === 'string' ? params.turnId : ''
      const delta = typeof params.delta === 'string' ? params.delta : ''
      const session = this.findSessionByTurnId(turnId)
      if (!session || !delta) return

      session.accumulatedText += delta
      session.callbacks?.onToken(delta)
      return
    }

    if (method === 'item/completed') {
      const turnId = typeof params.turnId === 'string' ? params.turnId : ''
      const item = (params.item as Record<string, unknown> | undefined) || {}
      if (item.type !== 'agentMessage') return

      const session = this.findSessionByTurnId(turnId)
      if (!session) return

      const text = typeof item.text === 'string' ? item.text : session.accumulatedText
      if (!session.accumulatedText && text) {
        session.callbacks?.onToken(text)
      }
      session.callbacks?.onFinish(text)
      void this.resetSessionTurnByTurnId(turnId)
      return
    }

    if (method === 'turn/completed') {
      const turn = (params.turn as Record<string, unknown> | undefined) || {}
      const turnId = typeof turn.id === 'string' ? turn.id : ''
      const status = typeof turn.status === 'string' ? turn.status : ''
      const session = this.findSessionByTurnId(turnId)
      if (!session) return

      if (status === 'failed') {
        const error = (turn.error as Record<string, unknown> | undefined) || {}
        const messageText =
          typeof error.message === 'string' ? error.message : 'Codex turn failed.'
        session.callbacks?.onError(messageText)
        void this.resetSessionTurnByTurnId(turnId)
      }

      if (status === 'interrupted') {
        void this.resetSessionTurnByTurnId(turnId)
      }
      return
    }

    if (method === 'error') {
      const turnId = typeof params.turnId === 'string' ? params.turnId : ''
      const session = this.findSessionByTurnId(turnId)
      if (!session) return

      const error = (params.error as Record<string, unknown> | undefined) || {}
      const messageText =
        typeof error.message === 'string' ? error.message : 'Codex request failed.'
      session.callbacks?.onError(messageText)
      void this.resetSessionTurnByTurnId(turnId)
    }
  }

  private extractRpcError(error: unknown): string {
    if (!error || typeof error !== 'object') return 'Codex app server request failed.'
    const maybeMessage = (error as Record<string, unknown>).message
    return typeof maybeMessage === 'string' ? maybeMessage : 'Codex app server request failed.'
  }

  private async ensureThread(sessionId: string): Promise<string> {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing.threadId

    const threadModel = resolveBackendModel()
    const response = (await this.request('thread/start', {
      cwd: process.cwd(),
      approvalPolicy: 'never',
      sandbox: 'read-only',
      model: threadModel,
      ephemeral: true,
    })) as { thread?: { id?: string } }

    const threadId = response.thread?.id
    if (!threadId) {
      throw new Error('Codex app server did not return a thread id.')
    }

    this.sessions.set(sessionId, {
      threadId,
      turnId: null,
      callbacks: null,
      accumulatedText: '',
      tempImages: [],
    })

    return threadId
  }

  private findSessionByTurnId(turnId: string): SessionState | null {
    for (const session of this.sessions.values()) {
      if (session.turnId === turnId) return session
    }
    return null
  }

  private async resetSessionTurn(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId)
    if (!session) return

    const images = session.tempImages
    session.turnId = null
    session.callbacks = null
    session.accumulatedText = ''
    session.tempImages = []
    await cleanupTempImages(images)
  }

  private async resetSessionTurnByTurnId(turnId: string): Promise<void> {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.turnId === turnId) {
        await this.resetSessionTurn(sessionId)
        return
      }
    }
  }

  private failAllSessions(message: string): void {
    for (const session of this.sessions.values()) {
      session.callbacks?.onError(message)
      void cleanupTempImages(session.tempImages)
    }
    this.sessions.clear()
  }

  private rejectPending(error: Error): void {
    for (const [id, pending] of this.pending.entries()) {
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  private request(method: string, params?: unknown): Promise<unknown> {
    this.startProcess()

    const id = this.nextRequestId++
    const payload: JsonRpcRequest = { jsonrpc: '2.0', id, method, params }

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.child?.stdin.write(`${JSON.stringify(payload)}\n`)
    })
  }

  private notify(method: string, params?: unknown): void {
    this.startProcess()
    const payload: JsonRpcRequest = { jsonrpc: '2.0', method, params }
    this.child?.stdin.write(`${JSON.stringify(payload)}\n`)
  }
}

const codexAppServerClient = new CodexAppServerClient()

/** Clean up a specific session's resources (call when UI starts a new session) */
export function cleanupSession(sessionId: string): void {
  codexAppServerClient.removeSession(sessionId)
}

/** Clean up all temp images on app exit */
export async function cleanupAllTempImages(): Promise<void> {
  const { readdirSync, unlinkSync } = await import('fs')
  const { tmpdir: getTmpdir } = await import('os')
  try {
    const tmp = getTmpdir()
    const files = readdirSync(tmp).filter((f) => f.startsWith('omnicue-codex-'))
    for (const file of files) {
      try { unlinkSync(join(tmp, file)) } catch { /* best effort */ }
    }
  } catch { /* best effort */ }
}

function getCodexCliCommand(model: string, images: PreparedImage[]): { command: string; args: string[] } {
  const baseArgs = [
    'exec',
    '--json',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--model',
    model,
  ]

  for (const image of images) {
    baseArgs.push('--image', image.path)
  }

  baseArgs.push('-')

  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `codex ${baseArgs.map(quoteForCmd).join(' ')}`],
    }
  }

  return { command: 'codex', args: baseArgs }
}

function quoteForCmd(value: string): string {
  if (!/[ \t"]/.test(value)) return value
  return `"${value.replace(/"/g, '""')}"`
}

async function streamViaCodexCliFallback(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  modelOverride?: string
): Promise<void> {
  const model = modelOverride || resolveBackendModel()
  const prompt = buildCodexPrompt(messages)
  const latestImageDataUrl = [...messages]
    .reverse()
    .map((message) => getImageDataUrl(message.content))
    .find((value): value is string => Boolean(value))

  const tempImages: PreparedImage[] = []
  if (latestImageDataUrl) {
    tempImages.push(await writeDataUrlToTempFile(latestImageDataUrl))
  }

  const { command, args } = getCodexCliCommand(model, tempImages)

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let finalText = ''

  const handleAbort = (): void => {
    try {
      child.kill()
    } catch {
      // Ignore abort race conditions.
    }
  }

  abortSignal?.addEventListener('abort', handleAbort, { once: true })
  child.stdin.end(prompt)

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue

      try {
        const event = JSON.parse(trimmed) as {
          type?: string
          item?: { type?: string; text?: string }
        }

        if (event.type === 'item.completed' && event.item?.type === 'agent_message') {
          finalText = event.item.text || ''
        }
      } catch {
        // Ignore malformed non-event lines.
      }
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8')
  })

  return new Promise((resolve, reject) => {
    child.on('error', async (error) => {
      abortSignal?.removeEventListener('abort', handleAbort)
      await cleanupTempImages(tempImages)
      reject(error)
    })

    child.on('close', async (code) => {
      abortSignal?.removeEventListener('abort', handleAbort)
      await cleanupTempImages(tempImages)

      if (abortSignal?.aborted) {
        resolve()
        return
      }

      if (finalText) {
        callbacks.onToken(finalText)
        callbacks.onFinish(finalText)
        resolve()
        return
      }

      const stderrSummary = stderrBuffer
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .filter((line) => !line.includes('failed to open state db'))
        .filter((line) => !line.includes('failed to initialize state runtime'))
        .filter((line) => !line.includes('shell snapshot'))
        .join('\n')

      reject(new Error(stderrSummary || `Codex exited without a response (code ${code ?? 'unknown'}).`))
    })
  })
}

async function streamViaOpenAiApi(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  modelOverride?: string
): Promise<void> {
  const settings = settingsStore.get()
  const apiKey = settings.aiApiKey || ''
  const model = modelOverride || settings.aiModel || 'gpt-4o'
  const baseURL = settings.aiBaseUrl || 'https://api.openai.com/v1'

  if (!apiKey) {
    throw new Error(
      'No AI provider configured. Sign in with Codex CLI (run "codex login") or set an OpenAI API key in Settings.'
    )
  }

  const apiMessages: ChatMessage[] = [{ role: 'system', content: SYSTEM_PROMPT }, ...messages]
  const res = await fetch(`${baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: apiMessages,
      stream: true,
    }),
    signal: abortSignal,
  })

  if (!res.ok) {
    const body = await res.text()
    let errorMsg = `API error ${res.status}`
    try {
      const parsed = JSON.parse(body)
      errorMsg = parsed.error?.message || errorMsg
    } catch {
      // Use the default status-based error.
    }
    throw new Error(errorMsg)
  }

  const reader = res.body?.getReader()
  if (!reader) {
    throw new Error('No response stream')
  }

  const decoder = new TextDecoder()
  let fullText = ''
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('data: ')) continue

      const data = trimmed.slice(6)
      if (data === '[DONE]') continue

      try {
        const parsed = JSON.parse(data)
        const delta = parsed.choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          callbacks.onToken(delta)
        }
      } catch {
        // Ignore malformed SSE chunks.
      }
    }
  }

  callbacks.onFinish(fullText)
}

/** Convert OpenAI-shaped messages to Anthropic format */
function toAnthropicMessages(
  messages: ChatMessage[]
): Anthropic.MessageParam[] {
  return messages
    .filter((m) => m.role !== 'system')
    .map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role as 'user' | 'assistant', content: m.content }
      }

      // Multi-part: convert image_url + text to Anthropic content blocks
      const blocks: Anthropic.ContentBlockParam[] = []
      for (const part of m.content) {
        if (part.type === 'text' && part.text) {
          blocks.push({ type: 'text', text: part.text })
        } else if (part.type === 'image_url' && part.image_url?.url) {
          const dataUrl = part.image_url.url
          const match = dataUrl.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
          if (match) {
            blocks.push({
              type: 'image',
              source: {
                type: 'base64',
                media_type: match[1] as 'image/jpeg' | 'image/png' | 'image/gif' | 'image/webp',
                data: match[2],
              },
            })
          }
        }
      }

      if (blocks.length === 0) {
        blocks.push({ type: 'text', text: '[No content]' })
      }

      return { role: m.role as 'user' | 'assistant', content: blocks }
    })
}

async function streamViaClaudeApi(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  modelOverride?: string
): Promise<void> {
  const settings = settingsStore.get()
  const apiKey = settings.claudeApiKey || ''
  const model = modelOverride || settings.claudeModel || 'claude-sonnet-4-6-20250514'

  if (!apiKey) {
    throw new Error(
      'No Claude API key configured. Add your Anthropic API key in Settings → AI Settings.'
    )
  }

  const client = new Anthropic({ apiKey })
  const anthropicMessages = toAnthropicMessages(messages)

  let fullText = ''

  const stream = await client.messages.stream({
    model,
    max_tokens: 4096,
    system: SYSTEM_PROMPT,
    messages: anthropicMessages,
  }, { signal: abortSignal ?? undefined })

  for await (const event of stream) {
    if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
      const delta = event.delta.text
      fullText += delta
      callbacks.onToken(delta)
    }
  }

  callbacks.onFinish(fullText)
}

function getClaudeCliCommand(): { command: string; args: string[] } {
  const baseArgs = [
    '-p',               // print mode (non-interactive)
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]

  if (process.platform === 'win32') {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/d', '/s', '/c', `claude ${baseArgs.map(quoteForCmd).join(' ')}`],
    }
  }

  return { command: 'claude', args: baseArgs }
}

async function streamViaClaudeCodeCli(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  _modelOverride?: string
): Promise<void> {
  // Claude Code CLI doesn't support --image, so we pass context as text only
  const prompt = buildCodexPrompt(messages)

  const { command, args } = getClaudeCliCommand()

  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  })

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let fullText = ''
  // Track current tool use being streamed
  let currentToolName: string | null = null
  let currentToolInput = ''

  const handleAbort = (): void => {
    try {
      child.kill()
    } catch {
      // Ignore abort race conditions.
    }
  }

  abortSignal?.addEventListener('abort', handleAbort, { once: true })
  child.stdin.end(prompt)

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>

        if (event.type === 'stream_event') {
          const inner = event.event as Record<string, unknown> | undefined
          if (!inner) continue

          // Text streaming delta
          if (inner.type === 'content_block_delta') {
            const delta = inner.delta as Record<string, unknown> | undefined
            if (delta?.type === 'text_delta' && typeof delta.text === 'string') {
              fullText += delta.text
              callbacks.onToken(delta.text)
            }
            // Tool input JSON delta — accumulate
            if (delta?.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              currentToolInput += delta.partial_json
            }
          }

          // Tool use start
          if (inner.type === 'content_block_start') {
            const block = inner.content_block as Record<string, unknown> | undefined
            if (block?.type === 'tool_use' && typeof block.name === 'string') {
              currentToolName = block.name
              currentToolInput = ''
            }
          }

          // Tool use end — emit the completed tool call
          if (inner.type === 'content_block_stop' && currentToolName) {
            // Try to extract a concise summary from the JSON input
            let summary = currentToolInput
            try {
              const parsed = JSON.parse(currentToolInput)
              // For common tools, pick the most useful field
              summary = parsed.command || parsed.pattern || parsed.file_path || parsed.content?.slice(0, 80) || currentToolInput
            } catch {
              // Use raw input if not valid JSON
            }
            callbacks.onToolUse?.(currentToolName, summary)
            currentToolName = null
            currentToolInput = ''
          }
        }

        // Final result
        if (event.type === 'result' && typeof event.result === 'string') {
          fullText = event.result
        }
      } catch {
        // Ignore malformed lines
      }
    }
  })

  child.stderr.on('data', (chunk: Buffer) => {
    stderrBuffer += chunk.toString('utf8')
  })

  return new Promise((resolve, reject) => {
    child.on('error', (error) => {
      abortSignal?.removeEventListener('abort', handleAbort)
      reject(error)
    })

    child.on('close', (code) => {
      abortSignal?.removeEventListener('abort', handleAbort)

      if (abortSignal?.aborted) {
        resolve()
        return
      }

      if (fullText) {
        callbacks.onFinish(fullText)
        resolve()
        return
      }

      const stderrSummary = stderrBuffer
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .join('\n')

      reject(new Error(stderrSummary || `Claude Code exited without a response (code ${code ?? 'unknown'}).`))
    })
  })
}

function resolveBackendModel(modelOverride?: string): string {
  if (modelOverride) return modelOverride
  const settings = settingsStore.get()
  return settings.aiModel.trim() || getCodexModel() || 'gpt-5.4'
}

export async function streamAiResponse(
  sessionId: string,
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  modelOverride?: string,
  provider?: string
): Promise<void> {
  const settings = settingsStore.get()
  const resolvedProvider = provider || settings.aiProvider || 'codex'
  const model = modelOverride || resolveBackendModel()
  console.log(`[OmniCue] Provider: ${resolvedProvider}, Model: ${model}`)

  // Claude provider — try Claude Code CLI first (uses Max subscription), fall back to Anthropic API
  if (resolvedProvider === 'claude') {
    const claudeStatus = getClaudeStatus()

    if (claudeStatus.authenticated) {
      // Tier 1: Claude Code CLI (uses Max/Pro subscription)
      try {
        await streamViaClaudeCodeCli(messages, callbacks, abortSignal, model)
        return
      } catch (cliErr) {
        const cliMsg = cliErr instanceof Error ? cliErr.message : String(cliErr)
        console.warn('[OmniCue] Claude Code CLI failed, trying Anthropic API fallback:', cliMsg)

        if (!settings.claudeApiKey) {
          callbacks.onError(`Claude Code CLI failed: ${cliMsg}`)
          return
        }
        // Fall through to Anthropic API
      }
    }

    // Tier 2: Direct Anthropic API (requires API key)
    try {
      await streamViaClaudeApi(messages, callbacks, abortSignal, model)
    } catch (error) {
      if (abortSignal?.aborted) return
      callbacks.onError(error instanceof Error ? error.message : String(error))
    }
    return
  }

  // OpenAI provider — direct API (no Codex)
  if (resolvedProvider === 'openai') {
    try {
      await streamViaOpenAiApi(messages, callbacks, abortSignal, model)
    } catch (error) {
      if (abortSignal?.aborted) return
      callbacks.onError(error instanceof Error ? error.message : String(error))
    }
    return
  }

  // Codex provider (default) — tiered fallback
  const codexStatus = getCodexStatus()

  if (codexStatus.authenticated) {
    // Tier 1: Codex app-server (JSON-RPC subprocess)
    try {
      await codexAppServerClient.streamSession(sessionId, messages, callbacks, abortSignal, model)
      return
    } catch (appServerErr) {
      const appMsg = appServerErr instanceof Error ? appServerErr.message : String(appServerErr)
      console.warn('[OmniCue] Codex app-server failed, trying CLI fallback:', appMsg)

      // Tier 2: Codex CLI fallback
      try {
        await streamViaCodexCliFallback(messages, callbacks, abortSignal, model)
        return
      } catch (cliErr) {
        const cliMsg = cliErr instanceof Error ? cliErr.message : String(cliErr)
        console.warn('[OmniCue] Codex CLI fallback failed:', cliMsg)

        if (!settings.aiApiKey) {
          callbacks.onError(`Codex connection failed: ${cliMsg}`)
          return
        }
        // Fall through to OpenAI API
      }
    }
  }

  // Tier 3: Direct OpenAI API (requires manual API key)
  try {
    await streamViaOpenAiApi(messages, callbacks, abortSignal, model)
  } catch (error) {
    if (abortSignal?.aborted) return
    callbacks.onError(error instanceof Error ? error.message : String(error))
  }
}
