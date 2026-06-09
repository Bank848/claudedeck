import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { useSettings } from '@/settings/SettingsContext'
import { useVoiceCommands, dispatchCommand, type VoiceCommand } from '@/settings/voiceCommands'
import { useLocalVoice } from '@/settings/localVoice'
import { plainSpeakableText, resolveLang } from '@/settings/speech'
import { speakSmart, cancelSmart } from '@/settings/tts'
import { VIEW_NAMES, STATUS, collectPrewarmPhrases } from '@/settings/prewarmPhrases'
import { useMikuPrewarm } from '@/settings/mikuServer'
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

import { ACTIVE_SESSION_ID, type ActivityId } from '@/mock/fixtures'
import { MODE_OPTIONS } from '@/settings/permissionModes'
import { EFFORT_OPTIONS } from '@/settings/effortLevels'
import { useSessions, emptySession, toStored } from '@/state/useSessions'
import * as sessionsClient from '@/state/sessionsClient'
import { contextPct, contextTokensOf, crossed80 } from '@/settings/contextWindow'
import type { ComposerHandle } from '@/views/chat/Composer'
import * as claudeClient from '@/cli/claudeClient'
import { permissionResponseOutcome } from '@/cli/permissionOutcome'
import { startActiveTurn, endActiveTurn, activeTurnFor, type ActiveTurns } from '@/state/activeTurns'
import type { Effort, PermissionMode, ClaudeEvent, PermissionSettings, PermissionRequestMsg } from '@/cli/types'
import { loadPermissions, savePermissions } from '@/settings/permissionRules'
import { PermissionPrompt } from '@/views/chat/PermissionPrompt'
import { ForkDialog } from '@/views/chat/ForkDialog'
import { defaultForkBranch } from '@/state/forkSession'
import { gitClient } from '@/cli/gitClient'
import { useAuth } from '@/cli/useAuth'
import { LoginBanner } from '@/components/LoginBanner'

export default function App(): JSX.Element {
  const { settings, update } = useSettings()
  const { state: sessionsState, dispatch: sessionsDispatch } = useSessions()
  const sessions = sessionsState.sessions
  const composerRef = useRef<ComposerHandle>(null)
  const auth = useAuth()

  const [claudeOk, setClaudeOk] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('plan')
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
  // Fork-to-worktree dialog. `sourceCwd` is captured at openFork time (not read
  // from activeSession at confirm time) so the fork targets the intended repo even
  // if the active tab changes between opening and confirming — and so the per-tab
  // Fork button forks the *clicked* tab, not whatever is active.
  const [forkState, setForkState] = useState<{ defaultBranch: string; seed: string; sourceCwd: string } | null>(null)
  const [pendingSeed, setPendingSeed] = useState<{ sessionId: string; text: string } | null>(null)

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
      const i = sessions.findIndex((s) => s.id === cur)
      const next = (i + dir + sessions.length) % sessions.length
      return sessions[next].id
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
    { phrases: ['fork', 'fork session', 'fork to worktree', 'fork branch', 'แยกเซสชัน', 'แตกเซสชัน'], run: () => openFork(), confirm: th ? 'แยกเซสชัน' : 'Fork', label: '“fork” / “แยกเซสชัน”' },
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
  const prewarmList = collectPrewarmPhrases({
    extraConfirms: [...commands, pauseCmd, resumeCmd, closeCmd].map((c) => c.confirm),
  })
  useMikuPrewarm(settings.ttsEngine === 'custom', prewarmList)

  // When paused, only resume/close are honoured; otherwise the full set.
  const liveCommands =
    voiceState === 'paused'
      ? [resumeCmd, closeCmd]
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
    // Barge-in: a fresh wake-word/command interrupts whatever Miku is reading so
    // the app responds immediately, like talking over a chatbot. Safe no-op when
    // nothing is playing. The new command's own confirmation speaks after this.
    stopSpeaking()
    dispatchCommand(liveCommands, cmd, voiceCode)
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

  // Ctrl+Shift+B → open the Fork dialog (fork the active session to a new worktree).
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'B' || e.key === 'b')) {
        e.preventDefault()
        openFork()
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
    setLiveStatus(text)
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
    if (!settings.screenReaderMode) {
      srMounted.current = false
      return
    }
    if (!srMounted.current) {
      srMounted.current = true
      return
    }
    const name = VIEW_NAMES[activity]
    if (name) speakStatus(say(name))
    // speakStatus intentionally excluded: avoid re-announcing on unrelated re-renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activity, settings.screenReaderMode])

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

  const handleSend = (text: string, modelId: string, effort?: Effort): void => {
    const sid = activeSession.id
    // B4: ignore a second send while this session's turn is still streaming —
    // otherwise its events would fold into the wrong (newer) assistant message.
    if (activeSession.status === 'running') {
      speakStatus(say(STATUS.busy))
      return
    }
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
    }
    sessionsDispatch({ type: 'startTurn', sessionId: sid, userMessage, assistantMessage })

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
        setPermissionQueue((q) => [...q, req])
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
        turnId, prompt: text, cwd: activeSession.cwd,
        sessionId: activeSession.claudeSessionId, model: modelId, permissionMode, effort,
        settings: permissions,
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

  // Answer the head-of-queue permission request, then dequeue it. If the turn was
  // already gone the response can't be delivered (ok:false) — clear the stale head
  // anyway and SAY so, instead of failing in total silence (#1, a11y).
  const decidePermission = async (decision: 'allow' | 'deny'): Promise<void> => {
    const req = permissionQueue[0]
    if (!req) return
    const { ok } = await claudeClient.respondPermission(
      req.turnId, req.id, decision, decision === 'allow' ? { input: req.input } : undefined,
    )
    const outcome = permissionResponseOutcome(ok)
    if (outcome.dequeue) setPermissionQueue((q) => q.slice(1))
    if (outcome.expired) speakStatus(say(STATUS.expired))
  }
  // Allow now AND persist the tool to the allow list so it never asks again.
  const alwaysAllowPermission = (): void => {
    const req = permissionQueue[0]
    if (!req) return
    const allow = permissions.allow ?? []
    if (!allow.includes(req.tool)) updatePermissions({ ...permissions, allow: [...allow, req.tool] })
    void decidePermission('allow')
  }

  // ── Session tab lifecycle (new / close / reopen-with-history) ─────────────
  const newSession = (): void => {
    const id = nextId('s')
    sessionsDispatch({ type: 'createSession', session: emptySession(id) })
    setActiveSessionId(id)
    speakStatus(say({ th: 'เปิดเซสชันใหม่', en: 'New session' }))
  }
  const closeSessionTab = (id: string): void => {
    if (sessions.length <= 1) return // keep at least one
    const idx = sessions.findIndex((s) => s.id === id)
    sessionsDispatch({ type: 'closeSession', sessionId: id })
    if (id === activeSessionId) {
      const fallback = sessions[idx + 1] ?? sessions[idx - 1]
      if (fallback) setActiveSessionId(fallback.id)
    }
  }
  const reopenSession = async (id: string): Promise<void> => {
    setActiveSessionId(id)
    setActivity('chat')
    const s = sessions.find((x) => x.id === id)
    if (s && s.messages.length === 0 && s.claudeSessionId) {
      const ok = await loadHistory(id, s.claudeSessionId)
      if (!ok) speakStatus(say({ th: 'ประวัติโหลดไม่ได้ แต่คุยต่อได้', en: 'History unavailable; you can still continue' }))
    }
  }

  // ── Fork to a new git-worktree-bound session ─────────────────────────────
  const openFork = (seed?: string, sourceCwd?: string): void => {
    setForkState({
      defaultBranch: defaultForkBranch(seed ?? '', new Date()),
      seed: seed ?? '',
      sourceCwd: sourceCwd ?? activeSession.cwd,
    })
  }

  const confirmFork = async ({ branch, seed }: { branch: string; seed: string }): Promise<void> => {
    if (!forkState) return
    const r = await gitClient.forkWorktree({ cwd: forkState.sourceCwd, branch })
    if (!r.ok || !r.path) {
      speakStatus(say({ th: `แยกไม่สำเร็จ: ${r.error ?? ''}`, en: `Fork failed: ${r.error ?? 'unknown error'}` }))
      return // keep dialog open
    }
    const id = nextId('s')
    const now = new Date().toISOString()
    sessionsDispatch({
      type: 'createSession',
      session: { ...emptySession(id), cwd: r.path, title: branch, updatedAt: now, createdAt: now },
    })
    setActiveSessionId(id)
    setActivity('chat')
    if (seed.trim()) setPendingSeed({ sessionId: id, text: seed.trim() })
    setForkState(null)
    speakStatus(say({ th: `แยกไปเซสชันใหม่ branch ${branch}`, en: `Forked to new session on branch ${branch}` }))
  }

  // Deliver a fork's starting prompt once the new session is active, idle and the
  // CLI is up. Fires exactly once (pendingSeed cleared before send).
  useEffect(() => {
    if (!pendingSeed) return
    if (activeSession.id !== pendingSeed.sessionId) return
    if (activeSession.status !== 'idle' || !claudeOk) return
    const text = pendingSeed.text
    setPendingSeed(null)
    handleSend(text, activeSession.model)
    // handleSend/activeSession intentionally read fresh each render; guarded by the id check above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSeed, activeSession, claudeOk])

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
            onFork={(text) => openFork(text)}
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
                  onFork={() => openFork()}
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
                    sessions={sessions}
                    activeSessionId={activeSessionId}
                    onSelect={setActiveSessionId}
                    onNew={newSession}
                    onClose={closeSessionTab}
                    onFork={(id) => {
                      const s = sessions.find((x) => x.id === id)
                      setActiveSessionId(id)
                      openFork(undefined, s?.cwd)
                    }}
                  />
                  <div className="min-h-0 flex-1 overflow-hidden">{centerView}</div>
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
        />
      )}

      {forkState && (
        <ForkDialog
          defaultBranch={forkState.defaultBranch}
          seed={forkState.seed}
          onConfirm={(args) => void confirmFork(args)}
          onCancel={() => setForkState(null)}
          th={th}
        />
      )}
    </div>
  )
}
