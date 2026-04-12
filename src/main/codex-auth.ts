import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CODEX_DIR = join(homedir(), '.codex')
const AUTH_PATH = join(CODEX_DIR, 'auth.json')
const CONFIG_PATH = join(CODEX_DIR, 'config.toml')

// OpenAI OAuth token endpoint
const TOKEN_URL = 'https://auth.openai.com/oauth/token'
const CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'

export interface CodexAuth {
  authMode: string
  accessToken: string
  refreshToken: string
  idToken: string
  accountId: string
  lastRefresh: string
}

export interface CodexStatus {
  authenticated: boolean
  planType?: string
  model?: string
  authMode?: string
}

function parseAuthJson(): CodexAuth | null {
  try {
    const raw = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'))
    if (!raw.tokens?.access_token || !raw.tokens?.refresh_token) return null
    return {
      authMode: raw.auth_mode || 'chatgpt',
      accessToken: raw.tokens.access_token,
      refreshToken: raw.tokens.refresh_token,
      idToken: raw.tokens.id_token || '',
      accountId: raw.tokens.account_id || '',
      lastRefresh: raw.last_refresh || '',
    }
  } catch {
    return null
  }
}

function parseConfigToml(): { model: string } {
  try {
    const raw = readFileSync(CONFIG_PATH, 'utf-8')
    const match = raw.match(/^model\s*=\s*"(.+)"/m)
    return { model: match?.[1] || 'gpt-4o' }
  } catch {
    return { model: 'gpt-4o' }
  }
}

/** Decode JWT payload without verification (we just need expiry) */
function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = Buffer.from(parts[1], 'base64url').toString('utf-8')
    return JSON.parse(payload)
  } catch {
    return null
  }
}

function isTokenExpired(token: string): boolean {
  const payload = decodeJwtPayload(token)
  if (!payload || typeof payload.exp !== 'number') return true
  // Consider expired 60s before actual expiry to avoid edge cases
  return Date.now() / 1000 > payload.exp - 60
}

async function refreshAccessToken(refreshToken: string): Promise<CodexAuth | null> {
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'refresh_token',
        client_id: CLIENT_ID,
        refresh_token: refreshToken,
      }),
    })

    if (!res.ok) return null

    const data = await res.json()
    if (!data.access_token) return null

    // Update auth.json with new tokens
    const existingRaw = JSON.parse(readFileSync(AUTH_PATH, 'utf-8'))
    existingRaw.tokens.access_token = data.access_token
    if (data.id_token) existingRaw.tokens.id_token = data.id_token
    if (data.refresh_token) existingRaw.tokens.refresh_token = data.refresh_token
    existingRaw.last_refresh = new Date().toISOString()
    writeFileSync(AUTH_PATH, JSON.stringify(existingRaw, null, 2), 'utf-8')

    return {
      authMode: existingRaw.auth_mode || 'chatgpt',
      accessToken: data.access_token,
      refreshToken: data.refresh_token || refreshToken,
      idToken: data.id_token || existingRaw.tokens.id_token || '',
      accountId: existingRaw.tokens.account_id || '',
      lastRefresh: existingRaw.last_refresh,
    }
  } catch {
    return null
  }
}

/**
 * Get a valid Codex access token, refreshing if needed.
 * Returns null if not authenticated or refresh fails.
 */
export async function getCodexAccessToken(): Promise<string | null> {
  const auth = parseAuthJson()
  if (!auth) return null

  if (!isTokenExpired(auth.accessToken)) {
    return auth.accessToken
  }

  // Token expired — try refresh
  const refreshed = await refreshAccessToken(auth.refreshToken)
  return refreshed?.accessToken ?? null
}

/**
 * Get Codex authentication status for the UI.
 */
export function getCodexStatus(): CodexStatus {
  const auth = parseAuthJson()
  if (!auth) return { authenticated: false }

  const payload = decodeJwtPayload(auth.idToken || auth.accessToken)
  const planType = (payload?.['https://api.openai.com/auth'] as Record<string, string>)
    ?.chatgpt_plan_type

  const config = parseConfigToml()

  return {
    authenticated: true,
    planType: planType || 'unknown',
    model: config.model,
    authMode: auth.authMode || 'chatgpt',
  }
}

/**
 * Get the default model from Codex config.
 */
export function getCodexModel(): string {
  return parseConfigToml().model
}
