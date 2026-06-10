import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { ArrowUp, Mic, GitBranch, Square, X } from 'lucide-react'
import { ModelPicker } from '@/components/ModelPicker'
import { ModePicker } from '@/components/controls/ModePicker'
import { EffortPicker } from '@/components/controls/EffortPicker'
import { UsagePill } from '@/components/controls/UsagePill'
import { PlusMenu } from '@/components/controls/PlusMenu'
import { useSettings } from '@/settings/SettingsContext'
import { useDictation } from '@/settings/speechRecognition'
import { resolveLang } from '@/settings/speech'
import { MODELS } from '@/mock/fixtures'
import type { Effort, PermissionMode } from '@/cli/types'

export interface ComposerHandle {
  /** Submit the current text programmatically (used by the "ส่ง" voice command). */
  submit: () => void
  /** Set the model by id (used by the "โมเดล …" voice command). */
  setModel: (id: string) => void
  /** Set the reasoning effort (used by the "เอฟฟอร์ต …" voice command); undefined = Auto. */
  setEffort: (effort?: Effort) => void
}

interface ImageDraft {
  mediaType: string
  data: string      // raw base64, no data-URI prefix
  preview: string   // data-URI for <img src>
}

interface ComposerProps {
  /** Session model label, used to seed the initial selection. */
  model: string
  /** Called with the message text + selected model id + effort + images when the user sends. */
  onSend: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  /** True while this session's turn is streaming — blocks a second send (B4). */
  busy?: boolean
  /** Stop/cancel the running turn; the send button becomes a Stop button while busy (#2). */
  onStop?: () => void
  /** Active session token count (for the usage ring). */
  tokens: number
  /** Permission mode (lifted from App, still read by App.handleSend). */
  permissionMode: PermissionMode
  onChangePermission: (mode: PermissionMode) => void
  /** Retarget the active session cwd (Add folder). */
  onSetCwd: (path: string) => void
  /** Fork the conversation into a new tab, seeding it with the current draft text. */
  onFork?: (seedText: string) => void
}

function seedModelId(label: string): string {
  const hit = MODELS.find((m) => m.label.toLowerCase().includes(label.toLowerCase()))
  return hit?.id ?? 'opus-4-8'
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { model, onSend, onStop, busy = false, tokens, permissionMode, onChangePermission, onSetCwd, onFork },
  ref,
): JSX.Element {
  const { settings } = useSettings()
  const th = resolveLang(settings.voiceLang).short === 'th'
  const [value, setValue] = useState('')
  const [modelId, setModelId] = useState(() => seedModelId(model))
  const [effort, setEffort] = useState<Effort | undefined>(undefined)
  const [images, setImages] = useState<ImageDraft[]>([])
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
    if (busy) return
    const text = value.trim()
    if (!text && images.length === 0) return
    onSend(text, modelId, effort, images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined)
    setValue('')
    setImages([])
    requestAnimationFrame(resize)
  }

  const insertSlash = (): void => {
    setValue((v) => (v.startsWith('/') ? v : `/${v}`))
    textareaRef.current?.focus()
    requestAnimationFrame(resize)
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = Array.from(e.clipboardData.items)
    const imageItems = items.filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    e.preventDefault()
    imageItems.forEach((item) => {
      const file = item.getAsFile()
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        const dataUri = ev.target?.result as string
        // dataUri = "data:<mediaType>;base64,<data>"
        const commaIdx = dataUri.indexOf(',')
        const header = dataUri.slice(0, commaIdx)         // "data:image/png;base64"
        const data = dataUri.slice(commaIdx + 1)          // raw base64
        const mediaType = header.replace('data:', '').replace(';base64', '')
        setImages((prev) => [...prev, { mediaType, data, preview: dataUri }])
      }
      reader.readAsDataURL(file)
    })
  }

  useImperativeHandle(ref, () => ({ submit, setModel: setModelId, setEffort }))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const canSend = !busy && (value.trim().length > 0 || images.length > 0)
  const showMic = settings.speechToText && dictation.supported

  return (
    <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {/* Input area */}
        <div className="flex flex-col rounded-lg border border-border bg-bg transition-colors focus-within:border-border-strong">
          {/* Image thumbnails */}
          {images.length > 0 && (
            <div className="flex flex-wrap gap-2 px-3 pt-2">
              {images.map((img, i) => (
                <div key={i} className="relative">
                  <img
                    src={img.preview}
                    alt={`Attached image ${i + 1}`}
                    className="h-16 w-16 rounded-md object-cover border border-border"
                  />
                  <button
                    type="button"
                    onClick={() => setImages((prev) => prev.filter((_, idx) => idx !== i))}
                    aria-label={`Remove image ${i + 1}`}
                    className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-destructive text-white"
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value)
              resize()
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            aria-label="Message Claude"
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
              <EffortPicker value={effort} onChange={setEffort} />
              {onFork && (
                <button
                  type="button"
                  onClick={() => onFork(value.trim())}
                  aria-label="Fork the conversation into a new tab with this message"
                  title="Fork conversation into a new tab (carry this message)"
                  className="flex h-7 w-7 items-center justify-center rounded-full text-fg-muted transition-colors hover:bg-surface-2 hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <GitBranch size={15} />
                </button>
              )}
            </div>

            {/* Right: model, usage, send */}
            <div className="flex items-center gap-2">
              <ModelPicker value={modelId} onChange={setModelId} />
              <UsagePill tokens={tokens} />
              {busy && onStop ? (
                <button
                  type="button"
                  onClick={onStop}
                  title={th ? 'หยุดการตอบ' : 'Stop generating'}
                  aria-label={th ? 'หยุดการตอบ' : 'Stop generating'}
                  className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white transition-colors hover:bg-destructive/90 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                >
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
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
              )}
            </div>
          </div>
        </div>

        {/* Hint row */}
        <p className="mt-1.5 text-center text-xs text-fg-muted">
          Shift+Enter for new line · <span className="font-mono">/</span> for skills
          {showMic && ' · mic to dictate'}
        </p>
      </div>
    </div>
  )
})
