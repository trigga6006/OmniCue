import { create } from 'zustand'
import type { ChatMessage, AgentInteractionRequest } from '@/lib/types'
import { generateId } from '@/lib/utils'
import type { PanelSizeMode } from '@/lib/constants'

interface ScreenshotData {
  image: string
  title: string
  ocrId?: number
  ocrText?: string
  screenType?: string
}

interface CompanionState {
  visible: boolean
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  sessionId: string
  /** Auto-captured on panel open — invisible to user, always sent as context */
  autoScreenshot: ScreenshotData | null
  /** Manual capture via photo button — visible chip in UI */
  pendingScreenshot: ScreenshotData | null
  /** Index into messages[] — messages before this are "earlier" and hidden by default */
  viewHorizon: number
  /** Whether the user has clicked "Load earlier" to reveal all messages */
  showingAll: boolean
  /** Current model mode — used by direct API providers only */
  aiMode: 'fast' | 'auto' | 'pro'
  /** Current panel size — driven by response content heuristics */
  panelSizeMode: PanelSizeMode
  /** Pending agent interaction requests */
  pendingInteractions: AgentInteractionRequest[]

  toggle: () => void
  open: () => void
  close: () => void
  addUserMessage: (content: string) => void
  startStreaming: (messageId: string) => void
  appendToken: (token: string) => void
  addToolUse: (toolName: string, toolInput: string) => void
  finishStreaming: (fullText: string) => void
  streamError: (error: string) => void
  setAutoScreenshot: (s: ScreenshotData | null) => void
  setPendingScreenshot: (s: ScreenshotData | null) => void
  clearMessages: () => void
  newSession: () => void
  showAll: () => void
  setAiMode: (mode: 'fast' | 'auto' | 'pro') => void
  setPanelSizeMode: (mode: PanelSizeMode) => void
  addInteractionRequest: (request: AgentInteractionRequest) => void
  resolveInteraction: (id: string, status: AgentInteractionRequest['status']) => void
}

export const useCompanionStore = create<CompanionState>((set) => ({
  visible: false,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  sessionId: generateId(),
  autoScreenshot: null,
  pendingScreenshot: null,
  viewHorizon: 0,
  showingAll: false,
  aiMode: 'auto',
  panelSizeMode: 'compact' as PanelSizeMode,
  pendingInteractions: [],

  toggle: () => set((s) => {
    if (s.visible) {
      return { visible: false, viewHorizon: s.messages.length, showingAll: false, pendingScreenshot: null }
    }
    return { visible: true, showingAll: false }
  }),
  open: () => set({ visible: true, showingAll: false }),
  close: () => set((s) => ({ visible: false, viewHorizon: s.messages.length, showingAll: false, pendingScreenshot: null, panelSizeMode: 'compact' as PanelSizeMode })),

  addUserMessage: (content) =>
    set((s) => {
      const msg: ChatMessage = {
        id: generateId(),
        role: 'user',
        content,
        // Auto screenshot (invisible) — always attached
        screenshot: s.autoScreenshot?.image,
        screenshotTitle: s.autoScreenshot?.title,
        ocrText: s.autoScreenshot?.ocrText,
        screenType: s.autoScreenshot?.screenType,
        // Manual screenshot (visible chip) — only if user captured one
        manualScreenshot: s.pendingScreenshot?.image,
        manualScreenshotTitle: s.pendingScreenshot?.title,
        createdAt: Date.now(),
      }
      return { messages: [...s.messages, msg], pendingScreenshot: null }
    }),

  startStreaming: (messageId) => {
    const msg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '',
      createdAt: Date.now(),
    }
    set((s) => ({
      messages: [...s.messages, msg],
      isStreaming: true,
      streamingMessageId: messageId,
    }))
  },

  appendToken: (token) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: m.content + token } : m
      ),
    })),

  addToolUse: (toolName, toolInput) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId
          ? { ...m, toolUses: [...(m.toolUses || []), { name: toolName, input: toolInput }] }
          : m
      ),
    })),

  finishStreaming: (fullText) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: fullText } : m
      ),
      isStreaming: false,
      streamingMessageId: null,
    })),

  streamError: (error) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: `Error: ${error}` } : m
      ),
      isStreaming: false,
      streamingMessageId: null,
    })),

  setAutoScreenshot: (s) => set({ autoScreenshot: s }),
  setPendingScreenshot: (s) => set({ pendingScreenshot: s }),
  clearMessages: () => set({ messages: [], viewHorizon: 0, showingAll: false }),
  newSession: () =>
    set((s) => {
      window.electronAPI.cleanupAiSession(s.sessionId)
      return {
        messages: [],
        sessionId: generateId(),
        autoScreenshot: null,
        pendingScreenshot: null,
        viewHorizon: 0,
        showingAll: false,
        panelSizeMode: 'compact' as PanelSizeMode,
        pendingInteractions: [],
      }
    }),
  showAll: () => set({ showingAll: true }),
  setPanelSizeMode: (mode) => set({ panelSizeMode: mode }),
  setAiMode: (mode) => {
    set({ aiMode: mode })
    window.electronAPI.setSettings({ aiMode: mode })
  },
  addInteractionRequest: (request) =>
    set((s) => {
      const pendingInteractions = [...s.pendingInteractions, request]

      if (s.streamingMessageId) {
        return {
          pendingInteractions,
          messages: s.messages.map((m) =>
            m.id === s.streamingMessageId
              ? { ...m, interactions: [...(m.interactions || []), request] }
              : m
          ),
        }
      }

      const lastAssistantIndex = [...s.messages]
        .map((message, index) => ({ message, index }))
        .reverse()
        .find(({ message }) => message.role === 'assistant')?.index

      if (lastAssistantIndex !== undefined) {
        return {
          pendingInteractions,
          messages: s.messages.map((message, index) =>
            index === lastAssistantIndex
              ? { ...message, interactions: [...(message.interactions || []), request] }
              : message
          ),
        }
      }

      const syntheticMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '',
        interactions: [request],
        createdAt: Date.now(),
      }

      return {
        pendingInteractions,
        messages: [...s.messages, syntheticMessage],
      }
    }),

  resolveInteraction: (id, status) =>
    set((s) => {
      const update = (req: AgentInteractionRequest) =>
        req.id === id ? { ...req, status } : req
      return {
        pendingInteractions: s.pendingInteractions.map(update),
        messages: s.messages.map((m) =>
          m.interactions
            ? { ...m, interactions: m.interactions.map(update) }
            : m
        ),
      }
    }),
}))
