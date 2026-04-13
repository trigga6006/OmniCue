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
 * addUserMessage is called first so the UI never stalls, then OCR and intent
 * resolution happen before the AI payload is constructed.
 */
export async function sendCompanionMessage(text: string): Promise<void> {
  const store = useCompanionStore.getState()
  if (store.isStreaming) return

  // ── Step 1: Show user message immediately ───────────────────────────────
  // The message appears in the chat right away. OCR text (if any) will be
  // injected into the AI payload later — the stored message may lack it,
  // but the user never sees OCR data so this is fine for the UI.
  store.addUserMessage(text)

  // ── Step 2: Resolve OCR (usually already complete) ──────────────────────
  // This runs AFTER addUserMessage so the UI never stalls. The resolved OCR
  // data is injected into the AI payload in Step 4 for the latest user message.
  const auto = store.autoScreenshot
  if (auto?.ocrId && !auto.ocrText) {
    const ocr = await window.electronAPI.getOcrResult(auto.ocrId).catch(() => null)
    if (ocr) {
      auto.ocrText = ocr.ocrText
      auto.screenType = ocr.screenType
    }
  }

  const manual = store.pendingScreenshot
  if (manual?.ocrId && !manual.ocrText) {
    const ocr = await window.electronAPI.getOcrResult(manual.ocrId).catch(() => null)
    if (ocr) {
      manual.ocrText = ocr.ocrText
      manual.screenType = ocr.screenType
    }
  }

  // ── Step 3: Try intent resolution (non-blocking from user's perspective)
  // The message is already visible, so the user sees their input right away.
  if (text.length < 200) {
    const handled = await tryIntentResolution(text, store.conversationId)
    if (handled) return
  }

  // ── Step 4: Build messages and start AI streaming ───────────────────────
  const updatedMessages = useCompanionStore.getState().messages

  // For the latest user message, the stored object may not have ocrText
  // because addUserMessage ran before OCR resolved. Patch it in for the
  // AI payload using the now-resolved autoScreenshot data.
  const lastUserIndex = updatedMessages.length - 1 -
    [...updatedMessages].reverse().findIndex((m) => m.role === 'user')
  const resolvedOcr = auto?.ocrText
  const resolvedScreenType = auto?.screenType

  const coreMessages = updatedMessages.map((m: ChatMessage, idx: number) => {
    const contentParts: Array<{ type: string; text?: string; image_url?: { url: string } }> = []

    if (m.role === 'user' && m.screenshot) {
      contentParts.push({ type: 'image_url', image_url: { url: m.screenshot } })
    }

    if (m.role === 'user' && m.manualScreenshot) {
      contentParts.push({ type: 'image_url', image_url: { url: m.manualScreenshot } })
    }

    // For the latest user message, prefer the freshly-resolved OCR data
    const ocrText = (idx === lastUserIndex && resolvedOcr) ? resolvedOcr : m.ocrText
    const screenType = (idx === lastUserIndex && resolvedScreenType) ? resolvedScreenType : m.screenType

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
        manualScreenshotTitle: m.manualScreenshotTitle,
      }
    }

    return {
      role: m.role,
      content: m.content,
      ocrText,
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

  try {
    await window.electronAPI.sendAiMessage({
      messages: coreMessages,
      sessionId: currentStore.sessionId,
      provider,
      resumeMode,
      conversationId: currentStore.conversationId,
    })
  } catch (err) {
    // IPC invoke failed (e.g. serialization error) — reset streaming state
    // so the UI doesn't get stuck in "thinking" forever.
    useCompanionStore.getState().streamError(
      `Failed to send message: ${err instanceof Error ? err.message : String(err)}`
    )
  }
}
