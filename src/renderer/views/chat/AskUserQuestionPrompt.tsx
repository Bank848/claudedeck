import { useEffect, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import type { PermissionRequestMsg } from '@/cli/types'

interface QuestionOption { label: string; description?: string }
interface Question {
  question: string
  header: string
  options: QuestionOption[]
  multiSelect?: boolean
}
interface AskInput { questions?: Question[] }

export interface AskUserQuestionPromptProps {
  request: PermissionRequestMsg
  onAnswer: (answeredInput: unknown) => void
  onDeny: () => void
  th?: boolean
}

/**
 * Renders the AskUserQuestion tool call as an interactive question UI instead
 * of the generic Allow/Deny permission prompt. Collects the user's selections
 * and forwards them back as `updatedInput` so the CLI gets the answers.
 */
export function AskUserQuestionPrompt({
  request,
  onAnswer,
  onDeny,
  th = true,
}: AskUserQuestionPromptProps): JSX.Element {
  const input = request.input as AskInput
  const questions = input?.questions ?? []
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const firstButtonRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    firstButtonRef.current?.focus()
  }, [request.id])

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') { e.preventDefault(); onDeny() }
  }

  const toggle = (qi: number, label: string, multiSelect?: boolean): void => {
    setSelected((prev) => {
      const cur = prev[qi] ?? []
      if (multiSelect) {
        const next = cur.includes(label) ? cur.filter((l) => l !== label) : [...cur, label]
        return { ...prev, [qi]: next }
      }
      return { ...prev, [qi]: [label] }
    })
  }

  const canSubmit = questions.length === 0 || questions.every((_, qi) => (selected[qi] ?? []).length > 0)

  const handleSubmit = (): void => {
    const answers: Record<string, string | string[]> = {}
    questions.forEach((q, qi) => {
      const sel = selected[qi] ?? []
      answers[q.question] = q.multiSelect ? sel : (sel[0] ?? '')
    })
    onAnswer({ ...input, answers })
  }

  return (
    <div
      className="rounded-lg border border-blue-400/50 bg-blue-400/5 p-4 shadow-sm"
      onKeyDown={onKeyDown}
    >
      <div className="mb-3 flex items-center gap-2">
        <MessageSquare size={18} className="text-blue-400" />
        <h2 className="text-sm font-semibold text-fg">
          {th ? 'Claude ถามคุณ' : 'Claude asks you'}
        </h2>
      </div>

      {questions.length === 0 ? (
        <p className="mb-4 text-xs text-fg-muted">
          {th ? 'Claude ขอถามคำถาม' : 'Claude wants to ask a question'}
        </p>
      ) : (
        <div className="mb-4 space-y-4">
          {questions.map((q, qi) => (
            <div key={qi}>
              <p className="mb-2 text-sm font-medium text-fg">{q.question}</p>
              <div className="space-y-1">
                {q.options.map((opt, oi) => {
                  const isSelected = (selected[qi] ?? []).includes(opt.label)
                  return (
                    <button
                      key={oi}
                      ref={qi === 0 && oi === 0 ? firstButtonRef : undefined}
                      type="button"
                      onClick={() => toggle(qi, opt.label, q.multiSelect)}
                      className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                        isSelected
                          ? 'border-blue-400 bg-blue-400/15 text-fg'
                          : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'
                      }`}
                    >
                      <span className="block font-medium">{opt.label}</span>
                      {opt.description && (
                        <span className="block text-xs text-fg-muted">{opt.description}</span>
                      )}
                    </button>
                  )
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-destructive hover:text-destructive"
        >
          {th ? 'ยกเลิก (Esc)' : 'Cancel (Esc)'}
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {th ? 'ตอบ' : 'Submit'}
        </button>
      </div>
    </div>
  )
}
