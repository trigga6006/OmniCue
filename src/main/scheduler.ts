import { BrowserWindow } from 'electron'
import { alarmsStore, remindersStore, historyStore } from './store'
import type { HistoryEntry } from './store'

function generateId(): string {
  return Math.random().toString(36).substring(2, 9)
}

function sendNotification(win: BrowserWindow, message: string, title: string): void {
  win.webContents.send('new-notification', {
    id: generateId(),
    message,
    title,
    timeout: 30,
    createdAt: Date.now(),
  })
}

function broadcastHistoryEntry(_win: BrowserWindow, entry: HistoryEntry): void {
  // Tell all renderer windows (overlay + settings window if open) about the new entry
  BrowserWindow.getAllWindows().forEach((w) => {
    if (!w.isDestroyed()) {
      w.webContents.send('new-history-entry', entry)
    }
  })
}

export function startScheduler(getMainWindow: () => BrowserWindow | null): void {
  let firstRun = true

  const check = () => {
    const win = getMainWindow()
    if (!win || win.isDestroyed()) return

    const now = Date.now()
    const currentDate = new Date()
    const HH_MM = `${String(currentDate.getHours()).padStart(2, '0')}:${String(currentDate.getMinutes()).padStart(2, '0')}`
    const todayDate = currentDate.toISOString().split('T')[0]

    // ── Alarms ────────────────────────────────────────────────────────────────
    for (const alarm of alarmsStore.getAll()) {
      if (!alarm.enabled || alarm.time !== HH_MM) continue
      if (alarm.lastFiredDate === todayDate) continue

      // Fire
      const fired: typeof alarm = {
        ...alarm,
        lastFiredDate: todayDate,
        enabled: alarm.repeat,  // disable after firing if one-shot
      }
      alarmsStore.set(fired)

      const label = alarm.label || alarm.time
      sendNotification(win, label, 'Alarm')

      const entry: HistoryEntry = {
        id: generateId(),
        name: label,
        duration: 0,
        completedAt: new Date().toISOString(),
        type: 'alarm',
      }
      historyStore.addEntry(entry)
      broadcastHistoryEntry(win, entry)
    }

    // ── Reminders ─────────────────────────────────────────────────────────────
    for (const reminder of remindersStore.getAll()) {
      if (!reminder.enabled) continue

      // On first run, skip reminders that are overdue (app just started)
      // to avoid a spam of stale reminders on startup
      if (firstRun && reminder.nextFireAt <= now) {
        remindersStore.set({
          ...reminder,
          nextFireAt: now + reminder.intervalMinutes * 60 * 1000,
        })
        continue
      }

      if (reminder.nextFireAt > now) continue

      // Fire
      remindersStore.set({
        ...reminder,
        nextFireAt: now + reminder.intervalMinutes * 60 * 1000,
      })

      sendNotification(win, reminder.label, 'Reminder')

      const entry: HistoryEntry = {
        id: generateId(),
        name: reminder.label,
        duration: 0,
        completedAt: new Date().toISOString(),
        type: 'reminder',
      }
      historyStore.addEntry(entry)
      broadcastHistoryEntry(win, entry)
    }

    firstRun = false
  }

  // Initial check after 5s (let windows load first), then every 10s
  // 10s ensures we never miss a 1-minute alarm window (30s was too coarse)
  setTimeout(check, 5_000)
  setInterval(check, 10_000)
}
