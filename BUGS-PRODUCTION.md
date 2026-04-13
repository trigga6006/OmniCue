# OmniCue Production-Only Bug Report

**Date:** 2026-04-13
**Environment:** Windows 11, GitHub Release (NSIS installer), Electron packaged build
**Not reproducible in:** `npm run dev` (Vite dev server)

---

## Bug 1: Messages get no visible response; "thinking" appears on panel reopen

### Symptoms
- User sends a message in the companion panel
- No visible response appears (no user message bubble, no "thinking" indicator)
- User closes the panel and reopens it
- Now the "thinking" spinner is visible, but no tokens ever arrive

### Root Cause: OCR await blocks message display + listeners are tied to panel visibility

Two issues compound into this bug:

**Issue A — OCR blocks the entire send flow (`src/renderer/src/lib/sendMessage.ts:98-105`)**

The code comment at line 89 says: *"the user's message must appear immediately in the chat. All async work (OCR resolution, intent resolution) happens after the message is visible so the UI never stalls."*

But the actual code does OCR resolution **BEFORE** `addUserMessage`:

```typescript
// Line 98-105 — runs BEFORE addUserMessage at line 117
const auto = store.autoScreenshot
if (auto?.ocrId && !auto.ocrText) {
  const ocr = await window.electronAPI.getOcrResult(auto.ocrId)  // BLOCKS HERE
  if (ocr) {
    auto.ocrText = ocr.ocrText
    auto.screenType = ocr.screenType
  }
}
```

When the companion panel opens via hotkey, `captureActiveWindow()` fires OCR in the background (`src/main/ipc.ts:424-445`). The OCR result is stored in a `pendingOcr` Map, and `getOcrResult` polls for it. In production, OCR can take several seconds (native sharp/tesseract processing). During this time, the user sees nothing — their message hasn't been added to the store yet.

**Issue B — Stream listeners are scoped to panel visibility (`src/renderer/src/components/CompanionPanel.tsx:73-121`)**

```typescript
useEffect(() => {
  if (!visible) return  // NO LISTENERS when panel is closed
  
  const unsubToken = window.electronAPI.onAiStreamToken(...)
  const unsubDone = window.electronAPI.onAiStreamDone(...)
  const unsubError = window.electronAPI.onAiStreamError(...)
  
  return () => {
    unsubToken()   // Cleanup removes ALL listeners
    unsubDone()
    unsubError()
  }
}, [growPanelForContent, visible, sessionId])
```

When `visible` is `false`, no listeners are registered. Any `ai:stream-token`, `ai:stream-done`, or `ai:stream-error` events sent during this gap are silently dropped.

**The compound failure sequence:**

1. User opens panel (hotkey) → screenshot + OCR starts in background
2. User types message, hits Enter → `sendCompanionMessage()` starts
3. `await getOcrResult(ocrId)` blocks — user sees nothing (no message, no spinner)
4. User closes panel (frustrated) → useEffect cleanup unsubscribes all stream listeners
5. OCR resolves → `addUserMessage()` runs → `startStreaming()` runs → `sendAiMessage()` fires
6. Main process streams response → sends `ai:stream-token` events
7. **No listeners** → tokens dropped silently
8. Main process finishes → sends `ai:stream-done` → **dropped**
9. User reopens panel → useEffect registers new listeners
10. `isStreaming` is still `true` (never got `finishStreaming`) → shows "thinking" spinner
11. **No more events coming** → stuck forever in "thinking" state

### Additional risk: `sendAiMessage` is fire-and-forget

In `sendMessage.ts:186`, the IPC call is not awaited and has no error handler:

```typescript
window.electronAPI.sendAiMessage({...})  // No await, no .catch()
```

If this IPC invoke fails (e.g., payload serialization error with large base64 screenshots), the error is an unhandled promise rejection. The renderer is stuck in streaming state with no recovery path.

### Suggested Fixes

1. **Move stream listeners to App.tsx** (or a global provider) so they're always active regardless of panel visibility
2. **Move `addUserMessage` before the OCR await** — show the message immediately, attach OCR data asynchronously (or use a timeout on the OCR await)
3. **Await `sendAiMessage` and handle errors** — if IPC fails, call `streamError()` to reset streaming state
4. **Add a streaming state recovery mechanism** — detect orphaned streaming state on panel open (e.g., if streaming but no tokens received for N seconds, reset)

---

## Bug 2: Fresh chat prompts to load prior chats (even though there are none)

### Symptoms
- User opens companion panel with a fresh chat (no messages)
- Something prompts them to "load prior chats"
- Clicking it loads a different conversation entirely

### Root Cause Analysis

**Most likely cause: Stale conversation index (`src/main/conversations.ts`)**

`listConversations()` reads from `conversations-index.json`, a cached index file:

```typescript
export function listConversations(): ConversationSummary[] {
  const index = readIndex()  // Reads index file, NOT disk scan
  index.sort((a, b) => b.updatedAt - a.updatedAt)
  return index
}
```

The index can become stale because:
- It's never automatically refreshed against actual conversation files on disk
- If conversation files are deleted externally, the index still lists them
- `rebuildIndex()` exists but is never called automatically
- No concurrent-write protection — if `saveConversation()` is called twice rapidly, index corruption is possible

**Contributing factor: `open()` doesn't reset `showConversationList`**

In `companionStore.ts:206-227`, the `open()` method sets:
```typescript
set({ visible: true, showingAll: false, panelSizeMode: 'compact' })
```

It does NOT set `showConversationList: false`. While `close()` does reset it (line 237), there's a window where:
1. User has conversation list visible
2. Something causes `visible` to become `false` WITHOUT going through `close()` (e.g., if the store is reset or there's a state conflict)
3. `showConversationList` remains `true`
4. Next `open()` call renders the conversation list immediately

**The "Load earlier messages" button (`CompanionPanel.tsx:271-282`)**

This button shows when `viewHorizon > 0 && messages.length > viewHorizon`:
```jsx
{hasEarlier && !showingAll && (
  <button onClick={showAll}>
    <ChevronUp size={12} />
    Load earlier messages
  </button>
)}
```

If Bug 1's delayed message processing adds messages while the panel is closed, `viewHorizon` could be set to a non-zero value via `close()`:
```typescript
viewHorizon: s.isStreaming ? s.viewHorizon : s.messages.length
```

On reopen, the panel shows "Load earlier messages" even though the user perceives it as a "fresh" chat.

### "Loads a different conversation entirely"

When the user clicks a conversation in ConversationList, `loadConversation(id)` is called. If the index is stale and points to a file that was overwritten (e.g., due to the index corruption scenario), the loaded conversation may not match what the user expected.

Additionally, `loadConversation` has no request de-duplication (`ConversationList.tsx:53-59`):
```typescript
const handleLoad = useCallback(async (id: string) => {
  cancelDismiss()
  setPreviewId(null)
  if (isStreaming || id === currentConvoId) return
  await useCompanionStore.getState().loadConversation(id)
}, [isStreaming, currentConvoId, cancelDismiss])
```

If the user clicks multiple conversations rapidly, multiple `loadConversation` calls fire concurrently. The last one to resolve wins, which may not be the one the user clicked last.

### Suggested Fixes

1. **Reset `showConversationList: false` in `open()`**
2. **Rebuild the conversation index on startup** — call `rebuildIndex()` during app initialization
3. **Add a loading lock** to `loadConversation` to prevent concurrent loads
4. **Validate conversation files** before listing — filter out index entries where the file doesn't exist

---

## Bug 3: Duplicate bubble overlay

### Symptoms
- A second activity bubble (spinning OmniCue logo) appears in the pill bar
- Or: the entire overlay pill bar appears duplicated on screen

### Root Cause Analysis

**If duplicate ActivityBubble component:**

The ActivityBubble is rendered in `MorphingPill.tsx:235-237`:
```jsx
<AnimatePresence>
  {isStreaming && <ActivityBubble />}
</AnimatePresence>
```

If `isStreaming` rapidly toggles `true → false → true` (e.g., from the orphaned streaming state in Bug 1 combined with a new message send), AnimatePresence may render two instances simultaneously: one exiting (animating out) and one entering (animating in). The exit animation takes 250ms (`transition: { duration: 0.25 }` in ActivityBubble), during which both are visible.

Scenario:
1. `isStreaming` is stuck `true` from Bug 1
2. User calls `newSession()` → resets `isStreaming: false` → exit animation starts (250ms)
3. User immediately sends new message → `startStreaming()` → `isStreaming: true` → enter animation starts
4. For 250ms, both the exiting and entering ActivityBubbles are visible

**If duplicate overlay window:**

This may be a Windows 11 compositor issue with transparent, always-on-top, frameless windows. The window is created with:
```typescript
// src/main/index.ts:57-78
mainWindow = new BrowserWindow({
  transparent: true,
  frame: false,
  alwaysOnTop: true,
  skipTaskbar: true,
  hasShadow: false,
})
mainWindow.setAlwaysOnTop(true, 'screen-saver')  // Highest z-level
```

Windows 11's DWM (Desktop Window Manager) has known issues with transparent windows at the `screen-saver` z-level. The window may be rendered in multiple compositing layers, especially after sleep/wake cycles or display configuration changes.

### Suggested Fixes

1. **Add a key to ActivityBubble** to help AnimatePresence distinguish instances: `<ActivityBubble key={streamingMessageId} />`
2. **Debounce `isStreaming` transitions** — don't allow rapid true→false→true within the animation duration
3. **For window duplication**: try `mainWindow.setAlwaysOnTop(true, 'pop-up-menu')` instead of `'screen-saver'` — lower z-level but still above most windows, and less likely to trigger compositor bugs
4. **[DONE] Add single-instance lock**: `app.requestSingleInstanceLock()` + `second-instance` handler to prevent duplicate processes

---

## Changes Implemented

### 1. Global stream listeners (Bug 1 — highest priority)

| File | Change |
|------|--------|
| `src/renderer/src/hooks/useAiStreamListeners.ts` | **NEW** — dedicated hook with all AI stream event listeners (token, done, error, tool-use, interaction) |
| `src/renderer/src/App.tsx` | Mounts `useAiStreamListeners()` globally so listeners persist regardless of panel visibility |
| `src/renderer/src/components/CompanionPanel.tsx` | Removed stream listener useEffect and unused `sessionId`/`growPanelForContent` |

### 2. Message-first send flow + IPC error handling (Bug 1)

| File | Change |
|------|--------|
| `src/renderer/src/lib/sendMessage.ts` | `addUserMessage()` now runs BEFORE OCR await; OCR data injected into AI payload separately; `sendAiMessage` is now awaited with try/catch that calls `streamError()` on failure |

### 3. Orphaned stream recovery + state reset on open (Bug 2)

| File | Change |
|------|--------|
| `src/renderer/src/stores/companionStore.ts` | `open()` now detects orphaned streaming state (empty content assistant message stuck in streaming) and cleans it up; also resets `showConversationList`/`showNotesList` to `false` |

### 4. Single-instance lock (Bug 3 — duplicate overlay)

| File | Change |
|------|--------|
| `src/main/index.ts` | Added `app.requestSingleInstanceLock()` — second launches quit immediately; existing instance focuses on `second-instance` event |

### 5. Conversation history hardening (Bug 2)

| File | Change |
|------|--------|
| `src/main/conversations.ts` | Added `validateIndexOnce()` — on first `listConversations()` call, checks for stale index entries pointing to missing files and rebuilds if needed |
| `src/renderer/src/components/ConversationList.tsx` | Added `isLoading` lock to prevent concurrent `loadConversation` calls from racing |

---

## Dev vs Production Differences

| Aspect | Dev | Production |
|--------|-----|------------|
| Renderer source | Vite dev server (`http://localhost`) | Static files (`file://`) |
| OCR performance | Potentially faster (warm caches, smaller screenshots) | Full-resolution screenshots, cold start |
| Error visibility | Console errors visible if devtools manually opened | Silent — no devtools to inspect |
| Instance management | Typically single instance via `npm run dev` | **[FIXED]** Was missing single-instance lock; could launch duplicates |
| IPC timing | Dev server may add microtask delays that serialize operations | Direct file load, operations may interleave differently |
