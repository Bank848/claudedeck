import { useState } from 'react'
import { Copy, Check } from 'lucide-react'

/**
 * Copy-to-clipboard button shown on assistant messages. Mirrors ReadAloudButton's
 * 6x6 ghost-icon style so the header controls line up. Renders nothing when there
 * is no text to copy (e.g. a tool-only turn).
 */
export function CopyButton({ text }: { text: string }): JSX.Element | null {
  const [copied, setCopied] = useState(false)

  if (!text) return null

  const handleCopy = (): void => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    })
  }

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied to clipboard' : 'Copy message'}
      title={copied ? 'Copied!' : 'Copy message'}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-surface-2 ${
        copied ? 'text-success' : 'text-fg-muted hover:text-fg'
      }`}
    >
      {copied ? <Check size={13} /> : <Copy size={14} />}
    </button>
  )
}
