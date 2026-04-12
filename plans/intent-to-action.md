# Intent-to-Action Translation Layer

## The Idea

User says natural language like "Open the folder for this project" — OmniCue resolves that into a concrete tool call (`reveal-in-folder` with the project path extracted from the VS Code window title). No screenshot reasoning required.

This is the layer that makes the assistant feel **situated** — it knows where you are, what you're doing, and can act on it.

---

## Architecture Overview

```
User intent (natural language)
        │
        ▼
┌──────────────────────┐
│  Context Collector    │  ← gathers rich OS state (not just active window)
│  src/main/context/    │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Intent Resolver      │  ← LLM maps intent + context → action plan
│  src/main/intent/     │
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Action Executor      │  ← existing action system (safe/guided/dangerous)
│  src/main/actions/    │     + new actions added below
└──────────────────────┘
```

---

## Part 1: Rich Context Collector

**New file:** `src/main/context/collector.ts`

The current `getDesktopContext()` returns `{ activeApp, processName, windowTitle, display, clipboard }`. That's the bare minimum. The intent resolver needs **structured, parsed context** so it doesn't have to re-derive everything from raw strings.

### DesktopSnapshot interface

**New file:** `src/main/context/types.ts`

```ts
export interface DesktopSnapshot {
  // ── What's already available ──
  activeApp: string
  processName: string
  windowTitle: string
  display: number
  clipboard?: string

  // ── Parsed from window title (via tool packs) ──
  pack: {
    id: string           // 'ide' | 'terminal' | 'browser' | 'fileExplorer'
    variant?: string     // 'vscode' | 'chrome' | 'powershell' etc.
    context: Record<string, string>  // fileName, projectName, siteHint, etc.
  } | null

  // ── New: deeper OS hooks ──
  editor?: {
    workspacePath: string    // e.g. "C:/Users/fowle/Documents/dev/omniox"
    openFile?: string        // full path if derivable
    language?: string
    isDirty?: boolean        // unsaved changes indicator from title (*filename)
  }

  terminal?: {
    shell: string            // powershell, bash, cmd, etc.
    cwd?: string             // parsed from title or prompt
    lastCommand?: string     // if visible in title
    isAdmin?: boolean
  }

  browser?: {
    url?: string             // from title heuristics or accessibility
    domain?: string
    pageTitle?: string
    site?: string            // github, stackoverflow, gmail, etc.
  }

  fileExplorer?: {
    currentPath?: string     // parsed from title "Documents > dev > omniox"
    selectedFile?: string    // if accessible via UI automation
  }

  // ── System-level context ──
  system: {
    runningApps: string[]          // list of processes with visible windows
    recentNotifications?: string[] // if we track them
    focusHistory?: string[]        // last N app switches
    dndActive?: boolean            // do not disturb state
  }
}
```

### Where the data comes from

| Field | Source | Mechanism |
|-------|--------|-----------|
| `editor.workspacePath` | VS Code title: `file - project - VSCode` | Title parsing (already in IDE pack) + resolve project path via heuristic or `code --status` |
| `editor.openFile` | Title parsing → `projectPath/fileName` | Combine workspacePath + fileName from pack context |
| `editor.isDirty` | Title prefix `*` or `●` | Regex on windowTitle |
| `terminal.cwd` | PowerShell/bash title often shows cwd | Regex: strip shell name, extract path |
| `terminal.shell` | processName + pack variant | Already in terminal pack |
| `terminal.isAdmin` | Title contains "Administrator" | Already in terminal pack |
| `browser.url` | Accessibility API → address bar value | New: PowerShell UI Automation query on browser address bar |
| `browser.domain` | Parsed from url or title | Domain extraction heuristic |
| `browser.pageTitle` | windowTitle minus browser suffix | Already in browser pack |
| `fileExplorer.currentPath` | Title: `dev > omniox` or full path | Parse breadcrumb from Explorer title |
| `system.runningApps` | PowerShell: `Get-Process \| Where MainWindowTitle` | New: lightweight process list |
| `system.focusHistory` | Track app switches over time in main process | New: ring buffer of last 10 active windows |

### Collector orchestrator

**New file:** `src/main/context/collector.ts`

```ts
import { getActiveWindowAsync } from '../activeWindow'
import { resolvePack } from '../../shared/tool-packs/resolver'
import { getCurrentDisplayId } from '../desktop-tools'
import { extractEditorContext } from './extractors/editor'
import { extractTerminalContext } from './extractors/terminal'
import { extractBrowserContext } from './extractors/browser'
import { extractExplorerContext } from './extractors/explorer'
import { extractSystemContext } from './extractors/system'

export async function collectSnapshot(win, options?): Promise<DesktopSnapshot> {
  const activeWin = await getActiveWindowAsync()
  const pack = activeWin ? resolvePack(activeWin) : null

  // Run extractors in parallel based on detected pack
  const [editor, terminal, browser, fileExplorer, system] = await Promise.all([
    pack?.packId === 'ide'           ? extractEditorContext(activeWin, pack) : undefined,
    pack?.packId === 'terminal'      ? extractTerminalContext(activeWin, pack) : undefined,
    pack?.packId === 'browser'       ? extractBrowserContext(activeWin, pack) : undefined,
    pack?.packId === 'fileExplorer'  ? extractExplorerContext(activeWin, pack) : undefined,
    extractSystemContext(),
  ])

  return {
    activeApp: activeWin?.activeApp || '',
    processName: activeWin?.processName || '',
    windowTitle: activeWin?.windowTitle || '',
    display: getCurrentDisplayId(win),
    pack: pack ? { id: pack.packId, variant: pack.variant, context: pack.context } : null,
    editor, terminal, browser, fileExplorer, system
  }
}
```

---

## Part 2: Context Extractors

### `src/main/context/extractors/editor.ts`

Workspace path resolution — the key insight is that VS Code window titles contain `projectName` which maps to a folder name somewhere on disk.

```ts
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

// Common development roots to search for project folders
const DEV_ROOTS = [
  join(homedir(), 'Documents', 'dev'),
  join(homedir(), 'projects'),
  join(homedir(), 'repos'),
  join(homedir(), 'src'),
  join(homedir(), 'code'),
  join(homedir(), 'Desktop'),
  homedir(),
]

export function extractEditorContext(activeWin, pack): EditorContext | undefined {
  const fileName = pack.context.fileName
  const projectName = pack.context.projectName
  const language = pack.context.languageHint

  // Detect dirty state from title (* prefix)
  const isDirty = activeWin.windowTitle.startsWith('● ') ||
                  (fileName && activeWin.windowTitle.includes(`* ${fileName}`))

  // Resolve workspace path
  let workspacePath: string | undefined
  if (projectName) {
    for (const root of DEV_ROOTS) {
      const candidate = join(root, projectName)
      if (existsSync(candidate)) { workspacePath = candidate; break }
    }
  }

  if (!workspacePath && !fileName) return undefined

  return {
    workspacePath: workspacePath || '',
    openFile: workspacePath && fileName ? join(workspacePath, fileName) : fileName,
    language,
    isDirty: isDirty || false,
  }
}
```

### `src/main/context/extractors/terminal.ts`

```ts
export function extractTerminalContext(activeWin, pack): TerminalContext | undefined {
  const title = activeWin.windowTitle
  const variant = pack.variant
  const isAdmin = pack.context.isAdmin === 'true' || /administrator/i.test(title)
  const shell = pack.context.shellHint || variant || 'unknown'

  // Parse CWD from various title formats
  let cwd: string | undefined

  // PowerShell: "PS C:\Users\fowle\dev\omniox> "
  const psMatch = title.match(/PS\s+([A-Z]:\\[^>]+)/i)
  if (psMatch) cwd = psMatch[1].trim()

  // Git Bash: "MINGW64:/c/Users/fowle/dev/omniox"
  if (!cwd) {
    const bashMatch = title.match(/MINGW\d*:([^\s]+)/i)
    if (bashMatch) cwd = bashMatch[1].replace(/^\/([a-z])\//i, '$1:\\').replace(/\//g, '\\')
  }

  // Windows Terminal with path: "C:\Users\fowle\dev"
  if (!cwd) {
    const pathMatch = title.match(/([A-Z]:\\[^\s\\]+(?:\\[^\s\\]+)*)/i)
    if (pathMatch) cwd = pathMatch[1]
  }

  // Bash/zsh: "user@host:~/dev/omniox"
  if (!cwd) {
    const unixMatch = title.match(/:~?\/?(.+)$/i)
    if (unixMatch) cwd = unixMatch[1]
  }

  return { shell, cwd, isAdmin }
}
```

### `src/main/context/extractors/browser.ts`

Two approaches — title parsing (fast, always works) and UI Automation (richer, Windows-only).

```ts
import { runPsScript, ensurePsScript } from '../../actions/powershell'

const BROWSER_SUFFIXES = [
  / - Google Chrome$/i,
  / - Mozilla Firefox$/i,
  / - Microsoft Edge$/i,
  / - Brave$/i,
  / - Opera$/i,
  / - Safari$/i,
]

const SITE_PATTERNS: Record<string, RegExp> = {
  github: /github\.com/i,
  stackoverflow: /stackoverflow\.com/i,
  gmail: /mail\.google\.com/i,
  // ... (already in browser pack)
}

// PowerShell script to extract URL from browser address bar via UI Automation
const PS_GET_BROWSER_URL = `
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement

# Try Chromium-based browsers first (Chrome, Edge, Brave)
$chromiumCondition = New-Object System.Windows.Automation.PropertyCondition(
  [System.Windows.Automation.AutomationElement]::ClassNameProperty, "Chrome_WidgetWin_1"
)
$browser = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $chromiumCondition)

if ($browser) {
  $editCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Edit
  )
  $addressBar = $browser.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $editCondition)
  if ($addressBar) {
    try {
      $vp = $addressBar.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
      Write-Output $vp.Current.Value
      exit 0
    } catch {}
    # Fallback: try LegacyIAccessible
    try {
      $lap = $addressBar.GetCurrentPattern([System.Windows.Automation.LegacyIAccessiblePattern]::Pattern)
      Write-Output $lap.Current.Value
      exit 0
    } catch {}
  }
}

Write-Output ""
`

export async function extractBrowserContext(activeWin, pack): Promise<BrowserContext | undefined> {
  let pageTitle = activeWin.windowTitle
  for (const suffix of BROWSER_SUFFIXES) {
    pageTitle = pageTitle.replace(suffix, '').trim()
  }

  // Try UI Automation for URL (async, may be slow)
  let url: string | undefined
  try {
    const script = ensurePsScript('browser-url', PS_GET_BROWSER_URL)
    const result = await runPsScript(script, [], { timeout: 1500 })
    if (result.exitCode === 0 && result.stdout.trim()) {
      let raw = result.stdout.trim()
      // Chrome often omits the scheme
      if (!raw.startsWith('http') && !raw.startsWith('file:')) raw = 'https://' + raw
      url = raw
    }
  } catch { /* timeout or failure — fall back to title only */ }

  const domain = url ? new URL(url).hostname : undefined
  const site = Object.entries(SITE_PATTERNS).find(([, re]) => {
    return (url && re.test(url)) || re.test(pageTitle)
  })?.[0]

  return { url, domain, pageTitle, site }
}
```

### `src/main/context/extractors/explorer.ts`

```ts
export function extractExplorerContext(activeWin, pack): ExplorerContext | undefined {
  const title = activeWin.windowTitle

  // Windows Explorer titles:
  // Full path: "C:\Users\fowle\Documents\dev"
  // Breadcrumb: "dev"  (just folder name when navigating)
  // Special: "This PC", "Downloads", "Documents"

  let currentPath: string | undefined

  // Check for full path in title
  const pathMatch = title.match(/^([A-Z]:\\[^\s].*?)(?:\s*$)/i)
  if (pathMatch) {
    currentPath = pathMatch[1]
  }

  // If just a folder name, try to resolve from known locations
  if (!currentPath) {
    const SPECIAL_FOLDERS: Record<string, string> = {
      'downloads': join(homedir(), 'Downloads'),
      'documents': join(homedir(), 'Documents'),
      'desktop': join(homedir(), 'Desktop'),
      'pictures': join(homedir(), 'Pictures'),
      'music': join(homedir(), 'Music'),
      'videos': join(homedir(), 'Videos'),
      'this pc': '',
    }
    const lower = title.toLowerCase().trim()
    if (SPECIAL_FOLDERS[lower] !== undefined) {
      currentPath = SPECIAL_FOLDERS[lower]
    }
  }

  return currentPath !== undefined ? { currentPath } : undefined
}
```

### `src/main/context/extractors/system.ts`

```ts
import { spawn } from 'child_process'
import { getFocusHistory, getRecentApps } from '../focus-history'

const PS_RUNNING_APPS = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -Property ProcessName, MainWindowTitle | ConvertTo-Json -Compress`

export async function extractSystemContext(): Promise<SystemContext> {
  const focusHistory = getRecentApps()

  let runningApps: string[] = []
  try {
    const result = await runPsCommand(PS_RUNNING_APPS, 2000)
    const parsed = JSON.parse(result)
    const list = Array.isArray(parsed) ? parsed : [parsed]
    runningApps = list.map(p => p.ProcessName).filter(Boolean)
    // Deduplicate
    runningApps = [...new Set(runningApps)]
  } catch { /* best effort */ }

  return { runningApps, focusHistory }
}
```

---

## Part 3: Focus History Tracker

**New file:** `src/main/context/focus-history.ts`

Simple ring buffer that records app switches. Sampled on a separate interval (not every 32ms cursor poll).

```ts
interface FocusEntry {
  app: string
  processName: string
  windowTitle: string
  timestamp: number
}

const MAX_HISTORY = 20
const history: FocusEntry[] = []
let lastProcess = ''

export function recordFocus(info: { activeApp: string; processName: string; windowTitle: string } | null): void {
  if (!info || info.processName === lastProcess) return
  lastProcess = info.processName
  history.push({
    app: info.activeApp,
    processName: info.processName,
    windowTitle: info.windowTitle,
    timestamp: Date.now(),
  })
  if (history.length > MAX_HISTORY) history.shift()
}

export function getFocusHistory(): FocusEntry[] {
  return [...history]
}

export function getRecentApps(): string[] {
  const seen = new Set<string>()
  return [...history].reverse()
    .filter(e => { if (seen.has(e.processName)) return false; seen.add(e.processName); return true })
    .map(e => e.app)
}
```

**Hook:** Add a `setInterval` in `src/main/index.ts` that samples every 3 seconds:

```ts
import { recordFocus } from './context/focus-history'
import { getActiveWindowAsync } from './activeWindow'

// Sample focus every 3 seconds for history (separate from 32ms cursor poll)
setInterval(async () => {
  const info = await getActiveWindowAsync()
  if (info) recordFocus(info)
}, 3000)
```

---

## Part 4: Intent Resolver

### `src/main/intent/types.ts`

```ts
export interface ActionStep {
  actionId: string
  params: Record<string, unknown>
}

export interface ActionPlan {
  actions: ActionStep[]
  explanation?: string
  confidence?: number
  needsConfirmation?: boolean
  fallback?: 'ask'
  question?: string
}

export interface IntentPattern {
  id: string
  patterns: RegExp[]
  resolve: (match: RegExpMatchArray, snapshot: DesktopSnapshot) => ActionPlan | null
}
```

### `src/main/intent/patterns.ts`

Pattern definitions for common intents — the 80% case handled without an LLM:

```ts
const PATTERNS: IntentPattern[] = [

  // ── Navigation ──

  {
    id: 'open-project-folder',
    patterns: [
      /open\s+(?:the\s+)?folder\s+(?:for\s+)?(?:this\s+)?project/i,
      /show\s+(?:this\s+)?project\s+(?:in\s+)?(?:explorer|file\s*manager|finder)/i,
      /reveal\s+(?:this\s+)?project/i,
    ],
    resolve: (_m, snap) => {
      const path = snap.editor?.workspacePath || snap.fileExplorer?.currentPath
      if (!path) return null
      return { actions: [{ actionId: 'reveal-in-folder', params: { path } }] }
    },
  },

  {
    id: 'open-config',
    patterns: [
      /find\s+(?:where\s+)?(?:this\s+)?app\s+stores?\s+(?:its?\s+)?config/i,
      /(?:where|find)\s+(?:is\s+)?(?:the\s+)?config(?:uration)?\s+(?:for|of)\s+/i,
      /open\s+(?:the\s+)?(?:settings|config)\s+(?:for\s+)?(?:this\s+)?app/i,
    ],
    resolve: (_m, snap) => {
      const variant = snap.pack?.variant || snap.processName.toLowerCase()
      const configPath = APP_CONFIG_PATHS[variant]
      if (!configPath) return null
      return {
        actions: [{ actionId: 'reveal-in-folder', params: { path: resolveEnvPath(configPath) } }],
        explanation: `Config for ${snap.activeApp}: ${configPath}`,
      }
    },
  },

  // ── Notifications & Reminders ──

  {
    id: 'mute-notifications',
    patterns: [
      /mute\s+(?:all\s+)?notifications?\s+(?:for\s+)?(\d+)\s*(hours?|minutes?|mins?|hrs?)/i,
      /(?:do\s+not\s+disturb|dnd)\s+(?:for\s+)?(\d+)\s*(hours?|minutes?|mins?|hrs?)/i,
    ],
    resolve: (m, _snap) => {
      const n = parseInt(m[1], 10)
      const unit = m[2].startsWith('h') ? 'hours' : 'minutes'
      const seconds = unit === 'hours' ? n * 3600 : n * 60
      return {
        actions: [{ actionId: 'set-dnd', params: { durationSeconds: seconds } }],
        explanation: `Muting for ${n} ${unit}`,
      }
    },
  },

  {
    id: 'set-reminder-timed',
    patterns: [
      /remind\s+me\s+in\s+(\d+)\s*(hours?|minutes?|mins?|hrs?)\s+(?:to\s+)?(.+)/i,
      /set\s+(?:a\s+)?reminder\s+(?:in\s+)?(\d+)\s*(hours?|minutes?|mins?|hrs?)\s+(?:to\s+)?(.+)/i,
    ],
    resolve: (m, _snap) => {
      const n = parseInt(m[1], 10)
      const unit = m[2].startsWith('h') ? 'hours' : 'minutes'
      const message = m[3].trim()
      const seconds = unit === 'hours' ? n * 3600 : n * 60
      return {
        actions: [{ actionId: 'set-reminder', params: { message, delaySeconds: seconds } }],
        explanation: `Reminder in ${n} ${unit}: "${message}"`,
      }
    },
  },

  {
    id: 'set-reminder-event',
    patterns: [
      /remind\s+me\s+when\s+(.+?)(?:\s+finishes?|\s+(?:is\s+)?done|\s+completes?)/i,
    ],
    resolve: (m, _snap) => {
      // "remind me when Claude finishes" → watch for process exit or activity change
      const target = m[1].trim()
      return {
        actions: [{ actionId: 'watch-and-remind', params: { target, event: 'finish' } }],
        explanation: `Will notify when ${target} finishes`,
      }
    },
  },

  // ── Bookmarking ──

  {
    id: 'bookmark-and-remind',
    patterns: [
      /bookmark\s+this\s+and\s+remind\s+me\s+(tomorrow|tonight|later|in\s+\d+\s*\w+)/i,
    ],
    resolve: (m, snap) => {
      const context = snap.browser?.url || snap.editor?.openFile || snap.windowTitle
      const when = m[1].trim()
      const delaySeconds = parseRelativeTime(when)
      return {
        actions: [
          { actionId: 'save-note', params: { text: `Bookmarked: ${context}`, title: `Bookmark — ${snap.activeApp}` } },
          ...(delaySeconds ? [{ actionId: 'set-reminder', params: { message: `Check bookmark: ${context}`, delaySeconds } }] : []),
        ],
      }
    },
  },

  // ── Error & debugging ──

  {
    id: 'open-error-docs',
    patterns: [
      /open\s+(?:the\s+)?docs?\s+(?:for\s+)?(?:this\s+)?error/i,
      /look\s+up\s+(?:this\s+)?error/i,
      /search\s+(?:for\s+)?(?:this\s+)?error/i,
    ],
    resolve: (_m, snap) => {
      const errorText = snap.clipboard || ''
      if (!errorText) return null
      const query = encodeURIComponent(errorText.slice(0, 200))
      return {
        actions: [{ actionId: 'search-web', params: { query: errorText.slice(0, 200) } }],
      }
    },
  },

  {
    id: 'find-file-stacktrace',
    patterns: [
      /find\s+(?:the\s+)?file\s+(?:related\s+to|from|in)\s+(?:this\s+)?(?:stack\s*trace|error|traceback)/i,
      /open\s+(?:the\s+)?file\s+(?:from|in)\s+(?:this\s+)?(?:stack\s*trace|error)/i,
    ],
    resolve: (_m, snap) => {
      const text = snap.clipboard || ''
      // Extract file paths from stack traces
      const fileMatch = text.match(/(?:at\s+)?([A-Za-z]:\\[^\s:]+|\/[^\s:]+\.[a-z]+)(?::(\d+))?/m)
        || text.match(/File "([^"]+)", line (\d+)/m)  // Python
        || text.match(/([^\s]+\.[a-z]{1,4}):(\d+)/m)  // generic file:line
      if (!fileMatch) return null
      return {
        actions: [{ actionId: 'open-file', params: { path: fileMatch[1] } }],
        explanation: `Opening ${fileMatch[1]}${fileMatch[2] ? ` at line ${fileMatch[2]}` : ''}`,
      }
    },
  },

  // ── App switching ──

  {
    id: 'switch-to-app',
    patterns: [
      /(?:switch|go)\s+(?:to|back\s+to)\s+(.+)/i,
      /open\s+(.+?)(?:\s+app)?$/i,
    ],
    resolve: (m, _snap) => {
      const target = m[1].trim()
      return {
        actions: [{ actionId: 'switch-app', params: { processName: target } }],
      }
    },
  },
]
```

### `src/main/intent/resolver.ts`

```ts
import { PATTERNS } from './patterns'
import { resolveLLM } from './llm-resolver'
import type { ActionPlan, DesktopSnapshot } from './types'

export function matchPattern(utterance: string, snapshot: DesktopSnapshot): ActionPlan | null {
  for (const pattern of PATTERNS) {
    for (const re of pattern.patterns) {
      const match = utterance.match(re)
      if (match) {
        const plan = pattern.resolve(match, snapshot)
        if (plan) return { ...plan, confidence: 1.0 }
      }
    }
  }
  return null
}

export async function resolveIntent(
  utterance: string,
  snapshot: DesktopSnapshot
): Promise<ActionPlan> {
  // Tier 1: pattern match
  const patternResult = matchPattern(utterance, snapshot)
  if (patternResult) return patternResult

  // Tier 2: LLM fallback
  return resolveLLM(utterance, snapshot)
}
```

### `src/main/intent/llm-resolver.ts`

For when patterns don't match — uses a fast, cheap model with structured output:

```ts
const INTENT_SYSTEM_PROMPT = `You are an intent resolver for OmniCue, a desktop AI assistant.
Given a user's request and their current desktop context, output a JSON action plan.

Available actions:
{ACTION_REGISTRY_JSON}

Current desktop context:
{SNAPSHOT_JSON}

Respond ONLY with valid JSON:
{
  "actions": [{ "actionId": "...", "params": { ... } }],
  "explanation": "what you're doing and why",
  "confidence": 0.0-1.0,
  "needsConfirmation": true/false
}

If the intent is unclear or can't be resolved to an action:
{ "actions": [], "fallback": "ask", "question": "your clarifying question" }

Rules:
- Use params from the desktop context (file paths, URLs, app names)
- Prefer specific, concrete actions over vague ones
- Set needsConfirmation=true for anything destructive
- confidence < 0.7 means you're guessing — flag it`

export async function resolveLLM(utterance: string, snapshot: DesktopSnapshot): Promise<ActionPlan> {
  // Use Claude Haiku or similar fast model
  // Parse JSON response → ActionPlan
  // If confidence < threshold, add needsConfirmation: true
}
```

---

## Part 5: New Actions

Add to `src/main/actions/registry.ts`:

```ts
// ── Safe ──
{
  id: 'set-reminder',
  name: 'Set reminder',
  tier: 'safe',
  category: 'notifications',
  description: 'Create a timed reminder that fires as an OmniCue notification',
  params: [
    { name: 'message', type: 'string', required: true, description: 'Reminder message' },
    { name: 'delaySeconds', type: 'number', required: true, description: 'Seconds until reminder fires' },
  ],
},
{
  id: 'search-web',
  name: 'Search the web',
  tier: 'safe',
  category: 'navigation',
  description: 'Open a web search for a query',
  params: [
    { name: 'query', type: 'string', required: true, description: 'Search query' },
  ],
},
{
  id: 'find-file',
  name: 'Find file',
  tier: 'safe',
  category: 'os',
  description: 'Search for files matching a name pattern and return their paths',
  params: [
    { name: 'pattern', type: 'string', required: true, description: 'File name or glob pattern' },
    { name: 'startDir', type: 'string', required: false, description: 'Directory to search in (defaults to user home)' },
  ],
},
{
  id: 'list-running-apps',
  name: 'List running apps',
  tier: 'safe',
  category: 'os',
  description: 'List all applications with visible windows',
  params: [],
},

// ── Guided ──
{
  id: 'set-dnd',
  name: 'Do Not Disturb',
  tier: 'guided',
  category: 'notifications',
  description: 'Suppress OmniCue notifications for a duration',
  params: [
    { name: 'durationSeconds', type: 'number', required: true, description: 'How long to mute (seconds)' },
  ],
},
```

Handlers in `safe.ts` and `guided.ts`:

```ts
// safe.ts
'set-reminder': async (params, mainWin) => {
  const message = String(params.message ?? '')
  const delay = Number(params.delaySeconds ?? 0)
  if (!message || delay <= 0) return fail('set-reminder', T, 'message and delaySeconds required')

  setTimeout(() => {
    if (mainWin && !mainWin.isDestroyed()) {
      mainWin.webContents.send('new-notification', {
        id: Math.random().toString(36).substring(2, 9),
        message,
        title: 'Reminder',
        timeout: 60,
        createdAt: Date.now(),
      })
    }
  }, delay * 1000)

  const mins = Math.round(delay / 60)
  return ok('set-reminder', T, `Reminder set for ${mins > 0 ? mins + ' min' : delay + 's'}: "${message}"`)
},

'search-web': async (params) => {
  const query = String(params.query ?? '')
  if (!query) return fail('search-web', T, 'query is required')
  const url = `https://www.google.com/search?q=${encodeURIComponent(query)}`
  await shell.openExternal(url)
  return ok('search-web', T, `Searching: ${query}`)
},

'find-file': async (params) => {
  const pattern = String(params.pattern ?? '')
  if (!pattern) return fail('find-file', T, 'pattern is required')
  const startDir = String(params.startDir || homedir())
  // Use PowerShell Get-ChildItem for fast recursive search
  const script = `Get-ChildItem -Path "${startDir}" -Filter "${pattern}" -Recurse -ErrorAction SilentlyContinue -Depth 5 | Select-Object -First 10 -ExpandProperty FullName`
  const result = await runPsCommand(script, 5000)
  return ok('find-file', T, result || 'No files found')
},

'list-running-apps': async () => {
  const script = `Get-Process | Where-Object { $_.MainWindowTitle -ne '' } | Select-Object -Unique ProcessName | Sort-Object ProcessName | Select-Object -ExpandProperty ProcessName`
  const result = await runPsCommand(script, 3000)
  return ok('list-running-apps', T, result)
},
```

---

## Part 6: Integration

### HTTP API — `POST /intent`

Add to `src/main/server.ts`:

```ts
if (url === '/intent' && req.method === 'POST') {
  try {
    const body = await parseBody(req)
    const utterance = typeof body.utterance === 'string' ? body.utterance : ''
    if (!utterance) {
      localJson(res, 400, { error: 'utterance is required' })
      return
    }

    const snapshot = await collectSnapshot(mainWin)
    const plan = await resolveIntent(utterance, snapshot)

    if (plan.fallback === 'ask') {
      localJson(res, 200, { resolved: false, question: plan.question })
      return
    }

    // Auto-execute safe actions, return plan for others
    const autoExecute = body.execute !== false
    let results: ActionResult[] | undefined

    if (autoExecute && plan.actions.length > 0) {
      results = []
      for (const step of plan.actions) {
        const def = ACTION_REGISTRY.find(a => a.id === step.actionId)
        if (def && (def.tier === 'safe' || (def.tier === 'guided' && !plan.needsConfirmation))) {
          const result = await executeAction({ actionId: step.actionId, params: step.params }, mainWin)
          results.push(result)
        } else {
          // Return plan without executing — needs confirmation
          localJson(res, 200, { resolved: true, plan, executed: false, reason: 'requires_confirmation' })
          return
        }
      }
    }

    localJson(res, 200, {
      resolved: true,
      plan,
      executed: autoExecute,
      results,
      context: { pack: snapshot.pack?.id, app: snapshot.activeApp },
    })
  } catch (err) {
    localJson(res, 500, { error: 'Intent resolution failed' })
  }
  return
}
```

### Desktop Tools Prompt update in `ai.ts`

```ts
// Add to DESKTOP_TOOLS_PROMPT:
`
## Intent Resolution
When the user gives a natural-language command about their desktop:
- \`curl.exe -s -X POST http://127.0.0.1:19191/intent -H "Content-Type: application/json" -d '{"utterance":"open project folder"}'\`
- Resolves the intent using current desktop context and executes safe actions automatically
- Returns: { resolved, plan, executed, results, context }
- For dangerous actions, pass execute: false and confirm with the user first

## Rich Context Snapshot
- \`curl.exe -s http://127.0.0.1:19191/snapshot\` — full desktop snapshot including parsed editor/terminal/browser context, running apps, and focus history
`
```

### `GET /snapshot` endpoint

```ts
if (url === '/snapshot' && req.method === 'GET') {
  try {
    const snapshot = await collectSnapshot(mainWin)
    localJson(res, 200, snapshot as unknown as Record<string, unknown>)
  } catch {
    localJson(res, 500, { error: 'Failed to collect snapshot' })
  }
  return
}
```

---

## File Structure Summary

```
src/main/context/
  types.ts                    ← DesktopSnapshot, EditorContext, etc.
  collector.ts                ← collectSnapshot() orchestrator
  focus-history.ts            ← ring buffer for app switches
  extractors/
    editor.ts                 ← workspace path, open file, dirty state
    terminal.ts               ← cwd, shell type, admin
    browser.ts                ← URL via UI Automation + title fallback
    explorer.ts               ← current path from title
    system.ts                 ← running apps, focus history

src/main/intent/
  types.ts                    ← ActionPlan, IntentPattern
  resolver.ts                 ← resolveIntent() — pattern then LLM
  patterns.ts                 ← regex-based pattern definitions
  llm-resolver.ts             ← structured Haiku call for ambiguous intents

src/main/actions/registry.ts  ← + set-reminder, search-web, find-file, list-running-apps, set-dnd
src/main/actions/safe.ts      ← + handlers for new safe actions
src/main/actions/guided.ts    ← + set-dnd handler
src/main/server.ts            ← + POST /intent, GET /snapshot
src/main/ai.ts                ← + updated DESKTOP_TOOLS_PROMPT
src/main/index.ts             ← + focus history sampling interval
```

---

## Build Order

### Phase 1: Context foundation
1. `src/main/context/types.ts`
2. `src/main/context/focus-history.ts` + hook into `index.ts`
3. `src/main/context/extractors/editor.ts`
4. `src/main/context/extractors/terminal.ts`
5. `src/main/context/extractors/explorer.ts`
6. `src/main/context/extractors/system.ts`
7. `src/main/context/collector.ts`
8. `GET /snapshot` endpoint

### Phase 2: Intent resolution
9. `src/main/intent/types.ts`
10. `src/main/intent/patterns.ts`
11. `src/main/intent/resolver.ts`
12. New actions: registry entries + handlers

### Phase 3: Integration
13. `POST /intent` endpoint
14. Update `DESKTOP_TOOLS_PROMPT` in ai.ts
15. Wire into companion panel for inline intent detection

### Phase 4: Browser URL extraction
16. `src/main/context/extractors/browser.ts` with UI Automation
17. Test across Chrome, Edge, Firefox
18. Fallback to title-only parsing on timeout

### Phase 5: LLM fallback resolver
19. `src/main/intent/llm-resolver.ts`
20. Confidence thresholds + confirmation UX

---

## Open Questions

1. **Should `/intent` auto-execute or return the plan for confirmation?** Recommend: auto-execute safe tier, return plan for guided/dangerous.
2. **Which LLM for Tier 2?** Haiku is fast and cheap. Could also use a local model.
3. **Browser URL: UI Automation or extension?** Start with UI Automation (zero install), add extension later.
4. **Should the companion panel always try intent resolution on short imperative messages?** Or use an explicit trigger?
