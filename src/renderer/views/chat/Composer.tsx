import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ArrowUp, Mic } from 'lucide-react'
import { ModelPicker } from '@/components/ModelPicker'
import { ModePicker } from '@/components/controls/ModePicker'
import { EffortPicker } from '@/components/controls/EffortPicker'
import { UsagePill } from '@/components/controls/UsagePill'
import { PlusMenu } from '@/components/controls/PlusMenu'
import { useSettings } from '@/settings/SettingsContext'
import { useDictation } from '@/settings/speechRecognition'
import { resolveLang } from '@/settings/speech'
import { MODELS } from '@/mock/fixtures'
import type { PermissionMode } from '@/cli/types'

export interface ComposerHandle {
  /** Submit the current text programmatically (used by the "ส่ง" voice command). */
  submit: () => void
  /** Set the model by id (used by the "โมเดล …" voice command). */
  setModel: (id: string) => void
}

interface ComposerProps {
  /** Session model label, used to seed the initial selection. */
  model: string
  /** Called with the message text + selected model id when the user sends. */
  onSend: (text: string, modelId: string) => void
  /** True while this session's turn is streaming — blocks a second send (B4). */
  busy?: boolean
  /** Active session token count (for the usage ring). */
  tokens: number
  /** Permission mode (lifted from App, still read by App.handleSend). */
  permissionMode: PermissionMode
  onChangePermission: (mode: PermissionMode) => void
  /** Retarget the active session cwd (Add folder). */
  onSetCwd: (path: string) => void
}

function seedModelId(label: string): string {
  const hit = MODELS.find((m) => m.label.toLowerCase().includes(label.toLowerCase()))
  return hit?.id ?? 'opus-4-8'
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { model, onSend, busy = false, tokens, permissionMode, onChangePermission, onSetCwd },
  ref,
): JSX.Element {
  const { settings, update } = useSettings()
  const [value, setValue] = useState('')
  const [modelId, setModelId] = useState(() => seedModelId(model))
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const resize = (): void => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`
  }

  const dictation = useDictation((text) => {
    setValue((v) => (v ? `${v} ${text}` : text))
    requestAnimationFrame(resize)
  }, resolveLang(settings.voiceLang).code)

  const submit = (): void => {
    if (busy) return // B4: turn in flight — ignore Enter / button / voice "ส่ง"
    const text = value.trim()
    if (!text) return
    onSend(text, modelId)
    setValue('')
    requestAnimationFrame(resize)
  }

  const insertSlash = (): void => {
    setValue((v) => (v.startsWith('/') ? v : `/${v}`))
    textareaRef.current?.focus()
    requestAnimationFrame(resize)
  }

  useImperativeHandle(ref, () => ({ submit, setModel: setModelId }))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const canSend = !busy && value.trim().length > 0
  const showMic = settings.speechToText && dictation.supported

  return (
    <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {/* Input area */}
        <div className="flex flex-col rounded-lg border border-border bg-bg transition-colors focus-within:border-border-strong">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              resize()
            }}
            onKeyDown={handleKeyDown}
            placeholder={busy ? 'Working…' : dictation.listening ? 'Listening…' : 'Message Claude…'}
            rows={1}
            className="min-h-[44px] max-h-[200px] w-full resize-none bg-transparent px-4 py-3 text-sm text-fg placeholder:text-fg-muted focus:outline-none leading-relaxed"
            style={{ height: '44px' }}
          />

          {/* Control bar */}
          <div className="flex items-center justify-between px-3 pb-2 pt-1">
            {/* Left: plus, mic, mode */}
            <div className="flex items-center gap-2">
              <PlusMenu onSlash={insertSlash} onPickFolder={onSetCwd} />
              {showMic && (
                <button
                  type="button"
                  onClick={dictation.toggle}
                  aria-label={dictation.listening ? 'Stop dictation' : 'Dictate with voice'}
                  title={dictation.listening ? 'Stop dictation' : 'Dictate with voice'}
                  aria-pressed={dictation.listening}
                  className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                    dictation.listening
                      ? 'bg-destructive/20 text-destructive animate-pulse'
                      : 'text-fg-muted hover:bg-surface-2 hover:text-fg'
                  }`}
                >
                  <Mic size={15} />
                </button>
              )}
              <ModePicker value={permissionMode} onChange={onChangePermission} />
            </div>

            {/* Right: model, effort, usage, send */}
            <div className="flex items-center gap-2">
              <ModelPicker value={modelId} onChange={setModelId} />
              <EffortPicker value={settings.effort} onChange={(level) => update('effort', level)} />
              <UsagePill tokens={tokens} />
              <button
                type="button"
                onClick={submit}
                disabled={!canSend}
                title={busy ? 'Working…' : 'Send message'}
                aria-label={busy ? 'Working, please wait' : 'Send message'}
                className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                  canSend
                    ? 'bg-accent hover:bg-accent-hover text-white cursor-pointer'
                    : 'bg-surface-2 text-fg-muted cursor-not-allowed'
                }`}
              >
                <ArrowUp size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Hint row */}
        <p className="mt-1.5 text-center text-xs text-fg-muted opacity-60">
          Shift+Enter for new line · <span className="font-mono">/</span> for skills
          {showMic && ' · 🎙 mic to dictate'}
        </p>
      </div>
    </div>
  )
})
