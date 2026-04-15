import { create } from 'zustand'
import type { ChatMessage, AgentInteractionRequest } from '@/lib/types'
import { generateId } from '@/lib/utils'
import { PANEL_SIZES, FULLSCREEN_GAP, type PanelSizeMode } from '@/lib/constants'
import { suppressRegionPublish } from '@/hooks/useClickThrough'

// ── Transition coordination ────────────────────────────────────────────────
// Monotonically increasing token so async open/close/resize flows can detect
// when a newer transition has superseded them ("latest request wins").
let _transitionSeq = 0
let _pendingOpenRelease: (() => void) | null = null
let _pendingSizeRelease: (() => void) | null = null

function beginTransition(): number {
  return ++_transitionSeq
}

function isCurrentTransition(token: number): boolean {
  return token === _transitionSeq
}

function replacePendingRelease(kind: 'open' | 'size', nextRelease: (() => void) | null): void {
  const previousRelease = kind === 'open' ? _pendingOpenRelease : _pendingSizeRelease

  if (kind === 'open') {
    _pendingOpenRelease = nextRelease
  } else {
    _pendingSizeRelease = nextRelease
  }

  // Acquire the new suppression before releasing the superseded one so we
  // don't briefly republish regions in the middle of a replacement transition.
  if (previousRelease) previousRelease()
}

function clearPendingRelease(kind: 'open' | 'size'): void {
  if (kind === 'open') {
    _pendingOpenRelease = null
  } else {
    _pendingSizeRelease = null
  }
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()))
}

/** Called by CompanionPanel when the enter animation completes. */
export function releasePanelOpenTransition(): void {
  if (_pendingOpenRelease) {
    const release = _pendingOpenRelease
    _pendingOpenRelease = null
    release()
  }
}

/** Called by CompanionPanel when the outer shell width transition completes. */
export function releasePanelSizeTransition(): void {
  if (_pendingSizeRelease) {
    const release = _pendingSizeRelease
    _pendingSizeRelease = null
    release()
  }
}

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

function resolveScreenshotOcrInBackground(
  key: 'autoScreenshot' | 'pendingScreenshot',
  screenshot: ScreenshotData
): void {
  if (!screenshot.ocrId) return

  window.electronAPI.getOcrResult(screenshot.ocrId).then((ocr) => {
    if (!ocr) return
    const current = useCompanionStore.getState()[key]
    if (current && current.ocrId === screenshot.ocrId) {
      useCompanionStore.setState({
        [key]: { ...current, ocrText: ocr.ocrText, screenType: ocr.screenType }
      } as Pick<CompanionState, typeof key>)
    }
  })
}

type ConversationStateSlice = Pick<
  CompanionState,
  | 'isStreaming'
  | 'isInitializing'
  | 'streamingMessageId'
  | 'messages'
  | 'conversationId'
  | 'conversationTitle'
  | 'conversationProvider'
  | 'sessionId'
  | 'restoredFromHistory'
  | 'requiresReplaySeed'
  | 'autoScreenshot'
  | 'pendingScreenshot'
  | 'viewHorizon'
  | 'showingAll'
  | 'panelSizeMode'
  | 'pendingInteractions'
  | 'showConversationList'
  | 'showNotesList'
>

interface CompanionState {
  visible: boolean
  messages: ChatMessage[]
  isStreaming: boolean
  /** Whether the provider is performing cold-start initialization (e.g. Codex subprocess) */
  isInitializing: boolean
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
  /** Saved window bounds before entering fullscreen, used to restore on exit */
  preFullscreenBounds: { x: number; y: number; width: number; height: number } | null

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
  /** Conversation that should survive close/reopen for the overlay */
  pinnedConversationId: string | null

  toggle: () => void
  open: () => void
  close: () => void
  addUserMessage: (content: string) => void
  setInitializing: (initializing: boolean) => void
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
  /** Coordinated panel resize: suppresses region publish, awaits window resize, then transitions. */
  transitionPanelSize: (mode: PanelSizeMode) => Promise<void>
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
  toggleConversationPin: () => Promise<void>
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
      messages: s.messages
    })
  }, 500)
}

function saveConversationSnapshot(
  state: Pick<
    CompanionState,
    'messages' | 'conversationId' | 'conversationTitle' | 'conversationProvider'
  >
): void {
  if (state.messages.length === 0) return
  window.electronAPI.saveConversation({
    id: state.conversationId,
    title: state.conversationTitle,
    provider: state.conversationProvider,
    messages: state.messages
  })
}

function createFreshConversationState(): ConversationStateSlice {
  return {
    messages: [],
    isInitializing: false,
    isStreaming: false,
    streamingMessageId: null,
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
    showNotesList: false
  }
}

export const useCompanionStore = create<CompanionState>((set, get) => ({
  visible: false,
  messages: [],
  isStreaming: false,
  isInitializing: false,
  streamingMessageId: null,
  sessionId: generateId(),
  autoScreenshot: null,
  pendingScreenshot: null,
  viewHorizon: 0,
  showingAll: false,
  aiMode: 'auto',
  panelSizeMode: 'compact' as PanelSizeMode,
  pendingInteractions: [],
  preFullscreenBounds: null,

  // Conversation history state
  conversationId: generateId(),
  conversationTitle: '',
  restoredFromHistory: false,
  requiresReplaySeed: false,
  showConversationList: false,
  showNotesList: false,
  conversationProvider: '',
  pinnedConversationId: null,

  toggle: () =>
    set((s) => {
      if (s.visible) {
        const isPinnedConversation = s.pinnedConversationId === s.conversationId
        // When closing during streaming, preserve viewHorizon so the current exchange
        // stays visible when the panel is reopened
        return {
          visible: false,
          viewHorizon: isPinnedConversation || s.isStreaming ? s.viewHorizon : s.messages.length,
          showingAll: isPinnedConversation || s.isStreaming ? s.showingAll : false,
          pendingScreenshot: null,
          preFullscreenBounds: null,
          showConversationList: false,
          showNotesList: false
        }
      }
      return { visible: true, showingAll: false }
    }),
  open: async () => {
    // Recover from orphaned streaming state — if the panel was closed mid-stream
    // and the stream finished (or errored) while listeners were active globally,
    // isStreaming should already be false. But if it's still true, the stream was
    // orphaned (e.g. IPC failure before global listeners existed). Reset it so the
    // user doesn't see a stuck "thinking" spinner.
    let current = get()
    if (current.isStreaming && current.streamingMessageId) {
      const streamMsg = current.messages.find((m) => m.id === current.streamingMessageId)
      // If the streaming message has no content after being created, it's stuck
      if (streamMsg && !streamMsg.content) {
        set({
          isStreaming: false,
          streamingMessageId: null,
          // Remove the empty assistant message so it doesn't show as a blank bubble
          messages: current.messages.filter((m) => m.id !== current.streamingMessageId)
        })
        current = get()
      }
    }

    const settings = await window.electronAPI.getSettings()
    const pinnedConversationId = settings.pinnedConversationId ?? null
    if (current.pinnedConversationId !== pinnedConversationId) {
      set({ pinnedConversationId })
      current = get()
    }

    if (!current.isStreaming) {
      if (pinnedConversationId) {
        const shouldRestorePinned =
          current.conversationId !== pinnedConversationId || current.messages.length === 0

        if (shouldRestorePinned) {
          if (current.messages.length > 0) {
            saveConversationSnapshot(current)
          }
          window.electronAPI.cleanupAiSession(current.sessionId)

          const conv = await window.electronAPI.loadConversation(pinnedConversationId)
          if (conv) {
            set({
              messages: conv.messages,
              conversationId: conv.id,
              conversationTitle: conv.title,
              conversationProvider: conv.provider,
              sessionId: generateId(),
              restoredFromHistory: true,
              requiresReplaySeed: conv.provider === 'codex',
              autoScreenshot: null,
              pendingScreenshot: null,
              viewHorizon: 0,
              showingAll: true,
              panelSizeMode: 'compact' as PanelSizeMode,
              pendingInteractions: [],
              showConversationList: false,
              showNotesList: false
            })
          } else {
            set({ pinnedConversationId: null, ...createFreshConversationState() })
            await window.electronAPI.setSettings({ pinnedConversationId: null })
          }
        } else {
          set({ viewHorizon: 0, showingAll: true })
        }
      } else if (current.messages.length > 0) {
        await get().newSession()
      }
    }

    const token = beginTransition()
    const release = suppressRegionPublish()
    replacePendingRelease('open', release)

    const config = PANEL_SIZES.compact
    await window.electronAPI.requestWindowResize(config.windowW, config.windowH)
    await nextFrame()

    if (!isCurrentTransition(token)) {
      if (_pendingOpenRelease === release) {
        clearPendingRelease('open')
        release()
      }
      return
    }

    // Panel mounts → Framer Motion enter animation runs.
    // Suppression is released by CompanionPanel's onAnimationComplete
    // via releasePanelOpenTransition().
    set({
      visible: true,
      showingAll: get().messages.length > 0 ? get().showingAll : false,
      panelSizeMode: 'compact' as PanelSizeMode,
      showConversationList: false,
      showNotesList: false
    })
  },
  close: () => {
    const state = get()
    const isPinnedConversation = state.pinnedConversationId === state.conversationId
    if (isPinnedConversation) {
      saveConversationSnapshot(state)
    }
    set({
      visible: false,
      // Preserve viewHorizon during streaming so reopening shows the active exchange
      viewHorizon:
        isPinnedConversation || state.isStreaming ? state.viewHorizon : state.messages.length,
      showingAll: isPinnedConversation || state.isStreaming ? state.showingAll : false,
      pendingScreenshot: null,
      preFullscreenBounds: null,
      // Don't reset panelSizeMode here — changing it during the exit animation
      // shifts the animate prop mid-exit, causing a visible size glitch.
      // It resets to 'compact' on the next open().
      showConversationList: false,
      showNotesList: false
    })
  },

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
        createdAt: Date.now()
      }
      // Auto-name conversation from first user message
      const title = s.conversationTitle || content.slice(0, 60).replace(/\n/g, ' ').trim()
      return {
        messages: [...s.messages, msg],
        pendingScreenshot: null,
        conversationTitle: title,
        showConversationList: false,
        showNotesList: false
      }
    })
    debouncedSave()
  },

  setInitializing: (initializing) => set({ isInitializing: initializing }),

  startStreaming: (messageId) => {
    const msg: ChatMessage = {
      id: messageId,
      role: 'assistant',
      content: '',
      createdAt: Date.now()
    }
    set((s) => ({
      messages: [...s.messages, msg],
      isStreaming: true,
      streamingMessageId: messageId
    }))
  },

  appendToken: (token) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: m.content + token } : m
      ),
      // First token means initialization is done
      isInitializing: false
    })),

  addToolUse: (toolName, toolInput) =>
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId
          ? { ...m, toolUses: [...(m.toolUses || []), { name: toolName, input: toolInput }] }
          : m
      )
    })),

  finishStreaming: (fullText) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: fullText } : m
      ),
      isStreaming: false,
      isInitializing: false,
      streamingMessageId: null,
      // Clear replay-seed flag after successful first resumed turn
      requiresReplaySeed: false
    }))
    debouncedSave()
  },

  streamError: (error) => {
    set((s) => ({
      messages: s.messages.map((m) =>
        m.id === s.streamingMessageId ? { ...m, content: `Error: ${error}` } : m
      ),
      isStreaming: false,
      isInitializing: false,
      streamingMessageId: null
    }))
    debouncedSave()
  },

  setAutoScreenshot: (s) => set({ autoScreenshot: s }),
  captureAndResolve: (s) => {
    // Clear stale screenType/ocrText so QuickActions doesn't flash old chips
    set({ autoScreenshot: { ...s, screenType: undefined, ocrText: undefined } })
    resolveScreenshotOcrInBackground('autoScreenshot', s)
  },
  setPendingScreenshot: (s) => {
    set({
      pendingScreenshot: s ? { ...s, screenType: undefined, ocrText: undefined } : null
    })
    if (s) {
      resolveScreenshotOcrInBackground('pendingScreenshot', s)
    }
  },
  clearMessages: () => set({ messages: [], viewHorizon: 0, showingAll: false }),

  newSession: async () => {
    const s = get()
    const wasPinnedConversation = s.pinnedConversationId === s.conversationId
    saveConversationSnapshot(s)
    if (wasPinnedConversation) {
      await window.electronAPI.setSettings({ pinnedConversationId: null })
    }
    window.electronAPI.cleanupAiSession(s.sessionId)
    set({
      ...createFreshConversationState(),
      pinnedConversationId: wasPinnedConversation ? null : s.pinnedConversationId
    })
  },

  showAll: () => set({ showingAll: true }),
  setPanelSizeMode: (mode) => set({ panelSizeMode: mode }),
  transitionPanelSize: async (mode) => {
    const state = get()
    if (state.panelSizeMode === mode || !state.visible) return

    const token = beginTransition()
    const release = suppressRegionPublish()
    replacePendingRelease('size', release)

    const isFullscreenTransition = mode === 'fullscreen' || state.panelSizeMode === 'fullscreen'

    if (mode === 'fullscreen') {
      // Save current window bounds so we can restore on exit
      const currentBounds = await window.electronAPI.getWindowBounds()
      // Get the display the overlay is currently on
      const displayBounds = await window.electronAPI.getCurrentDisplayBounds()
      // Expand window to near-fullscreen with a gap for the floating effect
      window.electronAPI.setWindowBounds({
        x: displayBounds.x + FULLSCREEN_GAP,
        y: displayBounds.y + FULLSCREEN_GAP,
        width: displayBounds.width - FULLSCREEN_GAP * 2,
        height: displayBounds.height - FULLSCREEN_GAP * 2,
      })
      set({ preFullscreenBounds: currentBounds })
    } else if (state.panelSizeMode === 'fullscreen' && state.preFullscreenBounds) {
      // Exiting fullscreen — restore position and apply target size in one step
      const prev = state.preFullscreenBounds
      const config = PANEL_SIZES[mode as keyof typeof PANEL_SIZES]
      const centerX = prev.x + Math.round(prev.width / 2)
      window.electronAPI.setWindowBounds({
        x: centerX - Math.round(config.windowW / 2),
        y: prev.y,
        width: config.windowW,
        height: config.windowH,
      })
      set({ preFullscreenBounds: null })
    } else {
      // Standard panel resize between compact/tall/wide/large
      const config = PANEL_SIZES[mode as keyof typeof PANEL_SIZES]
      await window.electronAPI.requestWindowResize(config.windowW, config.windowH)
    }

    await nextFrame()

    if (!isCurrentTransition(token)) {
      if (_pendingSizeRelease === release) {
        clearPendingRelease('size')
        release()
      }
      return
    }

    // State change triggers CSS transition on width/maxHeight.
    // For standard transitions, suppression is released by CompanionPanel's
    // transitionend handler via releasePanelSizeTransition().
    set({ panelSizeMode: mode })

    // For fullscreen transitions, CSS can't interpolate between px and
    // percentage values, so transitionend won't fire. Release manually.
    if (isFullscreenTransition) {
      releasePanelSizeTransition()
    }
  },
  setAiMode: (mode) => {
    set({ aiMode: mode })
    window.electronAPI.setSettings({ aiMode: mode })
  },

  // ── Conversation history actions ──────────────────────────────────────────

  saveCurrentConversation: () => {
    const s = get()
    saveConversationSnapshot(s)
  },

  loadConversation: async (id: string) => {
    const s = get()
    if (s.isStreaming) return

    // Save current conversation before switching
    saveConversationSnapshot(s)

    const wasPinnedConversation = s.pinnedConversationId === s.conversationId
    if (wasPinnedConversation && s.conversationId !== id) {
      await window.electronAPI.setSettings({ pinnedConversationId: null })
    }

    // Clean up current provider session
    window.electronAPI.cleanupAiSession(s.sessionId)

    const conv = await window.electronAPI.loadConversation(id)
    if (!conv) {
      if (wasPinnedConversation && s.conversationId !== id) {
        set({ pinnedConversationId: null })
      }
      return
    }

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
      pinnedConversationId:
        wasPinnedConversation && s.conversationId !== id ? null : s.pinnedConversationId
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
    if (s.pinnedConversationId === id) {
      await window.electronAPI.setSettings({ pinnedConversationId: null })
    }
    // If we deleted the currently loaded conversation, start fresh
    if (s.conversationId === id) {
      set({
        ...createFreshConversationState(),
        pinnedConversationId: s.pinnedConversationId === id ? null : s.pinnedConversationId
      })
    } else if (s.pinnedConversationId === id) {
      set({ pinnedConversationId: null })
    }
  },

  toggleConversationList: () =>
    set((s) => ({ showConversationList: !s.showConversationList, showNotesList: false })),
  toggleNotesList: () =>
    set((s) => ({ showNotesList: !s.showNotesList, showConversationList: false })),

  setConversationProvider: (provider: string) => set({ conversationProvider: provider }),
  toggleConversationPin: async () => {
    const s = get()
    if (s.messages.length === 0) return

    const nextPinnedConversationId =
      s.pinnedConversationId === s.conversationId ? null : s.conversationId

    if (nextPinnedConversationId) {
      saveConversationSnapshot(s)
    }

    set({ pinnedConversationId: nextPinnedConversationId })
    await window.electronAPI.setSettings({ pinnedConversationId: nextPinnedConversationId })
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
          )
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
          )
        }
      }

      const syntheticMessage: ChatMessage = {
        id: generateId(),
        role: 'assistant',
        content: '',
        interactions: [request],
        createdAt: Date.now()
      }

      return {
        pendingInteractions,
        messages: [...s.messages, syntheticMessage]
      }
    }),

  resolveInteraction: (id, status) =>
    set((s) => {
      const update = (req: AgentInteractionRequest) => (req.id === id ? { ...req, status } : req)
      return {
        pendingInteractions: s.pendingInteractions.map(update),
        messages: s.messages.map((m) =>
          m.interactions ? { ...m, interactions: m.interactions.map(update) } : m
        )
      }
    })
}))
