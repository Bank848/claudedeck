import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { useSettings } from '@/settings/SettingsContext'
import { useVoiceCommands, dispatchCommand, type VoiceCommand } from '@/settings/voiceCommands'
import { useLocalVoice } from '@/settings/localVoice'
import { plainSpeakableText, resolveLang } from '@/settings/speech'
import { speakSmart, cancelSmart } from '@/settings/tts'
import { VIEW_NAMES, STATUS, collectPrewarmPhrases } from '@/settings/prewarmPhrases'
import { useMikuPrewarm, useMikuAutostart } from '@/settings/mikuServer'
import { VoiceControlIndicator } from '@/components/VoiceControlIndicator'

import { TitleBar } from '@/layout/TitleBar'
import UpdateBanner from '@/components/UpdateBanner'
import { ActivityBar } from '@/layout/ActivityBar'
import { Sidebar } from '@/layout/Sidebar'
import { TabStrip } from '@/layout/TabStrip'
import { RightPanel } from '@/layout/RightPanel'
import { BottomPanel } from '@/layout/BottomPanel'
import { StatusBar } from '@/layout/StatusBar'

import ChatView from '@/views/chat/ChatView'
import KanbanBoard from '@/views/tasks/KanbanBoard'
import DiffView from '@/views/diffs/DiffView'
import SkillsBrowser from '@/views/skills/SkillsBrowser'
import UsageView from '@/views/usage/UsageView'
import GuideView from '@/views/guide/GuideView'
import SettingsView from '@/views/settings/SettingsView'

import { ACTIVE_SESSION_ID, MODELS, type ActivityId, type Session } from '@/mock/fixtures'
import { MODE_OPTIONS } from '@/settings/permissionModes'
import { EFFORT_OPTIONS } from '@/settings/effortLevels'
import { loadPermissionMode, savePermissionMode } from '@/settings/uiPrefs'
import { useSessions, emptySession, toStored } from '@/state/useSessions'
import { deriveSessionTitle, isDefaultTitle } from '@/state/sessionTitle'
import * as sessionsClient from '@/state/sessionsClient'
import { contextPct, contextTokensOf, crossed80 } from '@/settings/contextWindow'
import type { ComposerHandle } from '@/views/chat/Composer'
import * as claudeClient from '@/cli/claudeClient'
import { permissionResponseOutcome } from '@/cli/permissionOutcome'
import { startActiveTurn, endActiveTurn, activeTurnFor, type ActiveTurns } from '@/state/activeTurns'
import type { Effort, PermissionMode, ClaudeEvent, PermissionSettings, PermissionRequestMsg, ImageAttachment } from '@/cli/types'
import { loadPermissions, savePermissions } from '@/settings/permissionRules'
import { PermissionPrompt } from '@/views/chat/PermissionPrompt'
import { ModelSuggestion } from '@/views/chat/ModelSuggestion'
import { voiceToChoice } from '@/views/chat/modelSuggestionControls'
import {
  suggestModelHeuristic,
  decideRouting,
  detectErrorTrace,
  modelIdToTier,
  TIER_TO_MODEL_ID,
  type Tier,
  type RoutingDecision,
} from '@/settings/modelRouting'
import { useAuth } from '@/cli/useAuth'
import { LoginBanner } from '@/components/LoginBanner'

export default function App(): JSX.Element {
  const { settings, update } = useSettings()
  const { state: sessionsState, dispatch: sessionsDispatch } = useSessions()
  const sessions = sessionsState.sessions
  const composerRef = useRef<ComposerHandle>(null)
  const auth = useAuth()

  const [claudeOk, setClaudeOk] = useState(false)
  // Sticky across restarts (was: always reset to 'plan'). Persist on every change so
  // the picker AND voice commands ("plan mode", "bypass", …) both stick.
  const [permissionMode, setPermissionMode] = useState<PermissionMode>(loadPermissionMode)
  useEffect(() => { savePermissionMode(permissionMode) }, [permissionMode])
  const [liveStatus, setLiveStatus] = useState('')
  // Persistent permission settings (P2/P3/P4) — curated once in Settings →
  // Permissions, saved to localStorage, sent to the CLI via --settings.
  const [permissions, setPermissions] = useState<PermissionSettings>(() => loadPermissions())
  const updatePermissions = (next: PermissionSettings): void => {
    setPermissions(next)
    savePermissions(next)
  }
  // FIFO queue of mid-turn tool-permission requests; head is shown in a modal.
  const [permissionQueue, setPermissionQueue] = useState<PermissionRequestMsg[]>([])
  // Live turn per session (a ref — the Stop button's visibility is already driven
  // by session.status, so tracking the id needs no re-render). Lets Stop/voice
  // cancel a running or hung turn (#2).
  const activeTurnsRef = useRef<ActiveTurns>({})
  const [pendingSeed, setPendingSeed] = useState<{ sessionId: string; text: string } | null>(null)

  // Per-turn model routing: the open confirm dialog (if any) + a resolver the dialog
  // calls with the user's chosen tier. routePendingRef locks out a second send while a
  // route decision (classifier await or open dialog) is in flight, so Enter/voice can't
  // spawn a duplicate turn or a second dialog.
  const [modelSuggestion, setModelSuggestion] = useState<{ decision: RoutingDecision; restingTier: Tier } | null>(null)
  const routeResolveRef = useRef<((tier: Tier) => void) | null>(null)
  const routePendingRef = useRef(false)

  // Probe for the claude CLI once.
  useEffect(() => {
    void claudeClient.claudeAvailable().then(setClaudeOk)
  }, [])

  // Monotonic id source (reducer stays pure — ids come from here).
  const idRef = useRef(0)
  const nextId = (p: string): string => `${p}-${Date.now()}-${idRef.current++}`
  const [activity, setActivity] = useState<ActivityId>('chat')
  const [activeSessionId, setActiveSessionId] = useState<string>(ACTIVE_SESSION_ID)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [bottomOpen, setBottomOpen] = useState(true)

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === activeSessionId) ?? sessions[0],
    [sessions, activeSessionId],
  )

  /* ── Session persistence: boot restore + debounced index save ───────────── */

  // Lazy-load a session's claude transcript into the reducer. Returns false when
  // no transcript exists (caller decides how to surface that). The parser is a
  // dynamic import so it stays out of the boot bundle.
  const loadHistory = async (sessionId: string, claudeSessionId: string): Promise<boolean> => {
    const jsonl = await sessionsClient.loadTranscript(claudeSessionId)
    if (!jsonl) return false
    const { parseTranscript } = await import('@/cli/transcriptParser')
    sessionsDispatch({ type: 'loadMessages', sessionId, messages: parseTranscript(jsonl), claudeSessionId })
    return true
  }

  // Don't persist until the first load completes, or we'd clobber the stored
  // index with the transient boot session.
  const hydratedRef = useRef(false)
  useEffect(() => {
    void sessionsClient.loadIndex().then(async (stored) => {
      if (stored.length) {
        sessionsDispatch({ type: 'hydrate', stored })
        const active = stored.find((s) => s.open) ?? stored[0]
        setActiveSessionId(active.id)
        if (active.claudeSessionId) await loadHistory(active.id, active.claudeSessionId)
      } else {
        // Fresh install (empty index): activeSessionId defaults to ACTIVE_SESSION_ID
        // ('s1'), which has no matching session — point it at the boot session so a
        // tab renders active. (Reviewer-flagged.)
        setActiveSessionId(sessions[0].id)
      }
      hydratedRef.current = true
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Debounced persistence whenever sessions change post-hydration.
  useEffect(() => {
    if (!hydratedRef.current) return
    const t = setTimeout(() => {
      void sessionsClient.saveIndex(sessions.map(toStored))
    }, 400)
    return () => clearTimeout(t)
  }, [sessions])

  // Quit-flush: the 400ms debounce can drop the final change if the app closes
  // right after it. Flush un-debounced on unload. (Reviewer-flagged.) Keep a ref
  // so the listener always sees the latest sessions without re-binding each render.
  const sessionsRef = useRef(sessions)
  sessionsRef.current = sessions
  useEffect(() => {
    const flush = (): void => {
      if (hydratedRef.current) void sessionsClient.saveIndex(sessionsRef.current.map(toStored))
    }
    window.addEventListener('beforeunload', flush)
    return () => window.removeEventListener('beforeunload', flush)
  }, [])

  /* ── Voice control for blind users ──────────────────────────────────────── */

  const cycleSession = (dir: 1 | -1): void =>
    setActiveSessionId((cur) => {
      const open = sessions.filter((s) => s.open)
      if (open.length === 0) return cur
      const i = open.findIndex((s) => s.id === cur)
      const next = (i + dir + open.length) % open.length
      return open[next].id
    })

  const { code: voiceCode, short: lang } = resolveLang(settings.voiceLang)
  const th = lang === 'th'
  /** Pick the active-language string from a {th,en} pair (shared phrase sets). */
  const say = (p: { th: string; en: string }): string => (th ? p.th : p.en)

  // ── Barge-in support: know when Miku is talking + guard against self-echo ────
  // speakingRef = a read-aloud is in flight; spokenTextRef = its (normalized) text,
  // so we can drop transcripts that are just Miku's own audio bleeding into the mic.
  const speakingRef = useRef(false)
  const spokenTextRef = useRef('')
  const norm = (s: string): string => s.toLowerCase().replace(/\s+/g, '')
  const beginSpeaking = (text: string): void => {
    speakingRef.current = true
    spokenTextRef.current = norm(text)
  }
  const endSpeaking = (): void => {
    speakingRef.current = false
    spokenTextRef.current = ''
  }
  // Stop whatever Miku is currently saying (any engine) and clear speaking state.
  const stopSpeaking = (): void => {
    cancelSmart()
    endSpeaking()
  }
  // True when the heard text is most likely Miku's own playback, not the user.
  const isLikelyEcho = (t: string): boolean => {
    if (!speakingRef.current) return false
    const h = norm(t)
    return h.length >= 4 && spokenTextRef.current.includes(h)
  }

  const readLastResponse = (): void => {
    const last = [...activeSession.messages].reverse().find((m) => m.role === 'assistant')
    const text = last
      ? plainSpeakableText(last.parts.map((p) => ('text' in p ? p.text : '')).join('. '))
      : th
        ? 'ยังไม่มีข้อความให้อ่าน'
        : 'No response to read.'
    beginSpeaking(text)
    void speakSmart(text, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
      lang: voiceCode,
    }).finally(endSpeaking)
  }

  const go = (id: ActivityId) => (): void => setActivity(id)

  // phrases include BOTH Thai + English so it matches regardless of recognition language.
  const commands: VoiceCommand[] = [
    { phrases: ['go to chat', 'open chat', 'chat', 'แชท', 'แชต', 'คุย'], run: go('chat'), confirm: th ? 'แชท' : 'Chat', label: '“chat” / “แชท”' },
    { phrases: ['sessions', 'session list', 'เซสชัน', 'รายการ'], run: go('sessions'), confirm: th ? 'เซสชัน' : 'Sessions', label: '“sessions” / “เซสชัน”' },
    { phrases: ['tasks', 'board', 'kanban', 'งาน', 'บอร์ด'], run: go('tasks'), confirm: th ? 'บอร์ดงาน' : 'Tasks board', label: '“tasks” / “งาน”' },
    { phrases: ['changes', 'diff', 'source control', 'การเปลี่ยนแปลง', 'ดิฟ'], run: go('changes'), confirm: th ? 'การเปลี่ยนแปลง' : 'Changes', label: '“changes” / “ดิฟ”' },
    { phrases: ['skills', 'สกิล', 'ทักษะ'], run: go('skills'), confirm: th ? 'สกิล' : 'Skills', label: '“skills” / “สกิล”' },
    { phrases: ['usage', 'tokens', 'limit', 'การใช้งาน', 'โทเคน', 'ลิมิต'], run: go('usage'), confirm: th ? 'การใช้งาน' : 'Usage', label: '“usage” / “การใช้งาน”' },
    { phrases: ['guide', 'reference', 'manual', 'help page', 'คู่มือ', 'อ้างอิง', 'วิธีใช้'], run: go('guide'), confirm: th ? 'คู่มือ' : 'Guide', label: '“guide” / “คู่มือ”' },
    { phrases: ['settings', 'preferences', 'ตั้งค่า'], run: go('settings'), confirm: th ? 'ตั้งค่า' : 'Settings', label: '“settings” / “ตั้งค่า”' },
    { phrases: ['next tab', 'next session', 'แท็บถัดไป', 'ถัดไป'], run: () => cycleSession(1), confirm: th ? 'แท็บถัดไป' : 'Next tab', label: '“next tab” / “แท็บถัดไป”' },
    { phrases: ['previous tab', 'last tab', 'back tab', 'แท็บก่อนหน้า', 'ก่อนหน้า', 'ย้อนกลับ'], run: () => cycleSession(-1), confirm: th ? 'แท็บก่อนหน้า' : 'Previous tab', label: '“previous tab” / “แท็บก่อนหน้า”' },
    { phrases: ['toggle terminal', 'terminal', 'show terminal', 'hide terminal', 'เทอร์มินอล', 'หน้าต่างคำสั่ง'], run: () => setBottomOpen((v) => !v), confirm: th ? 'สลับเทอร์มินอล' : 'Terminal toggled', label: '“terminal” / “เทอร์มินอล”' },
    { phrases: ['toggle sidebar', 'sidebar', 'แถบข้าง', 'ไซด์บาร์'], run: () => setSidebarOpen((v) => !v), confirm: th ? 'สลับแถบข้าง' : 'Sidebar toggled', label: '“sidebar” / “แถบข้าง”' },
    { phrases: ['toggle panel', 'tasks panel', 'activity panel', 'พาเนล', 'แผงงาน'], run: () => setRightOpen((v) => !v), confirm: th ? 'สลับพาเนล' : 'Panel toggled', label: '“panel” / “พาเนล”' },
    { phrases: ['read response', 'read last', 'read message', 'read aloud', 'อ่าน', 'อ่านให้ฟัง', 'อ่านข้อความ'], run: readLastResponse, confirm: '', label: '“read” / “อ่าน”' },
    { phrases: ['send', 'send message', 'submit', 'ส่ง', 'ส่งข้อความ', 'ส่งเลย', 'ส่งให้หน่อย'], run: () => composerRef.current?.submit(), confirm: th ? 'ส่งแล้ว' : 'Sent', label: '“send” / “ส่ง”' },
    // Stop the running turn. Phrases avoid bare "หยุด" — that belongs to the voice
    // PAUSE command below; longest-match would still collide, so use distinct words.
    // confirm:'' → handleStop speaks STATUS.stopped (only when a turn is live).
    { phrases: ['stop', 'stop turn', 'stop generating', 'cancel', 'ยกเลิก', 'หยุดงาน', 'หยุดทำงาน', 'หยุดสร้าง'], run: () => handleStop(), confirm: '', label: '“stop” / “ยกเลิก”' },
    { phrases: ['spawn', 'spawn task', 'new task', 'สร้างงาน', 'งานใหม่', 'แตกงาน'], run: () => spawnTask(), confirm: th ? 'สร้างงานใหม่' : 'Spawn task', label: '“spawn” / “สร้างงาน”' },
    { phrases: ['connect', 'log in', 'login', 'เชื่อมต่อ', 'เข้าสู่ระบบ', 'ล็อกอิน'], run: () => { void auth.login() }, confirm: th ? 'กำลังเชื่อมต่อ' : 'Connecting', label: '“connect” / “เชื่อมต่อ”' },
    { phrases: ['disconnect', 'log out', 'logout', 'ตัดการเชื่อมต่อ', 'ออกจากระบบ'], run: () => { void auth.logout() }, confirm: th ? 'ออกจากระบบแล้ว' : 'Disconnected', label: '“disconnect” / “ออกจากระบบ”' },
    { phrases: ['quiet', 'silence', 'be quiet', 'เงียบ', 'เงียบ ๆ'], run: stopSpeaking, confirm: '', label: '“quiet” / “เงียบ”' },
    // Permission modes (all four CLI modes, TH+EN).
    ...MODE_OPTIONS.map<VoiceCommand>((o) => ({
      phrases: o.phrases,
      run: () => setPermissionMode(o.mode),
      confirm: th ? `โหมด ${o.label}` : o.label,
      label: `“${o.label}”`,
    })),
    // Model by spoken name → drives the Composer's local selection.
    { phrases: ['model opus', 'opus', 'โมเดลโอปุส', 'โอปุส'], run: () => composerRef.current?.setModel('opus-4-8'), confirm: th ? 'โมเดลโอปุส' : 'Opus', label: '“opus” / “โอปุส”' },
    { phrases: ['model sonnet', 'sonnet', 'โมเดลซอนเน็ต', 'ซอนเน็ต'], run: () => composerRef.current?.setModel('sonnet-4-6'), confirm: th ? 'โมเดลซอนเน็ต' : 'Sonnet', label: '“sonnet” / “ซอนเน็ต”' },
    { phrases: ['model haiku', 'haiku', 'โมเดลไฮกุ', 'ไฮกุ'], run: () => composerRef.current?.setModel('haiku-4-5'), confirm: th ? 'โมเดลไฮกุ' : 'Haiku', label: '“haiku” / “ไฮกุ”' },
    { phrases: ['model fable', 'fable', 'โมเดลเฟเบิล', 'เฟเบิล'], run: () => composerRef.current?.setModel('fable-5'), confirm: th ? 'โมเดลเฟเบิล' : 'Fable', label: '“fable” / “เฟเบิล”' },
    // Reasoning effort by spoken level (TH+EN) → drives the Composer's local effort.
    ...EFFORT_OPTIONS.map<VoiceCommand>((o) => ({
      phrases: o.phrases,
      run: () => composerRef.current?.setEffort(o.effort),
      confirm: th ? `เอฟฟอร์ต ${o.label}` : `Effort ${o.label}`,
      label: `“effort ${o.label}”`,
    })),
  ]

  // ── Listening state machine: active ⇄ paused, or off ───────────────────────
  const [voiceState, setVoiceState] = useState<'active' | 'paused'>('active')
  // Reset to active whenever the assistant is (re)enabled.
  useEffect(() => {
    if (settings.voiceCommands) setVoiceState('active')
  }, [settings.voiceCommands])

  const pauseCmd: VoiceCommand = {
    phrases: ['pause', 'หยุด', 'พัก', 'หยุดก่อน'],
    run: () => setVoiceState('paused'),
    confirm: th ? 'พักแล้ว พูดว่า เริ่มทำงานต่อ เพื่อกลับมา' : 'Paused. Say resume to continue.',
    label: '“pause” / “หยุด”',
  }
  const resumeCmd: VoiceCommand = {
    phrases: ['resume', 'continue', 'เริ่มทำงานต่อ', 'ทำงานต่อ', 'กลับมา'],
    run: () => setVoiceState('active'),
    confirm: th ? 'ทำงานต่อแล้ว' : 'Resumed',
    label: '“resume” / “เริ่มทำงานต่อ”',
  }
  const closeCmd: VoiceCommand = {
    phrases: ['turn off', 'close assistant', 'ปิดผู้ช่วย', 'ปิดเสียง', 'ปิดการทำงาน'],
    run: () => update('voiceCommands', false),
    confirm: th ? 'ปิดผู้ช่วยแล้ว' : 'Voice assistant off',
    label: '“turn off” / “ปิดผู้ช่วย”',
  }

  const help: VoiceCommand = {
    phrases: ['help', 'what can i say', 'commands', 'ช่วยเหลือ', 'พูดอะไรได้บ้าง', 'คำสั่ง'],
    run: () =>
      void speakSmart(
        th
          ? `คุณพูดได้ว่า: ${commands.map((c) => c.confirm).filter(Boolean).join(', ')}`
          : `You can say: ${commands.map((c) => c.label.replace(/["“”]/g, '')).join(', ')}.`,
        { lang: voiceCode, rate: settings.speechRate, pitch: settings.speechPitch, voiceURI: settings.voiceURI },
      ),
    confirm: '',
    label: '“help” / “ช่วยเหลือ”',
  }

  // Prewarm the Miku TTS cache with the finite set of fixed assistant phrases the
  // instant the local voice server is ready, so a blind user never waits on the
  // first (cold) edge-tts + RVC render of each phrase. Only relevant with the
  // custom (Miku) engine. The per-command `confirm` strings are passed straight
  // from the live commands so the warmed text can't drift from the spoken text.
  // Spoken when a paused user addresses the assistant with a non-command (see
  // handleVoice); defined once so the prewarmed text can't drift from the spoken text.
  const pausedReminder = th ? 'พักการฟังอยู่ พูดว่า ทำงานต่อ' : 'Listening is paused — say "resume"'
  const prewarmList = collectPrewarmPhrases({
    extraConfirms: [...[...commands, pauseCmd, resumeCmd, closeCmd].map((c) => c.confirm), pausedReminder],
  })
  // Bring the Miku server up automatically when the custom engine is the active
  // voice (on app open or when the user switches to it), so it's already warming
  // by the time a read-aloud is needed — no manual Settings → Start required.
  useMikuAutostart(settings.ttsEngine === 'custom')
  useMikuPrewarm(settings.ttsEngine === 'custom', prewarmList)

  // When paused, only help/resume/close are honoured; otherwise the full set.
  // help stays available so a paused user can still discover "ทำงานต่อ"/"resume".
  const liveCommands =
    voiceState === 'paused'
      ? [help, resumeCmd, closeCmd]
      : [help, resumeCmd, pauseCmd, closeCmd, ...commands]

  const useBrowserStt = settings.voiceCommands && settings.sttEngine === 'browser'
  const useLocalStt = settings.voiceCommands && settings.sttEngine === 'local'

  const [heard, setHeard] = useState('')

  // "Rename yourself": e.g. "เปลี่ยนชื่อเป็น มิกุ" / "rename to Miku".
  const tryRename = (t: string): boolean => {
    const m = t.match(
      /(?:เปลี่ยนชื่อเป็น|เปลี่ยนชื่อ|ตั้งชื่อว่า|ตั้งชื่อเป็น|ตั้งชื่อ|rename to|call yourself|change name to|your name is)\s*(.+)/i,
    )
    if (!m?.[1]) return false
    const newName = m[1].trim().replace(/[.?!。]+$/, '').split(/\s+/).slice(0, 2).join(' ')
    if (!newName) return false
    update('assistantName', newName)
    void speakSmart(th ? `ได้เลย ต่อไปเรียกฉันว่า ${newName}` : `Okay, call me ${newName}`, {
      lang: voiceCode,
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
    })
    return true
  }

  // Single entry point for both engines: echo guard → rename → wake-word gate →
  // barge-in (stop the current read) → dispatch.
  const handleVoice = (t: string): void => {
    setHeard(t.toLowerCase().trim())
    if (isLikelyEcho(t)) return // Miku's own playback re-entering the mic
    if (tryRename(t)) return
    let cmd = t
    // Wake word is only meaningful for always-listening (browser/continuous) mode.
    // In push-to-talk (local Whisper) the user already held the talk button to
    // address the assistant, so requiring the name on top silently drops every
    // plain command (e.g. "ไปหน้าแชท") — bypass it there.
    if (settings.requireWakeWord && useBrowserStt) {
      // Accept EITHER the assistant's name or the selected voice's name.
      const names = [settings.assistantName, settings.voiceName]
        .map((n) => n.trim().toLowerCase())
        .filter(Boolean)
      const lt = t.toLowerCase()
      let start = -1
      let end = -1
      for (const n of names) {
        const i = lt.indexOf(n)
        if (i !== -1 && (start === -1 || i < start)) {
          start = i
          end = i + n.length
        }
      }
      if (start === -1) return // no wake word spoken → ignore
      cmd = t.slice(end).trim() || t
    }
    // While the model-suggestion dialog is open, voice ANSWERS the dialog — and the
    // normal model-name commands ("opus"/"haiku") are suppressed so they can't change
    // the composer instead of confirming. Returns before the nav/composer dispatch.
    if (modelSuggestion) {
      const choice = voiceToChoice(cmd, modelSuggestion.decision.tier, modelSuggestion.restingTier)
      if (choice) {
        stopSpeaking()
        routeResolveRef.current?.(choice)
        void speakSmart(th ? `ใช้ ${choice}` : `Using ${choice}`, { lang: voiceCode })
        return
      }
    }
    // Barge-in: a fresh wake-word/command interrupts whatever Miku is reading so
    // the app responds immediately, like talking over a chatbot. Safe no-op when
    // nothing is playing. The new command's own confirmation speaks after this.
    stopSpeaking()
    const matched = dispatchCommand(liveCommands, cmd, voiceCode)
    // Paused + deliberately addressed (wake word heard, or push-to-talk) but the
    // utterance matched nothing → the user likely forgot listening is paused.
    // Remind them instead of staying silent. Always-listening WITHOUT a wake word
    // is excluded: room chatter would otherwise trigger this constantly.
    if (!matched && voiceState === 'paused' && (!useBrowserStt || settings.requireWakeWord)) {
      setLiveStatus(pausedReminder)
      void speakSmart(pausedReminder, {
        lang: voiceCode,
        rate: settings.speechRate,
        pitch: settings.speechPitch,
        voiceURI: settings.voiceURI,
      })
    }
  }

  const browserVoice = useVoiceCommands(useBrowserStt, voiceCode, handleVoice)

  const localVoice = useLocalVoice({
    enabled: useLocalStt,
    model: settings.whisperModel,
    lang,
    deviceId: settings.micDeviceId,
    onText: handleVoice,
  })

  // Global hotkey: Ctrl+Shift+V toggles hands-free voice control.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'V' || e.key === 'v')) {
        e.preventDefault()
        update('voiceCommands', !settings.voiceCommands)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [settings.voiceCommands, update])

  // Ctrl+Shift+B → spawn a fresh task in a new tab.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault()
        spawnTask()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Local engine: hold Ctrl+Shift+Space to talk (push-to-talk).
  const { startTalk, stopTalk } = localVoice
  useEffect(() => {
    if (!useLocalStt) return
    let down = false
    const kd = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.code === 'Space') {
        e.preventDefault()
        if (!down) {
          down = true
          void startTalk()
        }
      }
    }
    const ku = (e: KeyboardEvent): void => {
      if (down && (e.code === 'Space' || e.key === 'Control' || e.key === 'Shift')) {
        down = false
        void stopTalk()
      }
    }
    window.addEventListener('keydown', kd)
    window.addEventListener('keyup', ku)
    return () => {
      window.removeEventListener('keydown', kd)
      window.removeEventListener('keyup', ku)
    }
  }, [useLocalStt, startTalk, stopTalk])

  const speakStatus = (text: string): void => {
    if (!text) return
    // The sr-only aria-live region is ALWAYS fed: NVDA/JAWS users get status
    // without needing the in-app screenReaderMode (which gates only our own TTS —
    // the region is invisible to sighted users anyway).
    setLiveStatus(text)
    if (!settings.screenReaderMode) return
    void speakSmart(text, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
      lang: voiceCode,
    })
  }

  // ── Built-in screen-reader mode: announce view changes (live region + TTS) ──
  // VIEW_NAMES lives in @/settings/prewarmPhrases so the spoken text and the
  // Miku-prewarmed text share one source (no drift).
  // Skip announcing the initial mount; only speak on real navigations.
  const srMounted = useRef(false)
  useEffect(() => {
    if (!srMounted.current) {
      srMounted.current = true
      return
    }
    // Always announce (aria-live for NVDA/JAWS); speakStatus itself gates the
    // spoken TTS behind screenReaderMode.
    const name = VIEW_NAMES[activity]
    if (name) speakStatus(say(name))
    // speakStatus intentionally excluded: avoid re-announcing on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity])

  const announceEvent = (event: ClaudeEvent): void => {
    if (event.type === 'assistant') {
      const tool = event.message.content.find((c) => c.type === 'tool_use')
      if (tool && tool.type === 'tool_use') {
        speakStatus(th ? `กำลังใช้ ${tool.name}` : `Running ${tool.name}`)
      }
    } else if (event.type === 'result') {
      speakStatus(say(event.is_error ? STATUS.error : STATUS.done))
    }
  }

  const terminalSummary = (event: ClaudeEvent): string => {
    switch (event.type) {
      case 'system': {
        // The wire carries system events beyond init (hook_started/hook_response,
        // many per turn) — those are infra noise; only surface the real init.
        const sub = (event as { subtype?: string }).subtype
        return sub === 'init' ? `● init ${event.session_id ?? ''}`.trim() : ''
      }
      case 'assistant':
        return event.message.content
          .map((c) => (c.type === 'tool_use' ? `● ${c.name}` : c.type === 'text' ? '● (text)' : `● ${c.type}`))
          .join('  ')
      case 'user': return '  ⎿ tool result'
      case 'result': return event.is_error ? '✗ result: error' : '✓ result: done'
      default: return ''
    }
  }

  // Build the user + assistant messages and spawn the live turn on `sess` with the
  // already-chosen `modelId`. Extracted from handleSend so the silent and confirmed
  // routing paths share one body. `sess` is captured before any routing await, so the
  // turn always targets the session that was active when the user pressed send.
  const runTurn = (sess: Session, text: string, modelId: string, effort?: Effort, images?: ImageAttachment[]): void => {
    const sid = sess.id
    const now = new Date().toISOString()
    const userMessage = {
      id: nextId('u'), role: 'user' as const, createdAt: now,
      parts: [{ kind: 'markdown' as const, text }],
    }

    const useLive = claudeOk
    const assistantMessage = {
      id: nextId('a'), role: 'assistant' as const, createdAt: now,
      parts: useLive ? [] : [{ kind: 'markdown' as const, text: th ? '(ไม่พบ claude CLI — ติดตั้ง Claude Code ก่อน)' : '(claude CLI not found — install Claude Code first)' }],
      streaming: useLive,
      model: modelId,
    }
    sessionsDispatch({ type: 'startTurn', sessionId: sid, userMessage, assistantMessage })

    // Auto-name a still-unnamed session from its first message, so the tab stops
    // reading "New session" the moment the user sends something. Manual renames
    // win: once the title differs from the placeholder we never overwrite it.
    if (isDefaultTitle(sess.title)) {
      const title = deriveSessionTitle(text)
      if (title) sessionsDispatch({ type: 'setTitle', sessionId: sid, title })
    }

    if (!useLive) {
      sessionsDispatch({ type: 'finishTurn', sessionId: sid })
      return
    }

    // Show "thinking" visually + via aria-live, but do NOT speak it: the result
    // event's spoken "Done" would otherwise cancel this mid-word (speakSmart does
    // not queue, system speak() cancels-then-speaks) → "กำลังค—เสร็จแล้ว". Proper
    // queueing/auto-read is Slice C; this is the band-aid for the cut-off.
    setLiveStatus(say(STATUS.thinking))

    const turnId = nextId('turn')
    activeTurnsRef.current = startActiveTurn(activeTurnsRef.current, sid, turnId)
    const off = claudeClient.subscribe(turnId, {
      onEvent: (event: ClaudeEvent) => {
        sessionsDispatch({ type: 'event', sessionId: sid, event })
        // Capture real token usage + announce once when context crosses 80%.
        if (event.type === 'result') {
          const u = event.usage
          const usage = {
            input: u?.input_tokens ?? 0,
            output: u?.output_tokens ?? 0,
            cacheRead: u?.cache_read_input_tokens ?? 0,
            cacheCreation: u?.cache_creation_input_tokens ?? 0,
          }
          // sessionsRef avoids the stale closure over `sessions` in handleSend.
          const prev = sessionsRef.current.find((s) => s.id === sid)
          const model = prev?.model ?? 'opus-4-8'
          const prevPct = contextPct(prev?.contextTokens ?? 0, model)
          const nextPct = contextPct(contextTokensOf(usage), model)
          sessionsDispatch({ type: 'setUsage', sessionId: sid, usage })
          if (crossed80(prevPct, nextPct)) {
            speakStatus(
              say({
                th: `ใช้ context ${Math.round(nextPct * 100)} เปอร์เซ็นต์แล้ว`,
                en: `Context at ${Math.round(nextPct * 100)} percent`,
              }),
            )
          }
        }
        announceEvent(event)
        const summary = terminalSummary(event)
        if (summary) {
          sessionsDispatch({
            type: 'terminal', sessionId: sid,
            line: { id: nextId('tl'), kind: 'stdout', text: summary },
          })
        }
      },
      onStderr: (textLine: string) => {
        sessionsDispatch({
          type: 'terminal', sessionId: sid,
          line: { id: nextId('tl'), kind: 'stderr', text: textLine },
        })
      },
      onPermission: (req) => {
        // Stamp the owning session so the prompt renders inside ITS chat (and its
        // tab lights up amber), never as a global modal over whatever tab is focused.
        setPermissionQueue((q) => [...q, { ...req, sessionId: sid }])
        speakStatus(th ? `ขออนุญาตใช้ ${req.tool}` : `Permission needed: ${req.tool}`)
      },
      onDone: () => {
        sessionsDispatch({ type: 'finishTurn', sessionId: sid })
        // Drop any unanswered prompts for this finished turn.
        setPermissionQueue((q) => q.filter((r) => r.turnId !== turnId))
        activeTurnsRef.current = endActiveTurn(activeTurnsRef.current, sid, turnId)
        off()
      },
    })

    void claudeClient
      .startTurn({
        turnId, prompt: text, cwd: sess.cwd,
        sessionId: sess.claudeSessionId, model: modelId, permissionMode, effort,
        settings: permissions,
        images,
      })
      .then((r) => {
        if (!r.ok) {
          sessionsDispatch({
            type: 'terminal', sessionId: sid,
            line: { id: nextId('tl'), kind: 'stderr', text: r.error ?? 'failed to start claude' },
          })
          sessionsDispatch({ type: 'finishTurn', sessionId: sid })
          activeTurnsRef.current = endActiveTurn(activeTurnsRef.current, sid, turnId)
          speakStatus(say(STATUS.error))
          off()
        }
      })
  }

  // Resolve the model for this turn (routing), then run it. Async because the borderline
  // classifier and the confirm dialog both await. The session is captured up front so a
  // tab switch mid-routing can't retarget the turn.
  const handleSend = async (text: string, modelId: string, effort?: Effort, images?: ImageAttachment[]): Promise<void> => {
    const sess = activeSession
    // B4: ignore a second send while this session's turn is still streaming.
    if (sess.status === 'running') {
      speakStatus(say(STATUS.busy))
      return
    }
    // Routing lock: a classifier await or open dialog is already deciding a turn.
    if (routePendingRef.current) {
      speakStatus(say(STATUS.busy))
      return
    }
    // Routing off → behave exactly as before (use the composer's model).
    if (settings.modelRouting === 'off') {
      runTurn(sess, text, modelId, effort, images)
      return
    }

    routePendingRef.current = true
    try {
      const restingTier = modelIdToTier(settings.restingModel)
      let s = suggestModelHeuristic({ prompt: text, hasErrorTrace: detectErrorTrace(text), restingTier })
      if (s.needsClassifier) {
        // Announce (don't speak — would be cut off by the result's spoken "Done") that
        // we're consulting the classifier, so a blind user isn't left in silence.
        setLiveStatus(say({ th: 'กำลังเลือกโมเดล…', en: 'Choosing model…' }))
        const tier = await claudeClient.classify(text, restingTier)
        s = { ...s, tier, confidence: 'high', needsClassifier: false }
      }
      const decision = decideRouting(s, restingTier, settings.modelRouting, settings.routingAlwaysConfirm)

      let chosenModelId = decision.modelId
      if (decision.action === 'confirm') {
        const chosenTier = await new Promise<Tier>((resolve) => {
          routeResolveRef.current = resolve
          setModelSuggestion({ decision, restingTier })
        })
        routeResolveRef.current = null
        setModelSuggestion(null)
        chosenModelId = TIER_TO_MODEL_ID[chosenTier]
      }
      runTurn(sess, text, chosenModelId, effort, images)
    } finally {
      routePendingRef.current = false
    }
  }

  // The dialog (button/keyboard/voice) resolves the pending send with the chosen tier.
  const chooseSuggestedModel = (tier: Tier): void => {
    routeResolveRef.current?.(tier)
  }

  // Stop the active turn for the current session — cancels the CLI process so a
  // hung turn (no result/exit) can't strand the session as 'running' (#2). onDone
  // fires from the kill's exit and clears the running state + active-turn entry.
  const handleStop = (): void => {
    const sid = activeSession.id
    const turnId = activeTurnFor(activeTurnsRef.current, sid)
    if (!turnId) return
    claudeClient.cancelTurn(turnId)
    speakStatus(say(STATUS.stopped))
  }

  // Enqueue a message typed while THIS session's turn is running. It is flushed
  // (sent as its own turn) by the auto-flush effect when the session goes idle.
  const enqueueMessage = (
    text: string, modelId: string, effort?: Effort, images?: ImageAttachment[],
  ): void => {
    const sid = activeSession.id
    sessionsDispatch({
      type: 'enqueue', sessionId: sid,
      message: { id: nextId('q'), text, modelId, effort, images },
    })
    const n = (sessionsRef.current.find((s) => s.id === sid)?.queued?.length ?? 0) + 1
    speakStatus(say({ th: `เข้าคิวแล้ว ${n} ข้อความ`, en: `Queued (${n})` }))
  }

  const removeQueued = (id: string): void => {
    sessionsDispatch({ type: 'removeQueued', sessionId: activeSession.id, id })
    speakStatus(say({ th: 'ลบออกจากคิวแล้ว', en: 'Removed from queue' }))
  }

  // Interrupt = "send THIS now". Cancel the running turn (if any) and enqueue at
  // the HEAD (enqueueFront) so it jumps ahead of anything already queued — honoring
  // the design's "stop current + run now". The auto-flush effect sends it the moment
  // the session goes idle (the cancel's onDone flips status → 'idle'). We enqueue
  // rather than call runTurn directly because the cancel is async — a direct runTurn
  // would stack a second live turn on a still-'running' session.
  const interruptAndSend = (
    text: string, modelId: string, effort?: Effort, images?: ImageAttachment[],
  ): void => {
    const sess = activeSession
    if (sess.status === 'running') {
      const turnId = activeTurnFor(activeTurnsRef.current, sess.id)
      if (turnId) claudeClient.cancelTurn(turnId)
    }
    sessionsDispatch({
      type: 'enqueueFront', sessionId: sess.id,
      message: { id: nextId('q'), text, modelId, effort, images },
    })
    speakStatus(say(STATUS.stopped))
  }

  // Answer a specific permission request (each lives inside its own session's chat,
  // so multiple sessions can have pending prompts — we can't assume head-of-queue),
  // then remove it by id. If the turn was already gone the response can't be
  // delivered (ok:false) — clear the stale entry anyway and SAY so, instead of
  // failing in total silence (#1, a11y).
  const decidePermission = async (req: PermissionRequestMsg, decision: 'allow' | 'deny'): Promise<void> => {
    if (!req) return
    const { ok } = await claudeClient.respondPermission(
      req.turnId, req.id, decision, decision === 'allow' ? { input: req.input } : undefined,
    )
    const outcome = permissionResponseOutcome(ok)
    if (outcome.dequeue) setPermissionQueue((q) => q.filter((r) => r.id !== req.id))
    if (outcome.expired) speakStatus(say(STATUS.expired))
  }
  // Allow now AND persist the tool to the allow list so it never asks again.
  const alwaysAllowPermission = (req: PermissionRequestMsg): void => {
    if (!req) return
    const allow = permissions.allow ?? []
    if (!allow.includes(req.tool)) updatePermissions({ ...permissions, allow: [...allow, req.tool] })
    void decidePermission(req, 'allow')
  }

  // ── Session tab lifecycle (new / close / reopen-with-history) ─────────────
  // New session inherits the current folder by default (carry the last cwd
  // forward, like Codex), or binds to an explicit folder when one is passed
  // (the per-project "+" button in the session library).
  const newSession = (cwd?: string): void => {
    const id = nextId('s')
    const dir = cwd ?? activeSession?.cwd ?? ''
    sessionsDispatch({ type: 'createSession', session: emptySession(id, dir) })
    setActiveSessionId(id)
    speakStatus(say({ th: 'เปิดเซสชันใหม่', en: 'New session' }))
  }
  const closeSessionTab = (id: string): void => {
    const openSessions = sessions.filter((s) => s.open)
    const idx = openSessions.findIndex((s) => s.id === id)
    sessionsDispatch({ type: 'closeTab', sessionId: id })
    if (id === activeSessionId) {
      // Land on another OPEN tab if one exists. If this was the last open tab,
      // intentionally leave activeSessionId on it: the center pane keeps showing
      // that conversation (you can keep reading / typing to resume it) while the
      // tab strip shows the empty-state hint (Task 7). This is by design, not a bug.
      const fallback = openSessions[idx + 1] ?? openSessions[idx - 1]
      if (fallback) setActiveSessionId(fallback.id)
    }
    speakStatus(say({ th: 'ปิดแท็บแล้ว เซสชันยังอยู่ในแถบข้าง', en: 'Tab closed; session kept in the sidebar' }))
  }
  const reopenSession = async (id: string): Promise<void> => {
    sessionsDispatch({ type: 'reopenTab', sessionId: id })
    setActiveSessionId(id)
    setActivity('chat')
    const s = sessions.find((x) => x.id === id)
    if (s && s.messages.length === 0 && s.claudeSessionId) {
      const ok = await loadHistory(id, s.claudeSessionId)
      if (!ok) speakStatus(say({ th: 'ประวัติโหลดไม่ได้ แต่คุยต่อได้', en: 'History unavailable; you can still continue' }))
    }
  }
  const pinSession = (id: string): void => {
    sessionsDispatch({ type: 'togglePin', sessionId: id })
    const s = sessionsRef.current.find((x) => x.id === id)
    speakStatus(s?.pinned
      ? say({ th: 'เลิกปักหมุดแล้ว', en: 'Unpinned' })
      : say({ th: 'ปักหมุดแล้ว', en: 'Pinned' }))
  }
  const archiveSession = (id: string): void => {
    sessionsDispatch({ type: 'setArchived', sessionId: id, archived: true })
    if (id === activeSessionId) {
      const fallback = sessions.find((s) => s.open && s.id !== id)
      if (fallback) setActiveSessionId(fallback.id)
    }
    speakStatus(say({ th: 'เก็บเข้าคลังแล้ว เลิกทำได้ในหน้า Archive', en: 'Archived; undo from the Archive view' }))
  }
  const unarchiveSession = (id: string): void => {
    sessionsDispatch({ type: 'setArchived', sessionId: id, archived: false })
    speakStatus(say({ th: 'กู้คืนจากคลังแล้ว', en: 'Restored from archive' }))
  }
  const deleteSession = (id: string): void => {
    sessionsDispatch({ type: 'closeSession', sessionId: id })
    speakStatus(say({ th: 'ลบเซสชันถาวรแล้ว', en: 'Session permanently deleted' }))
  }
  const renameSession = (id: string, title: string): void => {
    sessionsDispatch({ type: 'setTitle', sessionId: id, title })
  }

  // ── Spawn a fresh task into a new tab ────────────────────────────────────────
  // Opens a brand-new EMPTY session (no copied history) in the current folder,
  // switches to it, and — when a seed prompt is given (e.g. the composer draft) —
  // sends it as the first turn. That first turn auto-titles the tab from the prompt
  // (see handleSend), so a spawned task names itself.
  const spawnTask = (seed?: string, cwd?: string): void => {
    const id = nextId('s')
    const dir = cwd ?? activeSession?.cwd ?? ''
    sessionsDispatch({ type: 'createSession', session: emptySession(id, dir) })
    setActiveSessionId(id)
    setActivity('chat')
    if (seed?.trim()) setPendingSeed({ sessionId: id, text: seed.trim() })
    speakStatus(say({ th: 'สร้างงานใหม่แล้ว', en: 'Spawned a new task' }))
  }

  // Deliver a spawned task's starting prompt once the new session is active, idle and the
  // CLI is up. Fires exactly once (pendingSeed cleared before send).
  useEffect(() => {
    if (!pendingSeed) return
    if (activeSession.id !== pendingSeed.sessionId) return
    if (activeSession.status !== 'idle' || !claudeOk) return
    const text = pendingSeed.text
    setPendingSeed(null)
    void handleSend(text, activeSession.model)
    // handleSend/activeSession intentionally read fresh each render; guarded by the id check above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed, activeSession, claudeOk])

  // Auto-flush queued messages: when ANY open session is idle with a non-empty
  // queue, dequeue the head and run it as its own turn. Works for background
  // sessions (the turn targets the queued session, not necessarily the active tab).
  //
  // Correctness invariants:
  // - Only `status === 'idle'` flushes. finishTurn always lands on 'idle' (never
  //   the unused 'error'/'active' states), and runTurn's error/cancel paths also
  //   finishTurn → 'idle', so an errored OR stopped turn still flushes the queue.
  // - dequeue (removeQueued) + runTurn's startTurn (status → 'running') are two
  //   dispatches in the same effect tick; React 18 (createRoot) auto-batches them
  //   into ONE commit, so the effect never re-observes the same head with status
  //   still 'idle' → no double-send. `break` = one flush per pass; FIFO across
  //   passes (next finishTurn → idle re-fires the effect for the following item).
  // - routePendingRef guard closes the routing race: if a normal send is mid-
  //   routing (classifier await / confirm dialog open) the session is still 'idle'
  //   but a runTurn is about to fire for it — flushing now would stack two turns.
  // - Skip non-open tabs: a soft-closed tab (closeTab → open:false) must not
  //   silently fire turns in the background.
  // Routing is bypassed for queued sends: the queued modelId is used as-is.
  useEffect(() => {
    if (!claudeOk) return
    if (routePendingRef.current) return
    for (const s of sessions) {
      if (s.status !== 'idle' || s.open === false) continue
      const head = s.queued?.[0]
      if (!head) continue
      sessionsDispatch({ type: 'removeQueued', sessionId: s.id, id: head.id })
      runTurn(s, head.text, head.modelId, head.effort, head.images)
      break // one flush per effect pass; the next idle render flushes the following item
    }
    // runTurn/sessions read fresh each render; guarded by status checks above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, claudeOk])

  const centerView = (() => {
    switch (activity) {
      case 'tasks':
        return <KanbanBoard />
      case 'changes':
        return <DiffView session={activeSession} />
      case 'skills':
        return <SkillsBrowser />
      case 'usage':
        return <UsageView />
      case 'guide':
        return <GuideView />
      case 'settings':
        return (
          <SettingsView
            auth={auth}
            permissions={permissions}
            onChangePermissions={updatePermissions}
          />
        )
      case 'chat':
      case 'sessions':
      default:
        return (
          <ChatView
            session={activeSession}
            onSend={handleSend}
            onStop={handleStop}
            composerRef={composerRef}
            permissionMode={permissionMode}
            onChangePermission={setPermissionMode}
            onSetCwd={(path) => sessionsDispatch({ type: 'setCwd', sessionId: activeSession.id, cwd: path })}
            onSpawn={(text) => spawnTask(text)}
            queued={activeSession.queued ?? []}
            onEnqueue={enqueueMessage}
            onInterrupt={interruptAndSend}
            onRemoveQueued={removeQueued}
            permissionRequest={permissionQueue.find((r) => r.sessionId === activeSession.id) ?? null}
            onPermissionDecide={decidePermission}
            onPermissionAlwaysAllow={alwaysAllowPermission}
            th={th}
          />
        )
    }
  })()

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
      <div className="sr-only" role="status" aria-live="polite">{liveStatus}</div>
      <VoiceControlIndicator
        enabled={settings.voiceCommands}
        mode={settings.sttEngine}
        paused={voiceState === 'paused'}
        listening={settings.sttEngine === 'browser' ? browserVoice.listening : localVoice.talking}
        lastHeard={heard}
        localStatus={localVoice.status}
        localProgress={localVoice.progress}
        onPTTDown={() => void startTalk()}
        onPTTUp={() => void stopTalk()}
      />
      <TitleBar
        title="ClaudeDeck"
        project={activeSession.cwd}
        rightOpen={rightOpen}
        bottomOpen={bottomOpen}
        sidebarOpen={sidebarOpen}
        onToggleSidebar={() => setSidebarOpen((v) => !v)}
        onToggleRight={() => setRightOpen((v) => !v)}
        onToggleBottom={() => setBottomOpen((v) => !v)}
      />

      <UpdateBanner />
      <LoginBanner auth={auth} />

      <div className="flex min-h-0 flex-1">
        <ActivityBar
          activity={activity}
          onChange={setActivity}
        />

        <PanelGroup direction="horizontal" className="min-h-0 flex-1">
          {sidebarOpen && (
            <>
              <Panel id="sidebar" order={1} defaultSize={20} minSize={14} maxSize={32}>
                <Sidebar
                  activity={activity}
                  sessions={sessions}
                  activeSessionId={activeSessionId}
                  onSelectSession={(id) => void reopenSession(id)}
                  onSpawn={() => spawnTask()}
                  onNew={newSession}
                  onNewInFolder={newSession}
                  onPin={pinSession}
                  onArchive={archiveSession}
                  onUnarchive={unarchiveSession}
                  onDelete={deleteSession}
                  onRename={renameSession}
                />
              </Panel>
              <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-accent" />
            </>
          )}

          <Panel id="center" order={2} minSize={30}>
            <PanelGroup direction="vertical" className="min-h-0">
              <Panel id="main" order={1} minSize={30}>
                <div className="flex h-full min-h-0 flex-col bg-bg">
                  <TabStrip
                    sessions={sessions.filter((s) => s.open)}
                    activeSessionId={activeSessionId}
                    onSelect={setActiveSessionId}
                    onNew={newSession}
                    onClose={closeSessionTab}
                  />
                  <main aria-label={VIEW_NAMES[activity] ? say(VIEW_NAMES[activity]) : 'Main'} className="min-h-0 flex-1 overflow-hidden">{centerView}</main>
                </div>
              </Panel>

              {bottomOpen && (
                <>
                  <PanelResizeHandle className="h-px bg-border transition-colors hover:bg-accent" />
                  <Panel id="bottom" order={2} defaultSize={26} minSize={10} maxSize={60}>
                    <BottomPanel onClose={() => setBottomOpen(false)} lines={activeSession.terminalLines} />
                  </Panel>
                </>
              )}
            </PanelGroup>
          </Panel>

          {rightOpen && (
            <>
              <PanelResizeHandle className="w-px bg-border transition-colors hover:bg-accent" />
              <Panel id="right" order={3} defaultSize={22} minSize={16} maxSize={36}>
                <RightPanel session={activeSession} onClose={() => setRightOpen(false)} />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>

      <StatusBar
        session={activeSession}
        loggedIn={auth.status.loggedIn}
        cliAvailable={claudeOk}
        permissionMode={permissionMode}
        onConnect={() => void auth.login()}
        onDisconnect={() => void auth.logout()}
        onSetCwd={(path) => sessionsDispatch({ type: 'setCwd', sessionId: activeSession.id, cwd: path })}
        onAnnounce={setLiveStatus}
      />

      {permissionQueue[0] && (
        <PermissionPrompt
          request={permissionQueue[0]}
          onDecide={decidePermission}
          onAlwaysAllow={alwaysAllowPermission}
          th={th}
        />
      )}


      {modelSuggestion && (
        <ModelSuggestion
          decision={modelSuggestion.decision}
          restingTier={modelSuggestion.restingTier}
          onChoose={chooseSuggestedModel}
          tierLabel={(t) => (MODELS.find((m) => m.id === TIER_TO_MODEL_ID[t])?.label ?? t).replace(/^Claude\s+/, '')}
          th={th}
        />
      )}
    </div>
  )
}
