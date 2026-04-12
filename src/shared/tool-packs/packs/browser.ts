import type { ToolPack, PackQuickAction } from '../types'

const PROCESS_NAMES = new Set([
  'chrome', 'firefox', 'msedge', 'brave', 'arc',
  'opera', 'vivaldi', 'safari',
])

const APP_NAMES_LC = [
  'google chrome', 'chrome', 'firefox', 'mozilla firefox',
  'microsoft edge', 'edge', 'brave', 'arc',
  'opera', 'vivaldi', 'safari',
]

interface SitePattern {
  variant: string
  titlePatterns: string[]
}

const KNOWN_SITES: SitePattern[] = [
  { variant: 'github', titlePatterns: ['github'] },
  { variant: 'stackoverflow', titlePatterns: ['stack overflow', 'stackoverflow'] },
  { variant: 'jira', titlePatterns: ['jira', 'atlassian'] },
  { variant: 'confluence', titlePatterns: ['confluence'] },
  { variant: 'google-docs', titlePatterns: ['google docs', 'google sheets', 'google slides'] },
  { variant: 'gmail', titlePatterns: ['gmail', 'inbox -'] },
  { variant: 'slack-web', titlePatterns: ['slack |', '| slack'] },
  { variant: 'youtube', titlePatterns: ['youtube'] },
  { variant: 'notion', titlePatterns: ['notion'] },
  { variant: 'linear', titlePatterns: ['linear'] },
  { variant: 'figma', titlePatterns: ['figma'] },
  { variant: 'vercel', titlePatterns: ['vercel'] },
]

function detectBrowserFamily(app: string, proc: string): string | undefined {
  const a = app.toLowerCase()
  const p = proc.toLowerCase()
  if (p === 'chrome' || a.includes('chrome')) return 'chrome'
  if (p === 'firefox' || a.includes('firefox')) return 'firefox'
  if (p === 'msedge' || a.includes('edge')) return 'edge'
  if (p === 'brave' || a.includes('brave')) return 'brave'
  if (p === 'arc' || a.includes('arc')) return 'arc'
  if (p === 'opera' || a.includes('opera')) return 'opera'
  if (p === 'vivaldi' || a.includes('vivaldi')) return 'vivaldi'
  if (p === 'safari' || a.includes('safari')) return 'safari'
  return undefined
}

function detectSite(title: string): SitePattern | undefined {
  const t = title.toLowerCase()
  return KNOWN_SITES.find(s => s.titlePatterns.some(p => t.includes(p)))
}

/**
 * Parse browser title: "Page Title - Google Chrome" or "Page Title — Mozilla Firefox"
 * Returns the page title portion.
 */
function parsePageTitle(title: string): string {
  // Strip trailing browser name after last " - " or " — "
  const stripped = title
    .replace(/\s*[-–—]\s*(Google Chrome|Mozilla Firefox|Microsoft Edge|Brave|Arc|Opera|Vivaldi|Safari)\s*$/i, '')
    .trim()
  return stripped || title
}

export const browserPack: ToolPack = {
  id: 'browser',
  name: 'Browser',

  match({ activeApp, processName, windowTitle }) {
    const proc = processName.toLowerCase()
    const app = activeApp.toLowerCase()

    const isProcess = PROCESS_NAMES.has(proc)
    const isApp = APP_NAMES_LC.some(a => app.includes(a))

    if (!isProcess && !isApp) return null

    const ctx: Record<string, string> = {}
    const browserFamily = detectBrowserFamily(activeApp, processName)
    if (browserFamily) ctx.browserFamily = browserFamily

    const pageTitle = parsePageTitle(windowTitle)
    if (pageTitle) ctx.pageTitle = pageTitle

    const site = detectSite(windowTitle)
    if (site) ctx.siteHint = site.variant

    const confidence = isProcess ? 0.93 : 0.83
    return { packId: 'browser', packName: 'Browser', confidence, context: ctx, variant: site?.variant }
  },

  getQuickActions(match, _ocrText) {
    const actions: PackQuickAction[] = []
    const variant = match.variant || match.context.siteHint

    switch (variant) {
      case 'github':
        actions.push(
          { id: 'summarize-pr', label: 'Summarize PR', prompt: 'Summarize the pull request or issue visible on this GitHub page.', icon: 'GitBranch' },
          { id: 'explain-issue', label: 'Explain issue', prompt: 'Explain the GitHub issue shown on screen.', icon: 'HelpCircle' },
          { id: 'review-changes', label: 'Review changes', prompt: 'Review the code changes visible on this page.', icon: 'Code' },
        )
        break

      case 'stackoverflow':
        actions.push(
          { id: 'explain-solution', label: 'Explain solution', prompt: 'Explain the top answer on this Stack Overflow page.', icon: 'FileText' },
          { id: 'simplify', label: 'Simplify answer', prompt: 'Simplify the answer shown on this page into clear steps.', icon: 'AlignLeft' },
        )
        break

      case 'gmail':
      case 'slack-web':
        actions.push(
          { id: 'summarize', label: 'Summarize', prompt: 'Summarize the conversation or email visible on screen.', icon: 'AlignLeft' },
          { id: 'draft-reply', label: 'Draft reply', prompt: 'Draft a professional reply based on what is on screen.', icon: 'PenLine' },
          { id: 'action-items', label: 'Action items', prompt: 'Extract the action items from this conversation or email.', icon: 'ClipboardList' },
        )
        break

      case 'google-docs':
      case 'notion':
        actions.push(
          { id: 'summarize', label: 'Summarize', prompt: 'Summarize this document.', icon: 'AlignLeft' },
          { id: 'key-points', label: 'Key points', prompt: 'Extract the key points from this document.', icon: 'ClipboardList' },
          { id: 'simplify', label: 'Simplify', prompt: 'Rewrite the visible text in simpler language.', icon: 'FileText' },
        )
        break

      case 'youtube':
        actions.push(
          { id: 'summarize', label: 'Summarize video', prompt: 'Based on the title and description visible, summarize what this video is about.', icon: 'AlignLeft' },
        )
        break

      default:
        // Generic browser actions
        actions.push(
          { id: 'summarize', label: 'Summarize page', prompt: 'Summarize what\'s on this page.', icon: 'AlignLeft' },
          { id: 'key-points', label: 'Key points', prompt: 'Extract the key points from this page.', icon: 'ClipboardList' },
          { id: 'fact-check', label: 'Fact check', prompt: 'Verify the main claims made on this page.', icon: 'CheckCircle2' },
        )
        break
    }

    // Browser-enrichment actions available for all sites
    actions.push(
      { id: 'extract-fonts', label: 'Identify fonts', prompt: 'What fonts is this page using? Use the browser-fonts tool.', icon: 'Type' },
      { id: 'page-structure', label: 'Page structure', prompt: 'Show me the heading structure of this page using the browser-headings tool.', icon: 'List' },
      { id: 'extract-links', label: 'Extract links', prompt: 'List all the links on this page using the browser-links tool.', icon: 'Link' },
    )

    return actions
  },

  buildContextNote(match) {
    const parts: string[] = []
    const c = match.context
    if (c.browserFamily) parts.push(`Browser: ${c.browserFamily}`)
    if (c.siteHint) parts.push(`Site: ${c.siteHint}`)
    if (c.pageTitle) parts.push(`Page: ${c.pageTitle}`)
    return parts.length > 0 ? parts.join(', ') : ''
  },
}
