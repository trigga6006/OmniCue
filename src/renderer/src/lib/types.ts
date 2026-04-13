export type { ActionTier, ActionDefinition, ActionRequest, ActionResult } from '../../../shared/actions'

export interface Note {
  id: string
  title: string
  content: string
  savedFrom?: string
  source?: string
  createdAt: number
  updatedAt?: number
}

export type NoteSummary = Omit<Note, 'content' | 'updatedAt'>

export type ChatRole = 'user' | 'assistant'

export interface ToolUseEntry {
  name: string
  input: string
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  /** Tool calls made during this assistant message */
  toolUses?: ToolUseEntry[]
  /** Agent interaction requests (approvals, user-input, etc.) */
  interactions?: AgentInteractionRequest[]
  /** Auto-captured screenshot (hidden from UI, always sent as context) */
  screenshot?: string
  screenshotTitle?: string
  ocrText?: string
  screenType?: string
  /** Manual screenshot via photo button (shown in UI) */
  manualScreenshot?: string
  manualScreenshotTitle?: string
  /** Structured desktop context */
  activeApp?: string
  processName?: string
  clipboardText?: string
  /** Tool pack metadata */
  packId?: string
  packName?: string
  packConfidence?: number
  packContext?: Record<string, string>
  packVariant?: string
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
  conversationId?: string
  provider?: string
}

export type AiProvider = 'codex' | 'claude' | 'opencode' | 'kimicode' | 'openai' | 'gemini' | 'deepseek' | 'groq' | 'mistral' | 'xai' | 'glm' | 'kimi'

// ── Agent Interaction Types ──────────────────────────────────────────────────

// ── Session Memory Types ─────────────────────────────────────────────────────

export interface ResumeCapsule {
  updatedAt: number
  conversationId: string
  provider: string
  goal?: string
  lastUserMessage?: string
  lastAssistantMessage?: string
  lastAssistantAction?: string
  desktop: {
    activeApp: string
    processName: string
    windowTitle: string
    display?: number
    packId?: string
    packVariant?: string
  }
  context?: {
    browser?: { pageTitle?: string; site?: string; browserFamily?: string }
    editor?: { workspacePath?: string; openFile?: string; language?: string; projectName?: string }
    terminal?: { cwd?: string; shell?: string; isAdmin?: boolean }
    fileExplorer?: { currentPath?: string; folderLabel?: string }
  }
  pending?: {
    waitingOn?: string
    pendingInteractions?: Array<{ kind: string; title: string }>
    lastToolUse?: { name: string; input?: string }
  }
  tags: string[]
  summary: string
}

export interface SessionMemorySummary {
  conversationId: string
  title?: string
  provider?: string
  lastActivity: number
  entryCount: number
  latestSummary: string
  latestDesktopApp: string
  tags: string[]
}

export interface SessionMemoryQuery {
  conversationId?: string
  since?: number
  tags?: string[]
  app?: string
  provider?: string
  limit?: number
  includeContext?: boolean
  summaryOnly?: boolean
}

// ── Conversation History Types ───────────────────────────────────────────────

export interface ConversationSummary {
  id: string
  title: string
  provider: string
  createdAt: number
  updatedAt: number
  messageCount: number
  firstMessage: string
}

export interface StoredConversation {
  id: string
  title: string
  provider: string
  createdAt: number
  updatedAt: number
  messageCount: number
  messages: ChatMessage[]
  resumeCapsule?: ResumeCapsule
}

// ── Agent Interaction Types ──────────────────────────────────────────────────

export type AgentInteractionKind =
  | 'command-approval'
  | 'file-change-approval'
  | 'user-input'
  | 'provider-elicitation'
  | 'action-confirmation'
  | 'unsupported'

export type AgentInteractionStatus =
  | 'pending'
  | 'submitted'
  | 'resolved'
  | 'declined'
  | 'cancelled'
  | 'failed'

export interface AgentInteractionOption {
  id: string
  label: string
  description?: string
  value: string
  style?: 'primary' | 'secondary' | 'danger'
}

export interface AgentInteractionQuestion {
  id: string
  header: string
  question: string
  isOther?: boolean
  isSecret?: boolean
  options?: AgentInteractionOption[]
}

export interface AgentInteractionRequest {
  id: string
  providerRequestId: string
  provider: 'codex' | 'claude'
  sessionId: string
  turnId?: string
  kind: AgentInteractionKind
  title: string
  description?: string
  detail?: string
  options?: AgentInteractionOption[]
  questions?: AgentInteractionQuestion[]
  requestedAt: number
  status: AgentInteractionStatus
  rawMethod: string
}

export interface AgentInteractionResponse {
  sessionId: string
  interactionId: string
  providerRequestId: string
  kind: AgentInteractionKind
  selectedOptionId?: string
  answers?: Record<string, string[]>
}
export type AgentPermissions = 'read-only' | 'workspace-write' | 'full-access'

// ── Watcher Types ────────────────────────────────────────────────────────────

export type WatcherType = 'file-exists' | 'folder-change' | 'process-exit'

export interface WatcherConfig {
  id: string
  label: string
  type: WatcherType
  target: string
  status: 'active' | 'completed'
  createdAt: number
  completedAt?: number
}

export interface WatcherEvent {
  id: string
  label: string
  type: WatcherType
  target: string
  detail?: string
}

export interface Settings {
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
  aiProvider: AiProvider
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
  agentPermissions: AgentPermissions
  companionHotkey: string
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
  setIgnoreMouseEvents: (ignore: boolean, opts?: { forward?: boolean }) => void
  getSettings: () => Promise<Settings>
  setSettings: (settings: Partial<Settings>) => Promise<void>
  getHistory: () => Promise<HistoryEntry[]>
  addHistory: (entry: HistoryEntry) => Promise<void>
  clearHistory: () => Promise<void>
  setAutoLaunch: (enabled: boolean) => Promise<void>
  updateCompanionHotkey: (accelerator: string) => Promise<boolean>
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
  setInteractiveRegions: (regions: { x: number; y: number; width: number; height: number }[]) => void
  moveWindowBy: (dx: number, dy: number) => void
  requestWindowResize: (width: number, height: number) => Promise<void>
  setWindowBounds: (bounds: { x: number; y: number; width: number; height: number }) => void
  getWindowBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  getPrimaryDisplayBounds: () => Promise<{ x: number; y: number; width: number; height: number }>
  sendTestAlert: () => void
  captureActiveWindow: (displayId?: number) => Promise<{ image: string; title: string; activeApp: string; processName: string; clipboardText: string; ocrId: number; packId?: string; packName?: string; packConfidence?: number; packContext?: Record<string, string>; packVariant?: string } | null>
  getOcrResult: (ocrId: number) => Promise<{ ocrText: string; screenType: string; ocrDurationMs: number } | null>
  captureRegion: () => Promise<{ image: string; title: string; ocrId: number } | null>
  sendAiMessage: (payload: { messages: unknown[]; sessionId: string; provider?: string; resumeMode?: 'normal' | 'replay-seed'; conversationId?: string }) => Promise<{ ok: boolean }>
  abortAiStream: (sessionId: string) => void
  cleanupAiSession: (sessionId: string) => void
  onAiInitializing: (cb: (data: { sessionId: string }) => void) => () => void
  onAiStreamToken: (cb: (data: { sessionId: string; token: string }) => void) => () => void
  onAiStreamDone: (cb: (data: { sessionId: string; fullText: string }) => void) => () => void
  onAiStreamError: (cb: (data: { sessionId: string; error: string }) => void) => () => void
  onAiToolUse: (cb: (data: { sessionId: string; toolName: string; toolInput: string }) => void) => () => void
  onAiInteractionRequest: (cb: (data: AgentInteractionRequest) => void) => () => void
  respondToAiInteraction: (response: AgentInteractionResponse) => void
  onToggleCompanion: (cb: () => void) => () => void
  getCodexStatus: () => Promise<{ authenticated: boolean; planType?: string; model?: string; authMode?: string }>
  getClaudeStatus: () => Promise<{ authenticated: boolean; planType?: string }>
  selectFolder: () => Promise<string | null>
  openExternalUrl: (url: string) => Promise<boolean>

  // ─── Session Memory ─────────────────────────────────────────────────────
  sessionMemoryQuery: (query: SessionMemoryQuery) => Promise<unknown>
  sessionMemoryList: () => Promise<SessionMemorySummary[]>
  sessionMemoryCapture: (args: { conversationId: string; runtimeSessionId?: string; provider: string }) => Promise<{ ok: boolean }>
  sessionMemoryGetCapsule: (conversationId: string) => Promise<ResumeCapsule | null>
  sessionMemoryClear: (conversationId: string) => Promise<{ ok: boolean }>
  desktopGetLiveContext: () => Promise<{ activeApp: string; processName: string; windowTitle: string }>

  // ─── Conversations ──────────────────────────────────────────────────────
  listConversations: () => Promise<ConversationSummary[]>
  loadConversation: (id: string) => Promise<StoredConversation | null>
  saveConversation: (data: { id: string; title: string; provider: string; messages: ChatMessage[] }) => Promise<void>
  deleteConversation: (id: string) => Promise<void>
  renameConversation: (id: string, title: string) => Promise<void>

  // ─── Clipboard ───────────────────────────────────────────────────────────
  clipboardReadText: () => Promise<string>
  clipboardWriteText: (text: string) => Promise<void>
  clipboardReadImage: () => Promise<string | null>

  // ─── OS Actions ──────────────────────────────────────────────────────────
  osOpenPath: (filePath: string) => Promise<{ ok: boolean; error?: string }>
  osShowInFolder: (filePath: string) => Promise<void>
  osOpenUrl: (url: string) => Promise<{ ok: boolean; error?: string }>
  osRunSystemCommand: (command: string) => Promise<{ ok: boolean; error?: string }>

  // ─── Claude Code ControlPlane ────────────────────────────────────────────
  claudeRespondPermission: (payload: { tabId: string; questionId: string; optionId: string }) => Promise<boolean>
  claudeGetHealth: () => Promise<unknown>
  claudeSetPermissionMode: (mode: string) => void

  // ─── Watchers ────────────────────────────────────────────────────────────
  createWatcher: (watcher: WatcherConfig) => Promise<void>
  listWatchers: () => Promise<WatcherConfig[]>
  deleteWatcher: (id: string) => Promise<void>
  resumeWatchers: () => Promise<void>
  onWatcherTriggered: (cb: (data: WatcherEvent) => void) => () => void

  // ─── Notes ───────────────────────────────────────────────────────────────
  listNotes: () => Promise<NoteSummary[]>
  getNote: (id: string) => Promise<Note | null>
  deleteNote: (id: string) => Promise<{ ok: boolean; error?: string }>

  // ─── App Actions ────────────────────────────────────────────────────────
  executeAction: (request: import('../../../shared/actions').ActionRequest) => Promise<import('../../../shared/actions').ActionResult>
  listActions: () => Promise<import('../../../shared/actions').ActionDefinition[]>
  resolveIntent: (payload: string | { utterance: string; conversationId?: string }) => Promise<{
    resolved: boolean
    executed?: boolean
    plan: { actions: Array<{ actionId: string; params: Record<string, unknown> }>; explanation?: string; fallback?: string; question?: string }
    results?: unknown[]
  }>
  onActionExecuting: (cb: (data: { actionId: string; name: string }) => void) => () => void
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
