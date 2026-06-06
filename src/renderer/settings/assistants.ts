/** Custom user-defined assistants, persisted to localStorage, merged with the built-in MODELS. */
import { useCallback, useState } from 'react'
import { MODELS, type ModelOption, type Provider } from '@/mock/fixtures'

const STORAGE_KEY = 'claudedeck.assistants'

function load(): ModelOption[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) return JSON.parse(raw) as ModelOption[]
  } catch {
    /* ignore */
  }
  return []
}

function save(list: ModelOption[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    /* ignore */
  }
}

interface UseAssistants {
  /** Built-in models + custom assistants. */
  all: ModelOption[]
  custom: ModelOption[]
  add: (label: string, provider: Provider, model?: string) => string
  remove: (id: string) => void
}

export function useAssistants(): UseAssistants {
  const [custom, setCustom] = useState<ModelOption[]>(load)

  const add = useCallback((label: string, provider: Provider, model?: string): string => {
    const id = `custom-${Date.now()}`
    const entry: ModelOption = {
      id,
      provider,
      label: label.trim() || 'New assistant',
      sublabel: model?.trim() || 'Custom assistant',
    }
    setCustom((prev) => {
      const next = [...prev, entry]
      save(next)
      return next
    })
    return id
  }, [])

  const remove = useCallback((id: string): void => {
    setCustom((prev) => {
      const next = prev.filter((a) => a.id !== id)
      save(next)
      return next
    })
  }, [])

  return { all: [...MODELS, ...custom], custom, add, remove }
}
