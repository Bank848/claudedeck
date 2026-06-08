import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { filterGuide } from '@/reference/guide'

export default function GuideView(): JSX.Element {
  const [query, setQuery] = useState('')
  const sections = useMemo(() => filterGuide(query), [query])

  const scrollTo = (id: string): void => {
    document.getElementById(`guide-${id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-surface px-4 py-3">
        <h1 className="mb-3 text-lg font-semibold text-fg">Guide</h1>
        <label htmlFor="guide-search" className="sr-only">
          Search the guide
        </label>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-muted" aria-hidden="true" />
          <input
            id="guide-search"
            type="text"
            placeholder="Search commands, flags, shortcuts..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-bg py-2 pl-9 pr-3 text-sm text-fg placeholder-fg-muted transition-colors focus:border-border-strong focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          />
        </div>
        {sections.length > 0 && (
          <nav aria-label="Guide sections" className="mt-3 flex flex-wrap gap-2">
            {sections.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => scrollTo(s.id)}
                className="rounded-full border border-border bg-bg px-3 py-1 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                {s.title}
              </button>
            ))}
          </nav>
        )}
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {sections.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
            <div className="mb-2 text-3xl opacity-30">⊘</div>
            <p className="text-sm text-fg-muted">No entries match your search</p>
            {query && (
              <button
                type="button"
                onClick={() => setQuery('')}
                className="mt-3 text-xs text-accent transition-colors hover:text-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-6 px-4 py-4">
            {sections.map((section) => (
              <section
                key={section.id}
                id={`guide-${section.id}`}
                aria-labelledby={`guide-${section.id}-h`}
              >
                <h2
                  id={`guide-${section.id}-h`}
                  className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted"
                >
                  {section.title}
                </h2>
                <dl className="divide-y divide-border overflow-hidden rounded-md border border-border bg-surface">
                  {section.entries.map((entry) => (
                    <div key={entry.command} className="px-3 py-2.5">
                      <dt>
                        <code className="font-mono text-sm text-accent">{entry.command}</code>
                      </dt>
                      <dd className="mt-1 text-sm text-fg-muted">
                        {entry.desc}
                        {entry.example && (
                          <div className="mt-1 font-mono text-xs text-fg-muted/80">{entry.example}</div>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
