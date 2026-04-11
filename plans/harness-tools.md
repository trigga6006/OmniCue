# Plan: Harness-within-a-Harness Tool System

## Goal

Give CLI-based harnesses that OmniCue already runs or supports an extra local tool layer without trying to extend each harness's native tool schema. The harness keeps its own built-in shell/file tools; OmniCue exposes desktop context over localhost, and the model is told how to query it.

This should work well for the in-app CLI harnesses we already ship:

- Codex app-server / Codex CLI fallback
- Claude Code CLI
- OpenCode
- Kimi Code CLI

Direct API providers stay unchanged.

## Core Approach

Expose a small HTTP API from the Electron main process, then append a short "OmniCue desktop tools" block only for harnesses that can execute shell commands. The model can call the endpoints with `curl` or `curl.exe` from its existing shell tool.

This avoids:

- trying to inject custom tools into each CLI's schema
- provider-specific MCP/tool protocol work
- additional subprocess layers for simple desktop lookups

## Important Revisions to the Original Draft

### 1. Make the MVP text-first

`/screen-text`, `/context`, and `/displays` are solid MVP endpoints.

`/screenshot` should not be treated as a core MVP feature yet. Returning a base64 PNG in shell output does not automatically give the harness visual understanding. For most of our supported CLIs, the model can read tool output as text, but that is not the same thing as ingesting a new image modality mid-turn.

Recommendation:

- Ship `/displays`
- Ship `/context`
- Ship `/screen-text`
- Treat `/screenshot` as Phase 2, only after we confirm a concrete per-harness flow that can actually consume an image generated during tool use

### 2. Do not expose sensitive endpoints with wildcard CORS

`src/main/server.ts` currently returns `Access-Control-Allow-Origin: *` for every response. That is acceptable for harmless endpoints like `/health`, but it becomes dangerous if we add desktop OCR, window title, or clipboard access because any webpage could read those responses from the browser.

Recommendation:

- Keep the server bound to `127.0.0.1`
- Do not send `Access-Control-Allow-Origin: *` on sensitive desktop-context endpoints
- Keep CORS only where we intentionally want browser-origin access, or split the JSON helper into public vs local-only responses
- Consider rejecting non-loopback `Host` headers as a small extra hardening step

### 3. Reuse the existing capture/context pipeline instead of duplicating it in `server.ts`

The draft is directionally right that `server.ts` can access Electron APIs, but the capture logic already exists in `src/main/ipc.ts`:

- display selection logic
- `desktopCapturer.getSources(...)`
- OCR via `extractTextFromScreenshot(...)`
- active window lookup
- clipboard access

Instead of re-implementing that logic in two places, extract shared helpers into a new module, for example:

- `src/main/desktop-tools.ts`

That module should own:

- resolving the target display
- capturing a display screenshot as a data URL
- extracting OCR text for a display
- reading lightweight desktop context

Then both `ipc.ts` and `server.ts` can call the same functions.

### 4. Put Codex app-server tool instructions in thread developer instructions, not only in per-turn text

For Codex app-server, we already have a dedicated `developerInstructions` field in `ensureThread()` in `src/main/ai.ts`. That is a better place for the desktop tool block than repeating it inside every user turn payload.

Recommendation:

- keep the existing interaction instructions there
- append the desktop tools block there as well
- keep `buildNonInteractivePrompt()` as the injection point for Claude Code CLI, OpenCode, Kimi Code CLI, and Codex CLI fallback

This lowers repeated token overhead for Codex app-server sessions.

### 5. Use `127.0.0.1` in examples, not `localhost`

The server binds to `127.0.0.1`. `localhost` will usually work, but using the exact bound address avoids name-resolution and IPv6 ambiguity.

## Endpoints to Add

Add these to `src/main/server.ts`, backed by shared helpers extracted from `ipc.ts`.

### `GET /displays`

Lists connected displays and identifies the one nearest the overlay window.

Example response:

```json
{
  "displays": [
    { "id": 12345, "label": "Display 1 (Primary)", "width": 1920, "height": 1080 }
  ],
  "current": 12345
}
```

### `GET /context`

Returns lightweight desktop context for the current or requested display. Keep this text-only and fast.

Recommended response:

```json
{
  "activeApp": "Chrome",
  "processName": "chrome",
  "windowTitle": "...",
  "display": 12345
}
```

Clipboard should be opt-in, not default. If we keep it at all, prefer:

- `GET /context?includeClipboard=1`

That keeps the default response safer and smaller.

### `GET /screen-text?display=<id>`

Returns OCR text plus lightweight metadata for a chosen display or the overlay's current display.

Example response:

```json
{
  "screenText": "...",
  "screenType": "browser",
  "activeApp": "Chrome",
  "windowTitle": "...",
  "display": 12345
}
```

### Phase 2: `GET /screenshot?display=<id>`

Only add this after validating an actual provider flow that can consume the returned image.

If we do add it later, the endpoint should return either:

- raw `image/png` bytes suitable for `curl.exe -o file.png ...`
- or a temp file path written by OmniCue

Do not assume that dumping base64 into tool output gives the model usable vision.

## Shared Helper Module

Create a shared module, for example `src/main/desktop-tools.ts`, with helpers along these lines:

- `getCurrentDisplayId(mainWin: BrowserWindow | null): number | null`
- `listDisplays(mainWin: BrowserWindow | null): {...}`
- `captureDisplayDataUrl(displayId?: number): Promise<{ image: string; displayId: number }>`
- `getScreenText(displayId?: number, mainWin?: BrowserWindow | null): Promise<{ ... }>`
- `getDesktopContext(options): Promise<{ ... }>`

This keeps `ipc.ts` and `server.ts` aligned and reduces the chance that monitor-selection or OCR behavior drifts over time.

## Prompt Injection

### Codex app-server

Update `ensureThread()` in `src/main/ai.ts` so `developerInstructions` includes both:

- the existing Codex interaction instructions
- the new OmniCue desktop tools instructions

### Other CLI harnesses

Append the same tool block from `buildNonInteractivePrompt()` in `src/main/ai.ts`.

That covers:

- Claude Code CLI
- OpenCode
- Kimi Code CLI
- Codex CLI fallback

### Direct API providers

Do not add the tool block to:

- `streamOpenAiCompat(...)`
- `streamViaClaudeApi(...)`
- any other direct API-only path

## Suggested Tool Block

Keep it short and shell-friendly:

```text
## OmniCue Desktop Tools

When shell access is available, you can query the user's desktop through OmniCue's local HTTP API:

- `curl.exe -s http://127.0.0.1:19191/displays` - list connected displays and the current one
- `curl.exe -s http://127.0.0.1:19191/context` - active app and window title
- `curl.exe -s "http://127.0.0.1:19191/context?includeClipboard=1"` - same, plus clipboard when needed
- `curl.exe -s http://127.0.0.1:19191/screen-text` - OCR text from the display OmniCue is currently on
- `curl.exe -s "http://127.0.0.1:19191/screen-text?display=<id>"` - OCR text from a specific display

Use `/screen-text` for most desktop questions. Use `/displays` first if the user mentions another monitor. Only request clipboard when it is directly relevant.
```

Notes:

- `curl.exe` is the safest example on Windows because PowerShell aliases `curl`
- on non-Windows shells, plain `curl -s ...` is fine

## Files to Modify

| File | Change |
|------|--------|
| `src/main/server.ts` | Add new local-only GET endpoints and split public vs sensitive response handling |
| `src/main/ipc.ts` | Refactor existing capture/context logic to use shared helpers |
| `src/main/ai.ts` | Inject desktop tools block only for shell-capable harnesses |
| `src/main/desktop-tools.ts` | New shared helper module for display resolution, capture, OCR, and context |

## Implementation Details

### `server.ts`

- Keep using Node's `http` module
- Import Electron APIs needed for shared helpers indirectly through the new module where possible
- Parse `display` and `includeClipboard` query params
- Use `mainWin.getBounds()` plus `screen.getDisplayNearestPoint(...)` to resolve the current display when `display` is omitted
- Return JSON with no wildcard CORS headers on sensitive endpoints

### `ipc.ts`

Refactor `capture-active-window` to call the new shared helper instead of owning its own capture path. That keeps IPC capture behavior and HTTP capture behavior identical.

### `ai.ts`

Add a small helper such as:

- `getDesktopToolsPrompt(): string`

Then:

- use it inside `ensureThread()` for Codex app-server `developerInstructions`
- use it inside `buildNonInteractivePrompt()` for shell-capable one-shot CLI providers
- do not append it to API-only system messages

## Latency Expectations

| Endpoint | Expected Latency | Notes |
|----------|-----------------|-------|
| `/displays` | under 5ms | `screen.getAllDisplays()` |
| `/context` | 300-500ms | active window lookup; clipboard only when requested |
| `/screen-text` | 500-1000ms | screen capture plus OCR |

These are acceptable for a harness tool call.

## Verification

### Local endpoint checks

1. Start the app
2. `curl.exe -s http://127.0.0.1:19191/displays`
3. `curl.exe -s http://127.0.0.1:19191/context`
4. `curl.exe -s http://127.0.0.1:19191/screen-text`
5. `curl.exe -s "http://127.0.0.1:19191/screen-text?display=<id>"`

### Security check

From a normal browser page, verify that sensitive endpoints are not readable cross-origin anymore. `/health` can stay public if desired; `/context` and `/screen-text` should not.

### Harness checks

1. Ask a CLI-backed provider: "What app am I in right now?"
2. Ask: "What is on my other monitor?"
3. Confirm the harness reaches for `/displays` and `/screen-text`
4. Confirm direct API providers still behave normally and do not receive the tool block

## Out of Scope for This Pass

- full image-understanding support from tool-generated screenshots
- adding tool blocks to external global harness integrations in `~/.codex/instructions` or `~/.claude/CLAUDE.md`
- any attempt to modify a provider's native tool schema

If we want external Codex/Claude terminal sessions to get the same desktop tools later, we can extend the existing installable instruction blocks in `src/main/ipc.ts` as a separate follow-up.
