import { useEffect, useMemo, useState } from 'react'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

import { useSettings } from '@/settings/SettingsContext'
import { useVoiceCommands, dispatchCommand, type VoiceCommand } from '@/settings/voiceCommands'
import { useLocalVoice } from '@/settings/localVoice'
import { speak, cancelSpeech, plainSpeakableText, resolveLang } from '@/settings/speech'
import { speakSmart } from '@/settings/tts'
import { VoiceControlIndicator } from '@/components/VoiceControlIndicator'

import { TitleBar } from '@/layout/TitleBar'
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

import { SESSIONS, ACTIVE_SESSION_ID, type ActivityId } from '@/mock/fixtures'

export default function App(): JSX.Element {
  const { settings, update } = useSettings()
  const [activity, setActivity] = useState<ActivityId>('chat')
  const [activeSessionId, setActiveSessionId] = useState<string>(ACTIVE_SESSION_ID)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [bottomOpen, setBottomOpen] = useState(true)

  const activeSession = useMemo(
    () => SESSIONS.find((s) => s.id === activeSessionId) ?? SESSIONS[0],
    [activeSessionId],
  )

  /* ── Voice control for blind users ──────────────────────────────────────── */

  const cycleSession = (dir: 1 | -1): void =>
    setActiveSessionId((cur) => {
      const i = SESSIONS.findIndex((s) => s.id === cur)
      const next = (i + dir + SESSIONS.length) % SESSIONS.length
      return SESSIONS[next].id
    })

  const { code: voiceCode, short: lang } = resolveLang(settings.voiceLang)
  const th = lang === 'th'

  const readLastResponse = (): void => {
    const last = [...activeSession.messages].reverse().find((m) => m.role === 'assistant')
    const text = last
      ? plainSpeakableText(last.parts.map((p) => ('text' in p ? p.text : '')).join('. '))
      : th
        ? 'ยังไม่มีข้อความให้อ่าน'
        : 'No response to read.'
    void speakSmart(text, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
      lang: voiceCode,
    })
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
    { phrases: ['quiet', 'silence', 'be quiet', 'เงียบ', 'เงียบ ๆ'], run: cancelSpeech, confirm: '', label: '“quiet” / “เงียบ”' },
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

  // Single entry point for both engines: rename → wake-word gate → dispatch.
  const handleVoice = (t: string): void => {
    setHeard(t.toLowerCase().trim())
    if (tryRename(t)) return
    let cmd = t
    if (settings.requireWakeWord) {
      const name = settings.assistantName.trim().toLowerCase()
      const idx = name ? t.toLowerCase().indexOf(name) : -1
      if (idx === -1) return // name not spoken → ignore (avoids misfires)
      cmd = t.slice(idx + name.length).trim() || t
    }
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
        return <ChatView session={activeSession} />
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
                  sessions={SESSIONS}
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
                    sessions={SESSIONS}
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
                    <BottomPanel onClose={() => setBottomOpen(false)} />
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

      <StatusBar session={activeSession} />
    </div>
  )
}
