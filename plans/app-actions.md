# App Actions: From Assistant to Operator

## Context

OmniCue currently observes the desktop (screenshots, OCR, active window detection) and comments on it, but can't *do* anything. The AI can see your VS Code but can't press Ctrl+S. It can read your clipboard but can't write to it on behalf of the user's request to an AI provider.

This plan adds a unified **App Actions** system — a set of OS-level actions organized into three permission tiers (safe/guided/dangerous) that both the AI (via HTTP API) and the renderer (via IPC) can invoke.

## Architecture

```
AI Provider (Claude Code, Codex CLI)
  │ curl POST /action
  ▼
server.ts ──► executor.ts ──► tier check
                │                 │
                │    ┌────────────┼────────────┐
                │    ▼            ▼             ▼
                │  safe.ts    guided.ts    dangerous.ts
                │  (execute)  (toast+exec) (confirm+exec)
                │                              │
                │                    agent-interactions.ts
                │                    (reuse existing UI)
                │
                ├── Electron APIs (clipboard, shell, etc.)
                └── powershell.ts ──► temp .ps1 scripts
                    (SendKeys, SendInput, UIAutomation,
                     SetForegroundWindow)
```

## New Files

| File | Purpose |
|------|---------|
| `src/shared/actions.ts` | Type definitions (ActionTier, ActionDefinition, ActionRequest, ActionResult) |
| `src/main/actions/registry.ts` | ACTION_REGISTRY — all action definitions, single source of truth |
| `src/main/actions/powershell.ts` | Script runner: ensurePsScript(), runPsScript(), cleanup |
| `src/main/actions/safe.ts` | Safe action handlers (clipboard, open file/url, reveal, save note) |
| `src/main/actions/guided.ts` | Guided action handlers + embedded PS scripts (type, click, press-key, switch-app) |
| `src/main/actions/dangerous.ts` | Dangerous action handlers (delete-to-recycle, send, submit) |
| `src/main/actions/executor.ts` | Dispatcher: validate, tier-gate, dispatch to handler |
| `src/main/actions/index.ts` | Barrel export |

## Modified Files

| File | Change |
|------|--------|
| `src/main/server.ts` | Add `POST /action` and `GET /actions` endpoints (local-only) |
| `src/main/ipc.ts` | Add `action:execute` and `action:list` handlers |
| `src/preload/index.ts` | Add `executeAction`, `listActions`, `onActionExecuting` to bridge |
| `src/renderer/src/lib/types.ts` | Add action types, `action-confirmation` interaction kind, update ElectronAPI |
| `src/main/ai.ts` | Update `DESKTOP_TOOLS_PROMPT` to document action endpoints |
| `src/main/agent-interactions.ts` | Add `action-confirmation` to AgentInteractionKind |
| `src/main/index.ts` | Add `cleanupActionScripts()` to will-quit handler |

## Action Registry

### Safe (auto-execute)
| ID | Params | Implementation |
|----|--------|---------------|
| `clipboard-write` | `text: string` | `clipboard.writeText()` — already in Electron |
| `open-url` | `url: string` | `shell.openExternal()` — existing |
| `open-file` | `path: string` | `shell.openPath()` — existing |
| `reveal-in-folder` | `path: string` | `shell.showItemInFolder()` — existing |
| `save-note` | `text: string`, `title?: string` | Write JSON to userData/notes/ |

### Guided (brief toast, no blocking confirm)
| ID | Params | Implementation |
|----|--------|---------------|
| `type-text` | `text: string` | PowerShell: `SendKeys` / `SendInput` for Unicode |
| `press-key` | `keys: string` (e.g. "ctrl+s") | PowerShell: parse combo → `SendKeys` format |
| `click-element` | `name?: string`, `x?: number`, `y?: number` | PowerShell: UIAutomation by name, or `SetCursorPos` + `mouse_event` by coords |
| `switch-app` | `processName: string` | PowerShell: `Get-Process` → `SetForegroundWindow` |

### Dangerous (explicit confirmation every time)
| ID | Params | Implementation |
|----|--------|---------------|
| `delete-file` | `path: string` | PowerShell: `Microsoft.VisualBasic.FileIO` → recycle bin |
| `send-input` | `confirm: boolean` | PowerShell: `SendKeys` Enter (context: user confirmed sending) |
| `submit-form` | `confirm: boolean` | PowerShell: click Submit button or Enter |

## Dangerous Action Confirmation Flow

Reuses the existing `agent-interactions.ts` system:

1. `executor.ts` creates an `AgentInteractionRequest` with kind `'action-confirmation'`
2. Calls `registerPendingRequest(interaction, respondCallback)` 
3. Sends to renderer via `mainWin.webContents.send('ai:interaction-request', interaction)`
4. Renderer shows the existing approval card UI (Approve / Deny buttons)
5. User clicks → `resolvePendingRequest()` fires → Promise resolves → action executes or rejects
6. For HTTP callers: the `POST /action` response is held open until user responds

## HTTP API Design

```
GET  /actions                → { actions: ActionDefinition[] }
POST /action                 → ActionResult
  Body: { actionId: string, params: Record<string, unknown>, requestId?: string }
  Response: { ok: boolean, actionId: string, tier: string, detail?: string, error?: string, durationMs: number }
```

Both endpoints use `localJson()` (no CORS — local-only, matches existing sensitive endpoints).

## AI System Prompt Addition

Append to `DESKTOP_TOOLS_PROMPT` in `ai.ts`:

```
## OmniCue App Actions

Execute desktop actions through OmniCue's action API:

- `curl.exe -s http://127.0.0.1:19191/actions` — list available actions
- `curl.exe -s -X POST http://127.0.0.1:19191/action -H "Content-Type: application/json" -d '{"actionId":"...","params":{...}}'`

Action tiers: safe (auto), guided (indicator shown), dangerous (user must approve).
For dangerous actions, curl blocks until user approves/denies.
Use /context or /screen-text first to understand the screen before acting.
```

## PowerShell Script Pattern

Following `activeWindow.ts` exactly:
- Scripts embedded as string constants in `guided.ts`/`dangerous.ts`
- Written to `%TEMP%/omnicue-action-*.ps1` once per session via `ensurePsScript()`
- Executed via `spawn('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path, ...args])`
- Cleaned up on `app.on('will-quit')`

**Why PowerShell over robotjs/nut.js**: No native addon compilation, works on every Windows machine, project already uses this pattern, and it provides access to .NET's UIAutomation namespace for element-level interaction.

## Implementation Order

1. `src/shared/actions.ts` — types
2. `src/main/actions/registry.ts` — action catalog
3. `src/main/actions/powershell.ts` — script runner utility
4. `src/main/actions/safe.ts` — safe handlers (mostly Electron API wrappers)
5. `src/main/actions/guided.ts` — guided handlers + PS scripts
6. `src/main/actions/dangerous.ts` — dangerous handlers + confirmation
7. `src/main/actions/executor.ts` — dispatcher with tier logic
8. `src/main/actions/index.ts` — barrel
9. `src/main/server.ts` — HTTP endpoints
10. `src/main/ipc.ts` — IPC handlers
11. `src/preload/index.ts` — bridge additions
12. `src/renderer/src/lib/types.ts` — type updates
13. `src/main/agent-interactions.ts` — add action-confirmation kind
14. `src/main/ai.ts` — update DESKTOP_TOOLS_PROMPT
15. `src/main/index.ts` — cleanup hook

## Verification

1. **Build check**: `npm run typecheck` passes
2. **Safe action test**: `curl -s -X POST http://127.0.0.1:19191/action -H "Content-Type: application/json" -d '{"actionId":"clipboard-write","params":{"text":"hello"}}'` → check clipboard
3. **Guided action test**: `curl ... -d '{"actionId":"press-key","params":{"keys":"ctrl+a"}}'` → observe Ctrl+A in active app
4. **Dangerous action test**: `curl ... -d '{"actionId":"delete-file","params":{"path":"C:/tmp/test.txt"}}'` → confirm dialog appears in OmniCue overlay, approve → file goes to recycle bin
5. **AI integration**: Open companion, ask "copy 'hello world' to my clipboard" → AI calls `/action` endpoint → clipboard updated
6. **Discovery**: `curl -s http://127.0.0.1:19191/actions` returns full action catalog
