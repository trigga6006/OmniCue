# Plan: Memory Preview UI

> Add a lightweight memory preview for saved conversations and conversation-linked history rows so the user can quickly see what the harness remembers without opening the thread.

## Goal

When hovering a saved conversation, and when hovering a conversation-linked entry in the History UI, the user should be able to see at a glance:

- what they were doing when the conversation last paused
- what the agent was working on or waiting for
- whether the saved context differs from the current desktop
- a way to clear saved memory
- a way to pin the current state for the active conversation

This is a preview, not an editor. The source of truth remains `resumeCapsule` on `StoredConversation` plus the `session-memory` timeline.

## Scope

This plan covers two surfaces:

1. `ConversationList.tsx` in the companion
2. The Settings window History tab, but only for history rows that can be linked back to a conversation

It does **not** attempt a generic preview for timer, alarm, or reminder history rows, because those entries do not have conversation memory behind them.

## Key Revisions

The draft direction was good, but a few pieces needed correction:

- The requested UX is hover preview, not click-to-expand. We should keep primary click behavior unchanged and add a hover/focus preview card.
- For hover UI, lazy-loading is the better fit than packing capsule fields into every `ConversationSummary`. One hovered item at a time means the N+1 concern is small, and it keeps the conversation index light and easier to maintain.
- The current History UI is backed by `HistoryEntry`, which does not currently include `conversationId`. If we want memory previews there, we need a conversation link for AI-related history rows.
- The stale check cannot rely on a nonexistent renderer bridge. We should add a tiny IPC bridge for lightweight live desktop context instead of referencing an “existing” call that is not exposed.

## UX Design

### Conversation List

Keep the current row behavior:

- click loads the conversation
- rename/delete buttons behave as they do today

Add a preview card on:

- mouse hover
- keyboard focus

The preview should be anchored to the row, feel tooltip-like, and disappear on mouse leave / blur / Escape.

### History Tab

Show the same preview card on hover/focus, but only for history rows with `conversationId`.

For rows without a linked conversation:

- no preview
- existing history row behavior remains unchanged

### Preview Content

Derived from `ResumeCapsule` and a lightweight live desktop check:

| Row | Source | Display |
|---|---|---|
| Desktop context | `capsule.desktop.activeApp` + `capsule.summary` | `VS Code - Editing auth/jwt.ts` |
| Last exchange | `capsule.lastUserMessage` | `"Can you check why refresh tokens fail?"` |
| Pending state | `capsule.pending.waitingOn` or `capsule.lastAssistantAction` | `Reviewing suggested fix` |
| Tags | `capsule.tags` | small pills, max 4 visible |
| Stale warning | compare capsule desktop app to current live app | `Desktop changed: now in Chrome` |

### Controls

| Control | Behavior |
|---|---|
| `Clear memory` | clear `resumeCapsule` and delete the session-memory timeline for that conversation |
| `Pin current state` | only for the active conversation; calls `sessionMemoryCapture` |

The preview remains read-only apart from those two actions.

## Data Model Changes

### 1. Add conversation linkage to history entries

The current `HistoryEntry` shape is generic and does not support memory previews on the History page.

Add optional fields:

```ts
export interface HistoryEntry {
  id: string
  name: string
  duration: number
  completedAt: string
  type?: EntryType
  conversationId?: string
  provider?: string
}
```

Use these only for conversation-related entries such as Claude/Codex completions or other AI session milestones.

### 2. Keep conversation summaries lightweight

Do **not** expand `ConversationSummary` with a large set of capsule-derived fields in the index as the primary plan.

Recommendation:

- keep `ConversationSummary` as-is
- lazy-load the full `resumeCapsule` on hover/focus via IPC
- cache preview data in the renderer for the current list session

Optional micro-optimization later:

- add a tiny boolean like `hasResumeCapsule?: boolean` if needed for row affordances

## Architecture

```text
ConversationList row hover/focus
  -> renderer asks for conversation capsule
  -> renderer asks for lightweight live desktop context
  -> MemoryPreviewCard renders

HistoryTab row hover/focus
  -> if row has conversationId:
       same flow as above
  -> else:
       no preview
```

## Backend Changes

### File: `src/main/conversations.ts`

Add a helper to clear a conversation's saved capsule cleanly:

```ts
export function clearConversationResumeCapsule(conversationId: string): void
```

This is better than overloading `updateConversationResumeCapsule(...)` with `undefined` unless you explicitly want to broaden that function’s contract.

### File: `src/main/ipc.ts`

Add:

1. `session-memory:clear`

```ts
ipcMain.handle('session-memory:clear', (_event, conversationId: string) => {
  clearConversationResumeCapsule(conversationId)
  deleteSessionTimeline(conversationId)
  return { ok: true }
})
```

2. `desktop:get-live-context`

This should return only the minimum data needed for stale detection, for example:

```ts
{
  activeApp: string
  processName: string
  windowTitle: string
}
```

Use the existing lightweight snapshot/context collection path under the hood, but expose a renderer-safe IPC bridge for it.

### File: `src/main/store.ts`

Extend `HistoryEntry` with optional `conversationId` and `provider`.

### Conversation-linked history writes

Wherever Claude/Codex or other conversation-related history rows are written, include the active `conversationId` so the History tab can resolve memory previews.

If a history row cannot be reliably linked to a conversation, leave `conversationId` undefined.

## Preload + Renderer Types

### File: `src/preload/index.ts`

Add:

```ts
sessionMemoryClear: (conversationId: string) => Promise<{ ok: boolean }>
desktopGetLiveContext: () => Promise<{ activeApp: string; processName: string; windowTitle: string }>
```

### File: `src/renderer/src/lib/types.ts`

Update:

- `HistoryEntry` to include optional `conversationId` and `provider`
- `ElectronAPI` with `sessionMemoryClear` and `desktopGetLiveContext`

## Renderer Components

### File: `src/renderer/src/components/MemoryPreviewCard.tsx` (create)

Reusable preview card component for both surfaces.

Props:

```ts
interface MemoryPreviewCardProps {
  conversationId: string
  capsule: ResumeCapsule
  isCurrentConversation: boolean
  liveContext?: { activeApp: string; processName: string; windowTitle: string } | null
  onClear: () => void
  onPin?: () => void
}
```

Responsibilities:

- render capsule summary
- truncate long user text
- render pending state
- render up to 4 tags
- render stale warning if `liveContext.activeApp !== capsule.desktop.activeApp`
- show `Clear memory`
- show `Pin current state` only for the active conversation

### File: `src/renderer/src/components/ConversationList.tsx` (edit)

Changes:

- add hover/focus tracking state: `previewConversationId`
- lazy-load capsule on hover via `sessionMemoryGetCapsule(id)`
- lazy-load live context on first preview open via `desktopGetLiveContext()`
- cache fetched capsules in local component state so repeat hover is instant
- render `MemoryPreviewCard` in an anchored overlay/popover

Important:

- do not change click-to-load behavior
- do not require a second click to open previews

### File: `src/renderer/src/components/SettingsWindow.tsx` (edit)

Update the History tab row component so that:

- if `entry.conversationId` exists, hovering/focusing the row can show `MemoryPreviewCard`
- if not, the row stays unchanged

This should share the same preview-loading logic or use a small hook.

## Optional Shared Hook

### File: `src/renderer/src/hooks/useMemoryPreview.ts` (optional create)

If implementation gets repetitive, factor the lazy-load/caching logic into a hook:

```ts
function useMemoryPreview()
```

It can manage:

- capsule cache by `conversationId`
- live context fetch
- loading state
- clear action refresh

This is optional but likely worthwhile if both ConversationList and HistoryTab adopt the preview.

## Implementation Order

```text
Phase 0: Data linkage
  1. Extend HistoryEntry with optional conversationId/provider
  2. Update conversation-related history writes to include conversationId when available

Phase 1: Backend bridges
  3. Add clearConversationResumeCapsule helper
  4. Add session-memory:clear IPC handler
  5. Add desktop:get-live-context IPC handler

Phase 2: Preload + types
  6. Add preload bridges
  7. Update renderer types

Phase 3: Shared preview UI
  8. Create MemoryPreviewCard
  9. Optionally add useMemoryPreview hook

Phase 4: Conversation list
  10. Add hover/focus preview to ConversationList without changing click-to-load

Phase 5: History page
  11. Add preview only for history rows with conversationId
  12. Leave timer/alarm/reminder rows unchanged
```

## File Manifest

| File | Action | Purpose |
|---|---|---|
| `src/main/conversations.ts` | Edit | Add helper to clear saved resume capsule |
| `src/main/ipc.ts` | Edit | Add `session-memory:clear` and `desktop:get-live-context` |
| `src/main/store.ts` | Edit | Extend `HistoryEntry` with optional conversation linkage |
| history-writing call sites | Edit | Include `conversationId` for AI-related history rows when available |
| `src/preload/index.ts` | Edit | Add preview-related bridges |
| `src/renderer/src/lib/types.ts` | Edit | Extend HistoryEntry and ElectronAPI types |
| `src/renderer/src/components/MemoryPreviewCard.tsx` | Create | Shared preview card |
| `src/renderer/src/components/ConversationList.tsx` | Edit | Hover/focus preview |
| `src/renderer/src/components/SettingsWindow.tsx` | Edit | History-tab preview for linked rows |
| `src/renderer/src/hooks/useMemoryPreview.ts` | Optional create | Shared lazy-load/caching logic |

## Edge Cases

| Case | Handling |
|---|---|
| No capsule exists | no preview card |
| Capsule exists but fields are effectively empty | treat as no preview |
| Live context lookup fails | render saved state only, no stale warning |
| User clears memory for active conversation | clear preview immediately; future conversation activity can regenerate capsule |
| Very long last user message | truncate to about 80 chars |
| Many tags | show max 4, then `+N more` |
| History row without conversationId | no preview |
| Keyboard navigation | preview appears on focus, not only mouse hover |
