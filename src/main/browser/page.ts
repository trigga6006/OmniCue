/**
 * Page content extraction — fetch a URL and parse it for structured content.
 * Uses Mozilla Readability (same engine as Firefox Reader View) for article extraction.
 */

import { Readability } from '@mozilla/readability'
import { JSDOM } from 'jsdom'
import { fetchHtml } from './fetch'

export interface PageHeading {
  level: number
  text: string
}

export interface PageLink {
  text: string
  href: string
}

export interface PageContent {
  url: string
  canonicalUrl?: string
  title: string
  description?: string
  headings: PageHeading[]
  articleBody?: string
  links: PageLink[]
  ogImage?: string
  author?: string
  publishedDate?: string
}

export interface ReadableContent {
  url: string
  title: string
  content: string
  wordCount: number
  estimatedReadTime: string
}

function extractMeta(doc: Document, names: string[]): string | undefined {
  for (const name of names) {
    const el =
      doc.querySelector(`meta[property="${name}"]`) ||
      doc.querySelector(`meta[name="${name}"]`)
    const content = el?.getAttribute('content')?.trim()
    if (content) return content
  }
  return undefined
}

function extractHeadings(doc: Document): PageHeading[] {
  const headings: PageHeading[] = []
  const els = doc.querySelectorAll('h1, h2, h3, h4, h5, h6')
  for (const el of els) {
    const text = el.textContent?.trim()
    if (!text) continue
    const level = parseInt(el.tagName[1], 10)
    headings.push({ level, text })
  }
  return headings
}

function extractLinks(doc: Document, baseUrl: string): PageLink[] {
  const links: PageLink[] = []
  const seen = new Set<string>()
  const els = doc.querySelectorAll('a[href]')

  for (const el of els) {
    const text = el.textContent?.trim()
    if (!text) continue

    let href = el.getAttribute('href') || ''
    if (!href || href.startsWith('#') || href.startsWith('javascript:')) continue

    // Resolve relative URLs
    try {
      href = new URL(href, baseUrl).href
    } catch {
      continue
    }

    if (seen.has(href)) continue
    seen.add(href)
    links.push({ text: text.slice(0, 200), href })
  }

  return links
}

/** Fetch a URL and extract structured page content. */
export async function fetchPageContent(url: string): Promise<PageContent> {
  const { url: finalUrl, html } = await fetchHtml(url)
  const dom = new JSDOM(html, { url: finalUrl })
  const doc = dom.window.document

  const title =
    extractMeta(doc, ['og:title']) ||
    doc.querySelector('title')?.textContent?.trim() ||
    ''

  const canonicalEl = doc.querySelector('link[rel="canonical"]')
  const canonicalUrl = canonicalEl?.getAttribute('href')?.trim() || undefined

  const description = extractMeta(doc, ['og:description', 'description'])
  const ogImage = extractMeta(doc, ['og:image'])
  const author = extractMeta(doc, ['author', 'article:author'])
  const publishedDate = extractMeta(doc, ['article:published_time', 'date'])

  const headings = extractHeadings(doc)
  const links = extractLinks(doc, finalUrl)

  // Article body via Readability
  let articleBody: string | undefined
  try {
    const clone = new JSDOM(html, { url: finalUrl })
    const reader = new Readability(clone.window.document)
    const article = reader.parse()
    if (article?.textContent) {
      // Cap at 50KB
      articleBody = article.textContent.slice(0, 50_000).trim()
    }
  } catch {
    // Readability may fail on non-article pages — that's fine
  }

  dom.window.close()

  return {
    url: finalUrl,
    canonicalUrl,
    title,
    description,
    headings,
    articleBody,
    links,
    ogImage,
    author,
    publishedDate,
  }
}

/** Fetch a URL and return a clean readable version optimized for summarization. */
export async function fetchReadableContent(url: string): Promise<ReadableContent> {
  const { url: finalUrl, html } = await fetchHtml(url)
  const dom = new JSDOM(html, { url: finalUrl })
  const doc = dom.window.document

  const title =
    doc.querySelector('meta[property="og:title"]')?.getAttribute('content')?.trim() ||
    doc.querySelector('title')?.textContent?.trim() ||
    ''

  let content = ''
  try {
    const reader = new Readability(dom.window.document)
    const article = reader.parse()
    if (article?.textContent) {
      content = article.textContent.slice(0, 50_000).trim()
    }
  } catch {
    // Fall back to body text
    content = doc.body?.textContent?.trim().slice(0, 50_000) || ''
  }

  const wordCount = content.split(/\s+/).filter(Boolean).length
  const readMinutes = Math.max(1, Math.ceil(wordCount / 250))

  return {
    url: finalUrl,
    title,
    content,
    wordCount,
    estimatedReadTime: `${readMinutes} min`,
  }
}
