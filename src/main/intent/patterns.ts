import { isAbsolute, join } from 'path'
import type { DesktopSnapshot } from '../context/types'
import type { ActionPlan, IntentPattern } from './types'

function parseDelaySeconds(amountText: string, unitText: string): number | null {
  const amount = Number.parseInt(amountText, 10)
  if (!Number.isFinite(amount) || amount <= 0) return null

  const unit = unitText.toLowerCase()
  if (unit.startsWith('h')) return amount * 3600
  return amount * 60
}

function resolveErrorPath(text: string, snapshot: DesktopSnapshot): { path: string; line?: number } | null {
  const match =
    text.match(/(?:at\s+)?([A-Za-z]:\\[^\s:]+|\/[^\s:]+\.[a-z0-9]+)(?::(\d+))?/im) ||
    text.match(/File "([^"]+)", line (\d+)/i) ||
    text.match(/([A-Za-z0-9_./\\-]*[/\\][A-Za-z0-9_./\\-]+\.[a-z0-9]{1,8}):(\d+)/i)

  if (!match?.[1]) return null

  const candidate = match[1]
  const absolutePath = isAbsolute(candidate)
    ? candidate
    : snapshot.editor?.workspacePath
      ? join(snapshot.editor.workspacePath, candidate)
      : ''

  if (!absolutePath) return null

  return {
    path: absolutePath,
    line: match[2] ? Number.parseInt(match[2], 10) : undefined,
  }
}

function ensureAbsoluteFile(path?: string): string | null {
  if (!path) return null
  return isAbsolute(path) ? path : null
}

function buildPlan(plan: ActionPlan): ActionPlan {
  return { ...plan, confidence: plan.confidence ?? 1 }
}

export const PATTERNS: IntentPattern[] = [
  {
    id: 'open-project-folder',
    patterns: [
      /open\s+(?:the\s+)?folder\s+(?:for\s+)?(?:this\s+)?project/i,
      /open\s+(?:the\s+)?(?:files?|project)\s+(?:for\s+)?(?:this\s+)?project/i,
      /reveal\s+(?:the\s+)?(?:files?|folder|project)\s+(?:for\s+)?(?:this\s+)?project/i,
      /show\s+(?:this\s+)?project\s+(?:in\s+)?(?:explorer|file\s*manager|finder)/i,
      /reveal\s+(?:this\s+)?project/i,
      /open\s+(?:this|the)\s+(?:folder|directory)\s*(?:in\s+)?(?:explorer|file\s*manager|finder)?/i,
      /show\s+(?:this|the)\s+(?:folder|directory)\s+in\s+(?:explorer|file\s*manager|finder)/i,
    ],
    resolve: (_match, snapshot) => {
      const path =
        snapshot.editor?.workspacePath ||
        snapshot.terminal?.cwd ||
        snapshot.fileExplorer?.currentPath
      if (!path) return null

      return buildPlan({
        actions: [{ actionId: 'reveal-in-folder', params: { path } }],
        explanation: `Reveal the current project folder: ${path}`,
      })
    },
  },
  {
    id: 'open-specific-folder',
    patterns: [
      /(?:open|show|reveal|pull\s+up)\s+(?:the\s+)?(?:folder|directory|path)?\s*["']?([A-Za-z]:\\[^\s"']+|\/[^\s"']+|~\/[^\s"']+)["']?\s*(?:in\s+)?(?:explorer|file\s*manager|finder)?/i,
      /(?:open|show|reveal|pull\s+up)\s+["']?([A-Za-z]:\\[^\s"']+|\/[^\s"']+|~\/[^\s"']+)["']?\s+(?:in\s+)?(?:explorer|file\s*manager|finder)/i,
    ],
    resolve: (match) => {
      let path = match[1]?.trim()
      if (!path) return null
      // Expand ~ to home directory
      if (path.startsWith('~/') || path === '~') {
        path = join(process.env.HOME || process.env.USERPROFILE || '', path.slice(1))
      }

      return buildPlan({
        actions: [{ actionId: 'reveal-in-folder', params: { path } }],
        explanation: `Open ${path} in file explorer`,
      })
    },
  },
  {
    id: 'open-it-in-explorer',
    patterns: [
      /(?:open|show|reveal|pull\s+up)\s+(?:it|that|this)\s+(?:in\s+)?(?:explorer|file\s*manager|finder|files)/i,
      /(?:pull|bring)\s+(?:it|that|this)\s+up\s+(?:in\s+)?(?:explorer|file\s*manager|finder|files)?/i,
      /(?:open|show|reveal)\s+(?:it|that|this)\s+(?:in\s+)?(?:the\s+)?(?:file\s*)?(?:explorer|manager|finder|browser)/i,
    ],
    resolve: (_match, snapshot) => {
      // Resolve "it" from context: terminal CWD > clipboard path > editor workspace > file explorer
      const candidates = [
        snapshot.terminal?.cwd,
        snapshot.clipboard?.trim(),
        snapshot.editor?.workspacePath,
        snapshot.fileExplorer?.currentPath,
      ]

      for (const candidate of candidates) {
        if (candidate && (isAbsolute(candidate) || candidate.match(/^[A-Za-z]:\\/))) {
          return buildPlan({
            actions: [{ actionId: 'reveal-in-folder', params: { path: candidate } }],
            explanation: `Open ${candidate} in file explorer`,
          })
        }
      }

      return null
    },
  },
  {
    id: 'open-current-file',
    patterns: [
      /^open\s+(?:this|the)\s+file(?:\s+(?:please|now))?[?.!]?$/i,
      /^reveal\s+(?:this|the)\s+file(?:\s+(?:please|now))?[?.!]?$/i,
    ],
    resolve: (_match, snapshot) => {
      const filePath = ensureAbsoluteFile(snapshot.editor?.openFile)
      if (!filePath) return null

      return buildPlan({
        actions: [{ actionId: 'open-file', params: { path: filePath } }],
        explanation: `Open the current file: ${filePath}`,
      })
    },
  },
  {
    id: 'set-reminder',
    patterns: [
      /remind\s+me\s+in\s+(\d+)\s*(hours?|hrs?|minutes?|mins?)\s+(?:to\s+)?(.+)/i,
      /set\s+(?:a\s+)?reminder\s+(?:for|in)\s+(\d+)\s*(hours?|hrs?|minutes?|mins?)\s+(?:to\s+)?(.+)/i,
    ],
    resolve: (match) => {
      const delaySeconds = parseDelaySeconds(match[1], match[2])
      const message = match[3]?.trim()
      if (!delaySeconds || !message) return null

      return buildPlan({
        actions: [{ actionId: 'set-reminder', params: { message, delaySeconds } }],
        explanation: `Set a reminder for ${message}`,
      })
    },
  },
  {
    id: 'search-error-docs',
    patterns: [
      /open\s+(?:the\s+)?docs?\s+(?:for\s+)?(?:this\s+)?error/i,
      /look\s+up\s+(?:this\s+)?error/i,
      /search\s+(?:for\s+)?(?:this\s+)?error/i,
    ],
    resolve: (_match, snapshot) => {
      const query = snapshot.clipboard?.trim()
      if (!query) return null

      return buildPlan({
        actions: [{ actionId: 'search-web', params: { query: query.slice(0, 200) } }],
        explanation: 'Search the web for the copied error text',
      })
    },
  },
  {
    id: 'find-stacktrace-file',
    patterns: [
      /find\s+(?:the\s+)?file\s+(?:from|in|for)\s+(?:this\s+)?(?:error|stack\s*trace|traceback)/i,
      /open\s+(?:the\s+)?file\s+(?:from|in)\s+(?:this\s+)?(?:error|stack\s*trace|traceback)/i,
    ],
    resolve: (_match, snapshot) => {
      const text = snapshot.clipboard?.trim()
      if (!text) return null

      const resolved = resolveErrorPath(text, snapshot)
      if (!resolved) return null

      return buildPlan({
        actions: [{ actionId: 'open-file', params: { path: resolved.path } }],
        explanation: resolved.line
          ? `Open ${resolved.path} (stack trace points to line ${resolved.line})`
          : `Open ${resolved.path}`,
      })
    },
  },
  {
    id: 'find-file',
    patterns: [
      /find\s+(?:the\s+)?file\s+(?:named\s+)?["']?([^"']+)["']?/i,
      /search\s+for\s+(?:a\s+)?file\s+(?:named\s+)?["']?([^"']+)["']?/i,
    ],
    resolve: (match, snapshot) => {
      const pattern = match[1]?.trim()
      if (!pattern) return null

      return buildPlan({
        actions: [
          {
            actionId: 'find-file',
            params: {
              pattern,
              startDir: snapshot.editor?.workspacePath,
            },
          },
        ],
        explanation: `Search for files matching ${pattern}`,
      })
    },
  },
  {
    id: 'list-running-apps',
    patterns: [
      /(?:what|which)\s+apps?\s+(?:are\s+)?running/i,
      /list\s+running\s+apps?/i,
    ],
    resolve: () =>
      buildPlan({
        actions: [{ actionId: 'list-running-apps', params: {} }],
        explanation: 'List visible running applications',
      }),
  },
  {
    id: 'switch-to-app',
    patterns: [
      /(?:switch|go)\s+(?:to|back\s+to)\s+(.+)/i,
      /^focus\s+(?:on\s+)?(.+?)(?:\s+app)?$/i,
      /open\s+(.+?)\s+app$/i,
    ],
    resolve: (match) => {
      const processName = match[1]?.trim()
      if (!processName) return null

      return buildPlan({
        actions: [{ actionId: 'switch-app', params: { processName } }],
        explanation: `Switch to ${processName}`,
        needsConfirmation: true,
      })
    },
  },
]

// ── Best-candidate pattern matcher ───────────────────────────────────────────

/**
 * Run all patterns against the utterance, collect candidates, return the best one.
 * Sorts by priority (lower first), then confidence (higher first).
 */
export function matchPatterns(
  utterance: string,
  snapshot: DesktopSnapshot
): ActionPlan | null {
  const candidates: Array<ActionPlan & { patternId: string; priority: number }> = []

  for (const pattern of PATTERNS) {
    for (const regex of pattern.patterns) {
      const match = utterance.match(regex)
      if (!match) continue

      const plan = pattern.resolve(match, snapshot)
      if (plan) {
        candidates.push({
          ...plan,
          patternId: pattern.id,
          priority: pattern.priority ?? 50,
          confidence: plan.confidence ?? 1,
        })
      }
      break // one regex hit per pattern is enough
    }
  }

  if (candidates.length === 0) return null

  candidates.sort(
    (a, b) => a.priority - b.priority || (b.confidence ?? 0) - (a.confidence ?? 0)
  )
  return candidates[0]
}
