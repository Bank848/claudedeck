import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import type { Components } from 'react-markdown'

interface MarkdownContentProps {
  text: string
}

const components: Components = {
  h1: ({ children }) => (
    <h1 className="mt-4 mb-2 font-serif text-xl font-semibold text-fg leading-snug">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mt-3 mb-2 font-serif text-lg font-semibold text-fg leading-snug">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mt-3 mb-1.5 text-base font-semibold text-fg leading-snug">{children}</h3>
  ),
  p: ({ children }) => (
    <p className="mb-2 last:mb-0 text-sm leading-relaxed text-fg">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="mb-2 ml-4 list-disc space-y-0.5 text-sm text-fg">{children}</ul>
  ),
  ol: ({ children }) => (
    <ol className="mb-2 ml-4 list-decimal space-y-0.5 text-sm text-fg">{children}</ol>
  ),
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-fg">{children}</strong>,
  em: ({ children }) => <em className="italic text-fg-muted">{children}</em>,
  blockquote: ({ children }) => (
    <blockquote className="my-2 border-l-2 border-border-strong pl-3 text-sm text-fg-muted italic">
      {children}
    </blockquote>
  ),
  code: ({ children, className }) => {
    // Fenced code blocks come with a language className; inline code does not
    const isBlock = Boolean(className)
    if (isBlock) {
      return (
        <code className={`block overflow-x-auto rounded bg-bg p-3 font-mono text-xs leading-relaxed ${className ?? ''}`}>
          {children}
        </code>
      )
    }
    return (
      <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs text-fg">{children}</code>
    )
  },
  pre: ({ children }) => (
    <pre className="my-2 overflow-x-auto rounded-md border border-border bg-bg">{children}</pre>
  ),
  a: ({ children, href }) => (
    <a
      href={href}
      className="text-accent underline underline-offset-2 hover:opacity-80 transition-opacity"
      onClick={(e) => e.preventDefault()}
      tabIndex={0}
    >
      {children}
    </a>
  ),
  table: ({ children }) => (
    <div className="my-2 overflow-x-auto">
      <table className="w-full border-collapse text-sm">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  tbody: ({ children }) => <tbody>{children}</tbody>,
  tr: ({ children }) => (
    <tr className="border-b border-border last:border-0 hover:bg-surface-2 transition-colors">
      {children}
    </tr>
  ),
  th: ({ children }) => (
    <th className="px-3 py-2 text-left text-xs font-semibold text-fg-muted uppercase tracking-wide">
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td className="px-3 py-2 text-sm text-fg">{children}</td>
  ),
  hr: () => <hr className="my-4 border-border" />,
}

export function MarkdownContent({ text }: MarkdownContentProps): JSX.Element {
  return (
    <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
      {text}
    </ReactMarkdown>
  )
}
