import { create } from 'zustand'
import type { HistoryEntry } from '@/lib/types'

interface HistoryState {
  entries: HistoryEntry[]
  loaded: boolean
  load: () => Promise<void>
  add: (entry: HistoryEntry) => Promise<void>
  addLocal: (entry: HistoryEntry) => void  // used when main process already persisted
  clear: () => Promise<void>
}

export const useHistoryStore = create<HistoryState>((set) => ({
  entries: [],
  loaded: false,

  load: async () => {
    const entries = (await window.electronAPI.getHistory()) as HistoryEntry[]
    set({ entries, loaded: true })
  },

  add: async (entry) => {
    set((s) => ({ entries: [entry, ...s.entries] }))
    await window.electronAPI.addHistory(entry)
  },

  // Updates in-memory state only — main process already wrote to disk
  addLocal: (entry) => {
    set((s) => ({ entries: [entry, ...s.entries] }))
  },

  clear: async () => {
    set({ entries: [] })
    await window.electronAPI.clearHistory()
  },
}))
