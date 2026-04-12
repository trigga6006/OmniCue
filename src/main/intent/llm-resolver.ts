/**
 * LLM-based intent resolver — constrained fallback.
 * Called only when the sync pipeline (patterns + normalizer + grounder + rule planner)
 * cannot confidently resolve the intent.
 *
 * Sends a tightly constrained prompt to the cheapest available provider.
 * The LLM can only choose from registered actions.
 */

import type { DesktopSnapshot } from '../context/types'
import type { ResumeCapsule } from '../session-memory/types'
import type { ActionPlan, NormalizedIntent, GroundedReferent } from './types'
import { ACTION_REGISTRY, getActionDefinition } from '../actions'
import { singleShotCompletion } from './intent-ai'
import { getNavCatalogCompact } from '../navigation'

// ── Prompt builder ───────────────────────────────────────────────────────────

function buildCompactRegistry(): string {
  return ACTION_REGISTRY.map((a) => {
    const params = a.params
      .map((p) => `${p.name}${p.required ? '*' : ''}:${p.type}`)
      .join(', ')
    return `- ${a.id} [${a.tier}] (${params || 'none'}) — ${a.description}`
  }).join('\n')
}

function buildSnapshotContext(snapshot: DesktopSnapshot): string {
  const lines: string[] = []
  if (snapshot.activeApp) lines.push(`Active app: ${snapshot.activeApp}`)
  if (snapshot.processName) lines.push(`Process: ${snapshot.processName}`)
  if (snapshot.windowTitle) lines.push(`Window: ${snapshot.windowTitle}`)
  if (snapshot.terminal?.cwd) lines.push(`Terminal CWD: ${snapshot.terminal.cwd}`)
  if (snapshot.editor?.workspacePath) lines.push(`Workspace: ${snapshot.editor.workspacePath}`)
  if (snapshot.editor?.openFile) lines.push(`Open file: ${snapshot.editor.openFile}`)
  if (snapshot.browser?.pageTitle) lines.push(`Browser page: ${snapshot.browser.pageTitle}`)
  if (snapshot.browser?.site) lines.push(`Browser site: ${snapshot.browser.site}`)
  if (snapshot.fileExplorer?.currentPath) lines.push(`Explorer path: ${snapshot.fileExplorer.currentPath}`)
  if (snapshot.clipboard) lines.push(`Clipboard: ${snapshot.clipboard.slice(0, 200)}`)
  return lines.join('\n') || 'No context available'
}

function buildReferentsList(referents: GroundedReferent[]): string {
  if (referents.length === 0) return 'None'
  return referents
    .slice(0, 5)
    .map((r, i) => `${i + 1}. "${r.value}" (${r.source}, confidence: ${r.confidence.toFixed(2)}, type: ${r.type})`)
    .join('\n')
}

function buildPrompt(
  intent: NormalizedIntent,
  referents: GroundedReferent[],
  snapshot: DesktopSnapshot,
  capsule?: ResumeCapsule
): string {
  const lines = [
    'You are a desktop action classifier. Given the user\'s utterance and desktop context, map it to exactly one action from the registry below.',
    '',
    'Available actions:',
    buildCompactRegistry(),
    '',
    'Desktop context:',
    buildSnapshotContext(snapshot),
    '',
    'Pre-resolved referent candidates:',
    buildReferentsList(referents),
    '',
    'System locations (valid locationId values for open-system-location):',
    getNavCatalogCompact(),
    '',
  ]

  if (capsule) {
    lines.push(
      `Resume capsule (${Math.round((Date.now() - capsule.updatedAt) / 60000)}m old):`,
      `  Goal: ${capsule.goal || 'unknown'}`,
      `  Summary: ${capsule.summary}`,
      ''
    )
  }

  lines.push(
    `Normalized: verb="${intent.verb}" targetType="${intent.targetType}" referent="${intent.surfaceReferent || ''}" destination="${intent.destination || ''}"`,
    '',
    `User utterance: "${intent.raw}"`,
    '',
    'Respond with ONLY valid JSON, no explanation:',
    '{ "actionId": "<from registry>", "params": { <match param schema> }, "confidence": <0.0-1.0>, "needsConfirmation": <bool>, "reason": "<one sentence>" }',
    '',
    'If the utterance does not map to any available action:',
    '{ "fallback": true, "reason": "<why>" }',
  )

  return lines.join('\n')
}

// ── Response parser ──────────────────────────────────────────────────────────

interface LLMResponse {
  actionId?: string
  params?: Record<string, unknown>
  confidence?: number
  needsConfirmation?: boolean
  reason?: string
  fallback?: boolean
}

function parseResponse(text: string): LLMResponse | null {
  // Extract JSON from response (may have markdown fences or extra text)
  const jsonMatch = text.match(/\{[\s\S]*\}/)
  if (!jsonMatch) return null

  try {
    return JSON.parse(jsonMatch[0]) as LLMResponse
  } catch {
    return null
  }
}

function validateResponse(response: LLMResponse): ActionPlan | null {
  if (response.fallback) return null

  if (!response.actionId || typeof response.actionId !== 'string') return null

  // Verify action exists in registry
  const definition = getActionDefinition(response.actionId)
  if (!definition) return null

  const params = response.params && typeof response.params === 'object' ? response.params : {}

  // Verify required params
  for (const paramDef of definition.params) {
    if (paramDef.required && (params[paramDef.name] === undefined || params[paramDef.name] === '')) {
      return null
    }
  }

  return {
    actions: [{ actionId: response.actionId, params }],
    explanation: response.reason || definition.name,
    confidence: typeof response.confidence === 'number' ? response.confidence : 0.6,
    needsConfirmation: response.needsConfirmation ?? definition.tier !== 'safe',
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function resolveLLM(
  intent: NormalizedIntent,
  referents: GroundedReferent[],
  snapshot: DesktopSnapshot,
  capsule?: ResumeCapsule
): Promise<ActionPlan> {
  const prompt = buildPrompt(intent, referents, snapshot, capsule)

  const response = await singleShotCompletion(prompt)
  if (!response) {
    // No provider available — fall back gracefully
    return buildFallbackPlan(intent)
  }

  const parsed = parseResponse(response)
  if (!parsed) {
    console.warn('[OmniCue] Intent LLM: failed to parse response')
    return buildFallbackPlan(intent)
  }

  const validated = validateResponse(parsed)
  if (validated) {
    return validated
  }

  // LLM responded with fallback or invalid data
  const reason = parsed.reason || parsed.fallback
    ? 'LLM could not map to an action'
    : 'Invalid LLM response'
  return {
    actions: [],
    confidence: 0,
    fallback: 'ask',
    question: parsed.reason || `I couldn't resolve "${intent.raw}". ${reason}.`,
  }
}

function buildFallbackPlan(intent: NormalizedIntent): ActionPlan {
  const verbHint = intent.verb !== 'unknown' ? ` (detected verb: "${intent.verb}")` : ''
  const targetHint = intent.targetType !== 'unknown' ? ` targeting ${intent.targetType}` : ''

  return {
    actions: [],
    confidence: 0,
    fallback: 'ask',
    question: `I couldn't confidently resolve "${intent.raw}"${verbHint}${targetHint}. Try a more specific command like "open this project folder" or "switch to Chrome".`,
  }
}
