import { create } from 'zustand'
import type { ActiveTimer } from '@/lib/types'

interface TimerState {
  timers: ActiveTimer[]
  isCreating: boolean
  setCreating: (v: boolean) => void
  addTimer: (timer: ActiveTimer) => void
  removeTimer: (id: string) => void
}

export const useTimerStore = create<TimerState>((set) => ({
  timers: [],
  isCreating: false,
  setCreating: (v) => set({ isCreating: v }),
  addTimer: (timer) => set((s) => ({ timers: [...s.timers, timer] })),
  removeTimer: (id) => set((s) => ({ timers: s.timers.filter((t) => t.id !== id) })),
}))
