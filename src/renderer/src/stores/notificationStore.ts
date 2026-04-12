import { create } from 'zustand'
import type { AppNotification } from '@/lib/types'

interface NotificationState {
  notifications: AppNotification[]
  expandedIds: Set<string>
  add: (n: AppNotification) => void
  remove: (id: string) => void
  setExpanded: (id: string, expanded: boolean) => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  expandedIds: new Set(),
  add: (n) => set((s) => ({ notifications: [...s.notifications, n] })),
  remove: (id) =>
    set((s) => {
      const next = new Set(s.expandedIds)
      next.delete(id)
      return { notifications: s.notifications.filter((n) => n.id !== id), expandedIds: next }
    }),
  setExpanded: (id, expanded) =>
    set((s) => {
      const next = new Set(s.expandedIds)
      if (expanded) next.add(id)
      else next.delete(id)
      return { expandedIds: next }
    }),
}))
