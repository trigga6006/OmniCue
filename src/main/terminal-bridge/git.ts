/** Git helpers — status, diff, log. All read-only operations. */

import { execFile } from 'child_process'
import { existsSync } from 'fs'
import { join } from 'path'
import type { GitStatus, GitDiff, GitLog, GitLogEntry } from './types'

const MAX_DIFF_BYTES = 200 * 1024 // 200 KB cap

function git(args: string[], cwd: string, timeoutMs = 10000): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const child = execFile('git', args, {
      cwd,
      timeout: timeoutMs,
      maxBuffer: MAX_DIFF_BYTES + 10240,
      windowsHide: true,
    }, (err, stdout, stderr) => {
      resolve({
        stdout: stdout || '',
        stderr: stderr || '',
        code: err ? (err as NodeJS.ErrnoException & { code?: number }).code as unknown as number ?? 1 : 0,
      })
    })
    // Safety net
    setTimeout(() => { try { child.kill() } catch {} }, timeoutMs + 1000)
  })
}

/** Check if a directory is inside a git repo. */
export function isGitRepo(dir: string): boolean {
  // Walk up to find .git
  let d = dir
  for (let i = 0; i < 10; i++) {
    if (existsSync(join(d, '.git'))) return true
    const parent = join(d, '..')
    if (parent === d) break
    d = parent
  }
  return false
}

export async function getGitStatus(cwd: string): Promise<GitStatus | null> {
  if (!isGitRepo(cwd)) return null

  const [branchResult, statusResult] = await Promise.all([
    git(['rev-parse', '--abbrev-ref', 'HEAD'], cwd, 3000),
    git(['status', '--porcelain=v1'], cwd, 5000),
  ])

  const branch = branchResult.stdout.trim() || 'unknown'

  // Parse ahead/behind
  let ahead = 0, behind = 0
  const abResult = await git(['rev-list', '--left-right', '--count', `HEAD...@{upstream}`], cwd, 3000)
  if (abResult.code === 0) {
    const parts = abResult.stdout.trim().split(/\s+/)
    ahead = parseInt(parts[0] || '0', 10) || 0
    behind = parseInt(parts[1] || '0', 10) || 0
  }

  const staged: Array<{ path: string; status: string }> = []
  const unstaged: Array<{ path: string; status: string }> = []
  const untracked: string[] = []

  for (const line of statusResult.stdout.split('\n')) {
    if (!line.trim()) continue
    const x = line[0] // index status
    const y = line[1] // work-tree status
    const filePath = line.slice(3).trim()

    if (x === '?' && y === '?') {
      untracked.push(filePath)
    } else {
      if (x && x !== ' ' && x !== '?') {
        staged.push({ path: filePath, status: statusChar(x) })
      }
      if (y && y !== ' ' && y !== '?') {
        unstaged.push({ path: filePath, status: statusChar(y) })
      }
    }
  }

  return { cwd, branch, ahead, behind, staged, unstaged, untracked }
}

export async function getGitDiff(
  cwd: string,
  options?: { staged?: boolean; file?: string }
): Promise<GitDiff | null> {
  if (!isGitRepo(cwd)) return null

  const status = await getGitStatus(cwd)
  if (!status) return null

  const diffArgs = ['diff', '--stat', '--patch']
  if (options?.staged) diffArgs.push('--cached')
  if (options?.file) diffArgs.push('--', options.file)

  const diffResult = await git(diffArgs, cwd, 10000)
  let diff = diffResult.stdout
  if (diff.length > MAX_DIFF_BYTES) {
    diff = diff.slice(0, MAX_DIFF_BYTES) + '\n... [truncated at 200KB]'
  }

  // Parse stats from diff --stat output
  const statsMatch = diff.match(/(\d+)\s+files?\s+changed(?:,\s+(\d+)\s+insertions?)?(?:,\s+(\d+)\s+deletions?)?/)
  const stats = {
    filesChanged: parseInt(statsMatch?.[1] || '0', 10) || 0,
    insertions: parseInt(statsMatch?.[2] || '0', 10) || 0,
    deletions: parseInt(statsMatch?.[3] || '0', 10) || 0,
  }

  return {
    cwd,
    branch: status.branch,
    status: {
      staged: status.staged.map(s => s.path),
      unstaged: status.unstaged.map(s => s.path),
      untracked: status.untracked,
    },
    diff,
    stats,
  }
}

export async function getGitLog(cwd: string, count = 10): Promise<GitLog | null> {
  if (!isGitRepo(cwd)) return null

  const format = '%H%n%h%n%s%n%an%n%aI%n'
  const result = await git(
    ['log', `--max-count=${count}`, `--format=${format}`, '--shortstat'],
    cwd,
    5000
  )

  if (result.code !== 0) return null

  const commits: GitLogEntry[] = []
  const blocks = result.stdout.split('\n\n').filter(Boolean)

  for (const block of blocks) {
    const lines = block.trim().split('\n')
    if (lines.length < 5) continue

    const filesMatch = lines.find(l => /files?\s+changed/.test(l))
    const filesChanged = parseInt(filesMatch?.match(/(\d+)\s+files?\s+changed/)?.[1] || '0', 10) || 0

    commits.push({
      hash: lines[0],
      shortHash: lines[1],
      message: lines[2],
      author: lines[3],
      date: lines[4],
      filesChanged,
    })
  }

  return { cwd, commits }
}

function statusChar(c: string): string {
  const map: Record<string, string> = {
    M: 'modified', A: 'added', D: 'deleted', R: 'renamed',
    C: 'copied', U: 'unmerged', T: 'type-changed',
  }
  return map[c] || c
}
