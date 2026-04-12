# Plan: Natural-Language OS Navigation

> "Take me to startup apps" should just work.

## Goal

Teach OmniCue to map natural-language navigation requests to real OS destinations:

- settings pages
- system utilities
- special folders

Examples:

- "Open Bluetooth settings"
- "Take me to startup apps"
- "Show me downloads"
- "Open Device Manager"
- "Open Task Manager"

This should feel broad and useful without turning the intent system into a pile of one-off regexes.

## Current State

Today there are only a few hardcoded OS commands in [ipc.ts](/C:/Users/fowle/Documents/dev/omniox/src/main/ipc.ts), exposed through `os:run-system-command` and `osRunSystemCommand`. The intent/action system has no real vocabulary for system locations, so navigation requests either fail or need ad hoc handling.

The good news is the right primitives already exist:

- intent pipeline
- safe-tier actions
- local-only HTTP and IPC surfaces
- LLM fallback constrained by the action registry

## Key Revisions

This revised plan keeps the feature, but tightens a few parts so it lands cleanly:

1. Use a **single `system-location` target type**, not three separate ones.
   The action is the same whether the destination is settings, a utility, or a special folder. The catalog entry category can carry the distinction without bloating the intent types and planner table.

2. Use a **structured launch spec**, not raw command strings.
   Safe-tier launch behavior should not depend on parsing arbitrary strings like `taskmgr`, `firewall.cpl`, `%APPDATA%`, or `shell:Startup`. Each entry should declare a launch kind explicitly.

3. Keep **navigation** separate from **analysis** and **toggles**.
   `Find the biggest files in this folder` is useful, but it is not navigation. `Turn on do not disturb` is a state change, not navigation. Both are good follow-ups, but they should not be core to Phase 1.

4. Add a **confidence gate** before auto-executing safe navigation.
   Because safe-tier actions auto-run, fuzzy matches need stricter thresholds than generic planner fallbacks. Opening the wrong settings page is still a bad experience.

5. Do not remove old IPC helpers until migration is complete.
   `osRunSystemCommand` should stay until the new action-based path fully covers current callers and the renderer surface is updated.

## Architecture

### New module

```text
src/main/navigation/
  catalog.ts     # system location catalog
  lookup.ts      # exact/prefix/fuzzy lookup
  launcher.ts    # safe structured launch execution
  index.ts       # exports
```

### Catalog shape

Use structured launch specs instead of freeform strings:

```ts
export type NavCategory =
  | 'settings'
  | 'utility'
  | 'folder'
  | 'control-panel'

export type LaunchSpec =
  | { kind: 'uri'; target: string }
  | { kind: 'path'; target: string }
  | { kind: 'shell-folder'; target: string }
  | { kind: 'command'; command: string; args?: string[] }
  | { kind: 'app'; name: string }

export interface NavEntry {
  id: string
  aliases: string[]
  category: NavCategory
  description: string
  win32?: LaunchSpec
  darwin?: LaunchSpec
  linux?: LaunchSpec
}
```

Why this is better:

- no shell-string guessing
- easier validation
- clearer safe execution logic
- less quoting/escaping risk

## Catalog Scope

Phase 1 should target Windows first, with macOS entries only where they are confidently known and tested.

### Windows core coverage

- `ms-settings:` pages
- MMC snap-ins like `devmgmt.msc`, `diskmgmt.msc`, `services.msc`
- control panel items like `firewall.cpl`
- shell folders like `shell:RecycleBinFolder`, `shell:Startup`
- user folders like Downloads, Desktop, Documents, AppData
- core utilities like Task Manager, Calculator, Snipping Tool, Explorer

### macOS scope

Best-effort equivalents are fine, but only include entries that are validated on current macOS behavior. Do not overcommit to older `.prefPane` paths without verifying they still work.

## Examples of Catalog Entries

```ts
{
  id: 'bluetooth',
  aliases: ['bluetooth', 'bluetooth settings', 'pair device'],
  category: 'settings',
  description: 'Bluetooth settings',
  win32: { kind: 'uri', target: 'ms-settings:bluetooth' },
}

{
  id: 'startup-apps',
  aliases: ['startup apps', 'startup programs', 'apps that run at startup', 'login items'],
  category: 'settings',
  description: 'Apps that launch when you sign in',
  win32: { kind: 'uri', target: 'ms-settings:startupapps' },
}

{
  id: 'device-manager',
  aliases: ['device manager', 'drivers', 'hardware manager'],
  category: 'utility',
  description: 'Device Manager',
  win32: { kind: 'command', command: 'devmgmt.msc' },
}

{
  id: 'downloads',
  aliases: ['downloads', 'download folder', 'my downloads'],
  category: 'folder',
  description: 'Downloads folder',
  win32: { kind: 'path', target: '%USERPROFILE%\\Downloads' },
}
```

## Lookup Design

### New file

`src/main/navigation/lookup.ts`

### API

```ts
export interface LookupResult {
  entry: NavEntry
  confidence: number
  matchedAlias: string
  matchType: 'exact' | 'prefix' | 'token'
}

export function lookupNavigation(query: string): LookupResult | null
```

### Matching strategy

1. Exact alias match: `1.0`
2. Strong normalized match or prefix match: `0.9`
3. Token overlap / lightweight fuzzy score: `0.7-0.89`

### Important confidence rule

- `>= 0.85`: safe to auto-plan for `open-system-location`
- `0.70 - 0.84`: do not auto-execute directly; prefer ask/LLM clarification behavior
- `< 0.70`: no match

This matters because the server currently auto-executes safe-tier plans.

## Action Design

### New safe action

Add to [registry.ts](/C:/Users/fowle/Documents/dev/omniox/src/main/actions/registry.ts):

```ts
{
  id: 'open-system-location',
  name: 'Open system location',
  tier: 'safe',
  category: 'navigation',
  description: 'Open a system settings page, utility, or special folder by catalog ID',
  params: [
    { name: 'locationId', type: 'string', required: true, description: 'Navigation catalog ID' },
  ],
}
```

### Safe handler

Add handler to [safe.ts](/C:/Users/fowle/Documents/dev/omniox/src/main/actions/safe.ts):

```ts
'open-system-location': async (params) => {
  const locationId = String(params.locationId ?? '').trim()
  if (!locationId) return fail('open-system-location', T, 'locationId is required')

  const entry = getNavEntry(locationId)
  if (!entry) return fail('open-system-location', T, `Unknown location: ${locationId}`)

  const result = await launchSystemLocation(entry)
  return result.ok
    ? ok('open-system-location', T, `Opened ${entry.description}`)
    : fail('open-system-location', T, result.error || `Failed to open ${entry.description}`)
}
```

### Launcher responsibilities

`launcher.ts` should:

- resolve the correct platform spec
- expand env vars for `path`
- use `shell.openExternal` for `uri`
- use `shell.openPath` for `path`
- use explicit spawn/execFile logic for `command` or `app`
- use Windows-specific Explorer invocation for `shell-folder`

It should not accept arbitrary strings from callers.

## Intent Integration

### Simplify intent types

In [types.ts](/C:/Users/fowle/Documents/dev/omniox/src/main/intent/types.ts), add:

```ts
type TargetType =
  | ...
  | 'system-location'
```

No need for separate `system-setting`, `system-utility`, and `special-folder` types.

### Normalizer

In [normalizer.ts](/C:/Users/fowle/Documents/dev/omniox/src/main/intent/normalizer.ts):

- keep `open` as the main verb
- optionally add `navigate` only if it meaningfully improves clarity
- detect known location phrases early and normalize them to:

```ts
{
  verb: 'open',
  targetType: 'system-location',
  surfaceReferent: 'startup apps',
}
```

This keeps the planner small.

### Planner

In [planner.ts](/C:/Users/fowle/Documents/dev/omniox/src/main/intent/planner.ts), add:

```ts
'open:system-location': 'open-system-location'
```

And a param builder branch:

```ts
case 'open-system-location': {
  const query = intent.surfaceReferent
  if (!query) return null
  const result = lookupNavigation(query)
  if (!result || result.confidence < 0.85) return null
  return { locationId: result.entry.id }
}
```

This makes planner behavior consistent with the auto-execution safety threshold.

### Patterns

Add a focused high-priority pattern in [patterns.ts](/C:/Users/fowle/Documents/dev/omniox/src/main/intent/patterns.ts), but keep it narrower than the original draft.

Good pattern families:

- `open/show/go to/take me to <location>`
- `where is <location>`
- `open <location> settings`

Avoid one broad pattern that captures all `turn on/turn off/enable/disable` phrasing. Those are not the same class of request.

### LLM fallback

In [llm-resolver.ts](/C:/Users/fowle/Documents/dev/omniox/src/main/intent/llm-resolver.ts), include a compact catalog summary when `open-system-location` is in the registry.

That should expose:

- ID
- category
- a short list of primary aliases

No need to dump the entire full catalog verbatim.

## Migration Plan

Keep the old path during rollout:

### Phase 1

- add navigation catalog
- add lookup
- add launcher
- add `open-system-location`
- wire intent pipeline

### Phase 2

- migrate any renderer or companion callers from `osRunSystemCommand`
- verify all five existing commands are covered through the new action

### Phase 3

- remove `SYSTEM_COMMANDS`
- remove `os:run-system-command`
- remove `osRunSystemCommand` from preload/types if nothing still uses it

This is safer than deleting the old path immediately.

## Out of Core Scope

These are good follow-ups, but should not be part of the first navigation landing:

### 1. Folder analysis

`Find the biggest files in this folder` is useful, but it is an analysis feature, not navigation.

If you want it, make it a separate safe action like:

- `analyze-folder`

That can live in a follow-up plan.

### 2. Direct toggles

`Turn on do not disturb` is a state-changing action.

Phase 1 behavior can be:

- resolve to the relevant settings page or focus mode page

If you later want a real toggle, that should be a separate guided action such as:

- `toggle-system-setting`

and it should not be safe-tier.

### 3. Knowledge questions

`Where does this app save exports?` is not navigation.

That should stay an AI question, optionally enriched by:

- active app context
- known export-path hints for common apps
- file-search helpers

## Files

### New

- `src/main/navigation/catalog.ts`
- `src/main/navigation/lookup.ts`
- `src/main/navigation/launcher.ts`
- `src/main/navigation/index.ts`

### Edited

- `src/main/actions/registry.ts`
- `src/main/actions/safe.ts`
- `src/main/intent/patterns.ts`
- `src/main/intent/types.ts`
- `src/main/intent/normalizer.ts`
- `src/main/intent/planner.ts`
- `src/main/intent/llm-resolver.ts`
- optionally later: `src/main/ipc.ts`
- optionally later: `src/preload/index.ts`
- optionally later: `src/renderer/src/lib/types.ts`

## Execution Order

1. Catalog + structured launcher
2. Lookup with confidence thresholds
3. `open-system-location` action
4. Intent pipeline integration
5. LLM context update
6. Manual validation of core locations
7. Only then migrate/remove old IPC command path

## Testing

Add at least:

- exact match tests
- prefix match tests
- fuzzy match threshold tests
- launcher tests by `LaunchSpec.kind`
- intent pipeline tests for representative utterances

Manual smoke tests should include:

- Bluetooth
- Startup apps
- Downloads
- Device Manager
- Task Manager
- Recycle Bin
- AppData

And one negative case:

- ambiguous phrase should ask/fallback instead of opening the wrong location

## Summary

The feature is a strong fit for OmniCue. The main thing the original draft needed was a tighter boundary:

- one structured catalog
- one safe action
- one `system-location` target type
- strict confidence gating
- migration before deletion

That should give you the “computer friction collapse” effect you want without making the intent system brittle or the safe tier too permissive.
