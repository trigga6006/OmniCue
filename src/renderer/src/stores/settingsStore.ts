import { create } from 'zustand'
import type { Settings } from '@/lib/types'
import { DEFAULT_SETTINGS } from '@/lib/constants'

interface SettingsState {
  settings: Settings
  loaded: boolean
  load: () => Promise<void>
  update: (partial: Partial<Settings>) => Promise<void>
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: { ...DEFAULT_SETTINGS },
  loaded: false,

  load: async () => {
    const s = (await window.electronAPI.getSettings()) as Settings
    set({ settings: { ...DEFAULT_SETTINGS, ...s }, loaded: true })
  },

  update: async (partial) => {
    const merged = { ...get().settings, ...partial }
    set({ settings: merged })
    await window.electronAPI.setSettings(partial)
    if (partial.autoLaunch !== undefined) {
      await window.electronAPI.setAutoLaunch(partial.autoLaunch)
    }
  },
}))
