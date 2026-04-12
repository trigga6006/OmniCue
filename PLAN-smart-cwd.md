# Smart Working Directory Resolution for AI Agents

## Problem

Both Codex and Claude Code agents spawned from OmniCue's companion panel use `process.cwd()` as their working directory — which is OmniCue's own app directory. This means the AI agents can't see or navigate the user's actual project files. The overlay is "all-seeing" via screenshots and OCR, but the agents it spawns are blind to the user's filesystem context.

## Goal

Make OmniCue's AI agents automatically start in the right project directory based on what the user is actively working on — inferred from screen context (OCR, screenshots, terminal prompts, IDE title bars). The agent should also be free to navigate anywhere on the computer if needed (e.g., diagnosing Steam files, system configs, etc.).

## Architecture

### 1. New Setting: `devRootPath`

A single path setting where the user points to their top-level dev folder (e.g., `C:\Users\fowle\Documents\dev`). This narrows the search space from the entire filesystem to a known tree of project directories.

**Files to modify:**
- `src/renderer/src/lib/types.ts` — add `devRootPath: string` to `Settings` interface
- `src/main/store.ts` — add `devRootPath: string` to `SettingsData` interface and `SETTINGS_DEFAULTS`
- `src/renderer/src/components/SettingsWindow.tsx` — add a folder-picker row in the Settings tab (General section)

**UI:** A row labeled "Dev Folder" with a path input and a "Browse" button that opens a native folder dialog via `electronAPI.selectFolder()`.

**IPC:** Add a `select-folder` IPC handler in `ipc.ts` that calls `dialog.showOpenDialog({ properties: ['openDirectory'] })`.

### 2. New Module: `src/main/resolveProjectCwd.ts`

A function that determines the best working directory for an agent session based on available context.

```typescript
export function resolveProjectCwd(
  messages: ChatMessage[],
  devRootPath: string
): string
```

**Resolution strategy (ordered by priority):**

1. **Extract path hints from messages** — scan the most recent user message's `ocrText` and `content` for:
   - Terminal prompts with paths: `PS C:\Users\fowle\Documents\dev\omniox>`, `user@host:~/dev/myproject$`
   - IDE title bars: `myproject — Visual Studio Code`, `omniox [omniQ] — WebStorm`
   - File paths in visible code: `src/main/index.ts`, `C:\Users\fowle\...`
   - Git branch indicators that include repo names

2. **Match against devRootPath subdirectories** — list immediate children of `devRootPath` and fuzzy-match extracted project names against them. Use the best match.

3. **Fallback chain:**
   - Matched project directory under devRootPath
   - `devRootPath` itself (if set but no project matched)
   - User's home directory (if devRootPath not set)

**Key regex patterns:**
```typescript
// PowerShell/CMD prompt
/PS\s+([A-Z]:\\[^\s>]+)>/i
/^([A-Z]:\\[^\s>]+)>/m

// Bash/Zsh prompt  
/[~\/]([^\s$#]+)[\$#]/

// VS Code / IDE title bar
/(\S+)\s*(?:—|[-–])\s*(?:Visual Studio Code|VS Code|WebStorm|Cursor)/i

// Explicit file paths
/([A-Z]:\\(?:[^\s\\:*?"<>|]+\\)+[^\s\\:*?"<>|]*)/g
/(?:\/(?:home|Users)\/\w+\/[^\s]+)/g
```

### 3. Pass Resolved CWD Through the AI Pipeline

**`src/main/ipc.ts`** — in the `ai:send-message` handler:
```typescript
ipcMain.handle('ai:send-message', async (event, payload) => {
  const settings = settingsStore.get()
  const cwd = resolveProjectCwd(payload.messages, settings.devRootPath || '')
  
  await streamAiResponse(
    payload.sessionId,
    payload.messages,
    callbacks,
    controller.signal,
    payload.model,
    payload.provider,
    cwd  // NEW parameter
  )
})
```

**`src/main/ai.ts`** — thread `cwd` through:

- `streamAiResponse()` — add `cwd?: string` parameter, pass to each provider function
- `CodexAppServerClient.streamSession()` — replace `cwd: process.cwd()` with `cwd: resolvedCwd` (line ~214)
- `streamViaClaudeCodeCli()` — replace `cwd: process.cwd()` in `spawn()` options with `cwd: resolvedCwd` (line ~862)
- `streamViaCodexCliFallback()` — same pattern for the CLI fallback spawn
- OpenAI/Anthropic API calls — no CWD needed (pure HTTP), but could inject the project path into the system prompt for context

### 4. System Prompt Enhancement

For API-only providers (OpenAI, Anthropic API) that don't have a filesystem, inject the resolved project path into the system prompt so the AI at least knows what project the user is working on:

```
The user appears to be working in: C:\Users\fowle\Documents\dev\omniox
```

### 5. Agent Freedom

- **Claude Code CLI**: Already has full filesystem access by default. Setting `cwd` just determines the starting point — Claude can `cd` or read any file on the system.
- **Codex app-server**: Currently uses `sandboxPolicy: { type: 'readOnly', access: { type: 'fullAccess' } }` — full read access to the entire filesystem. The `cwd` just sets the context root.
- **No additional restrictions needed** — agents can go anywhere, we're just giving them a smarter starting point.

## Implementation Order

1. Add `devRootPath` to settings types + defaults + store
2. Add folder picker IPC handler (`select-folder`)
3. Add "Dev Folder" row to SettingsWindow
4. Create `resolveProjectCwd.ts` with path extraction logic
5. Thread `cwd` parameter through `ipc.ts` → `ai.ts` → spawn calls
6. Add system prompt injection for API-only providers

## Files Changed

| File | Change |
|------|--------|
| `src/renderer/src/lib/types.ts` | Add `devRootPath` to Settings |
| `src/main/store.ts` | Add `devRootPath` to SettingsData + defaults |
| `src/main/ipc.ts` | Add `select-folder` handler; pass resolved CWD to streamAiResponse |
| `src/renderer/src/components/SettingsWindow.tsx` | Add Dev Folder picker row |
| `src/preload/index.ts` | Expose `selectFolder` method |
| `src/main/resolveProjectCwd.ts` | **NEW** — project directory inference from OCR/message context |
| `src/main/ai.ts` | Add `cwd` param to streamAiResponse + all provider functions |

## Edge Cases

- **No devRootPath set**: Falls back to home directory. Agents still work, just start in ~.
- **No OCR context**: Falls back to devRootPath root. User can still tell the agent where to look via chat.
- **Multiple projects detected**: Use the most specific/recent match.
- **Non-dev context** (e.g., Steam, system files): If no devRootPath match, use the detected path directly if it exists on disk. Agents can navigate from there.
- **devRootPath doesn't exist**: Validate on save, fall back to home directory at runtime.
