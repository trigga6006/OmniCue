/** Editor CLI detection and open-file-at-line dispatch. */

import { spawn } from 'child_process'
import type { OpenFileRequest, OpenFileResult } from './types'

interface EditorCli {
  name: string
  command: string
  buildArgs: (file: string, line?: number, column?: number) => string[]
}

const EDITOR_CLIS: EditorCli[] = [
  {
    name: 'vscode',
    command: 'code',
    buildArgs: (file, line, col) => {
      if (line) return ['--goto', `${file}:${line}${col ? ':' + col : ''}`]
      return [file]
    },
  },
  {
    name: 'cursor',
    command: 'cursor',
    buildArgs: (file, line, col) => {
      if (line) return ['--goto', `${file}:${line}${col ? ':' + col : ''}`]
      return [file]
    },
  },
  {
    name: 'windsurf',
    command: 'windsurf',
    buildArgs: (file, line, col) => {
      if (line) return ['--goto', `${file}:${line}${col ? ':' + col : ''}`]
      return [file]
    },
  },
  {
    name: 'sublime',
    command: 'subl',
    buildArgs: (file, line, col) => {
      if (line) return [`${file}:${line}${col ? ':' + col : ''}`]
      return [file]
    },
  },
]

/** Check if a command is available on PATH. */
function isCommandAvailable(cmd: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(process.platform === 'win32' ? 'where' : 'which', [cmd], {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    child.on('close', (code) => resolve(code === 0))
    child.on('error', () => resolve(false))
    setTimeout(() => { child.kill(); resolve(false) }, 2000)
  })
}

/** Find the best editor CLI to use. Prefers the specified editor, then tries all known ones. */
async function resolveEditorCli(preferred?: string): Promise<EditorCli | null> {
  // If a specific editor is requested, try it first
  if (preferred) {
    const cli = EDITOR_CLIS.find(c => c.name === preferred || c.command === preferred)
    if (cli && await isCommandAvailable(cli.command)) return cli
  }

  // Try each known CLI
  for (const cli of EDITOR_CLIS) {
    if (await isCommandAvailable(cli.command)) return cli
  }

  return null
}

/** Open a file at a specific line in the user's editor. */
export async function openFileAtLine(request: OpenFileRequest): Promise<OpenFileResult> {
  const cli = await resolveEditorCli(request.editor)

  if (!cli) {
    return {
      ok: false,
      editor: request.editor || 'none',
      command: '',
    }
  }

  const args = cli.buildArgs(request.file, request.line, request.column)
  const fullCommand = `${cli.command} ${args.join(' ')}`

  return new Promise((resolve) => {
    const child = spawn(cli.command, args, {
      windowsHide: true,
      stdio: 'ignore',
      detached: true,
    })

    child.unref()

    child.on('error', () => {
      resolve({ ok: false, editor: cli.name, command: fullCommand })
    })

    // Editor CLI spawns and exits quickly — just give it a moment
    setTimeout(() => {
      resolve({ ok: true, editor: cli.name, command: fullCommand })
    }, 500)
  })
}
