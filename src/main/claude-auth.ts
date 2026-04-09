import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CLAUDE_DIR = join(homedir(), '.claude')
const AUTH_PATH = join(CLAUDE_DIR, '.credentials.json')

export interface ClaudeStatus {
  authenticated: boolean
  planType?: string
}

/**
 * Check if Claude Code CLI is authenticated by looking for credentials file.
 */
export function getClaudeStatus(): ClaudeStatus {
  try {
    if (!existsSync(AUTH_PATH)) return { authenticated: false }
    const raw = readFileSync(AUTH_PATH, 'utf-8')
    const data = JSON.parse(raw)
    // Credentials file exists and has some token data
    if (data && (data.oauthAccount || data.claudeAiOauth)) {
      return { authenticated: true, planType: 'Max' }
    }
    return { authenticated: false }
  } catch {
    return { authenticated: false }
  }
}
