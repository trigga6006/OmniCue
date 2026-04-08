import { create } from 'zustand'
import type { ChatMessage } from '@/lib/types'
import { generateId } from '@/lib/utils'

interface CompanionState {
  visible: boolean
  messages: ChatMessage[]
  isStreaming: boolean
  streamingMessageId: string | null
  sessionId: string
  pendingScreenshot: { image: string; title: string } | null

  toggle: () => void
  open: () => void
  close: () => void
  addUserMessage: (content: string, screenshot?: { image: string; title: string }) => void
  startStreaming: (messageId: string) => void
  appendToken: (token: string) => void
  finishStreaming: (fullText: string) => void
  streamError: (error: string) => void
  setPendingScreenshot: (s: { image: string; title: string } | null) => void
  clearMessages: () => void
  newSession: () => void
}

export const useCompanionStore = create<CompanionState>((set) => ({
  visible: false,
  messages: [],
  isStreaming: false,
  streamingMessageId: null,
  sessionId: generateId(),
  pendingScreenshot: null,

  toggle: () => set((s) => ({ visible: !s.visible })),
  open: () => set({ visible: true }),
  close: () => set({ visible: false }),

  addUserMessage: (content, screenshot) => {
    const msg: ChatMessage = {
      id: generateId(),
      role: 'user',
      content,
      screenshot: screenshot?.image,
      screenshotTitle: screenshot?.title,
      createdAt: Date.now(),
    }
    set((s) => ({ messages: [...s.messages, msg], pendingScreenshot: null }))
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

  setPendingScreenshot: (s) => set({ pendingScreenshot: s }),
  clearMessages: () => set({ messages: [] }),
  newSession: () =>
    set({ messages: [], sessionId: generateId(), pendingScreenshot: null }),
}))
