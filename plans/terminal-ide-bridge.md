# Plan: Terminal/IDE Bridge

## Goal

Give OmniCue a first-class terminal and IDE bridge so Claude Code and Codex can act through real desktop/project context instead of asking the user to copy-paste terminal output, explain which file is open, or manually run common project commands.

This layer should make the harness feel native by exposing:

- active terminal buffer
- current cwd / project root
- running commands
- log tailing
- selected code
- open file at line
- jump from stack trace to source
- project script discovery + execution
- git diff / status / log
- rich "explain this error" packets

## Important Revisions

This revised plan keeps the ambition, but tightens a few architectural points so implementation fits OmniCue cleanly:

1. **Read-only bridge data gets dedicated `/terminal/*` and `/ide/*` endpoints.**
   Guided and dangerous operations do **not** get bespoke execution endpoints. They go through the existing `/action` path so OmniCue's tiering, interaction UI, and audit trail remain the single execution gate.

2. **Active-window metadata must grow first.**
   Current `ActiveWindowInfo` only has app name, process name, and title. Terminal/IDE bridging needs at least:
   - `processId`
   - `windowHandle`
   Without those, process trees, UI Automation targeting, and editor focus operations are all more brittle.

3. **Bridge enrichment must be cached and timeout-bounded.**
   `collectSnapshot()` runs often. Expensive bridge reads must not happen synchronously on every snapshot. Use a short-TTL cache and only enrich snapshots with cheap/cached bridge fields.

4. **Do not overpromise deep editor integration.**
   VSCode-family editors are a good primary target. JetBrains deep state, cursor positions, and robust selection metadata are later-phase work unless a reliable local mechanism is proven.

5. **Integrated terminal support is best-effort, not assumed.**
   Standalone Windows Terminal / Console Host is the primary target. VSCode integrated terminals may partially work through editor/UIA flows, but the plan should not depend on extension APIs.

## Current Gap

Today OmniCue can identify that a terminal or editor is focused and derive light context from the window title, but it cannot reliably answer:

- What error is on screen right now?
- What command is still running?
- What repo is this terminal in?
- What file is selected in the editor?
- What local stack-trace frame should I open?
- What changed in git in the project I'm looking at?

That forces the agent back into copy-paste and guesswork.

## Architecture

### New modules

Prefer focused bridge helpers plus thin HTTP routing helpers that are imported into the existing main server.

```text
src/main/terminal-bridge/
  index.ts
  types.ts
  session.ts         # resolve active terminal session from active window info
  buffer.ts          # read visible terminal text / bounded scrollback
  processes.ts       # process tree + running commands
  logs.ts            # tail files with caps / filtering
  git.ts             # git status / diff / log helpers
  scripts.ts         # detect project scripts / run approved scripts
  errors.ts          # error packet assembly
  http.ts            # route helpers used by src/main/server.ts

src/main/ide-bridge/
  index.ts
  types.ts
  state.ts           # best-effort editor state
  selection.ts       # safe selection read if available, guided clipboard fallback lives in actions
  navigation.ts      # editor CLI detection + open-file dispatch
  stack-trace.ts     # parse + resolve frames
  http.ts            # route helpers used by src/main/server.ts
```

### Modified core files

- `src/main/activeWindow.ts`
  Add `processId` and `windowHandle` to `ActiveWindowInfo`.
- `src/main/context/collector.ts`
  Merge in cached bridge enrichments with short timeouts.
- `src/main/context/types.ts`
  Extend `TerminalContext` / `EditorContext` with optional bridge-derived fields.
- `src/main/server.ts`
  Mount read-only bridge routes using imported route helpers.
- `src/main/actions/{registry,safe,guided,dangerous}.ts`
  Add bridge actions, but keep execution flowing through the existing action system.
- `src/main/ai.ts`
  Document the new read-only endpoints plus the existing `/action` path for guided/dangerous behavior.

## Foundation Requirement

### 0. Extend active-window capture

Before terminal/IDE bridge work, update active-window capture to return:

```ts
export interface ActiveWindowInfo {
  activeApp: string
  processName: string
  windowTitle: string
  processId?: number
  windowHandle?: number
}
```

Why this matters:

- terminal UI Automation needs a stable target window
- process-tree walking needs a shell/host PID
- editor targeting is more reliable when tied to the actual foreground process

This is the real prerequisite for the rest of the bridge.

## Shared Design Rules

### Safety model

- **Safe**: read-only inspection only
- **Guided**: sends keys, switches focus, opens files, captures selection via clipboard dance
- **Dangerous**: runs scripts / commands with side effects

### Route model

- Dedicated `/terminal/*` and `/ide/*` routes are **read-only only**
- Guided and dangerous actions must go through:
  - `/actions`
  - `/action`
- No direct `/terminal/run-script` or `/ide/open` execution routes

This preserves the action-tier system instead of accidentally bypassing it.

### Performance model

- Every bridge call gets a hard timeout
- Expensive results are cached briefly
- Context enrichment uses cached bridge data only
- Diff/log/buffer outputs are capped

Recommended caps:

- terminal buffer: max 200 lines
- log tail: max 500 lines / 128 KB
- git diff: max 200 KB
- script stdout/stderr: max 64 KB each
- bridge cache TTL: 1000-2000 ms

## Capability Design

### 1. Read active terminal buffer

**What**

Read visible terminal text plus bounded recent scrollback from the active terminal window.

**Primary target**

- Windows Terminal
- Console Host / PowerShell / cmd
- Git Bash / MinGW terminals where UIA works

**How**

- Resolve active terminal session from `ActiveWindowInfo`
- Use UI Automation text pattern when available
- Fallback to OCR only when UIA fails

**Read-only endpoint**

`GET /terminal/buffer`

```ts
{
  lines: string[]
  visibleLineCount: number
  totalLines: number | null
  shell: string
  cwd: string | null
  truncated: boolean
  source: 'uia' | 'ocr'
}
```

**Safe action**

- `terminal-read-buffer`

### 2. Get cwd / project root

**What**

Return the active terminal cwd, plus a normalized project root when it can be inferred.

**How**

- Prefer process/session-derived cwd if available
- Fall back to prompt parsing
- Fall back to title-derived cwd

**Read-only endpoint**

`GET /terminal/cwd`

```ts
{
  cwd: string | null
  projectRoot: string | null
  shell: string
  pid: number | null
  source: 'process' | 'prompt' | 'title' | null
}
```

**Safe action**

- `terminal-get-cwd`

### 3. List running commands

**What**

Show the active shell plus relevant child processes and recent commands reconstructed from the buffer.

**How**

- Walk the process tree from the active shell / terminal host
- Return only relevant leaf or near-leaf commands
- Use buffer parsing for a small recent command history

**Read-only endpoint**

`GET /terminal/processes`

```ts
{
  shell: { pid: number | null, name: string, cwd: string | null }
  running: Array<{
    pid: number
    name: string
    commandLine: string
    startedAt: string | null
    runtimeSeconds: number | null
  }>
  recentCommands: Array<{
    command: string
    exitCode: number | null
    timestamp: string | null
  }>
}
```

**Safe action**

- `terminal-list-processes`

### 4. Tail logs

**What**

Tail a specific file or auto-detect likely logs for the current project.

**How**

- Accept explicit `path`
- If omitted, infer from project root + project type
- Read only the tail region, not the full file
- Optionally filter by pattern

**Read-only endpoint**

`GET /terminal/logs?path=...&lines=100&pattern=ERROR&cwd=...`

```ts
{
  path: string
  lines: string[]
  lineCount: number
  format: 'json' | 'syslog' | 'plain' | 'unknown'
  filtered: boolean
  truncated: boolean
}
```

**Safe action**

- `terminal-tail-logs`

### 5. Capture selected code

**What**

Capture the user's current editor selection.

**Revised scope**

This splits into:

- **safe best-effort read** if selection is available via UIA or editor state
- **guided capture** using clipboard dance when read-only access is unavailable

Do not promise exact line ranges or cursor positions unless the chosen editor path can actually provide them.

**Read-only endpoint**

`GET /ide/selection`

```ts
{
  text: string | null
  file: string | null
  language: string | null
  source: 'uia' | 'editor-state' | null
}
```

**Guided action**

- `ide-capture-selection`

This action may:

- switch to the active editor if needed
- send `Ctrl+C`
- read clipboard
- restore clipboard

### 6. Open file at line number

**What**

Open a local file at a line and optional column in the user's editor.

**Execution model**

Guided action only. No direct execution endpoint.

**Editor priority**

- VSCode / Cursor / Windsurf via `code --goto`
- editor-specific CLIs if available
- graceful failure if no supported editor CLI is found

**Guided action**

- `ide-open-file`

Params:

```ts
{
  file: string
  line?: number
  column?: number
  editor?: string
}
```

### 7. Jump from stack trace to source

**What**

Parse a stack trace and resolve local frames to real files.

**Split**

- read-only parse endpoint
- guided open-frame action

**Read-only endpoint**

`POST /terminal/parse-stacktrace`

```ts
{
  language: string | null
  errorMessage: string | null
  errorType: string | null
  frames: Array<{
    raw: string
    file: string | null
    line: number | null
    column: number | null
    function: string | null
    exists: boolean
    isProjectFile: boolean
  }>
}
```

`text: "auto"` may use the active terminal buffer.

**Safe action**

- `terminal-parse-stacktrace`

**Guided action**

- `ide-jump-to-frame`

This action parses first, then opens the top project-local frame.

### 8. Run project-specific scripts

**What**

List project scripts safely, and run them only through dangerous-tier actions.

**Read-only endpoint**

`GET /terminal/scripts?cwd=...`

```ts
{
  projectType: string | null
  packageManager: string | null
  scripts: Array<{
    name: string
    command: string
    category: 'test' | 'build' | 'lint' | 'dev' | 'deploy' | 'other'
  }>
  cwd: string | null
}
```

**Safe action**

- `terminal-list-scripts`

**Dangerous action**

- `terminal-run-script`

Params:

```ts
{
  script: string
  cwd?: string
  timeoutMs?: number
}
```

Execution result should be bounded and transparent:

```ts
{
  ok: boolean
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
  durationMs: number
  truncated: boolean
}
```

### 9. Diff uncommitted changes

**What**

Return status, diff, and recent history for the relevant repo.

**Read-only endpoints**

- `GET /terminal/git-status`
- `GET /terminal/git-diff`
- `GET /terminal/git-log`

All should accept explicit `cwd` so they still work when the terminal is not focused.

**Safe actions**

- `terminal-git-status`
- `terminal-git-diff`
- `terminal-git-log`

### 10. Build "explain this error" packets

**What**

Assemble a compact structured packet from terminal output, parsed frames, source context, and local repo context.

**Read-only endpoint**

`GET /terminal/error-packet`

```ts
{
  detected: boolean
  packet: {
    errorMessage: string
    errorType: string | null
    stackTrace: Array<unknown> | null
    terminalContext: string[]
    sourceContext: {
      file: string
      startLine: number
      endLine: number
      content: string
      language: string | null
    } | null
    gitDiff: string | null
    project: {
      type: string | null
      cwd: string | null
    }
    suggestedActions: string[]
  } | null
}
```

**Safe action**

- `terminal-error-packet`

This is the bridge object the terminal quick action should feed into "Explain error".

## IDE State

Add one small safe endpoint for best-effort editor state:

`GET /ide/state`

```ts
{
  editor: string | null
  workspacePath: string | null
  openFile: string | null
  language: string | null
  isDirty: boolean | null
}
```

This avoids overloading `selection` with broader editor metadata.

## HTTP Surface

### Read-only bridge endpoints

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/terminal/buffer` | Read active terminal text |
| `GET` | `/terminal/cwd` | Resolve cwd / project root |
| `GET` | `/terminal/processes` | Running commands + recent commands |
| `GET` | `/terminal/logs` | Tail logs |
| `GET` | `/terminal/scripts` | Detect project scripts |
| `POST` | `/terminal/parse-stacktrace` | Parse and resolve frames |
| `GET` | `/terminal/git-diff` | Unified diff |
| `GET` | `/terminal/git-status` | Branch / staged / unstaged / untracked |
| `GET` | `/terminal/git-log` | Recent commits |
| `GET` | `/terminal/error-packet` | Rich error packet |
| `GET` | `/ide/state` | Best-effort active editor state |
| `GET` | `/ide/selection` | Safe selection read if available |

### Important note

There is intentionally **no** direct:

- `/terminal/run-script`
- `/ide/open`
- `/ide/jump-to-frame`

Those must go through `/action`.

## Action Registry Additions

### Safe

- `terminal-read-buffer`
- `terminal-get-cwd`
- `terminal-list-processes`
- `terminal-tail-logs`
- `terminal-list-scripts`
- `terminal-parse-stacktrace`
- `terminal-git-diff`
- `terminal-git-status`
- `terminal-git-log`
- `terminal-error-packet`
- `ide-get-state`
- `ide-read-selection`

### Guided

- `ide-capture-selection`
- `ide-open-file`
- `ide-jump-to-frame`

### Dangerous

- `terminal-run-script`

## Context Enrichment

### Terminal context

Keep base extraction fast and title-based, then merge cached bridge enrichments in `collector.ts`.

Revised optional fields:

```ts
export interface TerminalContext {
  shell: string
  cwd?: string
  isAdmin: boolean
  cwdSource?: 'process' | 'prompt' | 'title'
  projectRoot?: string
  gitBranch?: string
  projectType?: string
  runningProcesses?: Array<{ name: string; commandLine: string }>
  recentError?: {
    message: string
    type: string | null
    hasStackTrace: boolean
  }
}
```

### Editor context

Likewise, merge only cheap/cached enrichments:

```ts
export interface EditorContext {
  workspacePath?: string
  openFile?: string
  fileName?: string
  projectName?: string
  language?: string
  isDirty: boolean
  editorFamily?: string
  selectionAvailable?: boolean
  gitStatus?: 'clean' | 'modified' | 'staged'
}
```

Do **not** put large selected text or expensive live bridge reads directly into snapshot collection.

## Tool Pack Enhancements

### Terminal pack

Potential quick actions when bridge data is available:

- `Jump to source`
- `Explain error`
- `Review git diff`
- `Run tests`

### IDE pack

Potential quick actions:

- `Explain selection`
- `Open referenced file`
- `Review current file changes`

These should be driven by bridge availability and real context, not assumed.

## Desktop Tools Prompt Update

Update `DESKTOP_TOOLS_PROMPT` to document:

- the new read-only `/terminal/*` and `/ide/*` endpoints
- that `ide-open-file`, `ide-jump-to-frame`, `ide-capture-selection`, and `terminal-run-script` go through `/action`
- that agents should pass explicit `cwd`, `file`, or `text` when they already know the target instead of relying on focus

## Implementation Order

### Phase 1: Foundation

1. Extend `ActiveWindowInfo` with `processId` and `windowHandle`
2. Add shared bridge types
3. Add terminal/editor session resolution helpers
4. Add cache + timeout helpers
5. Add a small project-root resolver shared by git/scripts/logs/errors

### Phase 2: Read-only terminal bridge

6. Terminal buffer read
7. Cwd / process tree
8. Git helpers
9. Log tailing
10. Script discovery

### Phase 3: Read-only IDE + parsing

11. IDE state
12. Safe selection read
13. Stack trace parsing + frame resolution
14. Error packet assembly

### Phase 4: Action integration

15. Safe actions wired to bridge helpers
16. Guided actions for open-file / jump-to-frame / clipboard selection
17. Dangerous action for script execution

### Phase 5: Snapshot and UX integration

18. Cached enrichment in `collector.ts`
19. Tool pack quick actions
20. Prompt updates
21. Manual validation on:
   - Windows Terminal
   - PowerShell / cmd
   - VSCode / Cursor / Windsurf
   - at least one repo with git + scripts

## Verification

This feature needs more than typecheck. The plan should explicitly include a small fixture/manual test matrix:

- stack trace fixtures for Node, Python, Go, Rust, Java/Kotlin, C#, Ruby
- script detection fixtures for `package.json`, `Cargo.toml`, `pyproject.toml`, `Makefile`
- manual validation of:
  - active terminal buffer reads
  - cwd detection precedence
  - git diff caps
  - clipboard restore after guided selection capture
  - editor open-file behavior for VSCode-family editors

If test infrastructure is not already present, that should be added as part of implementation or called out as a follow-up.

## Scope Boundaries

### Strong targets

- Windows first
- Windows Terminal / Console Host
- VSCode / Cursor / Windsurf
- Git-based repos
- request/response bridge operations

### Not promised in this phase

- macOS/Linux parity
- deep JetBrains state integration
- tmux / screen / remote SSH session semantics
- direct extension-based editor control
- always-correct selection line ranges
- real-time streaming terminal session mirroring

## Summary

The terminal/IDE bridge is a good expansion, but it should land as:

- **active-window metadata foundation first**
- **read-only bridge endpoints second**
- **guided/dangerous behavior through `/action`, not bespoke execution routes**
- **cached snapshot enrichment, not heavy per-snapshot probing**

That gives OmniCue a much more native development workflow layer without undermining the safety and routing model you already have.
