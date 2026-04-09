import { app } from 'electron'
import { join } from 'path'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'

const dataDir = app.getPath('userData')

function ensureDir(): void {
  if (!existsSync(dataDir)) mkdirSync(dataDir, { recursive: true })
}

function readJson<T>(filename: string, defaults: T): T {
  ensureDir()
  const filePath = join(dataDir, filename)
  try {
    const raw = readFileSync(filePath, 'utf-8')
    return { ...defaults, ...JSON.parse(raw) }
  } catch {
    return defaults
  }
}

function writeJson<T>(filename: string, data: T): void {
  ensureDir()
  const filePath = join(dataDir, filename)
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8')
}

// ─── Settings ─────────────────────────────────────────────────────────────────

interface SettingsData {
  defaultDuration: number
  soundEnabled: boolean
  soundVolume: number
  autoLaunch: boolean
  theme: 'light' | 'dark'
  fullScreenAlarms: boolean
  fullScreenReminders: boolean
  fullScreenClaude: boolean
  aiApiKey: string
  aiBaseUrl: string
  aiModel: string
  aiMode: 'fast' | 'auto' | 'pro'
}

const SETTINGS_DEFAULTS: SettingsData = {
  defaultDuration: 300,
  soundEnabled: true,
  soundVolume: 0.7,
  autoLaunch: false,
  theme: 'dark',
  fullScreenAlarms: false,
  fullScreenReminders: false,
  fullScreenClaude: false,
  aiApiKey: '',
  aiBaseUrl: '',
  aiModel: '',
  aiMode: 'auto',
}

export const settingsStore = {
  get(): SettingsData {
    return readJson('settings.json', SETTINGS_DEFAULTS)
  },
  set(partial: Partial<SettingsData>): void {
    const current = this.get()
    writeJson('settings.json', { ...current, ...partial })
  },
}

// ─── History ──────────────────────────────────────────────────────────────────

export type EntryType = 'timer' | 'alarm' | 'reminder' | 'claude'

export interface HistoryEntry {
  id: string
  name: string
  duration: number
  completedAt: string
  type?: EntryType
}

interface HistoryData {
  entries: HistoryEntry[]
}

export const historyStore = {
  getEntries(): HistoryEntry[] {
    return readJson<HistoryData>('history.json', { entries: [] }).entries
  },
  addEntry(entry: HistoryEntry): void {
    const entries = this.getEntries()
    entries.unshift(entry)
    if (entries.length > 200) entries.length = 200
    writeJson('history.json', { entries })
  },
  clear(): void {
    writeJson('history.json', { entries: [] })
  },
}

// ─── Alarms ───────────────────────────────────────────────────────────────────

export interface Alarm {
  id: string
  label: string
  time: string        // "HH:MM" 24-hour
  repeat: boolean
  enabled: boolean
  lastFiredDate?: string  // "YYYY-MM-DD"
}

interface AlarmsData {
  alarms: Alarm[]
}

export const alarmsStore = {
  getAll(): Alarm[] {
    return readJson<AlarmsData>('alarms.json', { alarms: [] }).alarms
  },
  set(alarm: Alarm): void {
    const alarms = this.getAll()
    const idx = alarms.findIndex((a) => a.id === alarm.id)
    if (idx >= 0) alarms[idx] = alarm
    else alarms.push(alarm)
    writeJson('alarms.json', { alarms })
  },
  delete(id: string): void {
    const alarms = this.getAll().filter((a) => a.id !== id)
    writeJson('alarms.json', { alarms })
  },
}

// ─── Reminders ────────────────────────────────────────────────────────────────

export interface Reminder {
  id: string
  label: string
  intervalMinutes: number
  enabled: boolean
  nextFireAt: number  // epoch ms
}

interface RemindersData {
  reminders: Reminder[]
}

export const remindersStore = {
  getAll(): Reminder[] {
    return readJson<RemindersData>('reminders.json', { reminders: [] }).reminders
  },
  set(reminder: Reminder): void {
    const reminders = this.getAll()
    const idx = reminders.findIndex((r) => r.id === reminder.id)
    if (idx >= 0) reminders[idx] = reminder
    else reminders.push(reminder)
    writeJson('reminders.json', { reminders })
  },
  delete(id: string): void {
    const reminders = this.getAll().filter((r) => r.id !== id)
    writeJson('reminders.json', { reminders })
  },
}
