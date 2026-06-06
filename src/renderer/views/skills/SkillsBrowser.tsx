'use client'

import { useState, useMemo } from 'react'
import { Search } from 'lucide-react'
import { SKILLS } from '@/mock/fixtures'

export default function SkillsBrowser(): JSX.Element {
  const [searchQuery, setSearchQuery] = useState('')

  const filteredSkills = useMemo(() => {
    const q = searchQuery.toLowerCase()
    return SKILLS.filter((skill) => {
      return (
        skill.name.toLowerCase().includes(q) ||
        skill.description.toLowerCase().includes(q) ||
        skill.category.toLowerCase().includes(q) ||
        skill.namespace.toLowerCase().includes(q)
      )
    })
  }, [searchQuery])

  const categories = useMemo(() => {
    return Array.from(new Set(filteredSkills.map((s) => s.category))).sort()
  }, [filteredSkills])

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {/* Header */}
      <div className="shrink-0 border-b border-border bg-surface px-4 py-3">
        <h1 className="mb-3 text-lg font-semibold text-fg">Skills</h1>
        <div className="relative">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-fg-muted" />
          <input
            type="text"
            placeholder="Search skills..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-md border border-border bg-bg py-2 pl-9 pr-3 text-sm text-fg placeholder-fg-muted transition-colors focus:border-border-strong focus:outline-none"
          />
        </div>
      </div>

      {/* Content */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {filteredSkills.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-4 py-8 text-center">
            <div className="mb-2 text-3xl opacity-30">⊘</div>
            <p className="text-sm text-fg-muted">No skills match your search</p>
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="mt-3 text-xs text-accent transition-colors hover:text-accent-hover"
              >
                Clear search
              </button>
            )}
          </div>
        ) : (
          <div className="space-y-4 px-4 py-4">
            {categories.map((category) => {
              const categorySkills = filteredSkills.filter(
                (s) => s.category === category
              )
              return (
                <div key={category}>
                  <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
                    {category}
                  </h2>
                  <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                    {categorySkills.map((skill) => (
                      <div
                        key={skill.id}
                        className="rounded-md border border-border bg-surface p-3 transition-colors hover:border-border-strong"
                      >
                        <div className="mb-2 flex items-start justify-between gap-2">
                          <h3 className="font-medium text-fg">{skill.name}</h3>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-xs text-fg-muted">
                            {skill.namespace}
                          </span>
                        </div>
                        <p className="mb-3 line-clamp-2 text-sm text-fg-muted">
                          {skill.description}
                        </p>
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-xs text-fg-muted">
                            {skill.category}
                          </span>
                          {skill.trigger && (
                            <span className="font-mono text-xs text-accent">
                              {skill.trigger}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
