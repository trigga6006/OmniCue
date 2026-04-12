/** Detect and run project scripts. */

import { readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { spawn } from 'child_process'
import type { ProjectScripts, ProjectScript, ScriptRunResult } from './types'
import { findProjectRoot } from './project-root'

const MAX_OUTPUT_BYTES = 64 * 1024 // 64 KB per stream
const DEFAULT_TIMEOUT_MS = 30000

/** Categorize a script name into a semantic category. */
function categorize(name: string): ProjectScript['category'] {
  const n = name.toLowerCase()
  if (/test|spec|jest|vitest|mocha|pytest|check/.test(n)) return 'test'
  if (/build|compile|bundle|dist|pack/.test(n)) return 'build'
  if (/lint|eslint|prettier|format|stylelint|check-types|typecheck/.test(n)) return 'lint'
  if (/dev|start|serve|watch|preview/.test(n)) return 'dev'
  if (/deploy|publish|release|ship/.test(n)) return 'deploy'
  return 'other'
}

/** Detect project scripts from the given directory. */
export function detectScripts(cwd: string): ProjectScripts {
  const project = findProjectRoot(cwd)
  const root = project?.root || cwd

  // Try package.json first
  const pkgPath = join(root, 'package.json')
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as { scripts?: Record<string, string> }
      const scripts: ProjectScript[] = []
      if (pkg.scripts) {
        for (const [name, command] of Object.entries(pkg.scripts)) {
          scripts.push({ name, command, category: categorize(name) })
        }
      }
      return {
        projectType: 'node',
        packageManager: project?.packageManager || 'npm',
        scripts,
        cwd: root,
      }
    } catch { /* fall through */ }
  }

  // Makefile
  const makefilePath = join(root, 'Makefile')
  if (existsSync(makefilePath)) {
    try {
      const content = readFileSync(makefilePath, 'utf-8')
      const scripts: ProjectScript[] = []
      const targetRe = /^([a-zA-Z_][\w-]*)\s*:/gm
      let match
      while ((match = targetRe.exec(content)) !== null) {
        const name = match[1]
        // Skip internal targets starting with . or _
        if (name.startsWith('.') || name.startsWith('_')) continue
        scripts.push({ name, command: `make ${name}`, category: categorize(name) })
      }
      return { projectType: 'make', packageManager: null, scripts, cwd: root }
    } catch { /* fall through */ }
  }

  // Cargo.toml
  if (existsSync(join(root, 'Cargo.toml'))) {
    return {
      projectType: 'rust',
      packageManager: null,
      scripts: [
        { name: 'build', command: 'cargo build', category: 'build' },
        { name: 'test', command: 'cargo test', category: 'test' },
        { name: 'check', command: 'cargo check', category: 'lint' },
        { name: 'run', command: 'cargo run', category: 'dev' },
        { name: 'clippy', command: 'cargo clippy', category: 'lint' },
      ],
      cwd: root,
    }
  }

  // pyproject.toml
  if (existsSync(join(root, 'pyproject.toml'))) {
    return {
      projectType: 'python',
      packageManager: null,
      scripts: [
        { name: 'test', command: 'pytest', category: 'test' },
        { name: 'lint', command: 'ruff check .', category: 'lint' },
        { name: 'format', command: 'ruff format .', category: 'lint' },
      ],
      cwd: root,
    }
  }

  // go.mod
  if (existsSync(join(root, 'go.mod'))) {
    return {
      projectType: 'go',
      packageManager: null,
      scripts: [
        { name: 'build', command: 'go build ./...', category: 'build' },
        { name: 'test', command: 'go test ./...', category: 'test' },
        { name: 'vet', command: 'go vet ./...', category: 'lint' },
      ],
      cwd: root,
    }
  }

  return { projectType: project?.type || null, packageManager: null, scripts: [], cwd: root }
}

/** Run a named project script. Returns bounded output. */
export function runScript(options: {
  script: string
  cwd: string
  timeoutMs?: number
}): Promise<ScriptRunResult> {
  const { script, cwd, timeoutMs = DEFAULT_TIMEOUT_MS } = options
  const scripts = detectScripts(cwd)
  const found = scripts.scripts.find(s => s.name === script)

  if (!found) {
    return Promise.resolve({
      ok: false,
      script,
      command: '',
      stdout: '',
      stderr: `Script "${script}" not found in project`,
      exitCode: null,
      durationMs: 0,
      truncated: false,
    })
  }

  // Build the run command based on project type
  let cmd: string
  let args: string[]

  if (scripts.projectType === 'node') {
    const pm = scripts.packageManager || 'npm'
    cmd = pm
    args = pm === 'npm' ? ['run', script] : [script]
  } else if (scripts.projectType === 'make') {
    cmd = 'make'
    args = [script]
  } else {
    // Run the command directly via shell
    cmd = process.platform === 'win32' ? 'cmd' : 'sh'
    args = process.platform === 'win32' ? ['/c', found.command] : ['-c', found.command]
  }

  const startTime = Date.now()

  return new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: scripts.cwd || cwd,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    let stdout = ''
    let stderr = ''
    let truncated = false

    child.stdout.on('data', (data: Buffer) => {
      if (stdout.length < MAX_OUTPUT_BYTES) {
        stdout += data.toString()
      } else {
        truncated = true
      }
    })

    child.stderr.on('data', (data: Buffer) => {
      if (stderr.length < MAX_OUTPUT_BYTES) {
        stderr += data.toString()
      } else {
        truncated = true
      }
    })

    const timer = setTimeout(() => {
      child.kill()
      resolve({
        ok: false,
        script,
        command: `${cmd} ${args.join(' ')}`,
        stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: (stderr || 'Timed out').slice(0, MAX_OUTPUT_BYTES),
        exitCode: null,
        durationMs: Date.now() - startTime,
        truncated: true,
      })
    }, timeoutMs)

    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({
        ok: code === 0,
        script,
        command: `${cmd} ${args.join(' ')}`,
        stdout: stdout.slice(0, MAX_OUTPUT_BYTES),
        stderr: stderr.slice(0, MAX_OUTPUT_BYTES),
        exitCode: code,
        durationMs: Date.now() - startTime,
        truncated,
      })
    })

    child.on('error', (err) => {
      clearTimeout(timer)
      resolve({
        ok: false,
        script,
        command: `${cmd} ${args.join(' ')}`,
        stdout: '',
        stderr: err.message,
        exitCode: null,
        durationMs: Date.now() - startTime,
        truncated: false,
      })
    })
  })
}
