import { contextBridge, ipcRenderer } from 'electron'

const electronAPI = {
  setIgnoreMouseEvents: (ignore: boolean): void => {
    ipcRenderer.send('set-ignore-mouse-events', ignore)
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
  moveWindowBy: (dx: number, dy: number): void => {
    ipcRenderer.send('move-window-by', { dx, dy })
  },
  requestWindowResize: (width: number, height: number): void => {
    ipcRenderer.send('request-window-resize', { width, height })
  },
  setWindowBounds: (bounds: { x: number; y: number; width: number; height: number }): void => {
    ipcRenderer.send('set-window-bounds', bounds)
  },
  getWindowBounds: (): Promise<{ x: number; y: number; width: number; height: number }> =>
    ipcRenderer.invoke('get-window-bounds'),
  getPrimaryDisplayBounds: (): Promise<{ x: number; y: number; width: number; height: number }> =>
    ipcRenderer.invoke('get-primary-display-bounds'),
  sendTestAlert: (): void => {
    ipcRenderer.send('send-test-alert')
  },
  captureActiveWindow: (): Promise<{ image: string; title: string; ocrId: number } | null> =>
    ipcRenderer.invoke('capture-active-window'),
  getOcrResult: (ocrId: number): Promise<{ ocrText: string; screenType: string; ocrDurationMs: number } | null> =>
    ipcRenderer.invoke('get-ocr-result', ocrId),
  sendAiMessage: (payload: {
    messages: unknown[]
    sessionId: string
    provider?: string
  }): Promise<{ ok: boolean }> => ipcRenderer.invoke('ai:send-message', payload),
  abortAiStream: (sessionId: string): void => {
    ipcRenderer.send('ai:abort', { sessionId })
  },
  cleanupAiSession: (sessionId: string): void => {
    ipcRenderer.send('ai:cleanup-session', { sessionId })
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
}

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electronAPI', electronAPI)
} else {
  ;(window as unknown as Record<string, unknown>).electronAPI = electronAPI
}
