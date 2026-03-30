import { create } from 'zustand'
import type { AppNotification } from '@/lib/types'

interface NotificationState {
  notifications: AppNotification[]
  add: (n: AppNotification) => void
  remove: (id: string) => void
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  add: (n) => set((s) => ({ notifications: [...s.notifications, n] })),
  remove: (id) => set((s) => ({ notifications: s.notifications.filter((n) => n.id !== id) })),
}))
