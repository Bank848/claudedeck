import { useMemo, useState } from 'react'
import { Copy, Check } from 'lucide-react'
// Lean build: ~37 common languages instead of the full ~190 (faster dev + smaller bundle).
import hljs from 'highlight.js/lib/common'
import '@/theme/hljs-warm.css'
import type { CodeBlockContent } from '@/mock/fixtures'

interface CodeBlockProps {
  content: CodeBlockContent
}

export function CodeBlock({ content }: CodeBlockProps): JSX.Element {
  const [copied, setCopied] = useState(false)

  // Memoize the highlight: hljs.highlightAuto tries every bundled language, so
  // re-running it on every render is the heaviest work in a code card. The result
  // only depends on the code + language, which are stable once the block closes —
  // so a streaming message (which re-renders every token) stops re-highlighting
  // its already-complete code blocks. Pure string→string: no DOM/aria change.
  const highlighted = useMemo(() => {
    try {
      if (content.language && hljs.getLanguage(content.language)) {
        return hljs.highlight(content.code, { language: content.language }).value
      }
      return hljs.highlightAuto(content.code).value
    } catch {
      return content.code
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
    }
  }, [content.code, content.language])

  const handleCopy = () => {
    navigator.clipboard.writeText(content.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  const label = content.filename ?? content.language

  return (
    <div className="my-3 rounded-lg border border-border overflow-hidden">
      {/* Header bar */}
      <div className="flex items-center justify-between bg-surface-2 px-3 py-1.5 border-b border-border">
        <span className="font-mono text-xs text-fg-muted truncate">{label}</span>
        <button
          type="button"
          onClick={handleCopy}
          title={copied ? 'Copied!' : 'Copy code'}
          className="flex items-center gap-1.5 rounded px-2 py-0.5 text-xs text-fg-muted transition-colors hover:bg-muted hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent cursor-pointer"
        >
          {copied ? (
            <>
              <Check size={13} className="text-success" />
              <span className="text-success">Copied</span>
            </>
          ) : (
            <>
              <Copy size={13} />
              <span>Copy</span>
            </>
          )}
        </button>
      </div>
      {/* Code body — click anywhere to copy (selection-aware) */}
      <div
        role="button"
        tabIndex={0}
        onClick={handleBodyClick}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            handleCopy()
          }
        }}
        aria-label={copied ? 'Copied code to clipboard' : 'Copy code to clipboard'}
        title={copied ? 'Copied!' : 'Click to copy'}
        className="overflow-x-auto bg-bg cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent"
      >
        <pre className="p-4 m-0">
          <code
            className="font-mono text-xs leading-relaxed"
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </pre>
      </div>
    </div>
  )
}
