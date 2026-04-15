import { useCompanionStore } from '@/stores/companionStore'
import { generateId } from '@/lib/utils'
import type { ChatMessage, AiProvider } from '@/lib/types'

const AI_PROVIDERS: AiProvider[] = [
  'codex',
  'claude',
  'opencode',
  'kimicode',
  'openai',
  'gemini',
  'deepseek',
  'groq',
  'mistral',
  'xai',
  'glm',
  'kimi'
]

function isAiProvider(value: string): value is AiProvider {
  return AI_PROVIDERS.includes(value as AiProvider)
}

/**
 * Build a structured desktop context block from message metadata.
 */
function formatDesktopContext(m: ChatMessage): string {
  const lines: string[] = ['<desktop-context>']

  if (m.activeApp) lines.push(`  app: ${m.activeApp}`)
  if (m.processName) lines.push(`  process: ${m.processName}`)
  if (m.screenshotTitle) lines.push(`  windowTitle: ${m.screenshotTitle}`)
  if (m.screenType && m.screenType !== 'unknown') lines.push(`  screenType: ${m.screenType}`)
  if (m.clipboardText) lines.push(`  clipboard: ${m.clipboardText.slice(0, 500)}`)
  if (m.packId) {
    lines.push(`  pack: ${m.packId}`)
    if (m.packVariant) lines.push(`  packVariant: ${m.packVariant}`)
    if (m.packConfidence != null) lines.push(`  packConfidence: ${m.packConfidence.toFixed(2)}`)
    if (m.packContext && Object.keys(m.packContext).length > 0) {
      lines.push('  packContext:')
      for (const [k, v] of Object.entries(m.packContext)) {
        lines.push(`    ${k}: ${v}`)
      }
    }
  }
  if (m.ocrText) {
    const indented = m.ocrText.replace(/\n/g, '\n    ')
    lines.push(`  screenText: |\n    ${indented}`)
  }

  lines.push('</desktop-context>')
  return lines.join('\n')
}

/**
 * Try resolving a short imperative message as a desktop intent before hitting the AI.
 * Returns true if the intent was handled (caller should skip AI streaming).
 * Note: startStreaming has already been called, so we finishStreaming with the
 * intent result rather than creating a new streaming message.
 */
async function tryIntentResolution(text: string, conversationId?: string): Promise<boolean> {
  try {
    const result = await window.electronAPI.resolveIntent({ utterance: text, conversationId })
    if (!result.resolved) return false

    const store = useCompanionStore.getState()

    const explanation = result.plan.explanation || 'Done.'
    const detail = result.executed
      ? explanation
      : `I can do that, but it needs confirmation: ${explanation}`

    store.finishStreaming(detail)
    return true
  } catch {
    return false
  }
}

/**
 * Shared send logic used by CompanionInput and quick actions.
 * Resolves OCR, builds messages, routes model, and fires the stream.
 *
 * Key UX constraint: the user's message AND the thinking animation must appear
 * immediately. All async work (OCR, intent resolution, settings fetch) happens
 * after both are visible so the UI never stalls.
 */
export async function sendCompanionMessage(text: string): Promise<void> {
  const store = useCompanionStore.getState()
  if (store.isStreaming) return

  const _perfSend = performance.now()
  const _pS = (label: string): void => console.log(`[PERF] sendCompanionMessage | ${label}: ${Math.round(performance.now() - _perfSend)}ms`)

  // ── Step 1: Show user message + thinking animation immediately ─────────
  store.addUserMessage(text)

  const streamMsgId = generateId()
  store.startStreaming(streamMsgId)
  _pS('UI updated (message + thinking)')

  // ── Step 2: Resolve OCR (usually already complete) ──────────────────────
  const auto = store.autoScreenshot

  // ── Step 3: Build AI payload (sync — do this before any awaits) ────────
  const updatedMessages = useCompanionStore.getState().messages

  const lastUserIndex =
    updatedMessages.length - 1 - [...updatedMessages].reverse().findIndex((m) => m.role === 'user')
  const resolvedOcr = auto?.ocrText
  const resolvedScreenType = auto?.screenType

  const coreMessages = updatedMessages
    .filter((m) => m.id !== streamMsgId) // exclude the empty streaming placeholder
    .map((m: ChatMessage) => {
      const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []
      const isLatestUser = m.role === 'user' && updatedMessages.indexOf(m) === lastUserIndex

      if (m.role === 'user' && m.screenshot) {
        contentParts.push({ type: 'image_url', image_url: { url: m.screenshot } })
      }

      if (m.role === 'user' && m.manualScreenshot) {
        contentParts.push({ type: 'image_url', image_url: { url: m.manualScreenshot } })
      }

      const ocrText = isLatestUser && resolvedOcr ? resolvedOcr : m.ocrText
      const screenType = isLatestUser && resolvedScreenType ? resolvedScreenType : m.screenType

      let userText = m.content
      if (m.role === 'user' && (ocrText || m.activeApp)) {
        const ctx = formatDesktopContext({ ...m, ocrText, screenType })
        userText = `${ctx}\n\n${m.content}`
      }

      if (contentParts.length > 0 && m.role === 'user') {
        contentParts.push({ type: 'text', text: userText })
        return {
          role: m.role,
          content: contentParts,
          ocrText,
          screenshotTitle: m.screenshotTitle,
          manualScreenshotTitle: m.manualScreenshotTitle
        }
      }

      return {
        role: m.role,
        content: m.content,
        ocrText,
        screenshotTitle: m.screenshotTitle,
        manualScreenshotTitle: m.manualScreenshotTitle
      }
    })

  // ── Step 4: Fire intent resolution and AI call in parallel ─────────────
  // Intent resolution (desktop actions like "open folder") and the AI call
  // are independent. Run both concurrently so intent doesn't block the AI
  // path — saves 500-2000ms on every message.
  const intentPromise = text.length < 200
    ? tryIntentResolution(text, store.conversationId)
    : Promise.resolve(false)

  // Get provider from settings (needed before we can send)
  const settings = await window.electronAPI.getSettings()
  _pS('getSettings() done')
  const configuredProvider: AiProvider = settings.aiProvider || 'codex'

  const currentStore = useCompanionStore.getState()
  const provider: AiProvider = isAiProvider(currentStore.conversationProvider)
    ? currentStore.conversationProvider
    : configuredProvider

  if (currentStore.conversationProvider !== provider) {
    currentStore.setConversationProvider(provider)
  }

  const resumeMode =
    provider === 'codex' && currentStore.requiresReplaySeed ? 'replay-seed' : 'normal'

  // Start the AI call immediately — don't wait for intent resolution
  _pS('firing AI call (parallel with intent)')
  const aiPromise = window.electronAPI.sendAiMessage({
    messages: coreMessages,
    sessionId: currentStore.sessionId,
    provider,
    resumeMode,
    conversationId: currentStore.conversationId
  })

  // Check if intent resolution handled it
  const handled = await intentPromise
  _pS(`intent resolution done | handled=${handled}`)

  if (handled) {
    // Intent handled it — abort the AI stream that was started in parallel
    window.electronAPI.abortAiStream(currentStore.sessionId)
    return
  }

  // Wait for the AI call to complete (it's already in flight)
  try {
    await aiPromise
    _pS('sendAiMessage returned')
  } catch (err) {
    useCompanionStore
      .getState()
      .streamError(`Failed to send message: ${err instanceof Error ? err.message : String(err)}`)
  }
}
