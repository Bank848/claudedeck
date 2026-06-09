import { useEffect, useRef, useState } from 'react'
import { GitBranch } from 'lucide-react'
import { isValidBranchName } from '@/state/forkSession'

export interface ForkDialogProps {
  /** Prefilled, editable branch name. */
  defaultBranch: string
  /** Prefilled starting prompt (may be empty). */
  seed: string
  /** Confirm — only called with a valid branch. */
  onConfirm: (args: { branch: string; seed: string }) => void
  onCancel: () => void
  /** Active-language label pair picker from App (TH/EN). */
  th: boolean
}

export function ForkDialog({ defaultBranch, seed, onConfirm, onCancel, th }: ForkDialogProps): JSX.Element {
  const [branch, setBranch] = useState(defaultBranch)
  const [prompt, setPrompt] = useState(seed)
  const branchRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    branchRef.current?.focus()
    branchRef.current?.select()
  }, [])

  const valid = isValidBranchName(branch.trim())
  const submit = (): void => {
    if (!valid) return
    onConfirm({ branch: branch.trim(), seed: prompt.trim() })
  }

  const onKeyDown = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape') {
      e.preventDefault()
      onCancel()
    }
  }

  const t = (en: string, thai: string): string => (th ? thai : en)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onKeyDown={onKeyDown}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="fork-title"
        aria-describedby="fork-desc"
        className="w-full max-w-md rounded-lg border border-border bg-surface p-5 shadow-xl"
      >
        <div className="mb-3 flex items-center gap-2">
          <GitBranch size={18} className="text-accent" />
          <h2 id="fork-title" className="text-sm font-semibold text-fg">
            {t('Fork to a new worktree', 'แยกไปเวิร์กทรีใหม่')}
          </h2>
        </div>
        <p id="fork-desc" className="mb-3 text-xs text-fg-muted">
          {t(
            'Creates a new branch in a separate worktree and opens it as a new session. (Ctrl+Shift+B)',
            'สร้าง branch ใหม่ในเวิร์กทรีแยก แล้วเปิดเป็นเซสชันใหม่ (Ctrl+Shift+B)',
          )}
        </p>

        <label htmlFor="fork-branch" className="mb-1 block text-xs font-medium text-fg">
          {t('Branch name', 'ชื่อ branch')}
        </label>
        <input
          id="fork-branch"
          ref={branchRef}
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              submit()
            }
          }}
          aria-invalid={!valid}
          className="mb-1 w-full rounded-md border border-border bg-bg px-2 py-1.5 font-mono text-sm text-fg focus:border-border-strong focus:outline-none"
        />
        {!valid && (
          <p role="alert" className="mb-2 text-[11px] text-destructive">
            {t('Invalid branch name (no spaces, no leading dash, no "..").', 'ชื่อ branch ไม่ถูกต้อง')}
          </p>
        )}

        <label htmlFor="fork-seed" className="mb-1 mt-3 block text-xs font-medium text-fg">
          {t('Starting prompt (optional)', 'ข้อความเริ่มต้น (ไม่บังคับ)')}
        </label>
        <textarea
          id="fork-seed"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          rows={3}
          className="mb-4 w-full resize-none rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-border-strong focus:outline-none"
        />

        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            {t('Cancel (Esc)', 'ยกเลิก (Esc)')}
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!valid}
            className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
          >
            {t('Fork', 'แยก')}
          </button>
        </div>
      </div>
    </div>
  )
}
