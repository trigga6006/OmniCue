/** Error packet assembly — combines terminal buffer, stack trace, source, and git context. */

import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import type { ErrorPacket, StackFrame } from './types'
import { parseStackTrace, getTopProjectFrame } from '../ide-bridge/stack-trace'
import { getGitDiff } from './git'
import { findProjectRoot } from './project-root'

const ERROR_PATTERN = /error|failed|exception|traceback|fatal|panic|denied|not found|command not found|segfault|abort/i

const LANG_FROM_EXT: Record<string, string> = {
  '.ts': 'typescript', '.tsx': 'typescript', '.js': 'javascript', '.jsx': 'javascript',
  '.py': 'python', '.rb': 'ruby', '.rs': 'rust', '.go': 'go', '.java': 'java',
  '.kt': 'kotlin', '.cs': 'csharp', '.cpp': 'cpp', '.c': 'c',
}

const CONTEXT_LINES = 10 // lines above/below the error line

/** Build an error packet from terminal buffer lines. */
export async function buildErrorPacket(
  bufferLines: string[],
  cwd: string | null
): Promise<ErrorPacket> {
  // Check if there's actually an error in the buffer
  const hasError = bufferLines.some(l => ERROR_PATTERN.test(l))
  if (!hasError) {
    return { detected: false, packet: null }
  }

  // Find the error region — last occurrence of error pattern
  let errorStartIdx = -1
  for (let i = bufferLines.length - 1; i >= 0; i--) {
    if (ERROR_PATTERN.test(bufferLines[i])) {
      errorStartIdx = i
      break
    }
  }

  // Extract surrounding context
  const contextStart = Math.max(0, errorStartIdx - 10)
  const contextEnd = Math.min(bufferLines.length, errorStartIdx + 10)
  const terminalContext = bufferLines.slice(contextStart, contextEnd)

  // Parse the error region as a stack trace
  const errorText = bufferLines.slice(contextStart).join('\n')
  const parsed = parseStackTrace(errorText, cwd || undefined)

  // Get source context for the top project frame
  let sourceContext: ErrorPacket['packet'] extends null ? never : NonNullable<ErrorPacket['packet']>['sourceContext'] = null
  const topFrame = getTopProjectFrame(parsed)
  if (topFrame?.file && topFrame.line && topFrame.exists) {
    sourceContext = readSourceContext(topFrame.file, topFrame.line)
  }

  // Get git diff for the error file if available
  let gitDiff: string | null = null
  const projectCwd = cwd || (topFrame?.file ? findProjectRoot(topFrame.file)?.root : null) || null
  if (projectCwd && topFrame?.file) {
    try {
      const diff = await getGitDiff(projectCwd, { file: topFrame.file })
      if (diff?.diff) gitDiff = diff.diff
    } catch { /* git diff is best-effort */ }
  }

  // Detect project type
  const project = projectCwd ? findProjectRoot(projectCwd) : null

  // Build suggested actions
  const suggestedActions = buildSuggestedActions(parsed, topFrame)

  return {
    detected: true,
    packet: {
      errorMessage: parsed.errorMessage || terminalContext.find(l => ERROR_PATTERN.test(l)) || 'Unknown error',
      errorType: parsed.errorType,
      stackTrace: parsed.frames.length > 0 ? parsed.frames : null,
      terminalContext,
      sourceContext,
      gitDiff,
      project: {
        type: project?.type || null,
        cwd: projectCwd,
      },
      suggestedActions,
    },
  }
}

function readSourceContext(
  filePath: string,
  errorLine: number
): { file: string; startLine: number; endLine: number; content: string; language: string | null } | null {
  try {
    if (!existsSync(filePath)) return null
    const content = readFileSync(filePath, 'utf-8')
    const lines = content.split(/\r?\n/)

    const startLine = Math.max(1, errorLine - CONTEXT_LINES)
    const endLine = Math.min(lines.length, errorLine + CONTEXT_LINES)
    const contextLines = lines.slice(startLine - 1, endLine)

    const ext = extname(filePath)
    const language = LANG_FROM_EXT[ext] || null

    return {
      file: filePath,
      startLine,
      endLine,
      content: contextLines.join('\n'),
      language,
    }
  } catch {
    return null
  }
}

function buildSuggestedActions(
  parsed: ReturnType<typeof parseStackTrace>,
  topFrame: StackFrame | null
): string[] {
  const actions: string[] = []

  if (topFrame?.file && topFrame.line) {
    actions.push(`Open ${topFrame.file}:${topFrame.line}`)
  }

  if (parsed.errorType) {
    const type = parsed.errorType.toLowerCase()
    if (type.includes('modulenotfound') || type.includes('cannot find module')) {
      actions.push('Run npm install / pip install')
    }
    if (type.includes('syntaxerror')) {
      actions.push('Check syntax at the indicated line')
    }
    if (type.includes('typeerror')) {
      actions.push('Check type annotations and function signatures')
    }
    if (type.includes('permission') || type.includes('access')) {
      actions.push('Check file permissions')
    }
  }

  if (parsed.errorMessage) {
    if (/ENOENT|no such file/i.test(parsed.errorMessage)) {
      actions.push('Verify the file path exists')
    }
    if (/ECONNREFUSED|connection refused/i.test(parsed.errorMessage)) {
      actions.push('Check if the target service is running')
    }
  }

  return actions
}
