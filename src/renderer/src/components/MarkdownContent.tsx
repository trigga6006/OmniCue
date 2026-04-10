import { memo, useState, useCallback, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import { Copy, Check } from 'lucide-react'

interface MarkdownContentProps {
  content: string
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }, [text])

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 w-6 h-6 flex items-center justify-center rounded-md
        bg-[var(--g-bg-active)] text-[var(--g-text-secondary)] hover:text-[var(--g-text-bright)]
        transition-colors cursor-pointer opacity-0 group-hover:opacity-100"
      title="Copy"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  )
}

function extractText(children: ReactNode): string {
  if (typeof children === 'string') return children
  if (Array.isArray(children)) return children.map(extractText).join('')
  if (children && typeof children === 'object' && 'props' in children) {
    return extractText((children as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

function handleLinkClick(e: React.MouseEvent<HTMLAnchorElement>, href: string) {
  e.preventDefault()
  try {
    const url = new URL(href)
    if (url.protocol === 'http:' || url.protocol === 'https:') {
      window.electronAPI.openExternalUrl(href)
    }
  } catch {
    // invalid URL, do nothing
  }
}

export const MarkdownContent = memo(function MarkdownContent({ content }: MarkdownContentProps) {
  return (
    <div className="markdown-content min-w-0 max-w-full overflow-hidden text-[13px] leading-relaxed break-words [overflow-wrap:anywhere]">
      <ReactMarkdown
        rehypePlugins={[[rehypeHighlight, { detect: true }]]}
        components={{
          pre({ children }) {
            const text = extractText(children)
            return (
              <div className="group relative my-2 max-w-full rounded-lg overflow-hidden
                bg-[var(--g-bg-subtle)] border-[0.5px] border-[var(--g-line-faint)]">
                <pre className="overflow-x-auto p-3 text-[12px] leading-[1.5] font-mono m-0">
                  {children}
                </pre>
                <CopyButton text={text} />
              </div>
            )
          },
          code({ className, children, node, ...props }) {
            // Fenced code block: parent is <pre>
            const isBlock = node?.position && className?.startsWith('language-') ||
              (node as any)?.parentNode?.tagName === 'pre' ||
              (typeof children === 'string' && children.includes('\n'))
            if (!isBlock) {
              return (
                <code
                  className="bg-[var(--g-bg-active)] px-[5px] py-[1px] rounded-[4px] text-[12px] font-mono
                    break-words whitespace-pre-wrap [overflow-wrap:anywhere]
                    [box-decoration-break:clone] [-webkit-box-decoration-break:clone]"
                  {...props}
                >
                  {children}
                </code>
              )
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            )
          },
          a({ href, children }) {
            return (
              <a
                href={href || '#'}
                onClick={(e) => handleLinkClick(e, href || '')}
                className="text-[var(--g-text-bright)] underline underline-offset-2
                  hover:opacity-80 transition-opacity cursor-pointer break-words [overflow-wrap:anywhere]"
              >
                {children}
              </a>
            )
          },
          strong({ children }) {
            return <strong className="font-semibold text-[var(--g-text-bright)]">{children}</strong>
          },
          ul({ children }) {
            return <ul className="pl-4 my-1.5 space-y-0.5 list-disc marker:text-[var(--g-text-muted)]">{children}</ul>
          },
          ol({ children }) {
            return <ol className="pl-4 my-1.5 space-y-0.5 list-decimal marker:text-[var(--g-text-muted)]">{children}</ol>
          },
          li({ children }) {
            return <li className="text-[13px]">{children}</li>
          },
          h1({ children }) {
            return <h1 className="text-[15px] font-semibold text-[var(--g-text-bright)] mt-3 mb-1">{children}</h1>
          },
          h2({ children }) {
            return <h2 className="text-[14px] font-semibold text-[var(--g-text-bright)] mt-2.5 mb-1">{children}</h2>
          },
          h3({ children }) {
            return <h3 className="text-[13px] font-semibold text-[var(--g-text-bright)] mt-2 mb-0.5">{children}</h3>
          },
          p({ children }) {
            return <p className="my-1">{children}</p>
          },
          blockquote({ children }) {
            return (
              <blockquote className="border-l-2 border-[var(--g-line)] pl-3 my-1.5 text-[var(--g-text-secondary)]">
                {children}
              </blockquote>
            )
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  )
})
