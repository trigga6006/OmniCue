# Interactive Agent Requests UI (Revised)

## Goal

Support interactive mid-session requests from **Codex** and **Claude Code** in the companion panel when the active permission mode allows it, including:

- command/file approvals
- multiple-choice questions
- multi-question forms
- freeform follow-up input
- provider-specific prompts that do not fit the above exactly

The design should be **generic and extensible**, so we do not have to redesign the UI every time a provider adds a new request type.

## Main Corrections From The Original Plan

1. **Do not model this as “approve/deny cards only.”**
   The original plan was too narrow for the stated goal. We need a unified interaction model that can represent approvals, choices, and arbitrary user-input requests.

2. **Do not guess Codex protocol methods.**
   Codex already exposes concrete request types for approvals and user-input. The implementation should use those real request/response shapes, not guessed notification names.

3. **Do not answer server requests by sending a new RPC method.**
   Codex approval and user-input flows are JSON-RPC server requests with request ids. The client must respond to the original request id, not invent a new `approval/respond` request.

4. **Do not defer Claude entirely if the product goal includes Claude.**
   The work can be phased, but the plan must include a real Claude path and a fallback strategy if Claude’s stream format does not expose the needed events cleanly.

5. **Do not hardcode a fake approval policy.**
   Codex does not have an `auto-edit` approval policy. Use actual supported values and verify behavior empirically.

6. **Do not hardcode only Approve/Deny.**
   Codex approval requests can expose more than two valid decisions, including session-scoped acceptance and policy amendments. The UI must render the allowed decisions dynamically.

7. **Do not apply a blanket 120s auto-deny.**
   That may be inappropriate for multi-question prompts and can create surprising behavior. Use soft timeouts in UI unless a provider explicitly requires a hard timeout.

## Protocol Reality We Should Design Against

Verified locally from `codex app-server generate-ts`:

- Codex approval policy values are: `untrusted`, `on-failure`, `on-request`, `reject`, `never`
- Codex can send server requests for:
  - `item/commandExecution/requestApproval`
  - `item/fileChange/requestApproval`
  - `item/tool/requestUserInput`
  - `mcpServer/elicitation/request`
  - legacy `execCommandApproval`
  - legacy `applyPatchApproval`
- Codex command approvals can expose multiple possible decisions, not just approve/deny
- Codex `request_user_input` supports multiple questions, optional choice lists, secret inputs, and “Other” answers

## Architecture

### 1. Introduce A Unified Interaction Model

Add a generic interaction layer instead of a one-off approval type.

Suggested renderer/shared types in `src/renderer/src/lib/types.ts`:

```ts
export type AgentInteractionKind =
  | 'command-approval'
  | 'file-change-approval'
  | 'user-input'
  | 'provider-elicitation'
  | 'unsupported'

export type AgentInteractionStatus =
  | 'pending'
  | 'submitted'
  | 'resolved'
  | 'declined'
  | 'cancelled'
  | 'timed-out'
  | 'failed'

export interface AgentInteractionOption {
  id: string
  label: string
  description?: string
  value: string
  style?: 'primary' | 'secondary' | 'danger'
}

export interface AgentInteractionQuestion {
  id: string
  header: string
  question: string
  isOther?: boolean
  isSecret?: boolean
  options?: AgentInteractionOption[]
}

export interface AgentInteractionRequest {
  id: string
  providerRequestId: string
  provider: 'codex' | 'claude'
  sessionId: string
  turnId?: string
  itemId?: string
  kind: AgentInteractionKind
  title: string
  description?: string
  detail?: string
  options?: AgentInteractionOption[]
  questions?: AgentInteractionQuestion[]
  requestedAt: number
  status: AgentInteractionStatus
  rawMethod: string
  rawPayload?: unknown
}

export interface AgentInteractionResponse {
  sessionId: string
  interactionId: string
  providerRequestId: string
  kind: AgentInteractionKind
  selectedOptionId?: string
  answers?: Record<string, string[]>
}
```

Add `interactions?: AgentInteractionRequest[]` to `ChatMessage`.

Rationale:

- approvals are just one interaction kind
- multiple-choice questions and multi-question forms fit naturally
- provider-specific odd cases can still be shown using `unsupported` + raw details instead of being dropped

### 2. Introduce A Provider Interaction Adapter Layer

Create a small provider abstraction in main process, for example:

`src/main/agent-interactions.ts`

```ts
export interface ProviderInteractionAdapter {
  canHandle(provider: string): boolean
  sendResponse(response: AgentInteractionResponse): Promise<void>
}
```

And in practice maintain a per-session registry:

- session id
- provider
- pending provider requests keyed by original request id
- mapping from UI `interactionId` to provider request id

This keeps renderer/UI generic while provider-specific response wiring stays in main.

### 3. Codex: Implement Real JSON-RPC Server Request Handling

In `src/main/ai.ts`, update the Codex app-server client to support **server requests**, not just notifications and responses.

New responsibilities:

- detect JSON-RPC messages that contain both `id` and `method`
- route them as pending server requests
- emit normalized `AgentInteractionRequest` objects through callbacks
- store enough metadata to answer the original request id later

Support at least these Codex methods:

- `item/commandExecution/requestApproval`
- `item/fileChange/requestApproval`
- `item/tool/requestUserInput`
- `mcpServer/elicitation/request`
- legacy `execCommandApproval`
- legacy `applyPatchApproval`

Important:

- Responses must be written as JSON-RPC responses to the original `id`
- Do **not** invent `approval/respond`
- Do **not** depend on guessed event names like `approval/request`

### 4. Codex: Use Real Approval Policy Values

Replace the original plan’s `auto-edit` mapping with actual supported values.

Recommended MVP mapping:

- `read-only` -> `never`
- `workspace-write` -> `on-request`
- `full-access` -> `on-request`

Why:

- `never` is still appropriate when nothing should prompt
- `on-request` is a real supported value and aligns with interactive prompts
- exact prompt frequency should be validated with real turns before adding any stricter/looser policy setting

Do this consistently for both `thread/start` and `turn/start`.

### 5. Codex: Render Decisions Dynamically

Do not flatten all command approvals to Approve/Deny.

Codex command approvals can include decisions such as:

- `accept`
- `acceptForSession`
- `acceptWithExecpolicyAmendment`
- `applyNetworkPolicyAmendment`
- `decline`
- `cancel`

Implementation rule:

- render buttons/options from `availableDecisions` when present
- fall back to a sane default mapping only for older legacy request types

For file-change approvals, support at least:

- `accept`
- `acceptForSession`
- `decline`
- `cancel`

### 6. Codex: Support `request_user_input` Fully

For `item/tool/requestUserInput`:

- support multiple questions in one request
- support option-based questions
- support freeform “Other” responses when `isOther` is true
- support secret inputs when `isSecret` is true
- submit one combined response payload keyed by question id

Do not reduce this to a single-text-input prompt.

### 7. Claude Code: Move To A Long-Lived Interactive Session Path

The current Claude integration is one-shot:

- `-p`
- prompt piped once
- stdin closed immediately

That architecture cannot support mid-session follow-up requests.

Revised Claude plan:

1. Add a `ClaudeCliSession` path that keeps the child process open for the life of the session.
2. Use `--print --output-format stream-json --input-format stream-json`.
3. Switch interactive permission modes away from pre-answering modes when interactive support is enabled.
4. Keep stdin open so user responses can be sent back into the same session.
5. Parse structured Claude events into the same unified `AgentInteractionRequest` model.

Because the exact Claude event schema for permission prompts/questions is not yet verified in this repo, Phase 1 for Claude must include:

- capture fixture logs from authenticated runs
- document the real event shapes in code comments/tests
- gate interactive Claude support behind a feature flag until confirmed

Recommended mode strategy:

- `read-only`: keep current non-interactive behavior
- `workspace-write` / `full-access`: prefer a truly interactive mode such as `default` if structured prompts are exposed
- if structured prompts are **not** exposed, fall back to current static permission mode and show the limitation explicitly in UI

Do not promise interactive Claude approvals until the event stream proves it.

### 8. IPC + Preload: Generalize To Interaction Events

Replace approval-specific IPC with generic interaction IPC.

Add to preload/ElectronAPI:

- `onAiInteractionRequest(cb)`
- `onAiInteractionResolved(cb)` (optional but useful)
- `respondToAiInteraction(payload: AgentInteractionResponse)`

In `src/main/ipc.ts`:

- wire provider callbacks to `ai:interaction-request`
- add `ai:interaction-respond`
- route responses to the correct provider adapter using stored session metadata

Do **not** put renderer-store logic in main.

### 9. Renderer Store: Track Pending Interactions Separately

In `src/renderer/src/stores/companionStore.ts`, add:

- `pendingInteractions: AgentInteractionRequest[]`
- `addInteractionRequest(request)`
- `markInteractionSubmitted(id)`
- `resolveInteraction(id, status)`
- `clearPendingInteractionsForSession(sessionId)`

Behavior:

- attach interaction cards to the active assistant message when possible
- if no suitable assistant message exists yet, create a synthetic assistant message to host the interaction
- keep a top-level `pendingInteractions` list so the UI can show badges/nudges even if the message view changes

### 10. UI: Build A Generic `InteractionCard`, Not Just `ApprovalCard`

Create `src/renderer/src/components/InteractionCard.tsx`.

It should render based on `kind`:

- `command-approval`: command detail + dynamic decision buttons
- `file-change-approval`: file/write detail + dynamic decision buttons
- `user-input`: one or more questions, each with choices and optional text entry
- `provider-elicitation`: generic prompt + choices/text input
- `unsupported`: safe fallback showing summary + “Cancel” / optional raw detail disclosure

Requirements:

- support multiple buttons/options
- support multi-question submit
- support hidden/secret text input
- support session-scoped accept labels cleanly
- keep resolved interactions collapsed after submission

### 11. Visibility + Notification Behavior

Notification nudges should be triggered in the renderer after the interaction event arrives.

Do not try to read `companionStore.visible` or call `notificationStore.add()` from main process.

Renderer behavior:

- if panel is closed and a pending interaction arrives, show a notification/badge
- optionally auto-open the panel only for blocking interactions, but make this configurable later
- auto-grow panel width/height heuristically for multi-question interactions

### 12. Session Lifecycle Rules

When the user:

- closes the session
- starts a new session
- aborts a turn
- changes provider/cwd in a way that recreates the backend session

Then:

- pending provider requests must be resolved safely
- approvals should respond with `cancel`/`decline` where applicable
- user-input requests should be cancelled or marked abandoned, not silently left hanging
- UI state should be cleared for that session

Avoid a blanket hard auto-deny timer.

Recommended MVP:

- show “Waiting on you” immediately
- show “Stale” visual state after 2 minutes
- only send an automatic cancellation if the underlying provider requires it or the session is being destroyed

### 13. Files To Change

Core:

- `src/main/ai.ts`
- `src/main/ipc.ts`
- `src/preload/index.ts`
- `src/renderer/src/lib/types.ts`
- `src/renderer/src/stores/companionStore.ts`

New:

- `src/main/agent-interactions.ts`
- `src/renderer/src/components/InteractionCard.tsx`
- `src/renderer/src/components/InteractionForm.tsx` (optional, if the card gets too large)

Updated UI wiring:

- `src/renderer/src/components/CompanionMessage.tsx`
- `src/renderer/src/components/CompanionPanel.tsx`

Optional but recommended:

- `src/main/providers/claude-session.ts`
- `src/main/providers/codex-session.ts`

### 14. Implementation Phases

#### Phase 1: Codex Generic Interaction MVP

- vendor/check in the relevant Codex protocol types or define a narrow typed subset in source control
- add generic interaction types
- add JSON-RPC server request handling
- support Codex command approvals
- support Codex file-change approvals
- support Codex `request_user_input`
- add generic interaction UI and renderer plumbing

This phase should fully solve the Codex side for approvals and multiple-choice/user-input prompts.

#### Phase 2: Claude Interactive Session Path

- build long-lived Claude session transport
- capture and document real stream-json interaction events
- normalize Claude prompts into the same interaction model
- allow user responses to flow back into the active Claude session
- leave a visible fallback if structured interactive events are unavailable

#### Phase 3: Provider-Specific Polish

- session-scoped “approve for rest of session” affordances
- network-policy amendment UI
- richer unsupported-request fallback views
- analytics/debug logging around unresolved provider request types

## Verification

### Codex

1. Set permissions to `workspace-write`
2. Trigger a command that requires approval
3. Verify the card shows the real available decisions
4. Approve with normal accept
5. Approve with session-scoped accept if offered
6. Decline/cancel and verify the turn behaves correctly
7. Trigger a file-change approval and verify the separate path works
8. Trigger a `request_user_input` tool call with:
   - one question
   - multiple questions
   - choice options
   - “Other” enabled
   - secret input enabled
9. Close the panel and verify the nudge appears
10. Start a new session while a prompt is pending and verify safe cancellation

### Claude

1. Run an authenticated interactive Claude session behind a feature flag
2. Capture actual stream-json fixtures for permission prompts/questions
3. Verify parsed events map into the unified interaction model
4. Verify user responses are delivered back into the same session
5. If the stream does not expose structured prompts, verify the fallback behavior is explicit and non-broken

### Build

- `npm run typecheck`
- `npm run build`

## Open Risks

- Claude interactive event shapes are not yet verified in this repo and must be captured before promising full parity
- Codex has both legacy and newer request forms; the implementation should support both while preferring the newer typed request paths
- Dynamic provider prompts may expand over time, so the renderer must preserve an `unsupported` fallback rather than assuming today’s set is exhaustive
