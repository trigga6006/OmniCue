export type ChatRole = 'user' | 'assistant'

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** Auto-captured screenshot (hidden from UI, always sent as context) */
  screenshot?: string
  screenshotTitle?: string
  ocrText?: string
  screenType?: string
  /** Manual screenshot via photo button (shown in UI) */
  manualScreenshot?: string
  manualScreenshotTitle?: string
  createdAt: number
}

export interface ActiveTimer {
  id: string
  name: string
  totalSeconds: number
  startedAt: number
  paused: boolean
  pausedAt?: number
  elapsed?: number
}

export type EntryType = 'timer' | 'alarm' | 'reminder' | 'claude' | 'codex'

export interface HistoryEntry {
  id: string
  name: string
  duration: number
  completedAt: string
  type?: EntryType
}

export interface Settings {
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

export interface AppNotification {
  id: string
  message: string
  title?: string
  timeout: number
  createdAt: number
}

export interface Alarm {
  id: string
  label: string
  time: string // "HH:MM" 24-hour
  repeat: boolean // true = daily, false = fire once then disable
  enabled: boolean
  lastFiredDate?: string // "YYYY-MM-DD" â€” prevents double-firing same day
}

export interface Reminder {
  id: string
  label: string
  intervalMinutes: number
  enabled: boolean
  nextFireAt: number // epoch ms
}

export interface ElectronAPI {
  setIgnoreMouseEvents: (ignore: boolean) => void
  getSettings: () => Promise<Settings>
  setSettings: (settings: Partial<Settings>) => Promise<void>
  getHistory: () => Promise<HistoryEntry[]>
  addHistory: (entry: HistoryEntry) => Promise<void>
  clearHistory: () => Promise<void>
  setAutoLaunch: (enabled: boolean) => Promise<void>
  getPrimaryCenter: () => Promise<{ x: number; y: number }>
  getDisplays: () => Promise<{ id: number; label: string; centerX: number; centerY: number }[]>
  openSettingsWindow: (tab?: string) => void
  onNotification: (callback: (data: AppNotification) => void) => () => void
  onRemoteTimer: (callback: (data: ActiveTimer) => void) => () => void
  onSwitchTab: (callback: (tab: string) => void) => () => void
  onNewHistoryEntry: (callback: (entry: HistoryEntry) => void) => () => void
  checkClaudeIntegration: () => Promise<boolean>
  installClaudeIntegration: () => Promise<{ ok: boolean; error?: string }>
  uninstallClaudeIntegration: () => Promise<{ ok: boolean; error?: string }>
  checkCodexIntegration: () => Promise<boolean>
  installCodexIntegration: () => Promise<{ ok: boolean; error?: string }>
  uninstallCodexIntegration: () => Promise<{ ok: boolean; error?: string }>
  getAlarms: () => Promise<Alarm[]>
  setAlarm: (alarm: Alarm) => Promise<void>
  deleteAlarm: (id: string) => Promise<void>
  getReminders: () => Promise<Reminder[]>
  setReminder: (reminder: Reminder) => Promise<void>
  deleteReminder: (id: string) => Promise<void>
  sampleScreenBrightness: () => Promise<number>
  setInteractiveLock: (locked: boolean) => void
  setPanelOpen: (open: boolean) => void
  moveWindowBy: (dx: number, dy: number) => void
  requestWindowResize: (width: number, height: number) => void
  setWindowBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
  getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  getPrimaryDisplayBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  sendTestAlert: () => void
  captureActiveWindow: () => Promise<{ image: string; title: string; ocrId: number } | null>
  getOcrResult: (ocrId: number) => Promise<{ ocrText: string; screenType: string; ocrDurationMs: number } | null>
  sendAiMessage: (payload: { messages: unknown[]; sessionId: string; model?: string }) => Promise<{ ok: boolean }>
  abortAiStream: (sessionId: string) => void
  cleanupAiSession: (sessionId: string) => void
  onAiStreamToken: (cb: (data: { sessionId: string; token: string }) => void) => () => void
  onAiStreamDone: (cb: (data: { sessionId: string; fullText: string }) => void) => () => void
  onAiStreamError: (cb: (data: { sessionId: string; error: string }) => void) => () => void
  onToggleCompanion: (cb: () => void) => () => void
  getCodexStatus: () => Promise<{ authenticated: boolean; planType?: string; model?: string }>
  openExternalUrl: (url: string) => Promise<boolean>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
