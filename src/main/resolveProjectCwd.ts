import { existsSync, readdirSync, statSync } from 'fs'
import { homedir } from 'os'
import { basename, dirname, join, normalize } from 'path'

interface MessagePartLike {
  type?: string
  text?: string
}

interface MessageLike {
  role: string
  content: string | MessagePartLike[] | unknown
  ocrText?: string
  screenshotTitle?: string
  manualScreenshotTitle?: string
}

const WINDOWS_PROMPT_PATTERN = /(?:^|\n)(?:PS\s+)?([A-Z]:\\[^>\r\n]+)>/gi
const WINDOWS_PATH_PATTERN = /([A-Z]:\\(?:[^\\/:*?"<>|\r\n]+\\)*[^\\/:*?"<>|\r\n]*)/g
const UNIX_HOME_PATTERN = /(~\/[^\s`"'<>|]+(?:\/[^\s`"'<>|]+)*)/g
const UNIX_ABS_PATTERN = /(\/(?:Users|home)\/[^\s`"'<>|]+(?:\/[^\s`"'<>|]+)*)/g
const UNIX_PROMPT_PATTERN = /:[ \t]?(~?\/[^\s$#]+(?:\/[^\s$#]+)*)[$#]/g
const IDE_TITLE_PATTERN =
  /([^\r\n]+?)\s*(?:—|–|-)\s*(?:Visual Studio Code|VS Code|WebStorm|Cursor|IntelliJ|PyCharm)/gi

const REPO_MARKERS = ['.git', 'package.json', 'pyproject.toml', 'Cargo.toml', 'go.mod']
const SKIP_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'out', '.next'])

function textOf(msg: MessageLike): string {
  if (typeof msg.content === 'string') return msg.content
  if (Array.isArray(msg.content)) {
    return msg.content
      .filter((part) => part.type === 'text')
      .map((part) => part.text || '')
      .join('\n')
  }
  return ''
}

function extractPathHints(text: string): string[] {
  const hints: string[] = []
  const patterns = [
    WINDOWS_PROMPT_PATTERN,
    WINDOWS_PATH_PATTERN,
    UNIX_HOME_PATTERN,
    UNIX_ABS_PATTERN,
    UNIX_PROMPT_PATTERN,
  ]

  for (const pattern of patterns) {
    pattern.lastIndex = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(text)) !== null) {
      const captured = match[1] || match[0]
      if (captured && captured.length > 2) {
        hints.push(captured)
      }
    }
  }

  return hints
}

function extractProjectHints(text: string): string[] {
  const hints: string[] = []
  IDE_TITLE_PATTERN.lastIndex = 0

  let match: RegExpExecArray | null
  while ((match = IDE_TITLE_PATTERN.exec(text)) !== null) {
    const captured = match[1]?.trim()
    if (captured) {
      hints.push(captured)
    }
  }

  return hints
}

function expandHome(candidate: string): string {
  if (candidate === '~') return homedir()
  if (candidate.startsWith('~/')) {
    return join(homedir(), candidate.slice(2))
  }
  return candidate
}

function trimPathCandidate(value: string): string {
  return value
    .trim()
    .replace(/^["'`]+|["'`]+$/g, '')
    .replace(/[>,;]+$/g, '')
}

function resolveExistingDirectory(rawHint: string): string | null {
  let candidate = normalize(expandHome(trimPathCandidate(rawHint)))
  if (!candidate) return null

  while (true) {
    if (existsSync(candidate)) {
      try {
        const stats = statSync(candidate)
        return stats.isDirectory() ? candidate : dirname(candidate)
      } catch {
        return null
      }
    }

    const parent = dirname(candidate)
    if (parent === candidate) return null
    candidate = parent
  }
}

function findCandidateRoots(root: string, depth = 3): string[] {
  const candidates: string[] = []
  const seen = new Set<string>()

  function walk(current: string, remainingDepth: number): void {
    if (seen.has(current)) return
    seen.add(current)

    let entries: string[]
    try {
      entries = readdirSync(current)
    } catch {
      return
    }

    if (REPO_MARKERS.some((marker) => existsSync(join(current, marker)))) {
      candidates.push(current)
    }

    if (remainingDepth <= 0) return

    for (const entry of entries) {
      if (SKIP_DIRS.has(entry)) continue

      const fullPath = join(current, entry)
      try {
        if (statSync(fullPath).isDirectory()) {
          walk(fullPath, remainingDepth - 1)
        }
      } catch {
        // Ignore unreadable directories.
      }
    }
  }

  walk(root, depth)
  return candidates
}

function gatherRecentContext(messages: MessageLike[]): string {
  return messages
    .filter((message) => message.role === 'user')
    .slice(-3)
    .map((message) =>
      [
        textOf(message),
        message.ocrText || '',
        message.screenshotTitle || '',
        message.manualScreenshotTitle || '',
      ].join('\n')
    )
    .join('\n')
}

export function resolveProjectCwd(messages: MessageLike[], devRootPath: string): string {
  const allText = gatherRecentContext(messages)
  const pathHints = extractPathHints(allText)
  const projectHints = extractProjectHints(allText)

  for (const hint of pathHints) {
    const resolved = resolveExistingDirectory(hint)
    if (resolved) {
      return resolved
    }
  }

  if (devRootPath) {
    const normalizedRoot = normalize(devRootPath)
    if (existsSync(normalizedRoot)) {
      const candidates = findCandidateRoots(normalizedRoot)
      const candidateNames = candidates.map((candidate) => basename(candidate).toLowerCase())
      const allHints = [...pathHints, ...projectHints].map((hint) =>
        hint.toLowerCase().replace(/\\/g, '/')
      )

      for (const hint of allHints) {
        for (let i = 0; i < candidateNames.length; i += 1) {
          if (candidateNames[i].length > 1 && hint.includes(candidateNames[i])) {
            return candidates[i]
          }
        }
      }

      return normalizedRoot
    }
  }

  return homedir()
}
