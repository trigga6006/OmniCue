# Hardened Smart CWD and Local Access Plan

## Objective

Make OmniCue start AI sessions in the most relevant local working directory for the user's current task, while keeping the harness predictable, inspectable, and safe enough to trust for real local work.

This revision keeps the useful part of the original idea:

- infer a good starting directory from active context
- support Codex, Claude Code, and API-backed models through the same UI
- let agents work beyond a single repo when needed

But it hardens the risky parts by separating three concerns that should not be conflated:

1. **Where the agent starts** (`startingCwd`)
2. **What the agent may access** (`allowedRoots`)
3. **What the agent may do** (`filesystemMode`)

## Current Reality

- OmniCue currently launches local agent backends with `process.cwd()`, so they start in the app directory instead of the user's project.
- Codex app-server is currently read-only, even though it has broad read access. Changing `cwd` alone does not enable code edits.
- The renderer currently flattens OCR context into message text before sending it to the main process, so main-process cwd resolution cannot rely on structured `ocrText` unless we preserve it explicitly.
- Codex sessions are cached by `sessionId`, so cwd changes mid-conversation need explicit session reset or thread recreation logic.

## Design Principles

- **User-visible, not magic**: show the inferred starting directory and confidence in the UI.
- **Structured signals over regex alone**: use OCR/title heuristics, but prefer explicit paths and real filesystem checks.
- **Least surprise**: if inference is weak, start somewhere broad but sensible and tell the user where.
- **Capability honesty**: do not imply a provider can edit files unless that provider is actually running in a write-capable mode.
- **Privacy by design**: do not silently leak absolute local paths to remote APIs unless the feature is enabled or clearly disclosed.

## Revised Settings Model

Replace the single `devRootPath` concept with a slightly richer model:

```ts
interface Settings {
  devRootPath: string
  extraAllowedRoots: string[]
  agentFilesystemMode: 'read-only' | 'workspace-write' | 'full-access'
  shareResolvedPathWithApiProviders: boolean
  showCwdBadgeInChat: boolean
}
```

### Setting Semantics

- `devRootPath`
  The user's main development folder. Still useful as the default search scope.

- `extraAllowedRoots`
  Optional extra roots for non-dev workflows such as Steam libraries, config folders, docs, or test sandboxes.

- `agentFilesystemMode`
  A global default that controls whether local agent backends are read-only or write-capable.

- `shareResolvedPathWithApiProviders`
  Controls whether absolute or redacted path context is included in OpenAI/Anthropic API prompts.

- `showCwdBadgeInChat`
  Toggles a small UI badge that shows the active starting directory and permission mode.

## New Runtime Concepts

Add a resolved execution context object in main:

```ts
interface ResolvedAgentContext {
  startingCwd: string
  source: 'explicit' | 'terminal' | 'file-path' | 'ide-title' | 'repo-match' | 'fallback'
  confidence: number
  allowedRoots: string[]
  filesystemMode: 'read-only' | 'workspace-write' | 'full-access'
  displayPath: string
  shareWithRemoteApi: boolean
}
```

This object should be computed once in the main process for each send action and then threaded through all providers.

## Safer Resolution Strategy

Create `src/main/resolveAgentContext.ts` instead of only `resolveProjectCwd.ts`.

```ts
export function resolveAgentContext(input: {
  messages: ChatMessage[]
  cwdHints?: CwdHints
  settings: SettingsData
}): ResolvedAgentContext
```

### Structured Input First

Do not rely on regex over flattened message text alone. Preserve structured hints from the renderer in the send payload:

```ts
interface CwdHints {
  activeWindowTitle?: string
  autoOcrText?: string
  manualOcrText?: string
  explicitUserPaths?: string[]
  lastResolvedCwd?: string
}
```

### Resolution Order

1. **Explicit user path**
   If the user typed a real absolute path in the chat, prefer it if it exists.

2. **Detected terminal cwd**
   Parse terminal prompts from OCR only when the extracted path exists on disk.

3. **Detected absolute file path**
   If OCR or message text contains a real file path, walk up to the nearest existing directory or repo root.

4. **IDE title or repo-name hint**
   Extract likely project names from the active window title, then match against indexed repo directories.

5. **Last confirmed cwd**
   Reuse the prior successful cwd for the current session when fresh inference is weak.

6. **Fallback**
   Use `devRootPath` if valid, then the user's home directory as a last resort.

### Repository Matching

Do not scan only immediate children of `devRootPath`.

Instead:

- recursively index candidate project roots under `devRootPath` up to a reasonable depth
- treat directories containing `.git`, `package.json`, `pyproject.toml`, `Cargo.toml`, or similar markers as strong candidates
- cache the index and refresh it opportunistically
- score exact basename matches higher than fuzzy matches
- prefer recently used directories when scores are otherwise close

## Trust and Guardrails

### UI Disclosure

Before or during each streamed response, show:

- current provider
- resolved start directory
- confidence level
- filesystem mode
- whether the directory is inside or outside approved roots

If the resolver chooses a path outside `devRootPath` and `extraAllowedRoots`, show a warning state such as:

`Outside approved roots`

and give the user one-click options:

- `Use once`
- `Add root`
- `Fall back to dev folder`

### Low-Confidence Handling

When confidence is below a threshold:

- keep the response running
- start in `lastResolvedCwd` or `devRootPath`
- inject a short system note telling the model the current path may be uncertain
- show the user that the path was inferred with low confidence

Do not auto-launch into an unrelated sensitive directory based on a weak OCR guess.

### Prompt Injection Resistance

Treat OCR as an untrusted hint, not a command.

- never allow OCR alone to widen permissions
- never let OCR force a path unless that path exists and passes normalization
- do not trust on-screen strings like "open C:\\secret" without filesystem validation and scoring against other signals

## Provider Capability Model

Add a provider capability layer instead of assuming all providers behave the same way.

### Codex App-Server

Current state:

- supports local execution context
- currently configured read-only

Required changes:

- thread `ResolvedAgentContext` into `thread/start` and `turn/start`
- map `agentFilesystemMode` to the appropriate sandbox policy
- recreate or reset the thread when `startingCwd` or `filesystemMode` changes materially

### Codex CLI Fallback

Current state:

- can start in a specific cwd via spawn options

Required changes:

- use `startingCwd` in spawn options
- pass explicit permission flags if supported by the CLI version in use
- annotate the UI if fallback capability differs from app-server capability

### Claude Code CLI

Current state:

- can start in a specific cwd via spawn options
- may have broader local capability than API-only providers

Required changes:

- use `startingCwd` in spawn options
- clearly label the active permission mode in the UI
- if Claude Code cannot be constrained in the same way as Codex, say so in settings copy instead of implying equal controls

### OpenAI and Anthropic APIs

Current state:

- no direct filesystem access

Required changes:

- do not speak as if cwd gives these providers real local access
- optionally inject a path hint into the system prompt
- default to redacted path context unless `shareResolvedPathWithApiProviders` is enabled

Example safe remote context:

```text
The user appears to be working in a local project named "omniox" under their development folder.
```

If sharing is enabled, the prompt may include the absolute path.

## Session Lifecycle Changes

The resolved cwd cannot be a one-time launch detail only.

For each chat session, track:

```ts
interface SessionRoutingState {
  lastResolvedCwd: string | null
  lastFilesystemMode: 'read-only' | 'workspace-write' | 'full-access' | null
}
```

### Recreate Session When Needed

Reset the local backend session when:

- the resolved cwd changes to a different repo or root
- filesystem mode changes
- the user explicitly chooses a new path from the UI

Do not silently keep using a stale thread that was created for a different project.

## Renderer and IPC Changes

### Renderer

Update the send path to preserve structured context:

- current active window title
- OCR text separately from user text
- any explicit absolute paths detected in the user's message
- last resolved cwd from store if available

Suggested payload shape:

```ts
sendAiMessage({
  sessionId,
  model,
  provider,
  messages,
  cwdHints: {
    activeWindowTitle,
    autoOcrText,
    manualOcrText,
    explicitUserPaths,
    lastResolvedCwd,
  },
})
```

### Main Process

In `ipc.ts`:

- resolve `ResolvedAgentContext` before invoking provider code
- persist the last successful cwd per session
- send cwd metadata back to the renderer on stream start or via a dedicated event

Suggested event:

```ts
'ai:session-context'
```

with:

```ts
{
  sessionId: string
  startingCwd: string
  displayPath: string
  confidence: number
  source: string
  filesystemMode: string
  insideAllowedRoots: boolean
}
```

## Settings UI Changes

Add a new section in the AI settings area:

- `Dev Folder`
- `Extra Allowed Roots`
- `Agent Filesystem Mode`
- `Share local path context with API providers`

### Filesystem Mode Copy

Use capability-accurate copy:

- `Read-only`
  Agents can inspect local files but should not edit them.

- `Workspace-write`
  Agents may edit files in the resolved working area and approved roots.

- `Full-access`
  Agents may edit anywhere they can reach locally. Use with care.

If a provider cannot fully honor the selected mode, surface that mismatch inline.

## Observability

Add logging for resolver outcomes:

- chosen path
- source signal
- confidence
- fallback reason
- provider used

Avoid logging raw OCR text. Log only summarized signal types and chosen paths.

This will make false positives much easier to debug without creating a privacy mess.

## Privacy Rules

- local providers may receive absolute paths as needed for execution
- remote API providers should receive redacted path context by default
- no raw OCR dumps should be added to logs
- if future telemetry is added, strip usernames from paths before sending

## Phased Rollout

### Phase 1: Correct Starting Directory

Goal:
Fix the obvious `process.cwd()` problem without introducing silent risky behavior.

Tasks:

1. Add `devRootPath`
2. Add folder picker support
3. Preserve structured cwd hints in the payload
4. Implement `resolveAgentContext()` with conservative fallback rules
5. Thread `startingCwd` through Claude CLI, Codex CLI fallback, and Codex app-server
6. Show the resolved cwd in chat UI

Exit criteria:

- local agents stop starting in the OmniCue app directory
- the chosen cwd is visible to the user
- weak inference falls back predictably

### Phase 2: Honest Permission Modes

Goal:
Make write capability explicit and correct.

Tasks:

1. Add `agentFilesystemMode` setting
2. Map that setting to each provider's actual controls
3. Keep Codex read-only by default
4. Add capability warnings when a provider cannot honor the selected mode

Exit criteria:

- UI no longer implies all local providers can edit equally
- Codex edit behavior matches the selected mode

### Phase 3: Better Matching and Session Routing

Goal:
Improve inference quality and avoid stale-thread routing bugs.

Tasks:

1. Index candidate repos under `devRootPath`
2. add scoring by path evidence, repo markers, and recency
3. track last resolved cwd per session
4. reset provider sessions when cwd changes materially

Exit criteria:

- project switching in one chat behaves correctly
- inference is more reliable for nested repos and monorepos

### Phase 4: Optional Wider Local Harness

Goal:
Support non-dev diagnostics without making them accidental.

Tasks:

1. Add `extraAllowedRoots`
2. Add UI for temporary one-shot roots
3. warn when launching outside approved roots
4. optionally allow users to pin a path manually for the current conversation

Exit criteria:

- non-dev tasks are possible
- leaving the dev area is intentional and visible

## File Plan

### New Files

- `src/main/resolveAgentContext.ts`

### Updated Files

- `src/renderer/src/lib/types.ts`
  Add new settings fields, payload fields, and session-context event typing.

- `src/main/store.ts`
  Persist new settings and defaults.

- `src/preload/index.ts`
  Expose folder selection, extra root selection, and session-context events.

- `src/main/ipc.ts`
  Add folder selection handlers, resolve agent context, and emit session-context metadata.

- `src/renderer/src/components/SettingsWindow.tsx`
  Add AI filesystem and root settings UI.

- `src/renderer/src/lib/sendMessage.ts`
  Preserve structured cwd hints in the outgoing payload.

- `src/renderer/src/stores/companionStore.ts`
  Track last resolved cwd and display metadata in the chat session.

- `src/main/ai.ts`
  Thread `ResolvedAgentContext` through all local and remote providers.

## Suggested Order of Implementation

1. Add settings and UI for `devRootPath` plus `shareResolvedPathWithApiProviders`
2. Add structured `cwdHints` to the renderer send path
3. Implement `resolveAgentContext.ts`
4. Thread `startingCwd` into all local backends
5. Emit and render session-context metadata in the chat UI
6. Add `agentFilesystemMode`
7. Update Codex and Claude paths to honor capability-specific permission behavior
8. Add session reset logic for cwd changes
9. Add repo indexing and smarter matching
10. Add `extraAllowedRoots` and out-of-root warnings

## Open Decisions

1. Should `workspace-write` mean "resolved cwd only" or "all approved roots"?
2. For remote API providers, should absolute path sharing be opt-in or simply redacted-by-default with no absolute option?
3. Should a low-confidence path outside approved roots require a click before launching a write-capable session?

## Recommendation

Build Phase 1 first and keep Codex read-only until the permission model is explicit in both code and UI.

That gets the harness materially better fast:

- agents start in the right place more often
- users can see what OmniCue inferred
- the architecture stays compatible with fuller local access later

without pretending the harness is safer or more capable than it really is.
