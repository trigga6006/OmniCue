export type AiMode = 'fast' | 'auto' | 'pro'

export const MODELS = {
  fast: 'gpt-5.4-mini',
  pro: 'gpt-5.4',
} as const

const PRO_KEYWORDS = [
  'debug', 'analyze', 'compare', 'explain why', 'architecture',
  'refactor', 'tradeoff', 'trade-off', 'root cause', 'review',
  'what\'s wrong', 'how should i', 'step by step', 'pros and cons',
]

interface RouterInput {
  mode: AiMode
  userText: string
  ocrText: string | undefined
  screenType: string | undefined
  hasManualScreenshot: boolean
  messageCount: number
  sessionEscalatedToPro: boolean
}

export function resolveModel(input: RouterInput): typeof MODELS.fast | typeof MODELS.pro {
  if (input.mode === 'fast') return MODELS.fast
  if (input.mode === 'pro') return MODELS.pro

  // Auto mode — sticky escalation
  if (input.sessionEscalatedToPro) return MODELS.pro

  const text = input.userText.toLowerCase().trim()
  const wordCount = text.split(/\s+/).filter(Boolean).length

  // Deep conversation → pro
  if (input.messageCount > 8) return MODELS.pro

  // Code or dashboard screen → pro
  if (input.screenType === 'code' || input.screenType === 'dashboard') return MODELS.pro

  // Reasoning keywords → pro
  if (PRO_KEYWORDS.some((kw) => text.includes(kw))) return MODELS.pro

  // Long prompt → pro
  if (wordCount > 30) return MODELS.pro

  // Manual screenshot + non-trivial question → pro
  if (input.hasManualScreenshot && wordCount > 5) return MODELS.pro

  // Dense OCR (if available) → pro
  if (input.ocrText && input.ocrText.length > 2000) return MODELS.pro

  // Default: fast
  return MODELS.fast
}
