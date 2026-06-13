import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { ArrowUp, Mic, Square, X, ListPlus, Pencil, GitBranch } from 'lucide-react'
import { ModelPicker } from '@/components/ModelPicker'
import { ModePicker } from '@/components/controls/ModePicker'
import { EffortPicker } from '@/components/controls/EffortPicker'
import { UsagePill } from '@/components/controls/UsagePill'
import { PlusMenu } from '@/components/controls/PlusMenu'
import { useSettings } from '@/settings/SettingsContext'
import { useDictation } from '@/settings/speechRecognition'
import { resolveLang } from '@/settings/speech'
import { loadEffort, saveEffort } from '@/settings/uiPrefs'
import { MODELS } from '@/mock/fixtures'
import type { Effort, PermissionMode, QueuedMessage } from '@/cli/types'

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
  /** Spawn a fresh task in a new tab, seeding it with the current draft text. */
  onSpawn?: (seedText: string) => void
  /** Queued messages for this session (typed while a turn was running). */
  queued?: QueuedMessage[]
  /** Enqueue the current draft while busy (Enter while a turn runs). */
  onEnqueue?: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  /** Interrupt: stop the running turn and send the current draft now (Ctrl+Enter). */
  onInterrupt?: (text: string, modelId: string, effort?: Effort, images?: Array<{ mediaType: string; data: string }>) => void
  /** Remove a queued message by id (chip X button). */
  onRemoveQueued?: (id: string) => void
}

function seedModelId(label: string): string {
  const hit = MODELS.find((m) => m.label.toLowerCase().includes(label.toLowerCase()))
  return hit?.id ?? 'opus-4-8'
}

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer(
  { model, onSend, onStop, busy = false, tokens, permissionMode, onChangePermission, onSetCwd, onSpawn,
    queued = [], onEnqueue, onInterrupt, onRemoveQueued },
  ref,
): JSX.Element {
  const { settings } = useSettings()
  const th = resolveLang(settings.voiceLang).short === 'th'
  const [value, setValue] = useState('')
  const [modelId, setModelId] = useState(() => seedModelId(model))
  // Sticky across restarts (was: always reset to Auto). Persist on every change so
  // the picker AND voice commands ("high effort", …) both stick.
  const [effort, setEffort] = useState<Effort | undefined>(loadEffort)
  useEffect(() => { saveEffort(effort) }, [effort])
  const [images, setImages] = useState<ImageDraft[]>([])
  const [dragging, setDragging] = useState(false)
  const dragDepth = useRef(0)
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

  const imagesPayload = (): Array<{ mediaType: string; data: string }> | undefined =>
    images.length ? images.map(({ mediaType, data }) => ({ mediaType, data })) : undefined

  const clearDraft = (): void => {
    setValue('')
    setImages([])
    requestAnimationFrame(resize)
  }

  // While a turn is running, Enter queues the draft (auto-sent when the turn
  // finishes) instead of being blocked. When idle, it sends normally.
  const submit = (): void => {
    const text = value.trim()
    if (!text && images.length === 0) return
    if (busy) {
      if (!onEnqueue) return
      onEnqueue(text, modelId, effort, imagesPayload())
    } else {
      onSend(text, modelId, effort, imagesPayload())
    }
    clearDraft()
  }

  // Ctrl+Enter while busy: stop the running turn and send this draft immediately.
  const interrupt = (): void => {
    const text = value.trim()
    if (!text && images.length === 0) return
    if (!onInterrupt) return
    onInterrupt(text, modelId, effort, imagesPayload())
    clearDraft()
  }

  // Pull a queued message back into the textarea to edit it. ALWAYS remove it from
  // the queue first (unconditionally — not just while busy): if the session has
  // just gone idle, the auto-flush effect is about to send this very item, so
  // leaving it in the queue would double-send (once by flush, once on re-submit).
  const editQueued = (q: QueuedMessage): void => {
    onRemoveQueued?.(q.id)
    setValue((v) => (v ? `${q.text} ${v}` : q.text))
    setModelId(q.modelId)
    setEffort(q.effort)
    textareaRef.current?.focus()
    requestAnimationFrame(resize)
  }

  const insertSlash = (): void => {
    setValue((v) => (v.startsWith('/') ? v : `/${v}`))
    textareaRef.current?.focus()
    requestAnimationFrame(resize)
  }

  // Read an image File into a base64 ImageDraft and append it. Shared by paste + drag-drop.
  const addImageFile = (file: File): void => {
    if (!file.type.startsWith('image/')) return
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
  }

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const imageItems = Array.from(e.clipboardData.items).filter((item) => item.type.startsWith('image/'))
    if (imageItems.length === 0) return
    e.preventDefault()
    imageItems.forEach((item) => {
      const file = item.getAsFile()
      if (file) addImageFile(file)
    })
  }

  // Drag-and-drop image attachments onto the composer. Track depth so nested
  // dragenter/leave events don't flicker the highlight off prematurely.
  const handleDragEnter = (e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    dragDepth.current += 1
    setDragging(true)
  }

  const handleDragOver = (e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    e.preventDefault()
    e.dataTransfer.dropEffect = 'copy'
  }

  const handleDragLeave = (e: React.DragEvent): void => {
    if (!Array.from(e.dataTransfer.types).includes('Files')) return
    dragDepth.current = Math.max(0, dragDepth.current - 1)
    if (dragDepth.current === 0) setDragging(false)
  }

  const handleDrop = (e: React.DragEvent): void => {
    const files = Array.from(e.dataTransfer.files).filter((f) => f.type.startsWith('image/'))
    dragDepth.current = 0
    setDragging(false)
    if (files.length === 0) return
    e.preventDefault()
    files.forEach(addImageFile)
  }

  useImperativeHandle(ref, () => ({ submit, setModel: setModelId, setEffort }))

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>): void => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      // Ctrl/Cmd+Enter: interrupt the running turn and send now.
      e.preventDefault()
      if (busy) interrupt()
      else submit()
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const canSend = value.trim().length > 0 || images.length > 0
  const showMic = settings.speechToText && dictation.supported

  return (
    <div className="shrink-0 border-t border-border bg-surface px-4 py-3">
      <div className="mx-auto max-w-3xl">
        {/* Input area */}
        <div
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`relative flex flex-col rounded-2xl border bg-bg transition-shadow focus-within:ring-2 focus-within:ring-accent/40 ${
            dragging ? 'border-accent ring-2 ring-accent/40' : 'border-border'
          }`}
        >
          {dragging && (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl bg-accent/10 text-sm font-medium text-accent">
              {th ? 'วางรูปเพื่อแนบ' : 'Drop image to attach'}
            </div>
          )}
          {/* Queued messages (typed while a turn was running) */}
          {queued.length > 0 && (
            <ul className="flex flex-col gap-1 px-3 pt-2" aria-label={th ? 'คิวข้อความ' : 'Queued messages'}>
              {queued.map((q, i) => (
                <li
                  key={q.id}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface-2 px-2 py-1 text-xs text-fg-muted"
                >
                  <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-accent/20 text-[10px] text-accent">
                    {i + 1}
                  </span>
                  <button
                    type="button"
                    onClick={() => editQueued(q)}
                    title={th ? 'แก้ไขข้อความในคิว' : 'Edit queued message'}
                    aria-label={th ? `แก้ไขข้อความในคิวที่ ${i + 1}` : `Edit queued message ${i + 1}`}
                    className="flex min-w-0 flex-1 items-center gap-1.5 truncate text-left hover:text-fg focus:outline-none focus-visible:ring-2 focus-visible:ring-accent rounded"
                  >
                    <Pencil size={11} className="shrink-0" />
                    <span className="truncate">{q.text || (th ? '(รูปภาพ)' : '(image)')}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onRemoveQueued?.(q.id)}
                    title={th ? 'ลบออกจากคิว' : 'Remove from queue'}
                    aria-label={th ? `ลบข้อความในคิวที่ ${i + 1}` : `Remove queued message ${i + 1}`}
                    className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-fg-muted hover:bg-destructive/20 hover:text-destructive focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    <X size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}

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
            placeholder={busy ? (th ? 'พิมพ์เพื่อต่อคิว…' : 'Type to queue…') : dictation.listening ? 'Listening…' : 'Message Claude…'}
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
              {onSpawn && (
                <button
                  type="button"
                  onClick={() => onSpawn(value.trim())}
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
              {busy ? (
                <>
                  <button
                    type="button"
                    onClick={submit}
                    disabled={!canSend}
                    title={th ? 'ต่อคิว (Enter) · แทรกทันที Ctrl+Enter' : 'Queue (Enter) · Ctrl+Enter to interrupt'}
                    aria-label={th ? 'ต่อคิวข้อความ' : 'Queue message'}
                    className={`flex h-7 w-7 items-center justify-center rounded-full transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-accent ${
                      canSend
                        ? 'bg-accent/80 hover:bg-accent text-white cursor-pointer'
                        : 'bg-surface-2 text-fg-muted cursor-not-allowed'
                    }`}
                  >
                    <ListPlus size={14} />
                  </button>
                  {onStop && (
                    <button
                      type="button"
                      onClick={onStop}
                      title={th ? 'หยุดการตอบ' : 'Stop generating'}
                      aria-label={th ? 'หยุดการตอบ' : 'Stop generating'}
                      className="flex h-7 w-7 items-center justify-center rounded-full bg-destructive text-white transition-colors hover:bg-destructive/90 cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                    >
                      <Square size={13} fill="currentColor" />
                    </button>
                  )}
                </>
              ) : (
                <button
                  type="button"
                  onClick={submit}
                  disabled={!canSend}
                  title="Send message"
                  aria-label="Send message"
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
