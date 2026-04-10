import { useCompanionStore } from '@/stores/companionStore'
import { generateId } from '@/lib/utils'
import type { ChatMessage, AiProvider } from '@/lib/types'

/**
 * Shared send logic used by CompanionInput and quick actions.
 * Resolves OCR, builds messages, routes model, and fires the stream.
 */
export async function sendCompanionMessage(text: string): Promise<void> {
  const store = useCompanionStore.getState()
  if (store.isStreaming) return

  // Resolve auto-screenshot OCR if pending
  const auto = store.autoScreenshot
  if (auto?.ocrId && !auto.ocrText) {
    const ocr = await window.electronAPI.getOcrResult(auto.ocrId)
    if (ocr) {
      auto.ocrText = ocr.ocrText
      auto.screenType = ocr.screenType
    }
  }

  // Resolve manual screenshot OCR if pending
  const manual = store.pendingScreenshot
  if (manual?.ocrId && !manual.ocrText) {
    const ocr = await window.electronAPI.getOcrResult(manual.ocrId)
    if (ocr) {
      manual.ocrText = ocr.ocrText
      manual.screenType = ocr.screenType
    }
  }

  store.addUserMessage(text)

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
    if (m.role === 'user' && m.ocrText) {
      const screenLabel = m.screenType && m.screenType !== 'unknown'
        ? ` (${m.screenType})`
        : ''
      userText = `[Screen context${screenLabel} — extracted text from ${m.screenshotTitle || 'screen'}]\n${m.ocrText}\n\n[User question]\n${m.content}`
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
  const provider: AiProvider = settings.aiProvider || 'codex'

  const streamMsgId = generateId()
  store.startStreaming(streamMsgId)

  window.electronAPI.sendAiMessage({
    messages: coreMessages,
    sessionId: store.sessionId,
    provider,
  })
}
