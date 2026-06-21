import { useEffect, useRef, useState } from 'react'
import { MessageSquare } from 'lucide-react'
import type { PermissionRequestMsg } from '@/cli/types'
import { OTHER, isAnswered as isQAnswered, resolveAnswers } from './askUserQuestionLogic'

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
  /** Skip the question(s) entirely (proceed without answering). */
  onSkip: () => void
  th?: boolean
}

/**
 * Renders the AskUserQuestion tool call as an interactive question UI instead of the
 * generic Allow/Deny prompt. Questions are shown ONE AT A TIME; each offers its
 * options plus a free-text "Other"; selections accumulate locally and are forwarded
 * back as `updatedInput.answers` only on the final submit so the CLI gets the answers.
 */
export function AskUserQuestionPrompt({
  request,
  onAnswer,
  onDeny,
  onSkip,
  th = true,
}: AskUserQuestionPromptProps): JSX.Element {
  const input = request.input as AskInput
  const questions = input?.questions ?? []
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [otherText, setOtherText] = useState<Record<number, string>>({})
  const [current, setCurrent] = useState(0)
  const firstButtonRef = useRef<HTMLButtonElement>(null)

  // Reset all per-question state when a different request arrives.
  useEffect(() => {
    setSelected({})
    setOtherText({})
    setCurrent(0)
  }, [request.id])

  // Move focus to the first option whenever the visible question changes.
  useEffect(() => {
    firstButtonRef.current?.focus()
  }, [current, request.id])

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

  const submitAll = (): void => {
    onAnswer({ ...input, answers: resolveAnswers(questions, selected, otherText) })
  }

  const isLast = current >= questions.length - 1
  const canAdvance = questions.length === 0 || isQAnswered(current, selected, otherText)

  const advance = (): void => {
    if (questions.length === 0 || isLast) submitAll()
    else setCurrent((c) => c + 1)
  }

  const q = questions[current]
  const otherActive = (selected[current] ?? []).includes(OTHER)

  return (
    <div
      className="rounded-lg border border-blue-400/50 bg-blue-400/5 p-4 shadow-sm"
      onKeyDown={onKeyDown}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <MessageSquare size={18} className="text-blue-400" />
          <h2 className="text-sm font-semibold text-fg">
            {th ? 'Claude ถามคุณ' : 'Claude asks you'}
          </h2>
        </div>
        {questions.length > 1 && (
          <span className="text-xs text-fg-muted">
            {th ? `ข้อ ${current + 1} จาก ${questions.length}` : `Question ${current + 1} of ${questions.length}`}
          </span>
        )}
      </div>

      {questions.length === 0 ? (
        <p className="mb-4 text-xs text-fg-muted">
          {th ? 'Claude ขอถามคำถาม' : 'Claude wants to ask a question'}
        </p>
      ) : (
        <div className="mb-4">
          <p className="mb-2 text-sm font-medium text-fg">{q.question}</p>
          <div className="space-y-1">
            {q.options.map((opt, oi) => {
              const isSelected = (selected[current] ?? []).includes(opt.label)
              return (
                <button
                  key={oi}
                  ref={oi === 0 ? firstButtonRef : undefined}
                  type="button"
                  onClick={() => toggle(current, opt.label, q.multiSelect)}
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

            {/* Free-text "Other" — always available, matching real Claude. */}
            <button
              type="button"
              onClick={() => toggle(current, OTHER, q.multiSelect)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors ${
                otherActive
                  ? 'border-blue-400 bg-blue-400/15 text-fg'
                  : 'border-border text-fg-muted hover:border-border-strong hover:text-fg'
              }`}
            >
              <span className="block font-medium">{th ? 'อื่น ๆ (พิมพ์เอง)' : 'Other (type your own)'}</span>
            </button>
            {otherActive && (
              <input
                type="text"
                autoFocus
                value={otherText[current] ?? ''}
                onChange={(e) => setOtherText((prev) => ({ ...prev, [current]: e.target.value }))}
                placeholder={th ? 'พิมพ์คำตอบของคุณ' : 'Type your answer'}
                className="mt-1 w-full rounded-md border border-border bg-bg px-3 py-2 text-sm text-fg focus:border-blue-400 focus:outline-none"
              />
            )}
          </div>
        </div>
      )}

      <div className="flex items-center justify-end gap-2">
        <button
          type="button"
          onClick={onSkip}
          className="mr-auto rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
        >
          {th ? 'ข้ามคำถาม' : 'Skip'}
        </button>
        {current > 0 && (
          <button
            type="button"
            onClick={() => setCurrent((c) => c - 1)}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            {th ? 'ย้อนกลับ' : 'Back'}
          </button>
        )}
        <button
          type="button"
          onClick={onDeny}
          className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-destructive hover:text-destructive"
        >
          {th ? 'ยกเลิก (Esc)' : 'Cancel (Esc)'}
        </button>
        <button
          type="button"
          onClick={advance}
          disabled={!canAdvance}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isLast ? (th ? 'ตอบ' : 'Submit') : (th ? 'ถัดไป' : 'Next')}
        </button>
      </div>
    </div>
  )
}
