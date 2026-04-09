import { create } from 'zustand'
import type { ChatMessage } from '@/lib/types'
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
  /** Current model mode */
  aiMode: 'fast' | 'auto' | 'pro'
  /** Sticky escalation — once Auto picks Pro, stay Pro for the session */
  sessionEscalatedToPro: boolean
  /** Current panel size — driven by response content heuristics */
  panelSizeMode: PanelSizeMode

  toggle: () => void
  open: () => void
  close: () => void
  addUserMessage: (content: string) => void
  startStreaming: (messageId: string) => void
  appendToken: (token: string) => void
  finishStreaming: (fullText: string) => void
  streamError: (error: string) => void
  setAutoScreenshot: (s: ScreenshotData | null) => void
  setPendingScreenshot: (s: ScreenshotData | null) => void
  clearMessages: () => void
  newSession: () => void
  showAll: () => void
  setAiMode: (mode: 'fast' | 'auto' | 'pro') => void
  markSessionEscalatedToPro: () => void
  setPanelSizeMode: (mode: PanelSizeMode) => void
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
  sessionEscalatedToPro: false,
  panelSizeMode: 'compact' as PanelSizeMode,

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
        sessionEscalatedToPro: false,
        panelSizeMode: 'compact' as PanelSizeMode,
      }
    }),
  showAll: () => set({ showingAll: true }),
  setPanelSizeMode: (mode) => set({ panelSizeMode: mode }),
  setAiMode: (mode) => {
    set({ aiMode: mode })
    window.electronAPI.setSettings({ aiMode: mode })
  },
  markSessionEscalatedToPro: () => set({ sessionEscalatedToPro: true }),
}))
