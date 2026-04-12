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
  'kimi',
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
 */
/**
 * Try resolving a short imperative message as a desktop intent before hitting the AI.
 * Returns true if the intent was handled (caller should skip AI streaming).
 * Note: the user message is already added to the store before this is called.
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

    const msgId = generateId()
    store.startStreaming(msgId)
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
 * Key UX constraint: the user's message must appear immediately in the chat.
 * All async work (OCR resolution, intent resolution) happens after the
 * message is visible so the UI never stalls.
 */
export async function sendCompanionMessage(text: string): Promise<void> {
  const store = useCompanionStore.getState()
  if (store.isStreaming) return

  // ── Step 1: Resolve OCR eagerly (usually already complete) ──────────────
  const auto = store.autoScreenshot
  if (auto?.ocrId && !auto.ocrText) {
    const ocr = await window.electronAPI.getOcrResult(auto.ocrId)
    if (ocr) {
      auto.ocrText = ocr.ocrText
      auto.screenType = ocr.screenType
    }
  }

  const manual = store.pendingScreenshot
  if (manual?.ocrId && !manual.ocrText) {
    const ocr = await window.electronAPI.getOcrResult(manual.ocrId)
    if (ocr) {
      manual.ocrText = ocr.ocrText
      manual.screenType = ocr.screenType
    }
  }

  // ── Step 2: Show user message immediately ───────────────────────────────
  store.addUserMessage(text)

  // ── Step 3: Try intent resolution (non-blocking from user's perspective)
  // The message is already visible, so the user sees their input right away.
  if (text.length < 200) {
    const handled = await tryIntentResolution(text, store.conversationId)
    if (handled) return
  }

  // ── Step 4: Build messages and start AI streaming ───────────────────────
  const updatedMessages = useCompanionStore.getState().messages

  const coreMessages = updatedMessages.map((m: ChatMessage) => {
    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []

    if (m.role === 'user' && m.screenshot) {
      contentParts.push({ type: 'image_url', image_url: { url: m.screenshot } })
    }

    if (m.role === 'user' && m.manualScreenshot) {
      contentParts.push({ type: 'image_url', image_url: { url: m.manualScreenshot } })
    }

    let userText = m.content
    if (m.role === 'user' && (m.ocrText || m.activeApp)) {
      const ctx = formatDesktopContext(m)
      userText = `${ctx}\n\n${m.content}`
    }

    if (contentParts.length > 0 && m.role === 'user') {
      contentParts.push({ type: 'text', text: userText })
      return {
        role: m.role,
        content: contentParts,
        ocrText: m.ocrText,
        screenshotTitle: m.screenshotTitle,
        manualScreenshotTitle: m.manualScreenshotTitle,
      }
    }

    return {
      role: m.role,
      content: m.content,
      ocrText: m.ocrText,
      screenshotTitle: m.screenshotTitle,
      manualScreenshotTitle: m.manualScreenshotTitle,
    }
  })

  // Get provider from settings (cached in store or fetched)
  const settings = await window.electronAPI.getSettings()
  const configuredProvider: AiProvider = settings.aiProvider || 'codex'

  const currentStore = useCompanionStore.getState()
  const provider: AiProvider = isAiProvider(currentStore.conversationProvider)
    ? currentStore.conversationProvider
    : configuredProvider

  // Track provider on the conversation for persistence
  if (currentStore.conversationProvider !== provider) {
    currentStore.setConversationProvider(provider)
  }

  // Determine if this is a replay-seed send (restored Codex conversation)
  const resumeMode = provider === 'codex' && currentStore.requiresReplaySeed ? 'replay-seed' : 'normal'

  const streamMsgId = generateId()
  store.startStreaming(streamMsgId)

  window.electronAPI.sendAiMessage({
    messages: coreMessages,
    sessionId: currentStore.sessionId,
    provider,
    resumeMode,
    conversationId: currentStore.conversationId,
  })
}
