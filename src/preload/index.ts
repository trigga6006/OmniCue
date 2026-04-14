import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  setIgnoreMouseEvents: (ignore: boolean, opts?: { forward?: boolean }): void => {
    ipcRenderer.send('set-ignore-mouse-events', ignore, opts)
  },
  getSettings: (): Promise<unknown> => ipcRenderer.invoke('get-settings'),
  setSettings: (partial: Record<string, unknown>): Promise<void> =>
    ipcRenderer.invoke('set-settings', partial),
  getHistory: (): Promise<unknown[]> => ipcRenderer.invoke('get-history'),
  addHistory: (entry: {
    id: string
    name: string
    duration: number
    completedAt: string
    type?: string
  }): Promise<void> => ipcRenderer.invoke('add-history', entry),
  clearHistory: (): Promise<void> => ipcRenderer.invoke('clear-history'),
  setAutoLaunch: (enabled: boolean): Promise<void> =>
    ipcRenderer.invoke('set-auto-launch', enabled),
  updateCompanionHotkey: (accelerator: string): Promise<boolean> =>
    ipcRenderer.invoke('update-companion-hotkey', accelerator),
  getPrimaryCenter: (): Promise<{ x: number; y: number }> =>
    ipcRenderer.invoke('get-primary-center'),
  getDisplays: (): Promise<{ id: number; label: string; centerX: number; centerY: number }[]> =>
    ipcRenderer.invoke('get-displays'),
  openSettingsWindow: (tab?: string): void => {
    ipcRenderer.send('open-settings-window', tab)
  },
  onSwitchTab: (callback: (tab: string) => void): (() => void) => {
    const handler = (_event: unknown, tab: string): void => callback(tab)
    ipcRenderer.on('switch-tab', handler)
    return () => ipcRenderer.removeListener('switch-tab', handler)
  },
  onNewHistoryEntry: (callback: (entry: unknown) => void): (() => void) => {
    const handler = (_event: unknown, entry: unknown): void => callback(entry)
    ipcRenderer.on('new-history-entry', handler)
    return () => ipcRenderer.removeListener('new-history-entry', handler)
  },
  checkClaudeIntegration: (): Promise<boolean> => ipcRenderer.invoke('check-claude-integration'),
  installClaudeIntegration: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('install-claude-integration'),
  uninstallClaudeIntegration: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('uninstall-claude-integration'),
  checkCodexIntegration: (): Promise<boolean> => ipcRenderer.invoke('check-codex-integration'),
  installCodexIntegration: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('install-codex-integration'),
  uninstallCodexIntegration: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('uninstall-codex-integration'),
  onNotification: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('new-notification', handler)
    return () => ipcRenderer.removeListener('new-notification', handler)
  },
  onRemoteTimer: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('new-timer', handler)
    return () => ipcRenderer.removeListener('new-timer', handler)
  },
  getAlarms: (): Promise<unknown[]> => ipcRenderer.invoke('get-alarms'),
  setAlarm: (alarm: unknown): Promise<void> => ipcRenderer.invoke('set-alarm', alarm),
  deleteAlarm: (id: string): Promise<void> => ipcRenderer.invoke('delete-alarm', id),
  getReminders: (): Promise<unknown[]> => ipcRenderer.invoke('get-reminders'),
  setReminder: (reminder: unknown): Promise<void> => ipcRenderer.invoke('set-reminder', reminder),
  deleteReminder: (id: string): Promise<void> => ipcRenderer.invoke('delete-reminder', id),
  sampleScreenBrightness: (): Promise<number> => ipcRenderer.invoke('sample-screen-brightness'),
  setInteractiveLock: (locked: boolean): void => {
    ipcRenderer.send('set-interactive-lock', locked)
  },
  setPanelOpen: (open: boolean): void => {
    ipcRenderer.send('set-panel-open', open)
  },
  setInteractiveRegions: (regions: Array<{ x: number; y: number; width: number; height: number }>): void => {
    ipcRenderer.send('set-interactive-regions', regions)
  },
  moveWindowBy: (dx: number, dy: number): void => {
    ipcRenderer.send('move-window-by', { dx, dy })
  },
  requestWindowResize: (width: number, height: number): Promise<void> =>
    ipcRenderer.invoke('request-window-resize', { width, height }),
  setWindowBounds: (bounds: { x: number; y: number; width: number; height: number }): void => {
    ipcRenderer.send('set-window-bounds', bounds)
  },
  getWindowBounds: (): Promise<{ x: number; y: number; width: number; height: number }> =>
    ipcRenderer.invoke('get-window-bounds'),
  getPrimaryDisplayBounds: (): Promise<{ x: number; y: number; width: number; height: number }> =>
    ipcRenderer.invoke('get-primary-display-bounds'),
  getCurrentDisplayBounds: (): Promise<{ x: number; y: number; width: number; height: number }> =>
    ipcRenderer.invoke('get-current-display-bounds'),
  sendTestAlert: (): void => {
    ipcRenderer.send('send-test-alert')
  },
  captureActiveWindow: (displayId?: number): Promise<{ image: string; title: string; activeApp: string; processName: string; clipboardText: string; ocrId: number; packId?: string; packName?: string; packConfidence?: number; packContext?: Record<string, string>; packVariant?: string } | null> =>
    ipcRenderer.invoke('capture-active-window', displayId),
  getOcrResult: (ocrId: number): Promise<{ ocrText: string; screenType: string; ocrDurationMs: number } | null> =>
    ipcRenderer.invoke('get-ocr-result', ocrId),
  captureRegion: (): Promise<{ image: string; title: string; ocrId: number } | null> =>
    ipcRenderer.invoke('capture-region'),
  sendAiMessage: (payload: {
    messages: unknown[]
    sessionId: string
    provider?: string
    resumeMode?: 'normal' | 'replay-seed'
    conversationId?: string
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('ai:send-message', payload),
  abortAiStream: (sessionId: string): void => {
    ipcRenderer.send('ai:abort', { sessionId })
  },
  cleanupAiSession: (sessionId: string): void => {
    ipcRenderer.send('ai:cleanup-session', { sessionId })
  },
  onAiInitializing: (
    callback: (data: { sessionId: string }) => void
  ): (() => void) => {
    const handler = (_event: unknown, data: { sessionId: string }): void =>
      callback(data)
    ipcRenderer.on('ai:initializing', handler)
    return () => ipcRenderer.removeListener('ai:initializing', handler)
  },
  onAiStreamToken: (
    callback: (data: { sessionId: string; token: string }) => void
  ): (() => void) => {
    const handler = (_event: unknown, data: { sessionId: string; token: string }): void =>
      callback(data)
    ipcRenderer.on('ai:stream-token', handler)
    return () => ipcRenderer.removeListener('ai:stream-token', handler)
  },
  onAiStreamDone: (
    callback: (data: { sessionId: string; fullText: string }) => void
  ): (() => void) => {
    const handler = (_event: unknown, data: { sessionId: string; fullText: string }): void =>
      callback(data)
    ipcRenderer.on('ai:stream-done', handler)
    return () => ipcRenderer.removeListener('ai:stream-done', handler)
  },
  onAiStreamError: (
    callback: (data: { sessionId: string; error: string }) => void
  ): (() => void) => {
    const handler = (_event: unknown, data: { sessionId: string; error: string }): void =>
      callback(data)
    ipcRenderer.on('ai:stream-error', handler)
    return () => ipcRenderer.removeListener('ai:stream-error', handler)
  },
  onAiToolUse: (
    callback: (data: { sessionId: string; toolName: string; toolInput: string }) => void
  ): (() => void) => {
    const handler = (
      _event: unknown,
      data: { sessionId: string; toolName: string; toolInput: string }
    ): void => callback(data)
    ipcRenderer.on('ai:tool-use', handler)
    return () => ipcRenderer.removeListener('ai:tool-use', handler)
  },
  onAiInteractionRequest: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('ai:interaction-request', handler)
    return () => ipcRenderer.removeListener('ai:interaction-request', handler)
  },
  respondToAiInteraction: (payload: unknown): void => {
    ipcRenderer.send('ai:interaction-respond', payload)
  },
  onToggleCompanion: (callback: () => void): (() => void) => {
    const handler = (): void => callback()
    ipcRenderer.on('toggle-companion', handler)
    return () => ipcRenderer.removeListener('toggle-companion', handler)
  },
  getCodexStatus: (): Promise<{ authenticated: boolean; planType?: string; model?: string; authMode?: string }> =>
    ipcRenderer.invoke('get-codex-status'),
  getClaudeStatus: (): Promise<{ authenticated: boolean; planType?: string }> =>
    ipcRenderer.invoke('get-claude-status'),
  selectFolder: (): Promise<string | null> => ipcRenderer.invoke('select-folder'),
  openExternalUrl: (url: string): Promise<boolean> =>
    ipcRenderer.invoke('open-external-url', url),

  // ─── Conversations ──────────────────────────────────────────────────────
  listConversations: (): Promise<unknown[]> =>
    ipcRenderer.invoke('conversations:list'),
  loadConversation: (id: string): Promise<unknown> =>
    ipcRenderer.invoke('conversations:load', id),
  saveConversation: (data: { id: string; title: string; provider: string; messages: unknown[] }): Promise<void> =>
    ipcRenderer.invoke('conversations:save', data),
  deleteConversation: (id: string): Promise<void> =>
    ipcRenderer.invoke('conversations:delete', id),
  renameConversation: (id: string, title: string): Promise<void> =>
    ipcRenderer.invoke('conversations:rename', id, title),

  // ─── Session Memory ──────────────────────────────────────────────────────
  sessionMemoryQuery: (query: unknown): Promise<unknown> =>
    ipcRenderer.invoke('session-memory:query', query),
  sessionMemoryList: (): Promise<unknown[]> =>
    ipcRenderer.invoke('session-memory:list'),
  sessionMemoryCapture: (args: { conversationId: string; runtimeSessionId?: string; provider: string }): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('session-memory:capture', args),
  sessionMemoryGetCapsule: (conversationId: string): Promise<unknown> =>
    ipcRenderer.invoke('session-memory:get-capsule', conversationId),
  sessionMemoryClear: (conversationId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('session-memory:clear', conversationId),
  desktopGetLiveContext: (): Promise<{ activeApp: string; processName: string; windowTitle: string }> =>
    ipcRenderer.invoke('desktop:get-live-context'),

  // ─── Clipboard ───────────────────────────────────────────────────────────
  clipboardReadText: (): Promise<string> => ipcRenderer.invoke('clipboard:read-text'),
  clipboardWriteText: (text: string): Promise<void> => ipcRenderer.invoke('clipboard:write-text', text),
  clipboardReadImage: (): Promise<string | null> => ipcRenderer.invoke('clipboard:read-image'),

  // ─── OS Actions ──────────────────────────────────────────────────────────
  osOpenPath: (filePath: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('os:open-path', filePath),
  osShowInFolder: (filePath: string): Promise<void> =>
    ipcRenderer.invoke('os:show-in-folder', filePath),
  osOpenUrl: (url: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('os:open-url', url),
  osRunSystemCommand: (command: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('os:run-system-command', command),

  // ─── Notes ──────────────────────────────────────────────────────────────
  listNotes: (): Promise<unknown[]> => ipcRenderer.invoke('notes:list'),
  getNote: (id: string): Promise<unknown> => ipcRenderer.invoke('notes:get', id),
  deleteNote: (id: string): Promise<unknown> => ipcRenderer.invoke('notes:delete', id),

  // ─── App Actions ─────────────────────────────────────────────────────────
  executeAction: (request: unknown): Promise<unknown> => ipcRenderer.invoke('action:execute', request),
  listActions: (): Promise<unknown[]> => ipcRenderer.invoke('action:list'),
  resolveIntent: (payload: string | { utterance: string; conversationId?: string }): Promise<{
    resolved: boolean
    executed?: boolean
    plan: { actions: Array<{ actionId: string; params: Record<string, unknown> }>; explanation?: string; fallback?: string; question?: string }
    results?: unknown[]
  }> => ipcRenderer.invoke('intent:resolve', payload),
  onActionExecuting: (callback: (data: { actionId: string; name: string }) => void): (() => void) => {
    const handler = (_event: unknown, data: { actionId: string; name: string }): void => callback(data)
    ipcRenderer.on('action:executing', handler)
    return () => ipcRenderer.removeListener('action:executing', handler)
  },

  // ─── Claude Code ControlPlane ────────────────────────────────────────────
  claudeRespondPermission: (payload: { tabId: string; questionId: string; optionId: string }): Promise<boolean> =>
    ipcRenderer.invoke('claude:respond-permission', payload),
  claudeGetHealth: (): Promise<unknown> => ipcRenderer.invoke('claude:health'),
  claudeSetPermissionMode: (mode: string): void => {
    ipcRenderer.send('claude:set-permission-mode', mode)
  },

  // ─── Watchers ────────────────────────────────────────────────────────────
  createWatcher: (watcher: unknown): Promise<void> => ipcRenderer.invoke('watcher:create', watcher),
  listWatchers: (): Promise<unknown[]> => ipcRenderer.invoke('watcher:list'),
  deleteWatcher: (id: string): Promise<void> => ipcRenderer.invoke('watcher:delete', id),
  resumeWatchers: (): Promise<void> => ipcRenderer.invoke('watcher:resume-all'),
  onWatcherTriggered: (callback: (data: unknown) => void): (() => void) => {
    const handler = (_event: unknown, data: unknown): void => callback(data)
    ipcRenderer.on('watcher:triggered', handler)
    return () => ipcRenderer.removeListener('watcher:triggered', handler)
  },
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI)
} else {
  ;(window as unknown as Record<string, unknown>).electronAPI = electronAPI
}
