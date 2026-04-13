import { useEffect } from 'react'
import { useCompanionStore } from '@/stores/companionStore'
import { preferLargerPanelSize, resolvePanelSize } from '@/lib/resolvePanelSize'

/**
 * Global AI stream event listeners — mounted once in App.tsx so they persist
 * regardless of whether the CompanionPanel is visible.
 *
 * Previously these lived inside CompanionPanel's useEffect and were torn down
 * whenever the panel closed, causing tokens/done/error events to be silently
 * dropped if the user closed the panel mid-stream.
 */
export function useAiStreamListeners(): void {
  useEffect(() => {
    const store = useCompanionStore.getState

    function growPanelForContent(content: string): void {
      const state = store()
      if (!state.visible) return // no resize when panel is closed
      const nextSize = preferLargerPanelSize(state.panelSizeMode, resolvePanelSize(content))
      if (nextSize !== state.panelSizeMode) {
        state.transitionPanelSize(nextSize)
      }
    }

    const unsubToken = window.electronAPI.onAiStreamToken((data) => {
      if (data.sessionId === store().sessionId) {
        store().appendToken(data.token)
        const state = store()
        const streamingMessage = state.messages.find(
          (message) => message.id === state.streamingMessageId,
        )
        if (streamingMessage?.content) {
          growPanelForContent(streamingMessage.content)
        }
      }
    })

    const unsubDone = window.electronAPI.onAiStreamDone((data) => {
      if (data.sessionId === store().sessionId) {
        store().finishStreaming(data.fullText)
        growPanelForContent(data.fullText)
      }
    })

    const unsubError = window.electronAPI.onAiStreamError((data) => {
      if (data.sessionId === store().sessionId) {
        store().streamError(data.error)
      }
    })

    const unsubTool = window.electronAPI.onAiToolUse((data) => {
      if (data.sessionId === store().sessionId) {
        store().addToolUse(data.toolName, data.toolInput)
      }
    })

    const unsubInteraction = window.electronAPI.onAiInteractionRequest((data) => {
      if (data.sessionId === store().sessionId) {
        store().addInteractionRequest(data)
      }
    })

    return () => {
      unsubToken()
      unsubDone()
      unsubError()
      unsubTool()
      unsubInteraction()
    }
  }, [])
}
