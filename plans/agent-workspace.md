# Agent Workspace: Persistent Home for Agent Artifacts

## Goal

Give OmniCue a visible, user-owned area for agent-created artifacts, starting with notes.

This should:

- move note storage out of hidden app data and into a user-visible folder
- keep writes safely sandboxed away from the OmniCue app install and unrelated filesystem locations
- let the companion UI browse saved notes
- let shell-capable providers recall notes through the existing local HTTP/action surface

This should not try to become a full general-purpose writable filesystem for the agent in the first pass.

## Important Revisions to the Original Draft

The original direction is good, but a few pieces needed tightening:

- `workspacePath` is an overloaded name in this codebase because OmniCue already has `workspace-write` permissions and cwd logic for coding harnesses; use a clearer setting name such as `agentWorkspacePath`
- `resolved.startsWith(root)` is not a sufficient sandbox check on Windows because of case sensitivity and prefix collisions like `C:\\Users\\me\\OmniCue2`
- the draft says the workspace path is configurable via settings, but it does not include the renderer/settings UI changes needed to actually configure it
- `server.ts` and the action API already exist; note access should fit into those current surfaces instead of inventing a parallel shape
- the current plan mixes a future generic workspace with a concrete note feature; Phase 1 should stay note-first

## Scope

### Phase 1

Ship:

- visible markdown note storage under a user-owned root
- safe note CRUD in the main process
- notes list/read/delete in the companion UI
- local HTTP read endpoints for note recall
- action support for `save-note`, `list-notes`, `get-note`, `delete-note`

Do not ship yet:

- arbitrary file creation throughout `workspace/` or `skills/`
- generic "write any subpath" APIs
- exposing broad writable workspace semantics to the agent

### Phase 2

After the note flow is solid, extend the same root to support additional artifact types such as research files or agent scratch output.

## Workspace Root

Use a visible default root under the user home directory:

```text
~/OmniCue/
  notes/
  workspace/
  skills/
```

Implementation note:

- compute this with `app.getPath('home')`, not a hardcoded Windows path

Recommended setting name:

- `agentWorkspacePath`

Reason:

- avoids confusion with the existing coding-agent "workspace-write" permission model and cwd selection logic

Create directories lazily on first note save or first explicit note list/read if needed.

## Sandboxing

All workspace note operations should go through one main-process module, but the first pass should remain note-specific rather than fully generic.

Create:

- `src/main/workspace-notes.ts`

### Safe path resolution

Do not use this:

```ts
resolved.startsWith(root)
```

Use `path.relative()` against a normalized root instead:

```ts
function isWithinRoot(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate)
  return relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
}
```

For operations that intentionally target the root directory itself, allow equality explicitly.

Also:

- normalize both root and candidate first
- on Windows, compare normalized absolute paths consistently

### Note identity

Do not let note filenames be derived from arbitrary user strings.

Use:

- generated `id` for the filename
- sanitized display `title` only inside frontmatter/content

That means the draft's traversal test using title `../../evil` is not the right verification case. The delete/read path should validate note ID and map it to a safe filename under `notes/`.

## Storage Format

Markdown with YAML frontmatter is a good fit.

Example:

```md
---
id: mntwh2ilmyun
title: "Read later: Artemis II splashdown article"
source: cnn.com
savedFrom: Google Chrome
created: 2026-04-11T01:14:27.069Z
---

CNN Science article to revisit later.
Artemis II astronauts splash down off California's coast...
```

Recommended parsed type:

```ts
interface Note {
  id: string
  title: string
  content: string
  savedFrom?: string
  source?: string
  createdAt: number
  updatedAt?: number
}
```

Keep the first pass tolerant:

- if frontmatter is malformed, skip that file in list views rather than crashing
- if content is missing, treat it as an empty string

## Main-Process Note Module

Create:

- `src/main/workspace-notes.ts`

Suggested API:

- `getAgentWorkspaceRoot(): string`
- `getNotesDir(): string`
- `ensureNotesDir(): void`
- `listNotes(): NoteSummary[]`
- `getNote(id: string): Note | null`
- `saveNote(params): { ok: boolean; id?: string; error?: string }`
- `deleteNote(id: string): { ok: boolean; error?: string }`

Use note-specific helpers first. A fully generic `resolveWorkspacePath(subpath)` can wait until we truly support multiple artifact types.

## Actions

Update:

- `src/main/actions/safe.ts`
- `src/main/actions/registry.ts`

### Keep `save-note`

Preserve the existing action ID and params:

- `save-note(text, title?)`

But change the implementation to write markdown under the visible notes directory.

### Add note actions

Add:

- `list-notes`
- `get-note`
- `delete-note`

These belong in the safe tier because they only read or delete within the agent workspace notes directory.

Suggested params:

- `get-note(id)`
- `delete-note(id)`

Avoid path-based params here. Use note IDs only.

## HTTP API

Fit this into the existing local-only HTTP server in `src/main/server.ts`.

### Recommended endpoints

- `GET /notes`
- `GET /notes?id=<id>`

For deletion, prefer staying consistent with the existing action model:

- use `POST /action` with `actionId=delete-note`

Do not add both `DELETE /notes/:id` and `POST /action` for the same operation in Phase 1. The original draft was inconsistent there.

Keep note endpoints local-only with `localJson(...)`, not public CORS responses.

## IPC and Preload

Add note-specific IPC:

- `notes:list`
- `notes:get`
- `notes:delete`

And matching preload methods:

- `listNotes()`
- `getNote(id)`
- `deleteNote(id)`

This is for the companion UI. Do not route note browsing through the generic action IPC when a simple typed IPC is clearer.

## Settings

If the workspace root is truly configurable, the plan must include the settings surface.

Required updates:

- `src/main/store.ts` - add `agentWorkspacePath`
- `src/renderer/src/lib/types.ts` - add `agentWorkspacePath` to `Settings`
- `src/renderer/src/lib/constants.ts` if mirrored defaults live there
- `src/renderer/src/components/SettingsWindow.tsx` - add folder picker UI

If you do not want to expose the setting yet, then do not call it configurable in the plan. In that case, keep the root fixed at `~/OmniCue` for Phase 1.

## UI

Create:

- `src/renderer/src/components/NotesList.tsx`

Use the current `ConversationList` pattern as a visual/reference model, but wire it into the existing companion state rather than describing a hypothetical panel structure.

### Store changes

Update `src/renderer/src/stores/companionStore.ts` with:

- `showNotesList: boolean`
- `toggleNotesList()`

Also ensure the notes list and conversation list are mutually exclusive.

### Companion panel behavior

Update `src/renderer/src/components/CompanionPanel.tsx` so the main body routes by view state:

1. `showNotesList`
2. `showConversationList`
3. default messages view

Keep the input visible if that still feels right in the UI, but do not show Quick Actions while a list view is active.

### Notes list behavior

Show:

- title
- source or saved-from app
- relative time

Allow:

- click to expand/read note inline
- delete

Rename is optional in Phase 1. If note titles are editable later, add a dedicated rename action then.

## Prompt Strategy

The current `DESKTOP_TOOLS_PROMPT` in `src/main/ai.ts` is already doing a lot. Keep additions compact.

Do not add a large new "workspace docs" block with repeated PowerShell examples. The action API is already documented there.

Instead, add a short note-oriented extension, for example:

```text
### Agent notes
OmniCue stores notes as markdown under ~/OmniCue/notes.

- `curl.exe -s http://127.0.0.1:19191/notes` - list saved notes
- `curl.exe -s "http://127.0.0.1:19191/notes?id=<id>"` - read a note

You can also use actions: `save-note`, `list-notes`, `get-note`, `delete-note`.
```

That is enough. No need to duplicate full `Invoke-RestMethod` examples again.

## Files to Create

- `src/main/workspace-notes.ts`
- `src/renderer/src/components/NotesList.tsx`

## Files to Modify

- `src/main/actions/safe.ts`
- `src/main/actions/registry.ts`
- `src/main/server.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/lib/types.ts`
- `src/renderer/src/stores/companionStore.ts`
- `src/renderer/src/components/CompanionPanel.tsx`

If configurable path is exposed in Phase 1, also modify:

- `src/main/store.ts`
- `src/renderer/src/components/SettingsWindow.tsx`
- any mirrored renderer settings defaults/types file

## Implementation Order

1. Build `src/main/workspace-notes.ts` with safe path resolution and markdown note CRUD
2. Repoint `save-note` and add `list-notes` / `get-note` / `delete-note`
3. Add local-only `/notes` HTTP reads
4. Add note IPC and preload bridge methods
5. Add note types to renderer
6. Add `showNotesList` state to companion store
7. Build `NotesList.tsx`
8. Wire notes view into `CompanionPanel.tsx`
9. Add the short note recall section to `DESKTOP_TOOLS_PROMPT`
10. If desired, add configurable workspace root in settings as a separate final step

## Verification

1. `npm run build` or `npm run typecheck` succeeds
2. Calling `save-note` writes `~/OmniCue/notes/<id>.md`
3. `GET /notes` returns saved notes
4. `GET /notes?id=<id>` returns the full note
5. `delete-note` removes the correct file and cannot target paths outside the notes directory
6. Malformed `.md` files in the notes folder do not crash listing
7. The companion notes view opens, lists notes, expands a note, and deletes one
8. Asking a shell-capable provider "what notes do I have saved?" leads it toward `/notes` or the note actions

## Out of Scope

- general arbitrary-file workspace writes
- skill storage or automation storage
- exposing the full workspace as a coding-agent cwd or writable root
- note rename unless we decide it is needed after basic note browse/delete works
