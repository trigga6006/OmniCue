import type { AiProvider } from '@/lib/types'

export type AiMode = 'fast' | 'auto' | 'pro'

export const CODEX_MODELS = {
  fast: 'gpt-5.4-mini',
  pro: 'gpt-5.4',
} as const

export const CLAUDE_MODELS = {
  fast: 'claude-haiku-4-5-20251001',
  pro: 'claude-opus-4-6-20250514',
} as const

/** Human-readable labels for the ModelPicker */
export const MODE_LABELS: Record<AiProvider, { fast: string; auto: string; pro: string }> = {
  codex: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  claude: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  openai: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
}

const PRO_KEYWORDS = [
  'debug', 'analyze', 'compare', 'explain why', 'architecture',
  'refactor', 'tradeoff', 'trade-off', 'root cause', 'review',
  'what\'s wrong', 'how should i', 'step by step', 'pros and cons',
]

interface RouterInput {
  mode: AiMode
  provider: AiProvider
  userText: string
  ocrText: string | undefined
  screenType: string | undefined
  hasManualScreenshot: boolean
  messageCount: number
  sessionEscalatedToPro: boolean
}

function pickTier(input: RouterInput): 'fast' | 'pro' {
  if (input.mode === 'fast') return 'fast'
  if (input.mode === 'pro') return 'pro'

  // Auto mode — sticky escalation
  if (input.sessionEscalatedToPro) return 'pro'

  const text = input.userText.toLowerCase().trim()
  const wordCount = text.split(/\s+/).filter(Boolean).length

  if (input.messageCount > 8) return 'pro'
  if (input.screenType === 'code' || input.screenType === 'dashboard') return 'pro'
  if (PRO_KEYWORDS.some((kw) => text.includes(kw))) return 'pro'
  if (wordCount > 30) return 'pro'
  if (input.hasManualScreenshot && wordCount > 5) return 'pro'
  if (input.ocrText && input.ocrText.length > 2000) return 'pro'

  return 'fast'
}

export function resolveModel(input: RouterInput): string {
  const tier = pickTier(input)

  if (input.provider === 'claude') return CLAUDE_MODELS[tier]
  if (input.provider === 'codex') return CODEX_MODELS[tier]

  // openai — same as codex models
  return CODEX_MODELS[tier]
}

/** Check if the resolved model is the "pro" tier (for sticky escalation) */
export function isProModel(model: string): boolean {
  return model === CODEX_MODELS.pro || model === CLAUDE_MODELS.pro
}
