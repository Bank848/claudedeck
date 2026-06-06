import { useRef, useState } from 'react'
import { ArrowUp, Slash, Mic } from 'lucide-react'
import { ModelPicker } from '@/components/ModelPicker'
import { useSettings } from '@/settings/SettingsContext'
import { useDictation } from '@/settings/speechRecognition'
import { resolveLang } from '@/settings/speech'
import { MODELS } from '@/mock/fixtures'

interface ComposerProps {
  /** Session model label, used to seed the initial selection. */
  model: string
}

function seedModelId(label: string): string {
  const hit = MODELS.find((m) => m.label.toLowerCase().includes(label.toLowerCase()))
  return hit?.id ?? 'opus-4-8'
}

export function Composer({ model }: ComposerProps): JSX.Element {
  const { settings } = useSettings()
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      // mock send — no-op
    }
  }

  const canSend = value.trim().length > 0
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
            placeholder={dictation.listening ? 'Listening…' : 'Message Claude…'}
            rows={1}
            className="min-h-[44px] max-h-[200px] w-full resize-none bg-transparent px-4 py-3 text-sm text-fg placeholder:text-fg-muted focus:outline-none leading-relaxed"
            style={{ height: '44px' }}
          />

          {/* Bottom bar */}
          <div className="flex items-center justify-between px-3 pb-2 pt-1">
            {/* Left: slash hint + model picker */}
            <div className="flex items-center gap-2">
              <span className="flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-fg-muted border border-border hover:bg-surface-2 transition-colors cursor-pointer">
                <Slash size={11} />
                <span>Skills</span>
              </span>
              <ModelPicker value={modelId} onChange={setModelId} />
            </div>

            {/* Right: mic + send */}
            <div className="flex items-center gap-1.5">
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
              <button
                type="button"
                disabled={!canSend}
                title="Send message"
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
}
