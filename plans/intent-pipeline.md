# Plan: Intent Resolution Pipeline

> Replace the brittle regex-plus-stub system with a 4-stage pipeline: pattern fast-path -> normalization -> referent grounding -> constrained semantic resolver.

## Problem

The current intent system in `src/main/intent/` has two stages:

1. **Regex patterns** -> hardcoded matches for exact phrasings
2. **LLM fallback** -> a stub that always returns `fallback: 'ask'`

This means any utterance that does not hit a regex just fails. The agent then has to manually discover and call the action API, resulting in a multi-step dance visible to the user. Common natural phrasing like `"pull it up in Explorer"` or `"show me the repo"` falls through because:

- Regex patterns are brittle and do not generalize.
- Anaphoric references like `"it"`, `"this"`, and `"that"` require grounding logic that does not exist.
- There is no normalization, so `"pull it up"`, `"show it"`, and `"open it"` become separate pattern problems.
- The fallback does nothing today.
- The current `/intent` and `intent:resolve` entry points do not carry `conversationId`, so the resolver cannot use the saved `resumeCapsule` even though session memory now exists.

## Design Goals

- **Latency**: Pattern fast-path stays under 5ms. Normalization plus grounding should stay under 10ms on typical local data. The LLM fallback is best-effort and should only fire when needed.
- **Safety**: The LLM resolver can only choose from registered actions. Auto-execution stays limited to safe tier. No new trust boundaries.
- **Testability**: Every stage has pure-function inputs and outputs where possible. A fixture set of 50-100 utterances validates the full pipeline.
- **Codebase fit**: Reuse OmniCue's existing provider and auth stack instead of adding a second AI client path just for intent resolution.
- **Graceful degradation**: The sync pipeline should solve most requests. The LLM path is a quality booster, not a dependency for common desktop commands.

## Architecture

```text
  utterance + DesktopSnapshot + optional ResumeCapsule
          |
          v
  +------------------------+
  | Stage 1: Fast Match    |  <5ms, sync
  | (patterns.ts)          |  Exact regex hits with confidence scoring
  |                        |  Returns ActionPlan if matched strongly
  +-----------+------------+
              | no strong match
              v
  +------------------------+
  | Stage 2: Normalize     |  <2ms, sync
  | (normalizer.ts)        |  Parse utterance into canonical NormalizedIntent
  |                        |  { verb, target, referent, destination }
  +-----------+------------+
              |
              v
  +------------------------+
  | Stage 3: Ground        |  <10ms target, sync
  | (grounder.ts)          |  Resolve referents ("it", "this") to concrete
  |                        |  paths/targets using snapshot + capsule
  |                        |  Returns ranked GroundedReferent[]
  +-----------+------------+
              |
              v
  +------------------------+
  | Stage 4: Plan          |  sync first, async only if needed
  | (planner.ts)           |  Rule-based planner first
  |                        |  Constrained LLM fallback second
  |                        |  Registered actions only
  +------------------------+
              |
              v
         ActionPlan
```

## Stage 1: Pattern Fast-Path

### File: `src/main/intent/patterns.ts` (edit)

Changes:

- Keep all existing patterns. They are still valuable for obvious exact hits.
- Add a `priority?: number` field to `IntentPattern` where lower means more specific or preferred.
- Allow all patterns to attempt a match, collect candidates, and return the strongest one.
- Keep this stage purely synchronous and side-effect free.

Updated `IntentPattern` type in `types.ts`:

```ts
export interface IntentPattern {
  id: string
  priority?: number
  patterns: RegExp[]
  resolve: (match: RegExpMatchArray, snapshot: DesktopSnapshot) => ActionPlan | null
}
```

Updated resolve flow:

```ts
export function matchPatterns(
  utterance: string,
  snapshot: DesktopSnapshot
): ActionPlan | null {
  const candidates: Array<ActionPlan & { patternId: string; priority: number }> = []

  for (const pattern of PATTERNS) {
    for (const regex of pattern.patterns) {
      const match = utterance.match(regex)
      if (!match) continue

      const plan = pattern.resolve(match, snapshot)
      if (plan) {
        candidates.push({
          ...plan,
          patternId: pattern.id,
          priority: pattern.priority ?? 50,
          confidence: plan.confidence ?? 1,
        })
      }
      break
    }
  }

  if (candidates.length === 0) return null

  candidates.sort(
    (a, b) => a.priority - b.priority || (b.confidence ?? 0) - (a.confidence ?? 0)
  )
  return candidates[0]
}
```

Implementation note:

- Pattern collection should still short-circuit once a pattern has one successful regex hit. The goal is "best candidate across patterns," not exhaustive regex evaluation inside every pattern.

## Stage 2: Normalization

### File: `src/main/intent/normalizer.ts` (create)

Parse the raw utterance into a canonical shape before any reasoning happens. This should be a pure function with no I/O.

```ts
export interface NormalizedIntent {
  verb: IntentVerb
  targetType: TargetType
  surfaceReferent?: string
  destination?: string
  raw: string
}

export type IntentVerb =
  | 'open'
  | 'search'
  | 'copy'
  | 'type'
  | 'press'
  | 'click'
  | 'switch'
  | 'save'
  | 'delete'
  | 'remind'
  | 'list'
  | 'unknown'

export type TargetType =
  | 'file'
  | 'folder'
  | 'url'
  | 'app'
  | 'search-query'
  | 'note'
  | 'keyboard-combo'
  | 'ui-element'
  | 'reminder'
  | 'explicit-path'
  | 'referent'
  | 'current-context'
  | 'unknown'
```

```ts
export function normalize(utterance: string): NormalizedIntent
```

Implementation approach:

- **Verb detection**: Map synonym groups to canonical verbs. `"pull up"` -> `open`, `"look up"` -> `search`, `"go to"` -> `switch`. Use a static synonym table rather than ad hoc logic scattered across patterns.
- **Path detection**: Scan for path-like tokens such as `C:\...`, `/home/...`, or `~/...`. If found, set `targetType = 'explicit-path'`.
- **URL detection**: Scan for `http://` or `https://` tokens and set `targetType = 'url'`.
- **Referent detection**: If the surface target is `"it"`, `"this"`, `"that"`, `"the repo"`, or `"the folder"`, set `targetType = 'referent'`.
- **Context detection**: Recognize phrases like `"this project"`, `"this file"`, `"current folder"`, and `"this page"` as `targetType = 'current-context'`.
- **Destination detection**: Scan for `"in Explorer"`, `"in Finder"`, `"in the browser"`, `"in terminal"`, and similar hints.
- **Keyboard combo detection**: Match patterns like `"ctrl+s"`, `"alt+tab"`, and `"enter"`.

This stage should stay deterministic and easy to unit test.

## Stage 3: Referent Grounding

### File: `src/main/intent/grounder.ts` (create)

Resolve `"it"`, `"this project"`, `"current file"`, and similar phrases to concrete values using the desktop snapshot and optionally the resume capsule.

```ts
export interface GroundedReferent {
  value: string
  source: ReferentSource
  confidence: number
  type: 'path' | 'url' | 'app' | 'query' | 'text'
}

export type ReferentSource =
  | 'explicit-path'
  | 'terminal-cwd'
  | 'editor-workspace'
  | 'editor-open-file'
  | 'browser-url'
  | 'browser-page-title'
  | 'file-explorer-path'
  | 'clipboard'
  | 'resume-capsule'
  | 'window-title'

export function groundReferent(
  intent: NormalizedIntent,
  snapshot: DesktopSnapshot,
  capsule?: ResumeCapsule
): GroundedReferent[]
```

Grounding rules by target type:

### `targetType === 'referent'`

Rank candidates by relevance to the verb and destination:

| Source | Confidence | Condition |
|---|---|---|
| terminal CWD | 0.9 | terminal is active app or clearly present in snapshot |
| editor workspace | 0.85 | IDE is active or clearly present in snapshot |
| editor open file | 0.8 | file-oriented request |
| file explorer path | 0.8 | file explorer is active |
| clipboard | 0.6 | clipboard looks like a valid path or useful query |
| resume capsule | 0.5 | capsule has a relevant target, penalized for staleness |
| window title | 0.3 | path-like substring can be extracted |

### `targetType === 'current-context'`

Use the same sources, but filtered by phrase intent:

- `"this project"` or `"this folder"` -> prefer workspace, cwd, explorer path
- `"this file"` or `"current file"` -> prefer editor open file
- `"this page"` or `"this site"` -> prefer browser URL or page title

### `targetType === 'explicit-path'`

Validate the path and ground it directly:

```ts
{
  value: intent.surfaceReferent!,
  source: 'explicit-path',
  confidence: existsSync(intent.surfaceReferent!) ? 1.0 : 0.7,
  type: 'path',
}
```

### Clipboard validation

Clipboard is useful but risky. Rules:

- Only use clipboard as a path if it looks like an absolute path and does not contain newlines.
- Only use clipboard as a search query when the verb is `search` or the phrase strongly implies copied text.
- Path-like clipboard values that exist on disk can score high. Non-existent ones should be heavily penalized.

### Resume capsule staleness

If using capsule data, penalize based on age:

- under 5 minutes old: no penalty
- 5 to 30 minutes: confidence x 0.8
- 30 minutes to 2 hours: confidence x 0.5
- over 2 hours: confidence x 0.2

If the live snapshot clearly disagrees with the capsule, apply an additional strong penalty rather than treating the capsule as equal to live context.

Implementation note:

- Keep disk checks cheap. Only call `existsSync` for explicit paths and at most the top 1-2 path-like clipboard or capsule candidates. Do not turn grounding into repeated filesystem probing on every request.

## Stage 4: Planning

### File: `src/main/intent/planner.ts` (create)

Map normalized and grounded intent into an `ActionPlan`.

### 4a: Rule-based planner

Use a lookup table from `(verb, targetType)` to `actionId`:

```ts
const VERB_TARGET_MAP: Record<string, string> = {
  'open:folder': 'reveal-in-folder',
  'open:file': 'open-file',
  'open:url': 'open-url',
  'open:app': 'switch-app',
  'open:explicit-path': 'reveal-in-folder',
  'search:search-query': 'search-web',
  'search:file': 'find-file',
  'copy:*': 'clipboard-write',
  'type:*': 'type-text',
  'press:keyboard-combo': 'press-key',
  'click:ui-element': 'click-element',
  'switch:app': 'switch-app',
  'save:note': 'save-note',
  'delete:file': 'delete-file',
  'remind:reminder': 'set-reminder',
  'list:note': 'list-notes',
  'list:app': 'list-running-apps',
}
```

If a rule match is found and the best grounded referent has confidence above the threshold:

- Build the `ActionPlan` immediately.
- Set `confidence` from the grounded referent.
- Set `needsConfirmation` from the action tier.

If no good rule match exists, fall through to the LLM step.

### 4b: Constrained semantic resolver

This replaces the stub in `llm-resolver.ts`. It should call the AI provider with a tightly constrained prompt and return structured JSON only.

Guardrails:

- Response must parse as JSON.
- `actionId` must exist in the registry.
- `params` must satisfy required params for that action.
- If validation fails, fall back to `{ fallback: 'ask' }`.
- The request must be timeout-bounded.

Provider strategy:

- Reuse OmniCue's existing provider and auth stack rather than adding a separate parallel resolver client.
- Add a small non-streaming helper in `src/main/ai.ts` or a focused sibling module like `src/main/intent/intent-ai.ts`.
- Prefer the cheapest or fastest available configured provider.
- Use the LLM path only after the sync planner fails.

Delivery note:

- Treat the LLM path as Phase 2 of this effort, not Phase 1. The sync normalizer plus grounder plus rule planner should land first and cover the majority of real requests before provider work is added.

Planner interface:

```ts
export async function planAction(
  intent: NormalizedIntent,
  referents: GroundedReferent[],
  snapshot: DesktopSnapshot,
  capsule?: ResumeCapsule
): Promise<ActionPlan>
```

## Updated Resolver

### File: `src/main/intent/resolver.ts` (rewrite)

```ts
export async function resolveIntent(
  utterance: string,
  snapshot: DesktopSnapshot,
  capsule?: ResumeCapsule
): Promise<ActionPlan> {
  const patternResult = matchPatterns(utterance, snapshot)
  if (patternResult && (patternResult.confidence ?? 0) >= 0.8) {
    return patternResult
  }

  const intent = normalize(utterance)
  const referents = groundReferent(intent, snapshot, capsule)
  return planAction(intent, referents, snapshot, capsule)
}
```

API plumbing changes needed:

- `POST /intent` should accept an optional `conversationId` and load `resumeCapsule` from the stored conversation before calling `resolveIntent(...)`.
- `ipcMain.handle('intent:resolve', ...)` should accept `{ utterance, conversationId? }` instead of a raw string so the renderer can opt into capsule-aware resolution.
- If no `conversationId` is provided, resolution should still work from the live snapshot alone.

## Testing

Before adding the suites below, add a lightweight Node test harness. The repo currently does not have a test runner configured, so this plan needs an explicit harness step rather than assuming `*.test.ts` files will run on their own.

### File: `src/main/intent/__tests__/pipeline.test.ts` (create)

Fixture format:

```ts
interface IntentFixture {
  utterance: string
  snapshot: Partial<DesktopSnapshot>
  capsule?: Partial<ResumeCapsule>
  expected: {
    actionId?: string
    params?: Record<string, unknown>
    needsConfirmation?: boolean
    fallback?: boolean
    resolvedBy?: 'pattern' | 'rule-planner' | 'llm'
  }
}
```

Fixture categories:

- File and folder operations
- Navigation
- Input operations
- Notes and reminders
- Ambiguous and edge cases

Add separate unit tests for:

- `normalizer.ts`
- `grounder.ts`
- rule-table behavior in `planner.ts`

## File Manifest

| File | Action | Purpose |
|---|---|---|
| `src/main/intent/types.ts` | Edit | Add `priority` to `IntentPattern`, add `NormalizedIntent` and `GroundedReferent` types |
| `src/main/intent/normalizer.ts` | Create | Utterance to canonical intent shape |
| `src/main/intent/grounder.ts` | Create | Referent resolution from snapshot plus capsule |
| `src/main/intent/planner.ts` | Create | Rule-based plus LLM action planning |
| `src/main/intent/patterns.ts` | Edit | Add priority field and best-candidate selection |
| `src/main/intent/resolver.ts` | Edit | Wire up the 4-stage pipeline |
| `src/main/intent/llm-resolver.ts` | Rewrite | Constrained single-shot LLM call |
| `src/main/ai.ts` or `src/main/intent/intent-ai.ts` | Edit or create | Reusable non-streaming provider helper |
| `src/main/intent/__tests__/pipeline.test.ts` | Create | Fixture-based integration tests |
| `src/main/intent/__tests__/normalizer.test.ts` | Create | Unit tests for normalization |
| `src/main/intent/__tests__/grounder.test.ts` | Create | Unit tests for grounding |
| `package.json` | Edit | Add test script and test runner wiring |
| `src/main/server.ts` | Edit | Pass resume capsule to `resolveIntent` |
| `src/main/ipc.ts` | Edit | Pass resume capsule to `resolveIntent` |

## Implementation Order

```text
Phase 0: Harness + API plumbing
  1. Add a lightweight Node test runner and package scripts
  2. Update /intent and intent:resolve to optionally accept conversationId
  3. Load resumeCapsule from stored conversations at those entry points

Phase 1: Types + Normalizer
  4. Update types.ts with NormalizedIntent, GroundedReferent, priority
  5. Create normalizer.ts
  6. Create normalizer tests

Phase 2: Grounder
  7. Create grounder.ts
  8. Create grounder tests

Phase 3: Rule Planner + Integration
  9. Create planner.ts rule table
  10. Update patterns.ts with priority + best-candidate selection
  11. Rewrite resolver.ts to use pattern -> normalize -> ground -> rule-plan
  12. Create pipeline fixture suite and tune until common requests resolve without LLM

Phase 4: Optional LLM Fallback
  13. Add a non-streaming provider helper that reuses existing auth/provider selection
  14. Rewrite llm-resolver.ts as a constrained single-shot call
  15. Wire planner.ts to use rule table first, LLM second

Phase 5: Tuning
  16. Run fixture suite, identify misses
  17. Add patterns or normalizer rules for common misses
  18. Tune grounding thresholds and LLM fallback thresholds
```

## Latency Budget

| Stage | Budget | Mechanism |
|---|---|---|
| Pattern match | <5ms | Sync regex scan |
| Normalize | <2ms | Sync string analysis |
| Ground | <10ms target | Sync snapshot lookup plus limited `existsSync` |
| Plan (rule) | <1ms | Sync table lookup |
| Plan (LLM) | best-effort | Single-shot API call with bounded timeout |
| Total fast path | <20ms target | Pattern match or rule planner resolves |
| Total LLM path | variable | Only for genuinely ambiguous cases |

For the original `"pull it up in Explorer"` scenario, this should resolve via normalization (`verb: open`, `targetType: referent`, `destination: explorer`) plus grounding (terminal CWD as top candidate) plus the rule planner (`open:folder` -> `reveal-in-folder`) without needing the LLM path.
