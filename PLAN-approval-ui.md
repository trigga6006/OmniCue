# Interactive Approval UI for AI Agent Sessions

## Context

OmniCue routes AI sessions through Codex (app-server + CLI) and Claude Code CLI. Currently, the permission model is **pre-configured per session** — `approvalPolicy: 'never'` for Codex, static `--permission-mode` for Claude. Agents cannot ask the user anything mid-session.

The user wants agents in workspace-write or full-access mode to request permission before executing commands or editing files, with the user approving/denying from the overlay's companion panel.

## Approach

**Codex app-server is the primary target** — it has a bidirectional JSON-RPC protocol with `request()`/`notify()` that naturally supports approval round-trips. Claude Code CLI requires a larger refactor (keeping stdin open, dropping `-p` mode) and is deferred to a follow-up.

## Implementation

### 1. Types (`src/renderer/src/lib/types.ts`)

Add:
```ts
export type ApprovalStatus = 'pending' | 'approved' | 'denied' | 'timeout'

export interface ApprovalRequest {
  id: string
  sessionId: string
  toolName: string
  description: string
  detail?: string
  status: ApprovalStatus
  createdAt: number
}
```

Add `approvals?: ApprovalRequest[]` to `ChatMessage`.

Add to `ElectronAPI`:
- `onAiApprovalRequest(cb)` — listener
- `respondToApproval(payload: { sessionId: string; approvalId: string; approved: boolean })` — sender

### 2. Callbacks (`src/main/ai.ts` — AiStreamCallbacks)

Add `onApprovalRequest?: (request: ApprovalRequest) => void` to the interface.

### 3. Codex App-Server Changes (`src/main/ai.ts`)

**approvalPolicy**: Change from hardcoded `'never'` to dynamic based on `agentPermissions`:
- `read-only` → `'never'` (nothing to approve)
- `workspace-write` → `'auto-edit'` (approve commands, auto-approve edits in workspace)
- `full-access` → `'auto-edit'`

**handleLine()**: Add handler for approval request notifications from the server. Since the exact Codex protocol event name is uncertain, add a catch-all that logs unrecognized notifications during development, plus handlers for the most likely names (`approval/request`, `item/needsApproval`). Build `ApprovalRequest` from the params and call `session.callbacks?.onApprovalRequest(request)`.

**New method `respondToApproval()`**: Calls `this.request('approval/respond', { approvalId, decision })` (or `this.notify()` depending on protocol).

**Timeout**: 120s per request. `setTimeout` in main process, stored alongside pending approval. Auto-deny on expiry.

### 4. IPC Plumbing (`src/main/ipc.ts`)

In `ai:send-message` handler, add `onApprovalRequest` callback:
```ts
onApprovalRequest: (request) => {
  if (!win.isDestroyed())
    win.webContents.send('ai:approval-request', { sessionId, ...request })
}
```

New handler:
```ts
ipcMain.on('ai:approval-respond', (_event, payload) => {
  codexAppServerClient.respondToApproval(payload.sessionId, payload.approvalId, payload.approved)
})
```

### 5. Preload Bridge (`src/preload/index.ts`)

```ts
onAiApprovalRequest: (cb) => { ipcRenderer.on('ai:approval-request', handler); return unsub }
respondToApproval: (payload) => { ipcRenderer.send('ai:approval-respond', payload) }
```

### 6. Store (`src/renderer/src/stores/companionStore.ts`)

Add to state:
- `approvalRequests: ApprovalRequest[]`
- `addApprovalRequest(request)` — appends to array + attaches to current streaming message's `approvals[]`
- `resolveApproval(id, status)` — updates status in both places

Clear in `newSession()`.

### 7. ApprovalCard Component (`src/renderer/src/components/ApprovalCard.tsx` — NEW)

Renders inline in CompanionMessage between tool use chips and message text.

**Pending state**: Shows tool name, description, detail (command/path), Approve + Deny buttons. Left border accent in amber.

**Resolved state**: Collapses to single-line chip with status icon (ShieldCheck green / ShieldX red / Clock amber for timeout).

Glass morphism styling: `bg-[var(--g-bg-subtle)]`, `border-[var(--g-line)]`, `text-[12px]`.

### 8. CompanionMessage Integration (`src/renderer/src/components/CompanionMessage.tsx`)

Render `message.approvals?.map(a => <ApprovalCard key={a.id} ... />)` alongside the existing `message.toolUses?.map(...)` block.

### 9. CompanionPanel Wiring (`src/renderer/src/components/CompanionPanel.tsx`)

Subscribe to `window.electronAPI.onAiApprovalRequest()` in the existing `useEffect` alongside stream listeners. Call `store.addApprovalRequest(request)`.

### 10. Notification Nudge

When an approval arrives and `!companionStore.visible`, push a notification via `notificationStore.add()`: "Agent needs your approval".

### 11. Claude Code CLI (Deferred)

Current behavior unchanged — uses `--permission-mode plan/acceptEdits/bypassPermissions` based on setting. No interactive approvals. The companion panel shows a note: "Claude Code uses permission-mode flag; enforcement is best-effort."

Future work: drop `-p` flag, keep stdin open, use `--permission-mode default`, parse permission events, respond via stdin.

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/lib/types.ts` | `ApprovalRequest`, `ApprovalStatus` types; `ChatMessage.approvals`; `ElectronAPI` additions |
| `src/main/ai.ts` | `onApprovalRequest` callback; dynamic `approvalPolicy`; `handleLine` approval handler; `respondToApproval()`; timeout logic |
| `src/main/ipc.ts` | `ai:approval-request` event; `ai:approval-respond` handler |
| `src/preload/index.ts` | `onAiApprovalRequest`, `respondToApproval` bridge |
| `src/renderer/src/stores/companionStore.ts` | `approvalRequests` state + actions |
| `src/renderer/src/components/ApprovalCard.tsx` | **NEW** — approval card UI |
| `src/renderer/src/components/CompanionMessage.tsx` | Render ApprovalCards inline |
| `src/renderer/src/components/CompanionPanel.tsx` | Subscribe to approval events |

## Verification

1. Set `agentPermissions` to `workspace-write` in Settings → AI
2. Start a Codex session and ask it to do something that needs approval (e.g., "create a file")
3. Verify the approval card appears in the companion panel
4. Click Approve → verify the agent proceeds
5. Repeat with Deny → verify the agent stops/skips that action
6. Test timeout behavior (wait 120s)
7. Test with panel closed → verify notification bubble appears
8. Verify `read-only` mode still works without any approval prompts
9. Build passes: `npx electron-vite build`

## Open Risk

The exact Codex app-server approval notification event name/shape is unknown — we're inferring from the protocol pattern. Step 3 implementation should log all unrecognized notifications so we can discover the actual format. The UI/plumbing/store work is protocol-agnostic and will work regardless.
