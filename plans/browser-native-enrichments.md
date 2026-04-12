# Plan: Browser-Native Enrichments + Native Browser Control

## Goal

Give OmniCue first-class browser awareness and lightweight native control over the user's actual desktop browser without requiring an extension, CDP, or Puppeteer.

This breaks into two complementary capabilities:

1. **Browser enrichments**: understand the current page via URL-driven server-side parsing
2. **Native browser control**: perform a few high-value browser commands against the focused desktop browser

## Problem

When the active window is a browser, OmniCue currently knows very little. The browser context extractor only surfaces:

- `pageTitle`
- `site`
- `browserFamily`

These come from the window title, which means there is:

- no canonical URL
- no structured article/body extraction
- no link inventory
- no font inspection
- no reliable selected-text access

That pushes browser tasks toward OCR and screenshots even though webpages are structured data.

## Core Insight

The browser address bar is the bridge.

If OmniCue can read the focused browser's URL via UI Automation, it can:

1. fetch the URL server-side with Node.js
2. parse the HTML for structure
3. parse CSS for font usage
4. use the URL as a stable key for site-specific enrichments later

That gives a lot of value without browser instrumentation.

## Important Scope Boundaries

This plan should be explicit about what it can and cannot do.

### What this phase is good at

- focused Chrome / Edge / Firefox browser windows on Windows
- public webpages or pages whose useful HTML is available without session cookies
- article pages, docs, blogs, marketing sites, reference pages
- structured extraction from fetched HTML and CSS
- a small set of native browser control actions implemented via keyboard/UI automation

### What this phase is not promising

- parity with the fully rendered logged-in DOM
- access to the user's authenticated browser cookies
- extension-level DOM inspection
- perfect results on heavily client-rendered SPAs
- arbitrary browser automation beyond a few bounded commands

That means:

- URL extraction should be treated as the foundation
- content extraction should be treated as "best effort from fetched HTML"
- private/authenticated pages should degrade gracefully instead of pretending to be supported

## Architecture

```text
Focused browser window
        |
        v
  UI Automation / native input
        |
   +----+----------------------------+
   |                                 |
   v                                 v
Read address bar URL            Native browser control
   |                            (back / forward / refresh / focus bar)
   v
Server-side fetch + parse
   |
   +--> page content
   +--> readable article
   +--> headings + links
   +--> font inventory
```

## New Module: `src/main/browser/`

### 1. `src/main/browser/url.ts`

Read the current browser URL from the focused browser's address bar via UI Automation.

Recommended shape:

```ts
export interface BrowserUrlResult {
  url: string | null
  browserFamily?: string
  pageTitle?: string
}

export async function extractBrowserUrl(browserFamily?: string): Promise<BrowserUrlResult>
```

Implementation notes:

- Windows-first scope only
- use the active window info and detected `browserFamily` to choose extraction strategy
- support Chromium browsers first, then Firefox
- fail fast with a short timeout
- degrade to `null` URL cleanly

Do not make this block snapshots for too long. Treat it like best-effort enrichment.

### 2. `src/main/browser/fetch.ts`

Add a small shared fetch helper instead of duplicating network policy in `page.ts` and `fonts.ts`.

Responsibilities:

- timeout
- redirect limit
- custom user agent
- max response size
- content-type checks
- text decoding

Recommended helpers:

```ts
export async function fetchHtml(url: string): Promise<{ url: string; html: string; contentType?: string }>
export async function fetchCss(url: string): Promise<string>
export async function headResource(url: string): Promise<{ ok: boolean; size?: number; contentType?: string }>
```

This keeps the rest of the browser module smaller and safer.

### 3. `src/main/browser/page.ts`

Fetch and parse webpage content.

```ts
export interface PageContent {
  url: string
  canonicalUrl?: string
  title: string
  description?: string
  headings: { level: number; text: string }[]
  articleBody?: string
  links: { text: string; href: string }[]
  ogImage?: string
  author?: string
  publishedDate?: string
}

export async function fetchPageContent(url: string): Promise<PageContent>
export async function fetchReadableContent(url: string): Promise<{
  url: string
  title: string
  content: string
  wordCount: number
  estimatedReadTime: string
}>
```

Dependencies:

- `@mozilla/readability`
- `jsdom`

Implementation notes:

- Readability is appropriate for article-like content
- headings and links should still be extracted even when Readability is not useful
- treat GitHub / dashboards / heavily interactive apps as non-article pages
- return the fetched URL and metadata even if article extraction is weak

### 4. `src/main/browser/fonts.ts`

Inspect page CSS for font usage.

```ts
export interface SnipedFont {
  family: string
  weight?: string
  style?: string
  format: 'woff2' | 'woff' | 'ttf' | 'otf' | 'eot' | 'unknown'
  url: string
  size?: number
  accessible: boolean
  usedOn: string[]
}

export async function snipeFonts(url: string): Promise<SnipedFont[]>
export async function downloadFont(font: SnipedFont, destDir: string): Promise<string>
```

Dependency:

- `fontverter`

Implementation notes:

- the identify flow is read-only
- the download flow writes to disk and must **not** be safe-tier
- CSS parsing and `@import` traversal should be bounded
- inaccessible or auth-gated fonts should still be listed when discovered, but marked `accessible: false`

### 5. `src/main/browser/selection.ts`

Selected text needs a stricter safety split than the original draft.

Recommended API:

```ts
export async function getSelectedTextViaUiAutomation(browserFamily?: string): Promise<string | null>
export async function captureSelectedTextViaClipboardDance(): Promise<string | null>
```

Rules:

- UIA-only selected-text access can be treated as safe
- clipboard fallback is invasive because it sends keys and temporarily touches clipboard state
- clipboard fallback should therefore be guided-tier, not safe-tier

## Browser Context Enrichment

Update `src/main/context/types.ts`:

```ts
export interface BrowserContext {
  pageTitle?: string
  site?: string
  browserFamily?: string
  url?: string
}
```

Revision from the original draft:

- add `url?`
- do **not** add `canonicalUrl` or `selectedText` to the normal snapshot shape in this phase

Reason:

- `canonicalUrl` requires fetch work
- `selectedText` is transient and can be invasive to obtain
- snapshot collection should stay fast

Update `src/main/context/extractors/browser.ts` to populate `url` via `extractBrowserUrl()` best-effort when browser is active.

## New Actions

### Safe-tier browser enrichments

These are read-only and can stay safe-tier:

| Action ID | Tier | Category | Description |
|---|---|---|---|
| `browser-url` | safe | browser | Extract current browser URL |
| `browser-page-content` | safe | browser | Fetch and parse structured page content |
| `browser-readable` | safe | browser | Get readable article/body text |
| `browser-headings` | safe | browser | Extract heading structure |
| `browser-links` | safe | browser | Extract page links |
| `browser-fonts` | safe | browser | Identify fonts used on the page |
| `browser-selected-text` | safe | browser | Read selected text via UI Automation only |

### Guided-tier browser control / invasive capture

These should be guided because they inject input or write to disk:

| Action ID | Tier | Category | Description |
|---|---|---|---|
| `browser-back` | guided | browser | Navigate back in the focused browser |
| `browser-forward` | guided | browser | Navigate forward in the focused browser |
| `browser-refresh` | guided | browser | Refresh the focused browser tab |
| `browser-focus-address-bar` | guided | browser | Focus the browser address bar |
| `browser-copy-url` | guided | browser | Copy the current URL via address-bar key flow |
| `browser-selected-text-capture` | guided | browser | Capture selected text via clipboard dance |
| `browser-font-download` | guided | browser | Download and convert a font to disk |

This is the main revision needed to make the plan fit OmniCue's action safety model.

## Action Parameter Shape

Where possible, browser enrichments should accept an **optional** explicit URL:

```ts
{ url?: string }
```

Behavior:

- if `url` is provided, operate on that URL
- otherwise, resolve the current focused browser URL first

This makes the actions composable and avoids repeated UI Automation when the URL is already known.

For `browser-font-download`:

```ts
{
  fontUrl: string
  family?: string
  destDir: string
}
```

## New Server Endpoints

Keep `/browser/*` endpoints **read-only**.

### Read-only endpoints

- `GET /browser/url`
- `GET /browser/page`
- `GET /browser/readable`
- `GET /browser/links`
- `GET /browser/headings`
- `GET /browser/fonts`
- `GET /browser/selection`

Each of the content endpoints should also accept optional query `url=...` so they can work on an explicit URL without requiring the browser to be focused.

Examples:

- `/browser/page?url=https://example.com`
- `/browser/fonts?url=https://example.com`

### Important revision

Do **not** add `POST /browser/fonts/download` as a direct local endpoint in this phase.

Reason:

- it writes to disk
- it bypasses the existing action-tier safety model

Downloading should go through the existing action execution path as `browser-font-download` so guided execution semantics remain consistent.

## Native Browser Control

The current draft was mostly enrichments. Since the user explicitly wants browser control over the actual desktop browser, include a bounded native-control slice.

Control implementation should be thin wrappers over native key flows against the focused browser:

- back: `Alt+Left`
- forward: `Alt+Right`
- refresh: `Ctrl+R`
- focus address bar: `Ctrl+L`
- copy current URL: `Ctrl+L`, `Ctrl+C`, optional `Esc`

These belong in the action system, not the `/browser/*` read-only server surface.

## Prompt / Tooling Updates

Update the desktop tools prompt in `ai.ts` to document the new read-only browser endpoints:

- `/browser/url`
- `/browser/page`
- `/browser/readable`
- `/browser/links`
- `/browser/headings`
- `/browser/fonts`
- `/browser/selection`

And add a brief note that browser control is available through guided actions when the active app is a browser.

## Tool Pack Enhancements

Update `src/shared/tool-packs/packs/browser.ts` with quick actions that align to the new tools:

- `Identify fonts`
- `Page structure`
- `Extract links`
- `Summarize article`
- `Explain selection` only when selected text is actually available

Avoid showing selection-dependent quick actions unless the app has real selection data or the action explicitly says it may capture selection.

## Dependencies

Add:

```bash
npm install @mozilla/readability jsdom fontverter
```

Avoid adding `@types/jsdom` unless the installed `jsdom` version actually requires it.

## File Changes

| File | Change |
|---|---|
| `src/main/browser/url.ts` | NEW - address bar URL extraction |
| `src/main/browser/fetch.ts` | NEW - shared bounded fetch helpers |
| `src/main/browser/page.ts` | NEW - HTML fetch + parse |
| `src/main/browser/fonts.ts` | NEW - font inspection + optional download |
| `src/main/browser/selection.ts` | NEW - UIA selection + optional clipboard fallback |
| `src/main/browser/index.ts` | NEW - barrel export |
| `src/main/actions/registry.ts` | Add browser enrichment + control action definitions |
| `src/main/actions/safe.ts` | Add safe browser enrichment handlers |
| `src/main/actions/...` | Add guided handlers for native browser control and font download |
| `src/main/server.ts` | Add read-only `/browser/*` endpoints |
| `src/main/context/types.ts` | Add `url?` to `BrowserContext` |
| `src/main/context/extractors/browser.ts` | Populate browser URL best-effort |
| `src/shared/tool-packs/packs/browser.ts` | Add browser-aware quick actions |
| `src/main/ai.ts` | Add browser tools to prompt block |
| `package.json` | Add dependencies |

## Implementation Order

### Phase 1: URL extraction foundation
1. `src/main/browser/url.ts`
2. update browser context extractor to populate `url`
3. add `browser-url` action
4. add `GET /browser/url`
5. verify URL extraction on Chrome and Edge first, then Firefox

### Phase 2: Page fetch + structure
6. add `fetch.ts`
7. install `@mozilla/readability` and `jsdom`
8. implement `page.ts`
9. add `browser-page-content`, `browser-readable`, `browser-headings`, `browser-links`
10. add read-only `/browser/page`, `/browser/readable`, `/browser/headings`, `/browser/links`
11. support optional explicit `url` query/action param

### Phase 3: Font inspection
12. install `fontverter`
13. implement `fonts.ts`
14. add `browser-fonts` safe action
15. add `GET /browser/fonts`
16. add `browser-font-download` guided action

### Phase 4: Native control
17. add guided browser control actions: back, forward, refresh, focus-address-bar, copy-url
18. wire quick actions or intent patterns where appropriate

### Phase 5: Selection
19. implement UIA-only selected-text access
20. add safe `browser-selected-text`
21. if needed, add guided clipboard-fallback action separately

### Phase 6: Prompt + pack polish
22. update browser tool-pack quick actions
23. update `ai.ts` prompt block
24. verify latency and failure behavior

## Edge Cases

- **URL extraction fails**: return `null` URL and keep title-based browser context
- **Non-focused browser**: explicit-URL actions/endpoints should still work when a URL is passed directly
- **Authenticated pages**: fetched HTML may be incomplete or unusable because OmniCue does not have browser session cookies
- **SPAs / client-rendered pages**: fetched HTML may not match the current rendered DOM; return best-effort results
- **Large pages**: cap HTML size, CSS count, and response body sizes
- **Font URLs behind auth/CDN**: list them but mark inaccessible if HEAD/fetch fails
- **Selection capture**: clipboard fallback must preserve and restore clipboard state if used
- **Localized browsers / different accessibility names**: URL extraction must fail gracefully and not block snapshot collection

## What This Enables

With this plan, an agent can:

1. summarize the current article without OCR
2. inspect headings and links on the current page
3. identify fonts used by a site
4. download a font through the guided action path
5. navigate back/forward/refresh in the real focused browser
6. capture selected text safely when UIA supports it, or via guided fallback if needed

That gives OmniCue a real browser tool surface while staying consistent with the app's existing safety model and execution patterns.
