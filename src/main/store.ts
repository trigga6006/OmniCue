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
  barPosX: number | null
  barPosY: number | null
  theme: 'light' | 'dark'
  fullScreenAlarms: boolean
  fullScreenReminders: boolean
  fullScreenClaude: boolean
  aiProvider: 'codex' | 'claude' | 'opencode' | 'kimicode' | 'openai' | 'gemini' | 'deepseek' | 'groq' | 'mistral' | 'xai' | 'glm' | 'kimi'
  aiApiKey: string
  aiBaseUrl: string
  aiModel: string
  aiMode: 'fast' | 'auto' | 'pro'
  claudeApiKey: string
  claudeModel: string
  geminiApiKey: string
  geminiModel: string
  deepseekApiKey: string
  deepseekModel: string
  groqApiKey: string
  groqModel: string
  mistralApiKey: string
  mistralModel: string
  xaiApiKey: string
  xaiModel: string
  glmApiKey: string
  glmModel: string
  kimiApiKey: string
  kimiModel: string
  opencodeApiKey: string
  opencodeModel: string
  devRootPath: string
  agentPermissions: 'read-only' | 'workspace-write' | 'full-access'
  companionHotkey: string
  agentWorkspacePath: string
}

const SETTINGS_DEFAULTS: SettingsData = {
  defaultDuration: 300,
  soundEnabled: true,
  soundVolume: 0.7,
  autoLaunch: false,
  barPosX: null,
  barPosY: null,
  theme: 'dark',
  fullScreenAlarms: false,
  fullScreenReminders: false,
  fullScreenClaude: false,
  aiProvider: 'codex',
  aiApiKey: '',
  aiBaseUrl: '',
  aiModel: '',
  aiMode: 'auto',
  claudeApiKey: '',
  claudeModel: '',
  geminiApiKey: '',
  geminiModel: '',
  deepseekApiKey: '',
  deepseekModel: '',
  groqApiKey: '',
  groqModel: '',
  mistralApiKey: '',
  mistralModel: '',
  xaiApiKey: '',
  xaiModel: '',
  glmApiKey: '',
  glmModel: '',
  kimiApiKey: '',
  kimiModel: '',
  opencodeApiKey: '',
  opencodeModel: '',
  devRootPath: '',
  agentPermissions: 'read-only',
  companionHotkey: 'Ctrl+Shift+Space',
  agentWorkspacePath: '',
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
  conversationId?: string
  provider?: string
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

// ─── Watchers ────────────────────────────────────────────────────────────────

export type WatcherType = 'file-exists' | 'folder-change' | 'process-exit'

export interface Watcher {
  id: string
  label: string
  type: WatcherType
  target: string          // file path, folder path, or process name
  status: 'active' | 'completed'
  createdAt: number       // epoch ms
  completedAt?: number    // epoch ms
}

interface WatchersData {
  watchers: Watcher[]
}

export const watchersStore = {
  getAll(): Watcher[] {
    return readJson<WatchersData>('watchers.json', { watchers: [] }).watchers
  },
  set(watcher: Watcher): void {
    const watchers = this.getAll()
    const idx = watchers.findIndex((w) => w.id === watcher.id)
    if (idx >= 0) watchers[idx] = watcher
    else watchers.push(watcher)
    writeJson('watchers.json', { watchers })
  },
  complete(id: string): void {
    const watchers = this.getAll()
    const idx = watchers.findIndex((w) => w.id === id)
    if (idx >= 0) {
      watchers[idx].status = 'completed'
      watchers[idx].completedAt = Date.now()
    }
    // Prune old completed watchers — keep at most 50
    const completed = watchers.filter((w) => w.status === 'completed')
    if (completed.length > 50) {
      const toRemove = new Set(
        completed.sort((a, b) => (a.completedAt || 0) - (b.completedAt || 0))
          .slice(0, completed.length - 50)
          .map((w) => w.id)
      )
      writeJson('watchers.json', { watchers: watchers.filter((w) => !toRemove.has(w.id)) })
    } else {
      writeJson('watchers.json', { watchers })
    }
  },
  delete(id: string): void {
    const watchers = this.getAll().filter((w) => w.id !== id)
    writeJson('watchers.json', { watchers })
  },
}
