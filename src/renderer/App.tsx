import { useEffect, useMemo, useRef, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { useSettings } from '@/settings/SettingsContext'
import { useVoiceCommands, dispatchCommand, type VoiceCommand } from '@/settings/voiceCommands'
import { useLocalVoice } from '@/settings/localVoice'
import { speak, plainSpeakableText, resolveLang } from '@/settings/speech'
import { speakSmart, cancelSmart } from '@/settings/tts'
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
import SettingsView from '@/views/settings/SettingsView'

import { ACTIVE_SESSION_ID, type ActivityId } from '@/mock/fixtures'
import { useSessions } from '@/state/useSessions'
import type { ComposerHandle } from '@/views/chat/Composer'
import * as claudeClient from '@/cli/claudeClient'
import type { PermissionMode, ClaudeEvent } from '@/cli/types'

export default function App(): JSX.Element {
  const { settings, update } = useSettings()
  const { state: sessionsState, dispatch: sessionsDispatch } = useSessions()
  const sessions = sessionsState.sessions
  const composerRef = useRef<ComposerHandle>(null)

  const [liveMode, setLiveMode] = useState(false)
  const [claudeOk, setClaudeOk] = useState(false)
  const [permissionMode, setPermissionMode] = useState<PermissionMode>('plan')

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

  /* ── Voice control for blind users ──────────────────────────────────────── */

  const cycleSession = (dir: 1 | -1): void =>
    setActiveSessionId((cur) => {
      const i = sessions.findIndex((s) => s.id === cur)
      const next = (i + dir + sessions.length) % sessions.length
      return sessions[next].id
    })

  const { code: voiceCode, short: lang } = resolveLang(settings.voiceLang)
  const th = lang === 'th'

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
    { phrases: ['settings', 'preferences', 'ตั้งค่า'], run: go('settings'), confirm: th ? 'ตั้งค่า' : 'Settings', label: '“settings” / “ตั้งค่า”' },
    { phrases: ['next tab', 'next session', 'แท็บถัดไป', 'ถัดไป'], run: () => cycleSession(1), confirm: th ? 'แท็บถัดไป' : 'Next tab', label: '“next tab” / “แท็บถัดไป”' },
    { phrases: ['previous tab', 'last tab', 'back tab', 'แท็บก่อนหน้า', 'ก่อนหน้า', 'ย้อนกลับ'], run: () => cycleSession(-1), confirm: th ? 'แท็บก่อนหน้า' : 'Previous tab', label: '“previous tab” / “แท็บก่อนหน้า”' },
    { phrases: ['toggle terminal', 'terminal', 'show terminal', 'hide terminal', 'เทอร์มินอล', 'หน้าต่างคำสั่ง'], run: () => setBottomOpen((v) => !v), confirm: th ? 'สลับเทอร์มินอล' : 'Terminal toggled', label: '“terminal” / “เทอร์มินอล”' },
    { phrases: ['toggle sidebar', 'sidebar', 'แถบข้าง', 'ไซด์บาร์'], run: () => setSidebarOpen((v) => !v), confirm: th ? 'สลับแถบข้าง' : 'Sidebar toggled', label: '“sidebar” / “แถบข้าง”' },
    { phrases: ['toggle panel', 'tasks panel', 'activity panel', 'พาเนล', 'แผงงาน'], run: () => setRightOpen((v) => !v), confirm: th ? 'สลับพาเนล' : 'Panel toggled', label: '“panel” / “พาเนล”' },
    { phrases: ['read response', 'read last', 'read message', 'read aloud', 'อ่าน', 'อ่านให้ฟัง', 'อ่านข้อความ'], run: readLastResponse, confirm: '', label: '“read” / “อ่าน”' },
    { phrases: ['quiet', 'silence', 'be quiet', 'เงียบ', 'เงียบ ๆ'], run: stopSpeaking, confirm: '', label: '“quiet” / “เงียบ”' },
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
      speak(
        th
          ? `คุณพูดได้ว่า: ${commands.map((c) => c.confirm).filter(Boolean).join(', ')}`
          : `You can say: ${commands.map((c) => c.label.replace(/["“”]/g, '')).join(', ')}.`,
        { lang: voiceCode },
      ),
    confirm: '',
    label: '“help” / “ช่วยเหลือ”',
  }

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
    speak(th ? `ได้เลย ต่อไปเรียกฉันว่า ${newName}` : `Okay, call me ${newName}`, {
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
    if (settings.requireWakeWord) {
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
    void speakSmart(text, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
      lang: voiceCode,
    })
  }

  const announceEvent = (event: ClaudeEvent): void => {
    if (event.type === 'assistant') {
      const tool = event.message.content.find((c) => c.type === 'tool_use')
      if (tool && tool.type === 'tool_use') {
        speakStatus(th ? `กำลังใช้ ${tool.name}` : `Running ${tool.name}`)
      }
    } else if (event.type === 'result') {
      speakStatus(event.is_error ? (th ? 'เกิดข้อผิดพลาด' : 'Error') : (th ? 'เสร็จแล้ว' : 'Done'))
    }
  }

  const terminalSummary = (event: ClaudeEvent): string => {
    switch (event.type) {
      case 'system': return `● init ${event.session_id ?? ''}`.trim()
      case 'assistant':
        return event.message.content
          .map((c) => (c.type === 'tool_use' ? `● ${c.name}` : c.type === 'text' ? '● (text)' : `● ${c.type}`))
          .join('  ')
      case 'user': return '  ⎿ tool result'
      case 'result': return event.is_error ? '✗ result: error' : '✓ result: done'
      default: return ''
    }
  }

  const handleSend = (text: string, modelId: string): void => {
    const sid = activeSession.id
    const now = new Date().toISOString()
    const userMessage = {
      id: nextId('u'), role: 'user' as const, createdAt: now,
      parts: [{ kind: 'markdown' as const, text }],
    }

    const useLive = liveMode && claudeOk
    const assistantMessage = {
      id: nextId('a'), role: 'assistant' as const, createdAt: now,
      parts: useLive ? [] : [{ kind: 'markdown' as const, text: th ? '(โหมดจำลอง — ยังไม่ได้เชื่อมต่อ)' : '(mock mode — not connected)' }],
      streaming: useLive,
    }
    sessionsDispatch({ type: 'startTurn', sessionId: sid, userMessage, assistantMessage })

    if (!useLive) {
      sessionsDispatch({ type: 'finishTurn', sessionId: sid })
      return
    }

    speakStatus(th ? 'กำลังคิด' : 'Thinking')

    const turnId = nextId('turn')
    const off = claudeClient.subscribe(turnId, {
      onEvent: (event: ClaudeEvent) => {
        sessionsDispatch({ type: 'event', sessionId: sid, event })
        announceEvent(event)
        sessionsDispatch({
          type: 'terminal', sessionId: sid,
          line: { id: nextId('tl'), kind: 'stdout', text: terminalSummary(event) },
        })
      },
      onStderr: (textLine: string) => {
        sessionsDispatch({
          type: 'terminal', sessionId: sid,
          line: { id: nextId('tl'), kind: 'stderr', text: textLine },
        })
      },
      onDone: () => {
        sessionsDispatch({ type: 'finishTurn', sessionId: sid })
        off()
      },
    })

    void claudeClient
      .startTurn({
        turnId, prompt: text, cwd: activeSession.cwd,
        sessionId: activeSession.claudeSessionId, model: modelId, permissionMode,
      })
      .then((r) => {
        if (!r.ok) {
          sessionsDispatch({
            type: 'terminal', sessionId: sid,
            line: { id: nextId('tl'), kind: 'stderr', text: r.error ?? 'failed to start claude' },
          })
          sessionsDispatch({ type: 'finishTurn', sessionId: sid })
          speakStatus(th ? 'เกิดข้อผิดพลาด' : 'Error')
          off()
        }
      })
  }

  const centerView = (() => {
    switch (activity) {
      case 'tasks':
        return <KanbanBoard />
      case 'changes':
        return <DiffView />
      case 'skills':
        return <SkillsBrowser />
      case 'usage':
        return <UsageView />
      case 'settings':
        return <SettingsView />
      case 'chat':
      case 'sessions':
      default:
        return <ChatView session={activeSession} onSend={handleSend} composerRef={composerRef} />
    }
  })()

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-bg text-fg">
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
                  onSelectSession={setActiveSessionId}
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
        live={liveMode}
        claudeAvailable={claudeOk}
        permissionMode={permissionMode}
        onToggleLive={() => setLiveMode((v) => !v)}
        onChangePermission={setPermissionMode}
      />
    </div>
  )
}
