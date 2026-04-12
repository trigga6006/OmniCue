# Permissions Dropdown Plan

## Goal

Add a clear permissions dropdown to OmniCue so the user can choose how much local filesystem power an agent session gets, and make that choice visible, truthful, and provider-aware.

This plan is intentionally narrower than the broader smart-cwd plan. It focuses on:

- a UI control for local agent permissions
- plumbing that setting through the existing provider pipeline
- honest capability handling for Codex, Claude Code, and API-only providers

## Current State

As of this branch:

- OmniCue has a `Dev folder` setting in [src/renderer/src/components/SettingsWindow.tsx](C:/Users/fowle/Documents/dev/omniox/src/renderer/src/components/SettingsWindow.tsx)
- working directory resolution is already threaded through the main AI pipeline
- Codex app-server is still hardcoded read-only in [src/main/ai.ts](C:/Users/fowle/Documents/dev/omniox/src/main/ai.ts)
- Claude Code is launched through the CLI path with its existing behavior
- OpenAI and Anthropic API providers do not have real filesystem access at all

So the missing piece is not just UI. The app also needs a single settings model and provider-specific mapping layer for permissions.

## Recommendation

Use these three permission modes:

1. `Read-only`
2. `Workspace-write`
3. `Full-access`

Do not add a `Write-only` option. It is not a sensible operating mode for local coding agents because inspection is a prerequisite for safe edits and diagnostics.

## Desired User Experience

In Settings → AI, add a new row labeled:

`Agent permissions`

The control should be a dropdown with:

- `Read-only`
- `Workspace-write`
- `Full-access`

Under the dropdown, show a short description that updates with the selection.

Example copy:

- `Read-only`: Agents can inspect files but should not modify them.
- `Workspace-write`: Agents can inspect files and edit within the resolved working area.
- `Full-access`: Agents can inspect and edit any reachable local files. Use with care.

Also show provider capability notes immediately below the control:

- `Codex app-server currently honors this setting directly`
- `Claude Code may not support the same restriction model exactly`
- `OpenAI / Anthropic API providers do not get local filesystem access`

## Settings Model

Add a new settings field:

```ts
agentPermissions: 'read-only' | 'workspace-write' | 'full-access'
```

### Files to Update

- `src/main/store.ts`
- `src/renderer/src/lib/types.ts`
- `src/renderer/src/lib/constants.ts`

### Default

Default to:

```ts
agentPermissions: 'read-only'
```

That keeps the current behavior safe and non-breaking.

## UI Plan

### Settings Window

Add the dropdown in the AI section of [src/renderer/src/components/SettingsWindow.tsx](C:/Users/fowle/Documents/dev/omniox/src/renderer/src/components/SettingsWindow.tsx), not the general settings section.

This keeps:

- project-root configuration near general app behavior
- agent capability configuration near provider settings

### Suggested Layout

Inside the existing AI tab:

- keep provider picker first
- keep provider auth/config rows next
- add a new subsection or row group:
  - `Agent permissions`
  - optional helper text
  - inline provider caveat text

### Control Style

Use the same visual language as the rest of the settings window:

- dark translucent background
- compact control
- no browser-default ugly select if a custom segmented or styled select is already available

If no reusable select exists, a native `<select>` with project-consistent styling is acceptable.

## Runtime Model

Introduce a small shared runtime type in the main process:

```ts
type AgentPermissions = 'read-only' | 'workspace-write' | 'full-access'
```

Thread that setting from:

1. `settingsStore.get()`
2. `ipc.ts`
3. `streamAiResponse(...)`
4. provider-specific launch functions

## Provider Mapping

The key rule is:

The UI must describe what each provider can actually do, not what we wish it did.

### Codex App-Server

Current state:

- starts with a resolved cwd
- currently uses read-only sandbox settings

Implementation target:

- map the dropdown to Codex app-server sandbox policy

Suggested mapping:

#### `read-only`

Keep the current behavior:

```ts
sandboxPolicy: {
  type: 'readOnly',
  access: { type: 'fullAccess' },
  networkAccess: false,
}
```

#### `workspace-write`

Preferred behavior:

- writable within the resolved working directory
- readable as needed within that same working area

If Codex app-server supports a workspace-scoped write mode, use it directly.

If it does not support true workspace scoping, then do not silently treat this as full access. Instead:

- either fall back to `read-only`, or
- show a warning in the UI and in logs that the selected mode is only partially supported

#### `full-access`

Use the most permissive Codex mode the app-server supports.

Only do this when the user explicitly selected it.

### Codex CLI Fallback

Current state:

- launched via spawn
- already uses resolved cwd

Implementation target:

- pass equivalent permission flags if the installed Codex CLI supports them
- if CLI fallback cannot honor the selected mode, surface that mismatch clearly

Do not assume CLI parity with app-server without checking the actual supported flags in this codebase’s target environment.

### Claude Code CLI

Current state:

- launched via spawn with resolved cwd
- local behavior is shaped by the Claude CLI itself

Implementation target:

- if Claude CLI supports matching permission flags, wire them through
- if it does not, keep behavior as-is but show a capability note in the UI

Important:

Do not label Claude as fully constrained if OmniCue cannot actually enforce the selected mode on Claude.

### OpenAI and Anthropic APIs

These providers do not have local filesystem access.

Implementation target:

- ignore `agentPermissions` for actual filesystem behavior
- optionally mention this in provider helper text
- do not imply that `full-access` means anything for API-only providers

## Session Lifecycle Rules

Permission changes should not be treated as cosmetic.

When `agentPermissions` changes:

- current local backend sessions should be reset or recreated
- the next turn should start with the new permission level

This matters most for Codex app-server, where a thread/session can otherwise outlive its original launch assumptions.

### Suggested Behavior

When the user changes permissions in settings:

- persist the setting immediately
- do not kill in-flight streams
- invalidate the next local backend session startup so the next turn uses the new mode

If there is already a helper for `cleanupAiSession`, reuse it rather than inventing a second lifecycle path.

## Companion UI Visibility

Add a small session badge or metadata line in the companion panel showing:

- provider
- cwd
- permission mode

Example:

`Codex • omniox • Read-only`

This is not required for the first implementation pass, but it is strongly recommended. A dropdown hidden in settings is much less trustworthy than visible session state.

## Error and Warning Behavior

When the user selects a permission mode a provider cannot honor exactly:

- keep the session usable
- display a concise warning
- log the downgrade

Examples:

- `Claude Code may not be restricted to workspace-only edits by OmniCue`
- `Codex CLI fallback does not support workspace-write; using read-only`

Do not fail silently, and do not silently upgrade to broader permissions than the user asked for.

## Files Likely to Change

- `src/main/store.ts`
  Add persisted setting and default.

- `src/renderer/src/lib/types.ts`
  Add new `Settings` field and shared type.

- `src/renderer/src/lib/constants.ts`
  Add default client-side setting.

- `src/renderer/src/components/SettingsWindow.tsx`
  Add dropdown plus helper text.

- `src/main/ipc.ts`
  Load permission setting and pass it into `streamAiResponse`.

- `src/main/ai.ts`
  Add provider mapping logic for permission mode.

- `src/renderer/src/stores/companionStore.ts`
  Optional, if showing session permission metadata in chat.

- `src/renderer/src/components/CompanionPanel.tsx`
  Optional, if showing session permission badge.

## Implementation Steps

1. Add `agentPermissions` to the shared settings model and defaults.
2. Add the dropdown UI in the AI settings section.
3. Thread the selected permission mode through the main AI pipeline.
4. Implement Codex app-server mapping first.
5. Implement Codex CLI fallback mapping if supported.
6. Implement Claude CLI mapping if supported.
7. Add provider-specific downgrade/warning behavior.
8. Reset or recreate local backend sessions when permission mode changes.
9. Optionally add session visibility in the companion panel.

## Acceptance Criteria

The implementation is done when all of the following are true:

- the user can select a permission mode in the UI
- the selected mode persists across app restarts
- Codex app-server no longer stays hardcoded read-only regardless of settings
- local sessions restart or reinitialize when permission mode changes
- unsupported provider cases are disclosed clearly
- API-only providers are not falsely described as having local filesystem power

## Open Questions for Review

1. What exact sandbox values does the installed Codex app-server support for writable modes?
2. Does the Codex CLI fallback expose equivalent permission flags in the target environment?
3. Does Claude Code CLI expose any enforceable permission model, or does OmniCue need to present it as “best effort / provider-managed”?
4. Should `Workspace-write` mean only the resolved cwd, or the resolved cwd plus the configured dev root?

## Recommendation for Opus Review

Review this plan with special attention to one thing:

the provider capability mapping should be confirmed before implementation starts, especially for Codex writable modes and Claude CLI enforcement.

Everything else is straightforward UI-and-plumbing work, but that part determines whether the dropdown is trustworthy or just decorative.
