import type { AiProvider } from '@/lib/types'

export type AiMode = 'fast' | 'auto' | 'pro'

/** Human-readable labels for the ModelPicker */
export const MODE_LABELS: Record<AiProvider, { fast: string; auto: string; pro: string }> = {
  codex: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  claude: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  opencode: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  kimicode: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  openai: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  gemini: { fast: 'Flash', auto: 'Auto', pro: 'Pro' },
  deepseek: { fast: 'Fast', auto: 'Auto', pro: 'Reasoner' },
  groq: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  mistral: { fast: 'Fast', auto: 'Auto', pro: 'Large' },
  xai: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  glm: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  kimi: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
}
