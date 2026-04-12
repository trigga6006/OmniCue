// ── Work-State Timeline Entry ─────��───────────────────────────────────────────

/** A single point-in-time snapshot of user activity + agent state */
export interface WorkStateEntry {
  id: string
  timestamp: number

  /** Stable persisted identity — links to StoredConversation.id */
  conversationId: string

  /** Ephemeral runtime identity, useful for debugging but not indexing */
  runtimeSessionId?: string

  provider: string

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
    clipboard?: string
  }

  agent?: {
    lastUserMessage?: string
    lastAssistantMessage?: string
    lastToolUse?: { name: string; input?: string }
    waitingOn?: string
    pendingInteractions?: Array<{ kind: string; title: string }>
  }

  tags: string[]
  summary: string
  trigger:
    | 'user-message'
    | 'assistant-finish'
    | 'interaction-request'
    | 'focus-change'
    | 'periodic'
    | 'manual'
}

// ── Resume Capsule ───────��────────────────────────────────���───────────────────

/** Compact "best current understanding" of a conversation's resumable state */
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

// ── Timeline Index ───────────────────────────────────────��────────────────────

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

// ── Query Types ───────────────────────────────────────────────────────────────

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

export interface SessionMemoryResult {
  conversations: Array<{
    conversationId: string
    title?: string
    provider?: string
    lastActivity: number
    entries: WorkStateEntry[] | string[]
  }>
  totalEntries: number
}
