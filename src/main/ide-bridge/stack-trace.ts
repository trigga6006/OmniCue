/** Multi-language stack trace parser with local file resolution. */

import { existsSync } from 'fs'
import { isAbsolute, join, normalize } from 'path'
import type { StackFrame, ParsedStackTrace } from '../terminal-bridge/types'

// ── Parser patterns per language ────────────────────────────────────────────

interface FrameParser {
  language: string
  errorPattern: RegExp
  framePattern: RegExp
  parse: (match: RegExpMatchArray) => Omit<StackFrame, 'raw' | 'exists' | 'isProjectFile'>
}

const PARSERS: FrameParser[] = [
  // Node.js / JavaScript / TypeScript
  {
    language: 'javascript',
    errorPattern: /^(\w*Error):\s*(.+)$/,
    framePattern: /^\s+at\s+(?:(.+?)\s+\()?(.+?):(\d+):(\d+)\)?$/,
    parse: (m) => ({
      function: m[1] || null,
      file: m[2],
      line: parseInt(m[3], 10),
      column: parseInt(m[4], 10),
    }),
  },
  // Node.js without column
  {
    language: 'javascript',
    errorPattern: /^(\w*Error):\s*(.+)$/,
    framePattern: /^\s+at\s+(?:(.+?)\s+\()?(.+?):(\d+)\)?$/,
    parse: (m) => ({
      function: m[1] || null,
      file: m[2],
      line: parseInt(m[3], 10),
      column: null,
    }),
  },
  // Python
  {
    language: 'python',
    errorPattern: /^(\w*Error|\w*Exception):\s*(.+)$/,
    framePattern: /^\s+File\s+"(.+?)",\s+line\s+(\d+)(?:,\s+in\s+(.+))?$/,
    parse: (m) => ({
      file: m[1],
      line: parseInt(m[2], 10),
      column: null,
      function: m[3] || null,
    }),
  },
  // Go
  {
    language: 'go',
    errorPattern: /^(?:panic|fatal error):\s*(.+)$/,
    framePattern: /^\s*(.+\.go):(\d+)\s/,
    parse: (m) => ({
      file: m[1],
      line: parseInt(m[2], 10),
      column: null,
      function: null,
    }),
  },
  // Go with function name
  {
    language: 'go',
    errorPattern: /^(?:panic|fatal error):\s*(.+)$/,
    framePattern: /^(.+)\(.*\)$/,
    parse: (m) => ({
      file: null,
      line: null,
      column: null,
      function: m[1],
    }),
  },
  // Rust
  {
    language: 'rust',
    errorPattern: /^thread '.*' panicked at '(.+)',\s*(.+):(\d+):(\d+)$/,
    framePattern: /^\s+\d+:\s+.*\s+at\s+(.+):(\d+):(\d+)$/,
    parse: (m) => ({
      file: m[1],
      line: parseInt(m[2], 10),
      column: parseInt(m[3], 10),
      function: null,
    }),
  },
  // Java / Kotlin
  {
    language: 'java',
    errorPattern: /^(?:Exception in thread .+\s+)?(\w+(?:\.\w+)*(?:Error|Exception)):\s*(.+)$/,
    framePattern: /^\s+at\s+([\w.$]+)\(([\w.]+):(\d+)\)$/,
    parse: (m) => ({
      function: m[1],
      file: m[2],
      line: parseInt(m[3], 10),
      column: null,
    }),
  },
  // C# / .NET
  {
    language: 'csharp',
    errorPattern: /^(?:Unhandled exception\.\s+)?(\w+(?:\.\w+)*(?:Exception)):\s*(.+)$/,
    framePattern: /^\s+at\s+(.+?)\s+in\s+(.+?):line\s+(\d+)$/,
    parse: (m) => ({
      function: m[1],
      file: m[2],
      line: parseInt(m[3], 10),
      column: null,
    }),
  },
  // Ruby
  {
    language: 'ruby',
    errorPattern: /^(.+?)\s*\((\w+Error|\w+Exception)\)$/,
    framePattern: /^\s*(.+?):(\d+):in\s+[`'](.+?)'$/,
    parse: (m) => ({
      file: m[1],
      line: parseInt(m[2], 10),
      column: null,
      function: m[3],
    }),
  },
]

// Node internal / library path patterns
const NON_PROJECT_PATTERNS = [
  /node_modules/,
  /internal\//,
  /^node:/,
  /<anonymous>/,
  /^native /,
  /\.cargo/,
  /site-packages/,
  /dist-packages/,
  /\/usr\/lib/,
  /\\Windows\\/i,
  /\.rustup/,
]

/** Parse a stack trace from raw text. */
export function parseStackTrace(text: string, cwd?: string): ParsedStackTrace {
  const lines = text.split(/\r?\n/)
  let detectedLanguage: string | null = null
  let errorMessage: string | null = null
  let errorType: string | null = null
  const frames: StackFrame[] = []

  for (const line of lines) {
    const trimmed = line.trim()
    if (!trimmed) continue

    // Try to extract error message
    if (!errorMessage) {
      for (const parser of PARSERS) {
        const errMatch = trimmed.match(parser.errorPattern)
        if (errMatch) {
          errorType = errMatch[1]
          errorMessage = errMatch[2] || errMatch[1]
          detectedLanguage = parser.language
          break
        }
      }
    }

    // Try to parse as a stack frame
    for (const parser of PARSERS) {
      const frameMatch = trimmed.match(parser.framePattern)
      if (frameMatch) {
        const parsed = parser.parse(frameMatch)
        if (!detectedLanguage) detectedLanguage = parser.language

        // Resolve file path
        let resolvedFile = parsed.file
        let exists = false
        let isProjectFile = false

        if (resolvedFile) {
          // Normalize and resolve
          if (!isAbsolute(resolvedFile) && cwd) {
            resolvedFile = normalize(join(cwd, resolvedFile))
          }
          exists = resolvedFile ? existsSync(resolvedFile) : false
          isProjectFile = !NON_PROJECT_PATTERNS.some(p => p.test(resolvedFile || ''))
        }

        frames.push({
          raw: trimmed,
          file: resolvedFile || parsed.file,
          line: parsed.line,
          column: parsed.column,
          function: parsed.function,
          exists,
          isProjectFile,
        })
        break
      }
    }
  }

  return { language: detectedLanguage, errorMessage, errorType, frames }
}

/** Get the top project-local frame that exists on disk. */
export function getTopProjectFrame(trace: ParsedStackTrace): StackFrame | null {
  return trace.frames.find(f => f.isProjectFile && f.exists && f.file && f.line) || null
}
