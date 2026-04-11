/** Shared tool-pack types — imported by both main process and renderer. */

export interface PackMatchResult {
  packId: string
  packName: string
  confidence: number
  context: Record<string, string>
  variant?: string
}

export interface PackQuickAction {
  id: string
  label: string
  prompt: string
  icon: string
}

export interface ToolPack {
  id: string
  name: string
  match: (input: {
    activeApp: string
    processName: string
    windowTitle: string
    ocrText?: string
  }) => PackMatchResult | null
  getQuickActions: (match: PackMatchResult, ocrText?: string) => PackQuickAction[]
  /** Optional passive context note for the AI (not tool instructions). */
  buildContextNote?: (match: PackMatchResult) => string
}
