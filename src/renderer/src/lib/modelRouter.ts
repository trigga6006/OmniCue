import type { AiProvider } from '@/lib/types'

export type AiMode = 'fast' | 'auto' | 'pro'

/** Human-readable labels for the ModelPicker */
export const MODE_LABELS: Record<AiProvider, { fast: string; auto: string; pro: string }> = {
  codex: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  claude: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
  openai: { fast: 'Fast', auto: 'Auto', pro: 'Pro' },
}
