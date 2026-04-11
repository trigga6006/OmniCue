import { create } from 'zustand'
import type { ChatMessage, AgentInteractionRequest } from '@/lib/types'
import { generateId } from '@/lib/utils'
import type { PanelSizeMode } from '@/lib/constants'

interface ScreenshotData {
  image: string
  title: string
  activeApp?: string
  processName?: string
  clipboardText?: string
  ocrId?: number
  ocrText?: string
  screenType?: string
  packId?: string
  packName?: string
  packConfidence?: number
  packContext?: Record<string, string>
  packVariant?: string
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

  // ── Conversation history state ────────────────────────────────────────────
  conversationId: string
  conversationTitle: string
  /** Whether this conversation was restored from saved history */
  restoredFromHistory: boolean
  /** Whether the next send needs a replay-seed for thread-based providers */
  requiresReplaySeed: boolean
  /** Whether the conversation list is visible instead of messages */
  showConversationList: boolean
  /** Whether the notes list is visible instead of messages */
  showNotesList: boolean
  /** Provider used for this conversation (for persistence) */
  conversationProvider: string

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
  /** Set screenshot and eagerly resolve OCR in background for QuickActions */
  captureAndResolve: (s: ScreenshotData) => void
  setPendingScreenshot: (s: ScreenshotData | null) => void
  clearMessages: () => void
  newSession: () => void
  showAll: () => void
  setAiMode: (mode: 'fast' | 'auto' | 'pro') => void
  setPanelSizeMode: (mode: PanelSizeMode) => void
  addInteractionRequest: (request: AgentInteractionRequest) => void
  resolveInteraction: (id: string, status: AgentInteractionRequest['status']) => void

  // ── Conversation history actions ──────────────────────────────────────────
  saveCurrentConversation: () => void
  loadConversation: (id: string) => Promise<void>
  renameConversation: (title: string) => void
  deleteConversation: (id: string) => Promise<void>
  toggleConversationList: () => void
  toggleNotesList: () => void
  setConversationProvider: (provider: string) => void
}

// ── Auto-save helper (debounced) ────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null

function debouncedSave(): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    const s = useCompanionStore.getState()
    if (s.messages.length === 0) return
    window.electronAPI.saveConversation({
      id: s.conversationId,
      title: s.conversationTitle,
      provider: s.conversationProvider,
      messages: s.messages,
    })
  }, 500)
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
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

  // Conversation history state
  conversationId: generateId(),
  conversationTitle: '',
  restoredFromHistory: false,
  requiresReplaySeed: false,
  showConversationList: false,
  showNotesList: false,
  conversationProvider: '',

  toggle: () => set((s) => {
    if (s.visible) {
      return { visible: false, viewHorizon: s.messages.length, showingAll: false, pendingScreenshot: null, showConversationList: false, showNotesList: false }
    }
    return { visible: true, showingAll: false }
  }),
  open: () => set({ visible: true, showingAll: false }),
  close: () => set((s) => ({ visible: false, viewHorizon: s.messages.length, showingAll: false, pendingScreenshot: null, panelSizeMode: 'compact' as PanelSizeMode, showConversationList: false, showNotesList: false })),

  addUserMessage: (content) => {
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
        // Structured desktop context
        activeApp: s.autoScreenshot?.activeApp,
        processName: s.autoScreenshot?.processName,
        clipboardText: s.autoScreenshot?.clipboardText,
        // Tool pack metadata
        packId: s.autoScreenshot?.packId,
        packName: s.autoScreenshot?.packName,
        packConfidence: s.autoScreenshot?.packConfidence,
        packContext: s.autoScreenshot?.packContext,
        packVariant: s.autoScreenshot?.packVariant,
        createdAt: Date.now(),
      }
      // Auto-name conversation from first user message
      const title = s.conversationTitle || content.slice(0, 60).replace(/\n/g, ' ').trim()
      return {
        messages: [...s.messages, msg],
        pendingScreenshot: null,
        conversationTitle: title,
        showConversationList: false,
        showNotesList: false,
      }
    })
    debouncedSave()
  },

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

  finishStreaming: (fullText) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: fullText } : m
      ),
      isStreaming: false,
      streamingMessageId: null,
      // Clear replay-seed flag after successful first resumed turn
      requiresReplaySeed: false,
    }))
    debouncedSave()
  },

  streamError: (error) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: `Error: ${error}` } : m
      ),
      isStreaming: false,
      streamingMessageId: null,
    }))
    debouncedSave()
  },

  setAutoScreenshot: (s) => set({ autoScreenshot: s }),
  captureAndResolve: (s) => {
    // Clear stale screenType/ocrText so QuickActions doesn't flash old chips
    set({ autoScreenshot: { ...s, screenType: undefined, ocrText: undefined } })
    if (s.ocrId) {
      window.electronAPI.getOcrResult(s.ocrId).then((ocr) => {
        if (!ocr) return
        const current = useCompanionStore.getState().autoScreenshot
        if (current && current.ocrId === s.ocrId) {
          set({ autoScreenshot: { ...current, ocrText: ocr.ocrText, screenType: ocr.screenType } })
        }
      })
    }
  },
  setPendingScreenshot: (s) => set({ pendingScreenshot: s }),
  clearMessages: () => set({ messages: [], viewHorizon: 0, showingAll: false }),

  newSession: () => {
    const s = get()
    // Save current conversation before clearing (if it has messages)
    if (s.messages.length > 0) {
      window.electronAPI.saveConversation({
        id: s.conversationId,
        title: s.conversationTitle,
        provider: s.conversationProvider,
        messages: s.messages,
      })
    }
    window.electronAPI.cleanupAiSession(s.sessionId)
    set({
      messages: [],
      sessionId: generateId(),
      conversationId: generateId(),
      conversationTitle: '',
      restoredFromHistory: false,
      requiresReplaySeed: false,
      conversationProvider: '',
      autoScreenshot: null,
      pendingScreenshot: null,
      viewHorizon: 0,
      showingAll: false,
      panelSizeMode: 'compact' as PanelSizeMode,
      pendingInteractions: [],
      showConversationList: false,
      showNotesList: false,
    })
  },

  showAll: () => set({ showingAll: true }),
  setPanelSizeMode: (mode) => set({ panelSizeMode: mode }),
  setAiMode: (mode) => {
    set({ aiMode: mode })
    window.electronAPI.setSettings({ aiMode: mode })
  },

  // ── Conversation history actions ──────────────────────────────────────────

  saveCurrentConversation: () => {
    const s = get()
    if (s.messages.length === 0) return
    window.electronAPI.saveConversation({
      id: s.conversationId,
      title: s.conversationTitle,
      provider: s.conversationProvider,
      messages: s.messages,
    })
  },

  loadConversation: async (id: string) => {
    const s = get()
    if (s.isStreaming) return

    // Save current conversation before switching
    if (s.messages.length > 0) {
      window.electronAPI.saveConversation({
        id: s.conversationId,
        title: s.conversationTitle,
        provider: s.conversationProvider,
        messages: s.messages,
      })
    }

    // Clean up current provider session
    window.electronAPI.cleanupAiSession(s.sessionId)

    const conv = await window.electronAPI.loadConversation(id)
    if (!conv) return

    // Determine if we need replay-seed (for Codex app-server)
    const needsReplaySeed = conv.provider === 'codex'

    set({
      messages: conv.messages,
      conversationId: conv.id,
      conversationTitle: conv.title,
      conversationProvider: conv.provider,
      sessionId: generateId(),
      restoredFromHistory: true,
      requiresReplaySeed: needsReplaySeed,
      autoScreenshot: null,
      pendingScreenshot: null,
      viewHorizon: 0,
      showingAll: true,
      panelSizeMode: 'compact' as PanelSizeMode,
      pendingInteractions: [],
      showConversationList: false,
      showNotesList: false,
    })
  },

  renameConversation: (title: string) => {
    const s = get()
    set({ conversationTitle: title })
    window.electronAPI.renameConversation(s.conversationId, title)
  },

  deleteConversation: async (id: string) => {
    const s = get()
    await window.electronAPI.deleteConversation(id)
    // If we deleted the currently loaded conversation, start fresh
    if (s.conversationId === id) {
      set({
        messages: [],
        conversationId: generateId(),
        conversationTitle: '',
        restoredFromHistory: false,
        requiresReplaySeed: false,
        conversationProvider: '',
        viewHorizon: 0,
        showingAll: false,
      })
    }
  },

  toggleConversationList: () => set((s) => ({ showConversationList: !s.showConversationList, showNotesList: false })),
  toggleNotesList: () => set((s) => ({ showNotesList: !s.showNotesList, showConversationList: false })),

  setConversationProvider: (provider: string) => set({ conversationProvider: provider }),

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
