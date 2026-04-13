import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn, execSync, type ChildProcessWithoutNullStreams } from 'child_process'
import { existsSync } from 'fs'
import { homedir } from 'os'
import Anthropic from '@anthropic-ai/sdk'
import { settingsStore } from './store'
import { getCodexStatus } from './codex-auth'
import { getClaudeStatus } from './claude-auth'
import { loadConversation } from './conversations'
import { generateResumeGraft } from './session-memory/graft'
import { collectSnapshot } from './context/collector'
import {
  registerPendingRequest,
  normalizeCodexCommandApproval,
  normalizeCodexFileChangeApproval,
  normalizeCodexUserInput,
  normalizeCodexUnsupported,
} from './agent-interactions'

export interface AiStreamCallbacks {
  onToken: (token: string) => void
  onFinish: (fullText: string) => void
  onError: (error: string) => void
  onToolUse?: (toolName: string, toolInput: string) => void
  onInteractionRequest?: (request: import('./agent-interactions').AgentInteractionRequest) => void
  /** Emitted when a provider is performing session initialization (e.g. Codex subprocess + thread setup) */
  onInitializing?: () => void
}

// ── Process tree kill ────────────────────────────────────────────────────────
// On Windows, child.kill() only kills the immediate process (cmd.exe), leaving
// grandchild processes (claude, codex) alive as orphans that hold lock files.
// This helper kills the entire process tree via taskkill /T /F.

/** Set of active child PIDs for cleanup on app exit. */
export const activeChildPids = new Set<number>()

function killProcessTree(child: ChildProcessWithoutNullStreams): void {
  if (process.platform === 'win32' && child.pid) {
    try {
      spawn('taskkill', ['/T', '/F', '/PID', String(child.pid)], {
        windowsHide: true,
        stdio: 'ignore',
      })
    } catch { /* best effort */ }
  } else {
    try { child.kill() } catch { /* best effort */ }
  }
  if (child.pid) activeChildPids.delete(child.pid)
}

function trackChild(child: ChildProcessWithoutNullStreams): void {
  if (child.pid) activeChildPids.add(child.pid)
  child.on('close', () => { if (child.pid) activeChildPids.delete(child.pid) })
}

// ── CLI path resolution ──────────────────────────────────────────────────────
// Resolve the actual binary path for CLI tools so we can spawn them directly
// instead of going through cmd.exe (which breaks process tree kill on Windows).

const cliPathCache = new Map<string, string | null>()

function resolveCliPath(name: string): string | null {
  if (cliPathCache.has(name)) return cliPathCache.get(name) || null

  const home = homedir()
  const knownLocations: Record<string, string[]> = {
    claude: [
      join(home, '.local', 'bin', 'claude.exe'),
      join(home, '.local', 'bin', 'claude'),
      join(home, 'AppData', 'Roaming', 'npm', 'claude.cmd'),
    ],
    codex: [
      join(home, 'AppData', 'Roaming', 'npm', 'codex.cmd'),
      join(home, '.local', 'bin', 'codex.exe'),
      join(home, '.local', 'bin', 'codex'),
    ],
    opencode: [
      join(home, 'AppData', 'Roaming', 'npm', 'opencode.cmd'),
      join(home, '.local', 'bin', 'opencode.exe'),
      join(home, '.local', 'bin', 'opencode'),
    ],
  }

  // Check known locations first
  for (const loc of knownLocations[name] || []) {
    if (existsSync(loc)) {
      cliPathCache.set(name, loc)
      return loc
    }
  }

  // Fall back to system lookup
  try {
    const cmd = process.platform === 'win32' ? `where ${name}` : `which ${name}`
    const result = execSync(cmd, { encoding: 'utf-8', timeout: 5000, windowsHide: true }).trim()
    const firstLine = result.split(/\r?\n/)[0]?.trim() || null
    cliPathCache.set(name, firstLine)
    return firstLine
  } catch {
    cliPathCache.set(name, null)
    return null
  }
}

/**
 * Build a spawn command that avoids cmd.exe when possible.
 * For .exe files, spawns directly. For .cmd shims, uses shell: true (no /d flag).
 */
function buildDirectSpawn(name: string, args: string[]): { command: string; args: string[]; options: { shell?: boolean } } {
  const resolved = resolveCliPath(name)

  if (resolved) {
    // .cmd/.bat files need shell execution
    if (/\.(cmd|bat)$/i.test(resolved)) {
      return { command: resolved, args, options: { shell: true } }
    }
    // .exe or extensionless binary — spawn directly
    return { command: resolved, args, options: {} }
  }

  // Not found in known locations — fall back to shell: true which does PATH lookup
  // without the /d flag (so AutoRun can extend PATH if needed)
  return { command: name, args, options: { shell: true } }
}

const SYSTEM_PROMPT = `You are OmniCue, a concise desktop AI companion. Be helpful, brief, and specific. Prefer bullet points and short paragraphs over walls of text. You may use Markdown formatting: bold, italic, inline code, fenced code blocks with language tags, lists, and headers. Keep formatting purposeful and avoid unnecessary decoration for simple answers.

When you need to use a tool or endpoint to answer a question, call it BEFORE writing any response text. Do not output partial labels, headers, or filler words while waiting for tool results. Fetch the data first, then write your full response.

You may receive structured desktop context with each message inside <desktop-context> tags. This includes:
- app: The application the user is currently working in (e.g. "Visual Studio Code", "Google Chrome")
- process: The OS process name
- windowTitle: The full window title (often contains the current file, project, URL, etc.)
- screenType: Classified category — code, terminal, chat, email, article, browser, document, dashboard, form
- clipboard: The user's current clipboard contents (truncated)
- screenText: OCR-extracted text visible on screen

You may also receive a screenshot image alongside the text context.

This context is captured automatically — the user may or may not be asking about it. Use the app name and window title to give contextually aware responses (e.g. knowing which file or project the user has open). Only reference the desktop context if the user's question relates to what they're working on. For general questions, respond normally.`

const CODEX_INTERACTION_INSTRUCTIONS = `OmniCue supports interactive requests from Codex.

When you need the user to explicitly choose, confirm, or fill in information before you can continue, use the built-in interactive request path instead of simulating it in plain text.

Use an interactive request when:
- you want the user to choose from a short list of options
- you need one or more follow-up questions answered before continuing
- you need explicit confirmation before taking an action
- you need freeform or secret input from the user

Do not fake interactivity by printing "A, B, C, D" or by asking the user to reply with an option when the interactive request path would fit.

Never claim that you are using the interactive UI unless you actually send a real interactive request through the Codex interaction path.

If the user does not need to respond for you to continue, answer normally in chat.`

const NON_INTERACTIVE_SESSION_INSTRUCTIONS = `This session cannot open OmniCue's native interactive picker UI.

If you need the user to choose, confirm, or provide input, ask in normal chat text instead of claiming that you opened a picker, chooser, or approval dialog.

Do not say that you are "using the interactive picker" or "waiting on the UI" in this session.`

const DESKTOP_TOOLS_PROMPT = `## OmniCue Desktop Tools

When shell access is available, you can query the user's desktop through OmniCue's local HTTP API:

- \`curl.exe -s http://127.0.0.1:19191/displays\` - list connected displays and the current one
- \`curl.exe -s http://127.0.0.1:19191/context\` - active app and window title
- \`curl.exe -s "http://127.0.0.1:19191/context?includeClipboard=1"\` - same, plus clipboard when needed
- \`curl.exe -s http://127.0.0.1:19191/snapshot\` - richer desktop snapshot with parsed IDE, terminal, browser, and system context
- \`curl.exe -s "http://127.0.0.1:19191/snapshot?includeClipboard=1"\` - richer snapshot plus clipboard
- \`curl.exe -s http://127.0.0.1:19191/screen-text\` - OCR text from the display OmniCue is currently on
- \`curl.exe -s "http://127.0.0.1:19191/screen-text?display=<id>"\` - OCR text from a specific display

Use /screen-text for most desktop questions. Use /snapshot when you need structured desktop state such as the current project folder or terminal shell. Use /displays first if the user mentions another monitor. Only request clipboard when it is directly relevant.

## Browser Enrichment Tools

When the active window is a browser, these endpoints provide structured access to the page without needing OCR:

- \`curl.exe -s http://127.0.0.1:19191/browser/url\` — current page URL from address bar
- \`curl.exe -s http://127.0.0.1:19191/browser/page\` — full structured content (title, headings, article, links)
- \`curl.exe -s http://127.0.0.1:19191/browser/readable\` — clean readable article text, optimized for summarization
- \`curl.exe -s http://127.0.0.1:19191/browser/headings\` — page heading structure
- \`curl.exe -s http://127.0.0.1:19191/browser/links\` — all links on the page
- \`curl.exe -s http://127.0.0.1:19191/browser/fonts\` — identify all fonts used on the page
- \`curl.exe -s http://127.0.0.1:19191/browser/selection\` — currently selected text

All content endpoints accept an optional \`?url=...\` parameter to operate on a specific URL without requiring the browser to be focused.

**Important: When the user asks about fonts, typography, page content, article text, or links on a webpage, call the appropriate /browser/ endpoint FIRST before writing any response text.** Do not start typing partial answers or labels — fetch the data, then respond with the results. Use /browser/readable instead of /screen-text when the user asks to summarize or analyze a webpage. Use /browser/fonts when the user asks about typography, fonts, or design of a page.

## OmniCue App Pack Tools

You can inspect the active application pack through OmniCue's local API:

- \`curl.exe -s http://127.0.0.1:19191/pack-tools\` - list available app packs
- \`curl.exe -s http://127.0.0.1:19191/pack-tools/active\` - get the active pack with structured metadata (file name, project, browser site, etc.)

Use /pack-tools/active when you need app-specific context beyond the current desktop-context block.

## OmniCue App Actions

You can take actions on the user's desktop through OmniCue's action API at http://127.0.0.1:19191.

### Listing actions
\`curl.exe -s http://127.0.0.1:19191/actions\`

### Executing an action (PowerShell)
Use Invoke-RestMethod to avoid quoting issues:
\`\`\`powershell
$body = @{ actionId = "clipboard-write"; params = @{ text = "hello" } } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body
\`\`\`

### Resolving natural-language desktop commands
When the user gives a desktop command in natural language, prefer the intent endpoint first:
\`\`\`powershell
$body = @{ utterance = "open the folder for this project" } | ConvertTo-Json
Invoke-RestMethod -Uri http://127.0.0.1:19191/intent -Method Post -ContentType "application/json" -Body $body
\`\`\`

- \`/intent\` uses the current desktop snapshot plus the registered OmniCue actions to build an action plan
- Safe actions auto-execute by default
- Guided or dangerous actions return a plan instead of executing
- Pass \`execute = $false\` if you want the plan without execution

### Action tiers
- **safe** — executes immediately: clipboard-write, open-url, open-file, reveal-in-folder, save-note, list-notes, get-note, delete-note, set-reminder, search-web, find-file, list-running-apps, browser-url, browser-page-content, browser-readable, browser-headings, browser-links, browser-fonts, browser-selected-text
- **guided** — executes with a brief indicator: type-text, press-key, click-element, switch-app, browser-back, browser-forward, browser-refresh, browser-focus-address-bar, browser-copy-url, browser-selected-text-capture, browser-font-download
- **dangerous** — requires explicit user confirmation: delete-file, send-input, submit-form

### Copy-pasteable examples (PowerShell)
\`\`\`powershell
# Copy to clipboard
$body = @{ actionId = "clipboard-write"; params = @{ text = "hello" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Open URL
$body = @{ actionId = "open-url"; params = @{ url = "https://example.com" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Type into focused field
$body = @{ actionId = "type-text"; params = @{ text = "Hello world" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Press keyboard shortcut
$body = @{ actionId = "press-key"; params = @{ keys = "ctrl+s" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Click UI element by name
$body = @{ actionId = "click-element"; params = @{ name = "Save" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Click at screen coordinates
$body = @{ actionId = "click-element"; params = @{ x = 500; y = 300 } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Switch to app
$body = @{ actionId = "switch-app"; params = @{ processName = "chrome" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Save a note
$body = @{ actionId = "save-note"; params = @{ text = "Remember this"; title = "My Note" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body
\`\`\`

For dangerous actions, the request blocks until the user approves or denies. Check the \`ok\` field in the response.
Use /snapshot, /context, or /screen-text first to understand the screen before acting.

### Agent notes
OmniCue stores notes as markdown under ~/OmniCue/notes/.

- \`curl.exe -s http://127.0.0.1:19191/notes\` — list saved notes
- \`curl.exe -s "http://127.0.0.1:19191/notes?id=<id>"\` — read a note

You can also use actions: save-note, list-notes, get-note, delete-note.

## Session Memory

OmniCue tracks what the user was doing across conversations (active app, open files, browser tabs, agent state).

- \`curl.exe -s http://127.0.0.1:19191/session-memory\` — recent session overviews
- \`curl.exe -s "http://127.0.0.1:19191/session-memory?app=Chrome&tags=article"\` — find browser sessions
- \`curl.exe -s "http://127.0.0.1:19191/session-memory?conversationId=<id>&limit=20"\` — detailed session timeline
- \`curl.exe -s "http://127.0.0.1:19191/session-memory?summaryOnly=1"\` — compact list
- \`curl.exe -s "http://127.0.0.1:19191/session-memory/capsule?conversationId=<id>"\` — resume capsule for a conversation
- \`curl.exe -s http://127.0.0.1:19191/session-memory/sessions\` — list all tracked sessions

Use session memory when the user asks to resume work, recall what they were doing, or reference something from a previous session.

## Terminal Bridge

When the active window is a terminal, these endpoints provide structured access to terminal state:

- \`curl.exe -s http://127.0.0.1:19191/terminal/buffer\` — read visible terminal text and scrollback
- \`curl.exe -s http://127.0.0.1:19191/terminal/cwd\` — current working directory and project root
- \`curl.exe -s http://127.0.0.1:19191/terminal/processes\` — running commands and recent command history
- \`curl.exe -s "http://127.0.0.1:19191/terminal/logs?path=/path/to/file.log&lines=100&pattern=ERROR"\` — tail a log file with filtering
- \`curl.exe -s "http://127.0.0.1:19191/terminal/scripts?cwd=/path/to/project"\` — detect project scripts (package.json, Makefile, etc.)
- \`curl.exe -s http://127.0.0.1:19191/terminal/git-status\` — git branch, staged, unstaged, untracked
- \`curl.exe -s http://127.0.0.1:19191/terminal/git-diff\` — uncommitted changes as unified diff
- \`curl.exe -s "http://127.0.0.1:19191/terminal/git-log?count=10"\` — recent commit history
- \`curl.exe -s http://127.0.0.1:19191/terminal/error-packet\` — rich error context (error + stack trace + source + git diff)
- \`curl.exe -X POST http://127.0.0.1:19191/terminal/parse-stacktrace -H "Content-Type: application/json" -d '{"text":"auto"}'\` — parse stack trace from terminal buffer

Git and script endpoints accept \`?cwd=...\` to target a specific directory. If omitted, they use the active terminal's cwd.

**Important: Use /terminal/error-packet when the user has an error visible in their terminal.** It provides much richer context than just reading the screen.

## IDE Bridge

When the active window is an IDE, these endpoints provide editor state:

- \`curl.exe -s http://127.0.0.1:19191/ide/state\` — editor, workspace, open file, language, dirty state
- \`curl.exe -s http://127.0.0.1:19191/ide/selection\` — selected text via UI Automation (best-effort)

For actions that modify state (opening files, capturing selections via clipboard, running scripts), use the action system:

\`\`\`powershell
# Open file at line in editor
$body = @{ actionId = "ide-open-file"; params = @{ file = "C:\\path\\to\\file.ts"; line = 42 } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Jump from stack trace to source (parses trace + opens top project frame)
$body = @{ actionId = "ide-jump-to-frame"; params = @{ text = "auto" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Capture editor selection via clipboard dance (guided tier)
$body = @{ actionId = "ide-capture-selection"; params = @{} } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body

# Run project script (dangerous tier — requires user confirmation)
$body = @{ actionId = "terminal-run-script"; params = @{ script = "test" } } | ConvertTo-Json; Invoke-RestMethod -Uri http://127.0.0.1:19191/action -Method Post -ContentType "application/json" -Body $body
\`\`\`

### Updated action tiers
- **safe** — terminal-read-buffer, terminal-get-cwd, terminal-list-processes, terminal-tail-logs, terminal-list-scripts, terminal-parse-stacktrace, terminal-git-status, terminal-git-diff, terminal-git-log, terminal-error-packet, ide-get-state, ide-read-selection (plus all previous safe actions)
- **guided** — ide-capture-selection, ide-open-file, ide-jump-to-frame (plus all previous guided actions)
- **dangerous** — terminal-run-script (plus all previous dangerous actions)`

function getCodexSystemPrompt(): string {
  return `${SYSTEM_PROMPT}\n\n${CODEX_INTERACTION_INSTRUCTIONS}`
}

interface MessagePart {
  type: string
  text?: string
  image_url?: { url: string }
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: string | MessagePart[]
  ocrText?: string
  screenshotTitle?: string
  manualScreenshotTitle?: string
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
  cwd: string
  permissions: AgentPermissions
  /** Track the current assistant item to detect multi-item turns */
  currentItemId: string | null
  /** How many assistant items have completed in this turn */
  completedItemCount: number
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

function buildPrompt(messages: ChatMessage[], systemPrompt: string): string {
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
    systemPrompt,
    '',
    'You are replying inside a compact desktop chat panel.',
    'Respond to the latest user message, keep the answer concise, and use any attached screenshot as context.',
    '',
    'Conversation:',
    conversation,
  ].join('\n')
}

function buildNonInteractivePrompt(messages: ChatMessage[]): string {
  return buildPrompt(messages, `${SYSTEM_PROMPT}\n\n${NON_INTERACTIVE_SESSION_INSTRUCTIONS}\n\n${DESKTOP_TOOLS_PROMPT}`)
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

function getCodexExecCommand(): { command: string; args: string[]; shell?: boolean } {
  const baseArgs = ['app-server', '--listen', 'stdio://']
  if (process.platform === 'win32') {
    const direct = buildDirectSpawn('codex', baseArgs)
    return { command: direct.command, args: direct.args, shell: direct.options.shell }
  }
  return { command: 'codex', args: baseArgs }
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
    _model?: string,
    cwd?: string,
    permissions: AgentPermissions = 'read-only',
    resumeMode: 'normal' | 'replay-seed' = 'normal',
    resumeGraftText?: string
  ): Promise<void> {
    // Signal the renderer when Codex needs cold-start initialization
    if (!this.initialized) {
      callbacks.onInitializing?.()
    }

    await this.ensureInitialized()

    const resolvedCwd = cwd || process.cwd()
    const existingSession = this.sessions.get(sessionId)
    if (
      existingSession &&
      (existingSession.cwd !== resolvedCwd || existingSession.permissions !== permissions)
    ) {
      if (existingSession.turnId) {
        throw new Error('Codex session is already processing a turn.')
      }
      this.removeSession(sessionId)
    }

    const latestUserMessage = [...messages].reverse().find((message) => message.role === 'user')
    if (!latestUserMessage) {
      throw new Error('No user message to send.')
    }

    const tempImages: PreparedImage[] = []
    const latestImageDataUrl = getImageDataUrl(latestUserMessage.content)
    if (latestImageDataUrl) {
      tempImages.push(await writeDataUrlToTempFile(latestImageDataUrl))
    }

    const threadId = await this.ensureThread(sessionId, resolvedCwd, permissions)
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
    session.currentItemId = null
    session.completedItemCount = 0

    const inputs: Array<{ type: string; text?: string; path?: string }> = []
    const text = getTextContent(latestUserMessage.content)
    if (text) {
      // For resumed conversations, prepend a transcript seed so the new thread has context
      let fullText = text
      if (resumeMode === 'replay-seed' && messages.length > 1) {
        const parts: string[] = []

        // Inject resume graft before the transcript seed if available
        if (resumeGraftText) {
          parts.push(resumeGraftText)
          parts.push('')
        }

        const priorMessages = messages.slice(0, -1)
        const seed = priorMessages
          .map((m) => {
            const role = m.role === 'user' ? 'User' : 'Assistant'
            const content = getTextContent(m.content)
            // Truncate very long messages to keep the seed compact
            const truncated = content.length > 500 ? content.slice(0, 500) + '...' : content
            return `[${role}] ${truncated}`
          })
          .join('\n\n')
        parts.push(`Conversation so far:\n${seed}`)
        parts.push(`\nContinue this conversation. The user's next message is:\n${text}`)
        fullText = parts.join('\n')
      }
      inputs.push({
        type: 'text',
        text: `${getCodexSystemPrompt()}\n\nUser:\n${fullText}`,
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

    const sandboxPolicy = buildCodexSandboxPolicy(permissions, resolvedCwd)

    const approvalPolicy = permissions === 'read-only' ? 'never' : 'on-request'

    const turnResponse = (await this.request('turn/start', {
      threadId,
      cwd: resolvedCwd,
      approvalPolicy,
      sandboxPolicy,
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

    const { command, args, shell } = getCodexExecCommand()
    const cwd = homedir()
    console.log(`[OmniCue] Codex app-server spawn: ${command} ${args.join(' ')} (cwd: ${cwd}, shell: ${!!shell})`)
    const child = spawn(command, args, {
      cwd,
      env: process.env,
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell,
    })
    trackChild(child)

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

    child.stderr.on('data', (chunk: Buffer) => {
      // Log stderr for diagnostics — protocol data is on stdout, but errors land here.
      const text = chunk.toString('utf8').trim()
      if (text) console.warn('[OmniCue] Codex app-server stderr:', text)
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

  /** Write a JSON-RPC response back to the server for a server-initiated request */
  private respondToServerRequest(requestId: number, result: unknown): void {
    if (!this.child) return
    const payload = { jsonrpc: '2.0', id: requestId, result }
    this.child.stdin.write(`${JSON.stringify(payload)}\n`)
  }

  private handleLine(line: string): void {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(line) as Record<string, unknown>
    } catch {
      return
    }

    const hasId = typeof message.id === 'number'
    const method = typeof message.method === 'string' ? message.method : ''

    // Diagnostic: log every JSON-RPC message from the app-server
    if (method) {
      console.log(`[OmniCue][JSONRPC] method=${method} hasId=${hasId} keys=${Object.keys(message).join(',')}`)
    }

    // Server request: has both id and method — the server is asking US for a response
    if (hasId && method) {
      console.log(`[OmniCue] Codex server request: method=${method}, id=${message.id}`)
      this.handleServerRequest(message.id as number, method, (message.params as Record<string, unknown>) || {})
      return
    }

    // Client response: has id but no method — response to a request we sent
    if (hasId) {
      const pending = this.pending.get(message.id as number)
      if (!pending) return

      this.pending.delete(message.id as number)
      if ('error' in message && message.error) {
        pending.reject(new Error(this.extractRpcError(message.error)))
      } else {
        pending.resolve(message.result)
      }
      return
    }

    // Notification: has method but no id
    const params = (message.params as Record<string, unknown> | undefined) || {}

    // New assistant item started — detect multi-item turns
    if (method === 'item/started') {
      const turnId = typeof params.turnId === 'string' ? params.turnId : ''
      const item = (params.item as Record<string, unknown> | undefined) || {}
      if (item.type !== 'agentMessage') return

      const session = this.findSessionByTurnId(turnId)
      if (!session) return

      const itemId = typeof item.id === 'string' ? item.id : null

      // If this is not the first assistant item, insert a separator
      if (session.completedItemCount > 0 && session.accumulatedText) {
        session.accumulatedText += '\n\n'
        session.callbacks?.onToken('\n\n')
      }

      session.currentItemId = itemId
      return
    }

    if (method === 'item/agentMessage/delta') {
      const turnId = typeof params.turnId === 'string' ? params.turnId : ''
      const delta = typeof params.delta === 'string' ? params.delta : ''
      const session = this.findSessionByTurnId(turnId)
      if (!session || !delta) return

      session.accumulatedText += delta
      session.callbacks?.onToken(delta)
      return
    }

    // Item completed — do NOT call onFinish(), just catch up on missed deltas
    if (method === 'item/completed') {
      const turnId = typeof params.turnId === 'string' ? params.turnId : ''
      const item = (params.item as Record<string, unknown> | undefined) || {}
      if (item.type !== 'agentMessage') return

      const session = this.findSessionByTurnId(turnId)
      if (!session) return

      // If we missed the deltas for this item, catch up with the item's final text
      const itemText = typeof item.text === 'string' ? item.text : ''
      if (itemText && !session.accumulatedText) {
        session.accumulatedText = itemText
        session.callbacks?.onToken(itemText)
      }

      session.completedItemCount++
      session.currentItemId = null
      // Do NOT call onFinish() — wait for turn/completed
      return
    }

    // Turn completed — finalize the visible response exactly once
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
        return
      }

      if (status === 'interrupted') {
        // Don't call onFinish() for interrupted turns — the UI already stopped locally
        void this.resetSessionTurnByTurnId(turnId)
        return
      }

      // completed or any other status — finalize with accumulated text
      // Always call onFinish() even if text is empty, so the UI exits streaming state
      session.callbacks?.onFinish(session.accumulatedText || '')
      void this.resetSessionTurnByTurnId(turnId)
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

  /** Handle a JSON-RPC server request (both id and method present) */
  private handleServerRequest(requestId: number, method: string, params: Record<string, unknown>): void {
    const getStringParam = (...keys: string[]): string => {
      for (const key of keys) {
        if (typeof params[key] === 'string') return params[key] as string
      }
      return ''
    }

    const turnId = getStringParam('turnId', 'turn_id')
    const threadId = getStringParam('threadId', 'thread_id')

    let session = turnId ? this.findSessionByTurnId(turnId) : null
    if (!session && threadId) {
      session =
        [...this.sessions.values()].find((candidate) => candidate.threadId === threadId) || null
    }

    const sessionId = session
      ? [...this.sessions.entries()].find(([, s]) => s === session)?.[0] || ''
      : ''

    // Normalize the request into a generic interaction
    let interaction: import('./agent-interactions').AgentInteractionRequest

    const COMMAND_APPROVAL_METHODS = [
      'item/commandExecution/requestApproval',
      'execCommandApproval',
    ]
    const FILE_CHANGE_METHODS = [
      'item/fileChange/requestApproval',
      'applyPatchApproval',
    ]
    const USER_INPUT_METHODS = [
      'item/tool/requestUserInput',
      'mcpServer/elicitation/request',
    ]

    if (COMMAND_APPROVAL_METHODS.includes(method)) {
      interaction = normalizeCodexCommandApproval(sessionId, String(requestId), method, params)
    } else if (FILE_CHANGE_METHODS.includes(method)) {
      interaction = normalizeCodexFileChangeApproval(sessionId, String(requestId), method, params)
    } else if (USER_INPUT_METHODS.includes(method)) {
      interaction = normalizeCodexUserInput(sessionId, String(requestId), method, params)
    } else {
      // Unknown server request — show as unsupported but still allow cancel
      console.log(`[OmniCue] Unrecognized Codex server request: ${method}`)
      interaction = normalizeCodexUnsupported(sessionId, String(requestId), method, params)
    }

    // Register so we can respond later when the user acts
    registerPendingRequest(interaction, (result) => {
      this.respondToServerRequest(requestId, result)
    })

    // Emit to the renderer
    console.log(`[OmniCue] Interaction normalized: kind=${interaction.kind}, sessionId=${sessionId}, hasCallback=${!!session?.callbacks?.onInteractionRequest}, options=${interaction.options?.length || 0}, questions=${interaction.questions?.length || 0}`)
    if (session?.callbacks?.onInteractionRequest) {
      session.callbacks.onInteractionRequest(interaction)
    } else {
      console.warn(`[OmniCue] No interaction callback for session — request will be lost!`)
    }
  }

  private extractRpcError(error: unknown): string {
    if (!error || typeof error !== 'object') return 'Codex app server request failed.'
    const maybeMessage = (error as Record<string, unknown>).message
    return typeof maybeMessage === 'string' ? maybeMessage : 'Codex app server request failed.'
  }

  private async ensureThread(
    sessionId: string,
    cwd: string,
    permissions: AgentPermissions = 'read-only'
  ): Promise<string> {
    const existing = this.sessions.get(sessionId)
    if (existing) return existing.threadId

    const threadApprovalPolicy = permissions === 'read-only' ? 'never' : 'on-request'
    const response = (await this.request('thread/start', {
      cwd,
      approvalPolicy: threadApprovalPolicy,
      sandbox: CODEX_SANDBOX_MAP[permissions],
      developerInstructions: `${CODEX_INTERACTION_INSTRUCTIONS}\n\n${DESKTOP_TOOLS_PROMPT}`,
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
      cwd,
      permissions,
      currentItemId: null,
      completedItemCount: 0,
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
    session.currentItemId = null
    session.completedItemCount = 0
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

const CODEX_SANDBOX_MAP: Record<AgentPermissions, string> = {
  'read-only': 'read-only',
  'workspace-write': 'workspace-write',
  'full-access': 'danger-full-access',
}

function buildCodexSandboxPolicy(
  permissions: AgentPermissions,
  cwd: string
):
  | { type: 'dangerFullAccess' }
  | { type: 'readOnly'; access: { type: 'fullAccess' }; networkAccess: boolean }
  | {
      type: 'workspaceWrite'
      writableRoots: string[]
      readOnlyAccess: { type: 'fullAccess' }
      networkAccess: boolean
      excludeTmpdirEnvVar: boolean
      excludeSlashTmp: boolean
    } {
  if (permissions === 'full-access') {
    return { type: 'dangerFullAccess' }
  }

  if (permissions === 'workspace-write') {
    return {
      type: 'workspaceWrite',
      writableRoots: [cwd],
      readOnlyAccess: { type: 'fullAccess' },
      networkAccess: false,
      excludeTmpdirEnvVar: false,
      excludeSlashTmp: false,
    }
  }

  return {
    type: 'readOnly',
    access: { type: 'fullAccess' },
    networkAccess: false,
  }
}

function getCodexCliCommand(images: PreparedImage[], permissions: AgentPermissions = 'read-only', model?: string): { command: string; args: string[]; shell?: boolean } {
  const baseArgs = [
    'exec',
    '--json',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--sandbox',
    CODEX_SANDBOX_MAP[permissions],
  ]

  if (model) {
    baseArgs.push('--model', model)
  }

  for (const image of images) {
    baseArgs.push('--image', image.path)
  }

  baseArgs.push('-')

  if (process.platform === 'win32') {
    const direct = buildDirectSpawn('codex', baseArgs)
    return { command: direct.command, args: direct.args, shell: direct.options.shell }
  }

  return { command: 'codex', args: baseArgs }
}


async function streamViaCodexCliFallback(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  modelOverride?: string,
  cwd?: string,
  permissions: AgentPermissions = 'read-only'
): Promise<void> {
  const prompt = buildNonInteractivePrompt(messages)
  const latestImageDataUrl = [...messages]
    .reverse()
    .map((message) => getImageDataUrl(message.content))
    .find((value): value is string => Boolean(value))

  const tempImages: PreparedImage[] = []
  if (latestImageDataUrl) {
    tempImages.push(await writeDataUrlToTempFile(latestImageDataUrl))
  }

  const { command, args, shell } = getCodexCliCommand(tempImages, permissions, modelOverride)
  const resolvedCwd = cwd || homedir()
  console.log(`[OmniCue] Codex CLI fallback spawn: ${command} ${args.join(' ')} (cwd: ${resolvedCwd}, shell: ${!!shell})`)

  const child = spawn(command, args, {
    cwd: resolvedCwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell,
  })
  trackChild(child)

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let finalText = ''

  const handleAbort = (): void => {
    killProcessTree(child)
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
          const itemText = event.item.text || ''
          if (itemText) {
            if (finalText) finalText += '\n\n'
            finalText += itemText
          }
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

/** Shared OpenAI-compatible SSE streaming core. */
async function streamOpenAiCompat(opts: {
  baseURL: string
  apiKey: string
  model: string
  providerLabel: string
  authHeader?: string
  authPrefix?: string
}, messages: ChatMessage[], callbacks: AiStreamCallbacks, abortSignal?: AbortSignal, cwd?: string): Promise<void> {
  const headerName = opts.authHeader || 'Authorization'
  const prefix = opts.authPrefix || 'Bearer'
  const systemContent = cwd ? `${SYSTEM_PROMPT}\n\nThe user is currently working in: ${cwd}` : SYSTEM_PROMPT
  const apiMessages: ChatMessage[] = [{ role: 'system', content: systemContent }, ...messages]

  const res = await fetch(`${opts.baseURL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      [headerName]: `${prefix} ${opts.apiKey}`,
    },
    body: JSON.stringify({ model: opts.model, messages: apiMessages, stream: true }),
    signal: abortSignal,
  })

  if (!res.ok) {
    const body = await res.text()
    let errorMsg = `${opts.providerLabel} API error ${res.status}`
    try { errorMsg = JSON.parse(body).error?.message || errorMsg } catch { /* use default */ }
    throw new Error(errorMsg)
  }

  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response stream')

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
        const delta = JSON.parse(data).choices?.[0]?.delta?.content
        if (delta) {
          fullText += delta
          callbacks.onToken(delta)
        }
      } catch { /* ignore malformed SSE chunks */ }
    }
  }

  callbacks.onFinish(fullText)
}

async function streamViaOpenAiApi(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  modelOverride?: string,
  cwd?: string
): Promise<void> {
  const settings = settingsStore.get()
  const apiKey = settings.aiApiKey || ''
  if (!apiKey) {
    throw new Error('No AI provider configured. Sign in with Codex CLI (run "codex login") or set an OpenAI API key in Settings.')
  }
  await streamOpenAiCompat({
    baseURL: settings.aiBaseUrl || 'https://api.openai.com/v1',
    apiKey,
    model: modelOverride || settings.aiModel || 'gpt-4o',
    providerLabel: 'OpenAI',
  }, messages, callbacks, abortSignal, cwd)
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
  modelOverride?: string,
  cwd?: string
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
    system: cwd ? `${SYSTEM_PROMPT}\n\nThe user is currently working in: ${cwd}` : SYSTEM_PROMPT,
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

function getClaudeCliCommand(permissions: AgentPermissions = 'read-only'): { command: string; args: string[]; shell?: boolean } {
  const baseArgs = [
    '-p',               // print mode (non-interactive)
    '--output-format', 'stream-json',
    '--verbose',
    '--include-partial-messages',
  ]

  // Map permissions to Claude Code's permission-mode flag
  if (permissions === 'full-access') {
    baseArgs.push('--permission-mode', 'bypassPermissions')
  } else if (permissions === 'workspace-write') {
    baseArgs.push('--permission-mode', 'acceptEdits')
  } else {
    baseArgs.push('--permission-mode', 'plan')
  }

  if (process.platform === 'win32') {
    const direct = buildDirectSpawn('claude', baseArgs)
    return { command: direct.command, args: direct.args, shell: direct.options.shell }
  }

  return { command: 'claude', args: baseArgs }
}

async function streamViaClaudeCodeCli(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  _modelOverride?: string,
  cwd?: string,
  permissions: AgentPermissions = 'read-only'
): Promise<void> {
  // Claude Code CLI is running in non-interactive print mode here, so we pass
  // screenshot context as text only and avoid promising native OmniCue pickers.
  const prompt = buildNonInteractivePrompt(messages)

  const { command, args, shell } = getClaudeCliCommand(permissions)
  const resolvedCwd = cwd || homedir()
  console.log(`[OmniCue] Claude CLI spawn: ${command} ${args.join(' ')} (cwd: ${resolvedCwd}, shell: ${!!shell})`)

  const child = spawn(command, args, {
    cwd: resolvedCwd,
    env: process.env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell,
  })
  trackChild(child)

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let fullText = ''
  // Track current tool use being streamed
  let currentToolName: string | null = null
  let currentToolInput = ''

  const handleAbort = (): void => {
    killProcessTree(child)
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

// ── OpenCode CLI Harness ─────────────────────────────────────────────────────

function getOpenCodeCommand(model?: string, cwd?: string): { command: string; args: string[]; env: Record<string, string>; shell?: boolean } {
  const settings = settingsStore.get()
  const resolvedModel = model || settings.opencodeModel?.trim() || ''

  const baseArgs = ['run', '--format', 'json']
  if (resolvedModel) baseArgs.push('--model', resolvedModel)
  if (cwd) baseArgs.push('--dir', cwd)
  baseArgs.push('-') // read prompt from stdin

  // Pass through any API key the user configured as env vars
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  if (settings.opencodeApiKey?.trim()) {
    // Set common provider env vars so OpenCode picks them up
    env.OPENAI_API_KEY = settings.opencodeApiKey
    env.ANTHROPIC_API_KEY = settings.opencodeApiKey
    env.OPENCODE_OPENAI_APIKEY = settings.opencodeApiKey
    env.OPENCODE_ANTHROPIC_APIKEY = settings.opencodeApiKey
    env.GOOGLE_API_KEY = settings.opencodeApiKey
    env.XAI_API_KEY = settings.opencodeApiKey
    env.GROQ_API_KEY = settings.opencodeApiKey
    env.DEEPSEEK_API_KEY = settings.opencodeApiKey
  }

  if (process.platform === 'win32') {
    const direct = buildDirectSpawn('opencode', baseArgs)
    return { command: direct.command, args: direct.args, env, shell: direct.options.shell }
  }

  return { command: 'opencode', args: baseArgs, env }
}

async function streamViaOpenCodeCli(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  _modelOverride?: string,
  cwd?: string
): Promise<void> {
  const prompt = buildNonInteractivePrompt(messages)
  const { command, args, env, shell } = getOpenCodeCommand(undefined, cwd)

  const child = spawn(command, args, {
    cwd: cwd || homedir(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell,
  })
  trackChild(child)

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let fullText = ''

  const handleAbort = (): void => {
    killProcessTree(child)
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
        const type = event.type as string

        if (type === 'text') {
          const part = event.part as Record<string, unknown> | undefined
          const text = part?.text as string | undefined
          if (text) {
            fullText += text
            callbacks.onToken(text)
          }
        }

        if (type === 'tool_use') {
          const part = event.part as Record<string, unknown> | undefined
          const toolName = part?.tool as string || 'tool'
          const state = part?.state as Record<string, unknown> | undefined
          const input = state?.input as Record<string, unknown> | undefined
          const summary = (input?.command || input?.path || input?.pattern || toolName) as string
          callbacks.onToolUse?.(toolName, summary)
        }

        if (type === 'error') {
          const error = event.error as Record<string, unknown> | undefined
          const data = error?.data as Record<string, unknown> | undefined
          const msg = (data?.message || error?.name || 'OpenCode error') as string
          callbacks.onError(msg)
        }
      } catch { /* ignore malformed lines */ }
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
      if (abortSignal?.aborted) { resolve(); return }

      if (fullText) {
        callbacks.onFinish(fullText)
        resolve()
        return
      }

      const stderrSummary = stderrBuffer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n')
      reject(new Error(stderrSummary || `OpenCode exited without a response (code ${code ?? 'unknown'}).`))
    })
  })
}

// ── Kimi Code CLI Harness ───────────────────────────────────────────────────

function getKimiCodeCommand(): { command: string; args: string[]; env: Record<string, string>; shell?: boolean } {
  const baseArgs = ['--print', '--output-format', 'stream-json']

  const env: Record<string, string> = { ...process.env } as Record<string, string>
  const settings = settingsStore.get()
  if (settings.kimiApiKey?.trim()) {
    env.KIMI_API_KEY = settings.kimiApiKey
  }

  if (process.platform === 'win32') {
    const direct = buildDirectSpawn('kimi', baseArgs)
    return { command: direct.command, args: direct.args, env, shell: direct.options.shell }
  }

  return { command: 'kimi', args: baseArgs, env }
}

async function streamViaKimiCodeCli(
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  _modelOverride?: string,
  cwd?: string
): Promise<void> {
  const prompt = buildNonInteractivePrompt(messages)
  const { command, args, env, shell } = getKimiCodeCommand()

  // Append the prompt via -p flag
  args.push('-p', prompt)

  const child = spawn(command, args, {
    cwd: cwd || homedir(),
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    shell,
  })
  trackChild(child)

  let stdoutBuffer = ''
  let stderrBuffer = ''
  let fullText = ''

  const handleAbort = (): void => {
    killProcessTree(child)
  }
  abortSignal?.addEventListener('abort', handleAbort, { once: true })

  child.stdout.on('data', (chunk: Buffer) => {
    stdoutBuffer += chunk.toString('utf8')
    const lines = stdoutBuffer.split(/\r?\n/)
    stdoutBuffer = lines.pop() || ''

    for (const line of lines) {
      const trimmed = line.trim()
      if (!trimmed.startsWith('{')) continue

      try {
        const event = JSON.parse(trimmed) as Record<string, unknown>
        const role = event.role as string | undefined
        const content = event.content as string | undefined

        // Assistant text message
        if (role === 'assistant' && content) {
          fullText += content
          callbacks.onToken(content)
        }

        // Tool calls
        const toolCalls = event.tool_calls as Array<Record<string, unknown>> | undefined
        if (toolCalls) {
          for (const tc of toolCalls) {
            const fn = tc.function as Record<string, unknown> | undefined
            if (fn) {
              const name = (fn.name || 'tool') as string
              let summary = name
              try {
                const parsed = JSON.parse(fn.arguments as string)
                summary = parsed.command || parsed.path || parsed.pattern || name
              } catch { /* use name */ }
              callbacks.onToolUse?.(name, summary)
            }
          }
        }
      } catch { /* ignore malformed lines */ }
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
      if (abortSignal?.aborted) { resolve(); return }

      if (fullText) {
        callbacks.onFinish(fullText)
        resolve()
        return
      }

      const stderrSummary = stderrBuffer.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).join('\n')
      reject(new Error(stderrSummary || `Kimi Code exited without a response (code ${code ?? 'unknown'}).`))
    })
  })
}

// ── Provider registry for OpenAI-compatible APIs ────────────────────────────

interface CompatProviderConfig {
  name: string
  defaultBaseUrl: string
  defaultModel: string
  apiKeyField: keyof ReturnType<typeof settingsStore.get>
  modelField: keyof ReturnType<typeof settingsStore.get>
  /** Custom auth header name (defaults to 'Authorization') */
  authHeader?: string
  /** Custom auth prefix (defaults to 'Bearer') */
  authPrefix?: string
}

const COMPAT_PROVIDERS: Record<string, CompatProviderConfig> = {
  gemini: {
    name: 'Google Gemini',
    defaultBaseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    defaultModel: 'gemini-3.1-pro',
    apiKeyField: 'geminiApiKey',
    modelField: 'geminiModel',
  },
  deepseek: {
    name: 'DeepSeek',
    defaultBaseUrl: 'https://api.deepseek.com/v1',
    defaultModel: 'deepseek-chat',
    apiKeyField: 'deepseekApiKey',
    modelField: 'deepseekModel',
  },
  groq: {
    name: 'Groq',
    defaultBaseUrl: 'https://api.groq.com/openai/v1',
    defaultModel: 'meta-llama/llama-4-scout-17b-16e-instruct',
    apiKeyField: 'groqApiKey',
    modelField: 'groqModel',
  },
  mistral: {
    name: 'Mistral',
    defaultBaseUrl: 'https://api.mistral.ai/v1',
    defaultModel: 'mistral-large-latest',
    apiKeyField: 'mistralApiKey',
    modelField: 'mistralModel',
  },
  xai: {
    name: 'xAI Grok',
    defaultBaseUrl: 'https://api.x.ai/v1',
    defaultModel: 'grok-4',
    apiKeyField: 'xaiApiKey',
    modelField: 'xaiModel',
  },
  glm: {
    name: 'GLM (Zhipu AI)',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    defaultModel: 'glm-5.1',
    apiKeyField: 'glmApiKey',
    modelField: 'glmModel',
  },
  kimi: {
    name: 'Kimi (Moonshot)',
    defaultBaseUrl: 'https://api.moonshot.ai/v1',
    defaultModel: 'kimi-k2.5',
    apiKeyField: 'kimiApiKey',
    modelField: 'kimiModel',
  },
}

async function streamViaCompatProvider(
  providerId: string,
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  modelOverride?: string,
  cwd?: string
): Promise<void> {
  const config = COMPAT_PROVIDERS[providerId]
  if (!config) throw new Error(`Unknown provider: ${providerId}`)

  const settings = settingsStore.get()
  const apiKey = (settings[config.apiKeyField] as string) || ''
  if (!apiKey) {
    throw new Error(`No API key configured for ${config.name}. Add your API key in Settings → AI Settings.`)
  }

  await streamOpenAiCompat({
    baseURL: config.defaultBaseUrl,
    apiKey,
    model: modelOverride || (settings[config.modelField] as string)?.trim() || config.defaultModel,
    providerLabel: config.name,
    authHeader: config.authHeader,
    authPrefix: config.authPrefix,
  }, messages, callbacks, abortSignal, cwd)
}

/** Resolve a model for direct API fallback paths only (not CLI providers). */
function resolveModelForApi(provider: string): string {
  const settings = settingsStore.get()
  if (provider === 'claude') {
    return settings.claudeModel?.trim() || 'claude-sonnet-4-6-20250514'
  }
  if (COMPAT_PROVIDERS[provider]) {
    const config = COMPAT_PROVIDERS[provider]
    return (settings[config.modelField] as string)?.trim() || config.defaultModel
  }
  return settings.aiModel?.trim() || 'gpt-5.4'
}

export type AgentPermissions = 'read-only' | 'workspace-write' | 'full-access'

export async function streamAiResponse(
  sessionId: string,
  messages: ChatMessage[],
  callbacks: AiStreamCallbacks,
  abortSignal?: AbortSignal,
  _modelOverride?: string,
  provider?: string,
  cwd?: string,
  permissions: AgentPermissions = 'read-only',
  resumeMode: 'normal' | 'replay-seed' = 'normal',
  conversationId?: string
): Promise<void> {
  const settings = settingsStore.get()
  const resolvedProvider = provider || settings.aiProvider || 'codex'
  console.log(`[OmniCue] Provider: ${resolvedProvider}, Permissions: ${permissions}, CWD: ${cwd}`)

  // ── Resume graft injection ──────────────────────────────────────────────
  // If this is a resumed conversation with a saved capsule, generate and inject
  // a diff-aware resume context block before provider dispatch.
  let resumeGraftText: string | undefined
  if (resumeMode === 'replay-seed' && conversationId) {
    try {
      const conversation = loadConversation(conversationId)
      if (conversation?.resumeCapsule) {
        const liveSnapshot = await collectSnapshot(null, { skipSystem: true })
        const graft = generateResumeGraft(conversation.resumeCapsule, liveSnapshot)
        resumeGraftText = graft.text
        console.log(`[OmniCue] Resume graft generated (${graft.staleFields.length} changes)`)
      }
    } catch (err) {
      console.warn('[OmniCue] Resume graft generation failed:', err)
    }
  }

  // For non-Codex providers, inject the graft as a synthetic system message
  // so it flows naturally through buildPrompt / message arrays.
  if (resumeGraftText && resolvedProvider !== 'codex') {
    messages = [
      { role: 'system', content: resumeGraftText } as ChatMessage,
      ...messages,
    ]
  }

  // Claude provider — try Claude Code CLI first (uses Max subscription), fall back to Anthropic API
  if (resolvedProvider === 'claude') {
    const claudeStatus = getClaudeStatus()

    if (claudeStatus.authenticated) {
      // Tier 1: Claude Code CLI (uses Max/Pro subscription) — no model override, CLI picks its own
      try {
        await streamViaClaudeCodeCli(messages, callbacks, abortSignal, undefined, cwd, permissions)
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

    // Tier 2: Direct Anthropic API (requires API key) — use saved model from settings
    const apiModel = resolveModelForApi('claude')
    try {
      await streamViaClaudeApi(messages, callbacks, abortSignal, apiModel, cwd)
    } catch (error) {
      if (abortSignal?.aborted) return
      callbacks.onError(error instanceof Error ? error.message : String(error))
    }
    return
  }

  // OpenCode harness — full coding agent CLI
  if (resolvedProvider === 'opencode') {
    try {
      await streamViaOpenCodeCli(messages, callbacks, abortSignal, undefined, cwd)
    } catch (error) {
      if (abortSignal?.aborted) return
      callbacks.onError(error instanceof Error ? error.message : String(error))
    }
    return
  }

  // Kimi Code harness — full coding agent CLI, falls back to Kimi API
  if (resolvedProvider === 'kimicode') {
    try {
      await streamViaKimiCodeCli(messages, callbacks, abortSignal, undefined, cwd)
    } catch (cliErr) {
      const cliMsg = cliErr instanceof Error ? cliErr.message : String(cliErr)
      console.warn('[OmniCue] Kimi Code CLI failed, trying Kimi API fallback:', cliMsg)

      if (!settings.kimiApiKey) {
        callbacks.onError(`Kimi Code CLI failed: ${cliMsg}`)
        return
      }
      // Fall back to Kimi API
      try {
        await streamViaCompatProvider('kimi', messages, callbacks, abortSignal, undefined, cwd)
      } catch (apiErr) {
        if (abortSignal?.aborted) return
        callbacks.onError(apiErr instanceof Error ? apiErr.message : String(apiErr))
      }
    }
    return
  }

  // OpenAI provider — direct API (no Codex)
  if (resolvedProvider === 'openai') {
    const apiModel = resolveModelForApi('openai')
    try {
      await streamViaOpenAiApi(messages, callbacks, abortSignal, apiModel, cwd)
    } catch (error) {
      if (abortSignal?.aborted) return
      callbacks.onError(error instanceof Error ? error.message : String(error))
    }
    return
  }

  // OpenAI-compatible providers (Gemini, DeepSeek, Groq, Mistral, xAI)
  if (COMPAT_PROVIDERS[resolvedProvider]) {
    try {
      await streamViaCompatProvider(resolvedProvider, messages, callbacks, abortSignal, undefined, cwd)
    } catch (error) {
      if (abortSignal?.aborted) return
      callbacks.onError(error instanceof Error ? error.message : String(error))
    }
    return
  }

  // Codex provider (default) — tiered fallback
  const codexStatus = getCodexStatus()

  if (codexStatus.authenticated) {
    // Tier 1: Codex app-server (JSON-RPC subprocess) — no model override, app-server picks its own
    try {
      await codexAppServerClient.streamSession(sessionId, messages, callbacks, abortSignal, undefined, cwd, permissions, resumeMode, resumeGraftText)
      return
    } catch (appServerErr) {
      const appMsg = appServerErr instanceof Error ? appServerErr.message : String(appServerErr)
      console.warn('[OmniCue] Codex app-server failed, trying CLI fallback:', appMsg)

      // Tier 2: Codex CLI fallback — no model override, uses its own default
      try {
        await streamViaCodexCliFallback(messages, callbacks, abortSignal, undefined, cwd, permissions)
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
  const apiModel = resolveModelForApi('openai')
  try {
    await streamViaOpenAiApi(messages, callbacks, abortSignal, apiModel, cwd)
  } catch (error) {
    if (abortSignal?.aborted) return
    callbacks.onError(error instanceof Error ? error.message : String(error))
  }
}
