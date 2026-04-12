/** Detect project root and project type from a directory. */

import { existsSync } from 'fs'
import { join, dirname, parse as parsePath } from 'path'

export interface ProjectInfo {
  root: string
  type: string | null
  packageManager: string | null
}

const PROJECT_MARKERS: Array<{ file: string; type: string }> = [
  { file: 'package.json', type: 'node' },
  { file: 'Cargo.toml', type: 'rust' },
  { file: 'go.mod', type: 'go' },
  { file: 'pyproject.toml', type: 'python' },
  { file: 'setup.py', type: 'python' },
  { file: 'requirements.txt', type: 'python' },
  { file: 'Gemfile', type: 'ruby' },
  { file: 'pom.xml', type: 'java' },
  { file: 'build.gradle', type: 'java' },
  { file: 'build.gradle.kts', type: 'kotlin' },
  { file: '*.sln', type: 'dotnet' },
  { file: '*.csproj', type: 'dotnet' },
  { file: 'Makefile', type: 'make' },
  { file: 'Justfile', type: 'just' },
  { file: 'Taskfile.yml', type: 'taskfile' },
]

const PM_LOCKFILES: Record<string, string> = {
  'package-lock.json': 'npm',
  'yarn.lock': 'yarn',
  'pnpm-lock.yaml': 'pnpm',
  'bun.lockb': 'bun',
  'bun.lock': 'bun',
}

/** Walk up from `startDir` to find a project root. Returns null if we hit the filesystem root. */
export function findProjectRoot(startDir: string): ProjectInfo | null {
  let dir = startDir
  const { root: fsRoot } = parsePath(dir)
  const maxDepth = 10

  for (let i = 0; i < maxDepth; i++) {
    // Check for git root first (strongest signal)
    if (existsSync(join(dir, '.git'))) {
      const type = detectProjectType(dir)
      const packageManager = detectPackageManager(dir)
      return { root: dir, type, packageManager }
    }

    // Check project markers
    for (const marker of PROJECT_MARKERS) {
      if (!marker.file.includes('*') && existsSync(join(dir, marker.file))) {
        const packageManager = marker.type === 'node' ? detectPackageManager(dir) : null
        return { root: dir, type: marker.type, packageManager }
      }
    }

    const parent = dirname(dir)
    if (parent === dir || parent === fsRoot) break
    dir = parent
  }

  return null
}

function detectProjectType(dir: string): string | null {
  for (const marker of PROJECT_MARKERS) {
    if (!marker.file.includes('*') && existsSync(join(dir, marker.file))) {
      return marker.type
    }
  }
  return null
}

function detectPackageManager(dir: string): string | null {
  for (const [lockfile, pm] of Object.entries(PM_LOCKFILES)) {
    if (existsSync(join(dir, lockfile))) return pm
  }
  return null
}
