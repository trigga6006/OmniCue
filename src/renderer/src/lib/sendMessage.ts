import { useCompanionStore } from '@/stores/companionStore'
import { resolveModel, MODELS } from '@/lib/modelRouter'
import { generateId } from '@/lib/utils'
import type { ChatMessage } from '@/lib/types'

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
      return { role: m.role, content: contentParts }
    }

    return { role: m.role, content: m.content }
  })

  const resolvedModel = resolveModel({
    mode: store.aiMode,
    userText: text,
    ocrText: store.autoScreenshot?.ocrText,
    screenType: store.autoScreenshot?.screenType,
    hasManualScreenshot: !!manual,
    messageCount: updatedMessages.length,
    sessionEscalatedToPro: store.sessionEscalatedToPro,
  })

  if (store.aiMode === 'auto' && resolvedModel === MODELS.pro) {
    store.markSessionEscalatedToPro()
  }

  const streamMsgId = generateId()
  store.startStreaming(streamMsgId)

  window.electronAPI.sendAiMessage({
    messages: coreMessages,
    sessionId: store.sessionId,
    model: resolvedModel,
  })
}
