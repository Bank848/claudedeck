import { useState, useEffect } from 'react'
import { Volume2, Eye, Sparkles, RotateCcw, Play, Mic, HardDrive, Trash2, Bug, RefreshCw, LogIn, LogOut, ChevronDown, ShieldCheck } from 'lucide-react'
import { useSettings } from '@/settings/SettingsContext'
import {
  isSpeechSupported,
  useVoices,
  speak,
  resolveLang,
  findGenderVoice,
} from '@/settings/speech'
import { isDictationSupported } from '@/settings/speechRecognition'
import { useAudioInputs, useMicLevel, useMicMonitor } from '@/settings/audioDevices'
import { speakSmart } from '@/settings/tts'
import { edgeSpeak } from '@/settings/edgeTts'
import { customSpeak } from '@/settings/customTts'
import { useMikuServer } from '@/settings/mikuServer'
import { buildVoiceCatalog, findVoiceChoice, VOICE_GROUPS, type VoiceChoice } from '@/settings/voiceCatalog'
import { estimateUsage, clearCachedData, formatBytes } from '@/settings/storage'
import { getAppInfo, checkForUpdate, openExternal, reportBugUrl, type AppInfo } from '@/settings/appInfo'
import { Toggle, Segmented, Select, Slider } from '@/components/controls'
import { ToolRulesEditor, RuleList } from '@/components/controls/ToolRulesEditor'
import { DirScopeEditor } from '@/components/controls/DirScopeEditor'
import { LoginFlow } from '@/components/LoginFlow'
import { MODE_OPTIONS } from '@/settings/permissionModes'
import type { PermissionSettings } from '@/settings/permissionRules'
import type { useAuth } from '@/cli/useAuth'

export interface SettingsViewProps {
  auth: ReturnType<typeof useAuth>
  /** Persistent permission settings (allow/deny/ask/defaultMode/dirs). */
  permissions: PermissionSettings
  onChangePermissions: (next: PermissionSettings) => void
}

export default function SettingsView({
  auth,
  permissions,
  onChangePermissions,
}: SettingsViewProps): JSX.Element {
  const patchPerms = (patch: Partial<PermissionSettings>): void =>
    onChangePermissions({ ...permissions, ...patch })
  const { settings, update, reset } = useSettings()
  const voices = useVoices()
  const speechOk = isSpeechSupported()
  const { inputs } = useAudioInputs()
  const micMonitor = useMicMonitor(settings.micDeviceId)
  const micLevel = useMicLevel(micMonitor.recording, settings.micDeviceId)
  const miku = useMikuServer()
  const [modelUrl, setModelUrl] = useState('')
  const [dlStatus, setDlStatus] = useState('')
  const [mikuPrompt, setMikuPrompt] = useState(false)
  const [mikuErr, setMikuErr] = useState('')
  const [cacheUsage, setCacheUsage] = useState(0)
  const [clearing, setClearing] = useState(false)
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null)
  const [updateMsg, setUpdateMsg] = useState('')

  useEffect(() => {
    void estimateUsage().then(setCacheUsage)
    void getAppInfo().then(setAppInfo)
  }, [])

  const micOptions = [
    { value: '', label: 'System default' },
    ...inputs.map((d) => ({ value: d.deviceId, label: d.label })),
  ]

  const dictationOk = isDictationSupported()
  const sample = resolveLang(settings.voiceLang).short === 'th' ? 'สวัสดีครับ นี่คือเสียงผู้ช่วย' : 'Hi, this is your assistant voice.'

  const catalog = buildVoiceCatalog()
  const activeChoice = findVoiceChoice(settings.voiceChoiceId)

  // One-line readiness summary for the Miku-RVC card (announced via aria-live).
  const mikuReady = miku.available && miku.hasModel && miku.running
  const mikuStatus = !miku.available
    ? 'ใช้ได้เฉพาะแอปเดสก์ท็อป'
    : mikuReady
      ? 'พร้อมใช้งาน 🟢'
      : !miku.hasModel
        ? 'ขั้นต่อไป: เพิ่มไฟล์โมเดล'
        : miku.starting
          ? 'กำลังเริ่มเซิร์ฟเวอร์… (~30 วิ) รอสักครู่'
          : 'ขั้นต่อไป: กดเริ่มเซิร์ฟเวอร์'

  const previewActive = (): void => {
    const L = resolveLang(settings.voiceLang)
    void speakSmart(sample, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
      lang: L.code,
    })
  }

  /** Pick a voice: set engine + voice + pitch/rate in one action, then preview. */
  const applyChoice = (c: VoiceChoice): void => {
    update('voiceChoiceId', c.id)
    update('voiceName', c.name)
    setMikuPrompt(false)
    const L = resolveLang(settings.voiceLang)
    if (c.engine === 'system') {
      // Hybrid persona: route through a distinct Edge neural voice when online
      // (Windows has only one Thai system voice, so offline all personas sound
      // alike — same voice, different pitch). Always set the system voiceURI +
      // pitch/rate too: speakSmart's edge branch falls back to them offline / on
      // Edge failure, so the persona still works without a connection.
      const voiceURI = findGenderVoice(voices, L.short, c.gender ?? 'female')
      const pitch = c.pitch ?? 1
      const rate = c.rate ?? 1
      update('voiceURI', voiceURI)
      update('speechPitch', pitch)
      update('speechRate', rate)
      if (c.edgeVoice) {
        update('ttsEngine', 'edge')
        update('edgeVoice', c.edgeVoice)
        void edgeSpeak(sample, { voice: c.edgeVoice, rate, pitch }).catch(() =>
          speak(sample, { rate, pitch, voiceURI, lang: L.code }),
        )
      } else {
        update('ttsEngine', 'system')
        speak(sample, { rate, pitch, voiceURI, lang: L.code })
      }
    } else if (c.engine === 'edge' && c.edgeVoice) {
      update('ttsEngine', 'edge')
      update('edgeVoice', c.edgeVoice)
      void edgeSpeak(sample, {
        voice: c.edgeVoice,
        rate: settings.speechRate,
        pitch: settings.speechPitch,
      }).catch(() => undefined)
    } else if (c.engine === 'custom') {
      update('ttsEngine', 'custom')
      setMikuErr('')
      if (miku.available && miku.starting) {
        // Server spawned but still booting — a request now hits connection-refused
        // and would fail silently. Tell the user to wait instead.
        setMikuErr('กำลังเริ่มเซิร์ฟเวอร์มิกุ รอจนขึ้น 🟢 แล้วกดเลือกอีกครั้ง')
      } else if (miku.available && !miku.running) {
        setMikuPrompt(true)
      } else {
        // Call customSpeak directly with explicit opts — speakSmart reads a
        // module-level cfg published via a useEffect that has not committed yet
        // in this same tick, so it would preview with the *previous* engine.
        // Surface failures (don't swallow) so "no sound" is never silent.
        void customSpeak(sample, {
          url: settings.customUrl,
          voice: settings.customVoice,
          model: settings.customModel,
          apiKey: settings.customApiKey,
        }).catch((e) =>
          setMikuErr(
            `เล่นเสียงมิกุไม่สำเร็จ: ${e instanceof Error ? e.message : String(e)} — เช็คว่าเซิร์ฟเวอร์ขึ้น 🟢 แล้ว`,
          ),
        )
      }
    }
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between">
          <h1 className="text-2xl font-semibold text-fg">Settings</h1>
          <button
            type="button"
            onClick={reset}
            className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
          >
            <RotateCcw size={13} />
            Reset to defaults
          </button>
        </div>

        {/* Accessibility — first, because it is the heart of the app for blind users */}
        <Section icon={<Eye size={16} className="text-accent" />} title="การเข้าถึง (Accessibility)">
          <Row
            label="โหมดอ่านหน้าจอ (Screen-reader mode)"
            desc="เปิดแล้วแอปจะประกาศด้วยเสียงเมื่อเปลี่ยนหน้า/สถานะสำคัญ ผ่านลำโพง — สำหรับผู้ใช้ที่มองไม่เห็น. ค่าจะถูกจำไว้."
          >
            <Toggle
              label="โหมดอ่านหน้าจอ"
              checked={settings.screenReaderMode}
              onChange={(v) => update('screenReaderMode', v)}
            />
          </Row>

          <Row
            label="อ่านข้อความออกเสียง"
            desc="เพิ่มปุ่มลำโพงบนข้อความผู้ช่วยแต่ละอัน เพื่อฟังเสียงอ่าน (text-to-speech). กด Esc เพื่อหยุด."
          >
            <Toggle
              label="อ่านข้อความออกเสียง"
              checked={settings.readAloud}
              onChange={(v) => update('readAloud', v)}
            />
          </Row>

          <Row
            label="พิมพ์ด้วยเสียง (speech-to-text)"
            desc={
              dictationOk
                ? 'แสดงปุ่มไมโครโฟนในกล่องพิมพ์ เพื่อพูดเป็นข้อความ.'
                : 'การรู้จำเสียงไม่พร้อมใช้งานในสภาพแวดล้อมนี้.'
            }
          >
            <Toggle
              label="พิมพ์ด้วยเสียง"
              checked={settings.speechToText && dictationOk}
              onChange={(v) => update('speechToText', v)}
            />
          </Row>

          <Row label="ความคมชัดสูง" desc="ตัวอักษรสว่างขึ้น เส้นขอบเข้มขึ้น สำหรับผู้มีสายตาเลือนราง.">
            <Toggle
              label="ความคมชัดสูง"
              checked={settings.highContrast}
              onChange={(v) => update('highContrast', v)}
            />
          </Row>

          <Row label="ลดการเคลื่อนไหว" desc="ลดแอนิเมชันและเคอร์เซอร์กะพริบ.">
            <Toggle
              label="ลดการเคลื่อนไหว"
              checked={settings.reduceMotion}
              onChange={(v) => update('reduceMotion', v)}
            />
          </Row>

          <Row label="ขนาดอินเทอร์เฟซ" desc="ย่อหรือขยายทั้งหน้าจอ.">
            <Segmented
              ariaLabel="ขนาดอินเทอร์เฟซ"
              value={settings.uiScale}
              onChange={(v) => update('uiScale', v)}
              options={[
                { value: 'small', label: 'เล็ก' },
                { value: 'normal', label: 'ปกติ' },
                { value: 'large', label: 'ใหญ่' },
              ]}
            />
          </Row>
        </Section>

        {/* Permissions — curated once, persisted, sent via --settings */}
        <Section icon={<ShieldCheck size={16} className="text-accent" />} title="สิทธิ์การใช้งาน (Permissions)">
          <div className="px-4 py-3">
            <p className="mb-3 text-xs text-fg-muted">
              กำหนดกฎว่าเครื่องมือ (tools) ไหนใช้ได้/ต้องถาม/ห้ามใช้ — แต่ละกฎคือรูปแบบหนึ่งอัน เช่น
              <span className="font-mono"> Edit</span>, <span className="font-mono">Bash(git *)</span>,
              <span className="font-mono"> mcp__renpy__*</span>. ค่าจะถูกจำไว้และส่งให้ claude ทุกครั้ง.
            </p>
            <ToolRulesEditor
              allowed={permissions.allow ?? []}
              disallowed={permissions.deny ?? []}
              onChange={(next) => patchPerms({ allow: next.allowed, deny: next.disallowed })}
            />
            <div className="mt-4">
              <RuleList
                label="ถามก่อนใช้ (Ask)"
                hint="ถามทุกครั้งก่อนใช้เครื่องมือเหล่านี้ — เช่น Bash(rm *)"
                rules={permissions.ask ?? []}
                onChange={(next) => patchPerms({ ask: next })}
              />
            </div>
          </div>

          <Row
            label="โหมดเริ่มต้น (Default mode)"
            desc="โหมดสิทธิ์เริ่มต้นที่บันทึกไว้ — โหมดที่เลือกจากแถบสถานะจะใช้แทนเฉพาะรอบนั้น."
          >
            <Select
              ariaLabel="โหมดเริ่มต้น"
              value={permissions.defaultMode ?? ''}
              onChange={(v) => patchPerms({ defaultMode: v || undefined })}
              options={[
                { value: '', label: '(ไม่กำหนด)' },
                ...MODE_OPTIONS.map((o) => ({ value: o.mode, label: o.label })),
              ]}
            />
          </Row>

          <div className="border-t border-border px-4 py-3">
            <div className="mb-1.5 flex items-baseline gap-2">
              <span className="text-xs font-semibold text-fg">โฟลเดอร์เพิ่มเติม (Directory access)</span>
              <span className="text-[10px] text-fg-muted">ให้ claude เข้าถึงโฟลเดอร์นอกเหนือจากโฟลเดอร์งาน</span>
            </div>
            <DirScopeEditor
              dirs={permissions.additionalDirectories ?? []}
              onChange={(next) => patchPerms({ additionalDirectories: next })}
            />
          </div>
        </Section>

        {/* Voice — ONE box: pick a named voice, everything else is set for you */}
        <Section icon={<Volume2 size={16} className="text-accent" />} title="เสียงพูด (Voice)">
          <div className="px-4 py-3">
            <p className="mb-3 text-xs text-fg-muted">
              เลือกเสียงเดียว แล้วระบบตั้งค่าที่เหลือให้เอง — กดปุ่มไหนก็เล่นตัวอย่างให้ฟังทันที.
            </p>

            {!speechOk && (
              <p className="mb-3 rounded-md border border-border bg-muted px-3 py-2 text-xs text-fg-muted">
                เสียงพูดไม่พร้อมใช้งานในสภาพแวดล้อมนี้.
              </p>
            )}

            <div className="space-y-4">
              {VOICE_GROUPS.map((g) => {
                const choices = catalog.filter((c) => c.group === g.id)
                if (!choices.length) return null
                return (
                  <VoiceRadioGroup
                    key={g.id}
                    label={g.label}
                    hint={g.hint}
                    choices={choices}
                    selectedId={settings.voiceChoiceId}
                    disabled={!speechOk}
                    onSelect={applyChoice}
                  />
                )
              })}
            </div>

            {/* Miku-RVC needs the local server — offer to start it, announced live */}
            {mikuPrompt && (
              <div
                role="alert"
                className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300"
              >
                <span>ต้องเปิด Miku server ก่อนถึงจะได้ยินเสียงมิกุ.</span>
                <button
                  type="button"
                  onClick={() => {
                    void miku.start()
                    setMikuPrompt(false)
                  }}
                  className="shrink-0 rounded-md bg-accent px-2.5 py-1 font-medium text-white transition-colors hover:bg-accent-hover"
                >
                  เปิดเลย
                </button>
              </div>
            )}

            {/* Miku preview failed / still warming up — surfaced, never silent */}
            {mikuErr && (
              <div
                role="alert"
                className="mt-3 flex items-center justify-between gap-3 rounded-md border border-amber-400/40 bg-amber-400/10 px-3 py-2 text-xs text-amber-300"
              >
                <span>{mikuErr}</span>
                <button
                  type="button"
                  onClick={() => setMikuErr('')}
                  className="shrink-0 rounded-md border border-amber-400/40 px-2.5 py-1 font-medium transition-colors hover:bg-amber-400/10"
                >
                  ปิด
                </button>
              </div>
            )}
          </div>

          {/* Advanced — progressive disclosure: hidden until the user wants it */}
          <details className="group border-t border-border">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-4 py-3 text-sm font-medium text-fg-muted transition-colors hover:text-fg">
              <ChevronDown size={15} className="transition-transform group-open:rotate-180" />
              ตั้งค่าขั้นสูง
            </summary>

            <div className="border-t border-border">
              <Row label="ระดับเสียงสูง-ต่ำ (Pitch)" desc={`สูง = อนิเมะขึ้น · ${settings.speechPitch.toFixed(2)}`}>
                <Slider
                  ariaLabel="ระดับเสียง"
                  min={0.5}
                  max={2}
                  step={0.05}
                  value={settings.speechPitch}
                  onChange={(v) => update('speechPitch', v)}
                />
              </Row>

              <Row label="ความเร็วในการพูด" desc={`${settings.speechRate.toFixed(1)}×`}>
                <div className="flex items-center gap-3">
                  <Slider
                    ariaLabel="ความเร็วในการพูด"
                    min={0.7}
                    max={1.6}
                    step={0.1}
                    value={settings.speechRate}
                    onChange={(v) => update('speechRate', v)}
                  />
                  <button
                    type="button"
                    onClick={previewActive}
                    disabled={!speechOk}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Play size={13} />
                    ทดสอบ
                  </button>
                </div>
              </Row>

              {/* Miku-RVC card — only when a Miku voice is active. Two-step checklist
                  (model → server) + a single action button, instead of a wall of inputs. */}
              {activeChoice?.engine === 'custom' && (
                <div className="border-t border-border px-4 py-3">
                  {/* One-line readiness summary, announced to screen readers */}
                  <div role="status" aria-live="polite" className="mb-3 flex items-center gap-2 text-sm font-medium">
                    <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${mikuReady ? 'bg-success' : 'bg-amber-400'}`} />
                    <span className={mikuReady ? 'text-success' : 'text-amber-300'}>มิกุ — {mikuStatus}</span>
                  </div>

                  {miku.available ? (
                    <ol className="space-y-2.5">
                      {/* ① Model */}
                      <li className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-sm text-fg">
                          <span aria-hidden>{miku.hasModel ? '✅' : '⬜'}</span>
                          ① โมเดล: {miku.hasModel ? 'พบแล้ว' : 'ยังไม่มี'}
                        </span>
                        <button
                          type="button"
                          onClick={miku.openModels}
                          className="shrink-0 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
                        >
                          {miku.hasModel ? 'เปิดโฟลเดอร์' : 'เลือกไฟล์…'}
                        </button>
                      </li>

                      {/* Load-from-URL — only shown until a model exists, to cut clutter */}
                      {!miku.hasModel && (
                        <li className="flex items-center gap-2 pl-6">
                          <input
                            aria-label="โหลดโมเดลจาก URL"
                            value={modelUrl}
                            onChange={(e) => setModelUrl(e.target.value)}
                            placeholder="หรือวางลิงก์ .pth แล้วกดโหลด"
                            className="min-w-0 flex-1 rounded-md border border-border bg-bg px-2 py-1.5 text-xs text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                          />
                          {dlStatus && <span className="shrink-0 text-xs text-fg-muted">{dlStatus}</span>}
                          <button
                            type="button"
                            disabled={!modelUrl.trim()}
                            onClick={async () => {
                              setDlStatus('กำลังโหลด…')
                              const r = await miku.downloadModel(modelUrl.trim())
                              setDlStatus(r.ok ? 'สำเร็จ ✓' : `ผิดพลาด: ${r.error ?? ''}`)
                            }}
                            className="shrink-0 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:opacity-50"
                          >
                            โหลด
                          </button>
                        </li>
                      )}

                      {/* ② Server — single start/stop button */}
                      <li className="flex items-center justify-between gap-3">
                        <span className="flex items-center gap-2 text-sm text-fg">
                          <span aria-hidden>{miku.running ? '✅' : miku.starting ? '⏳' : '⬜'}</span>
                          ② เซิร์ฟเวอร์:{' '}
                          {miku.running
                            ? 'กำลังทำงาน'
                            : miku.starting
                              ? 'กำลังเริ่ม… (~30 วิ)'
                              : 'ยังไม่เริ่ม'}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            miku.running || miku.starting ? void miku.stop() : void miku.start()
                          }
                          className={`shrink-0 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                            miku.running || miku.starting
                              ? 'bg-destructive/20 text-destructive hover:bg-destructive/30'
                              : 'bg-accent text-white hover:bg-accent-hover'
                          }`}
                        >
                          {miku.running || miku.starting ? 'หยุด' : 'เริ่ม'}
                        </button>
                      </li>
                    </ol>
                  ) : (
                    <p className="text-xs text-fg-muted">เปิดบนแอปเดสก์ท็อปเพื่อรัน Miku server.</p>
                  )}

                  {/* GPU caveat — collapsed to one line, expandable */}
                  <details className="mt-3 text-xs">
                    <summary className="cursor-pointer text-amber-400/90 transition-colors hover:text-amber-300">
                      ⚠️ ใช้ทรัพยากรเครื่องสูง (กดดูรายละเอียด)
                    </summary>
                    <p className="mt-1.5 leading-relaxed text-fg-muted">
                      รัน RVC ในเครื่อง — แนะนำ GPU NVIDIA (RTX 3060/4070 ขึ้นไป, VRAM ≥ 6 GB).
                      ครั้งแรกต้องโหลดโมเดล ~3 GB และลง deps สักครู่. GPU อ่อน/CPU อาจมีดีเลย์.
                      ถ้า server ล่มจะถอยไปใช้เสียงระบบให้อัตโนมัติ.
                    </p>
                  </details>

                  {miku.log && (
                    <pre className="mt-2 max-h-32 overflow-auto rounded-md border border-border bg-bg p-2 font-mono text-[10px] leading-relaxed text-fg-muted">
                      {miku.log}
                    </pre>
                  )}

                  {/* Expert server settings — 99% never touch these, so nest them deeper */}
                  <details className="mt-2">
                    <summary className="cursor-pointer list-none text-xs font-medium text-fg-muted transition-colors hover:text-fg">
                      ▸ ตั้งค่าเซิร์ฟเวอร์ (ผู้เชี่ยวชาญ)
                    </summary>
                    <div className="mt-1 border-t border-border">
                      <Row label="Server URL" desc="OpenAI-compatible /v1/audio/speech endpoint.">
                        <input
                          aria-label="Custom server URL"
                          value={settings.customUrl}
                          onChange={(e) => update('customUrl', e.target.value)}
                          className="w-56 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                      </Row>
                      <Row label="ชื่อเสียงบนเซิร์ฟเวอร์" desc="เช่น miku.">
                        <input
                          aria-label="Custom voice"
                          value={settings.customVoice}
                          onChange={(e) => update('customVoice', e.target.value)}
                          className="w-40 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                      </Row>
                      <Row label="Model" desc="Model id (default tts-1).">
                        <input
                          aria-label="Custom model"
                          value={settings.customModel}
                          onChange={(e) => update('customModel', e.target.value)}
                          className="w-40 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                        />
                      </Row>
                      <Row label="API key" desc="Optional bearer token.">
                        <input
                          aria-label="Custom API key"
                          type="password"
                          value={settings.customApiKey}
                          onChange={(e) => update('customApiKey', e.target.value)}
                          placeholder="(none)"
                          className="w-40 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                        />
                      </Row>
                    </div>
                  </details>
                </div>
              )}
            </div>
          </details>
        </Section>

        {/* Voice assistant (accessibility) — unchanged */}
        <Section icon={<Mic size={16} className="text-accent" />} title="ผู้ช่วยเสียง (Voice assistant)">
          <Row
            label="ควบคุมด้วยเสียง (แฮนด์ฟรี)"
            desc="สั่งงานแอปด้วยเสียง — เปลี่ยนหน้า สลับแท็บ เปิด-ปิดพาเนล. สำหรับผู้พิการทางสายตา. สลับเปิด-ปิดได้ทุกเมื่อด้วย Ctrl+Shift+V."
          >
            <Toggle
              label="ควบคุมด้วยเสียง"
              checked={settings.voiceCommands && dictationOk}
              onChange={(v) => update('voiceCommands', v)}
            />
          </Row>

          <Row
            label="ชื่อผู้ช่วย"
            desc={`เรียกด้วยชื่อนี้ หรือชื่อเสียงที่เลือก${settings.voiceName ? ` (“${settings.voiceName}”)` : ''} — เช่น “กุ้ง เปิดตั้งค่า”. เปลี่ยนชื่อด้วยเสียง: “เปลี่ยนชื่อเป็น …”.`}
          >
            <input
              aria-label="ชื่อผู้ช่วย"
              value={settings.assistantName}
              onChange={(e) => update('assistantName', e.target.value)}
              className="w-32 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            />
          </Row>

          <Row label="ต้องเรียกชื่อก่อนสั่ง" desc="ทำงานเฉพาะเมื่อพูดชื่อผู้ช่วยขึ้นก่อน — กันสั่งโดยไม่ตั้งใจ.">
            <Toggle
              label="ต้องเรียกชื่อก่อนสั่ง"
              checked={settings.requireWakeWord}
              onChange={(v) => update('requireWakeWord', v)}
            />
          </Row>

          <Row label="ภาษาผู้ช่วย" desc="ภาษาที่ผู้ช่วยฟังและตอบ.">
            <Segmented
              ariaLabel="ภาษาผู้ช่วย"
              value={settings.voiceLang}
              onChange={(v) => update('voiceLang', v)}
              options={[
                { value: 'auto', label: 'อัตโนมัติ' },
                { value: 'th-TH', label: 'ไทย' },
                { value: 'en-US', label: 'English' },
              ]}
            />
          </Row>

          <Row label="ไมโครโฟน" desc="อุปกรณ์รับเสียงสำหรับแปลงเสียงเป็นข้อความ (Whisper Base, ในเครื่อง) และการทดสอบด้านล่าง. กดค้าง Ctrl+Shift+Space เพื่อพูด.">
            <Select
              ariaLabel="ไมโครโฟน"
              value={settings.micDeviceId}
              onChange={(v) => update('micDeviceId', v)}
              options={micOptions}
            />
          </Row>

          <Row
            label="ทดสอบไมโครโฟน"
            desc="กดอัดเสียงสั้น ๆ แล้วระบบเล่นกลับให้ฟังทันที — ยืนยันว่าไมค์ทำงานโดยฟังเสียงตัวเอง. แถบด้านข้างแสดงระดับเสียงตอนอัด."
          >
            <div className="flex items-center gap-3">
              <div
                className="h-2 w-32 overflow-hidden rounded-full bg-bg"
                role="meter"
                aria-label="ระดับเสียงไมโครโฟน"
                aria-valuenow={Math.round(micLevel * 100)}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full rounded-full bg-success transition-[width] duration-75"
                  style={{ width: `${Math.round(micLevel * 100)}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => (micMonitor.recording ? micMonitor.stopAndPlay() : void micMonitor.start())}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  micMonitor.recording ? 'bg-destructive/20 text-destructive' : 'bg-accent text-white hover:bg-accent-hover'
                }`}
              >
                <Mic size={13} />
                {micMonitor.recording ? 'หยุดแล้วฟัง' : 'อัดทดสอบ'}
              </button>
            </div>
          </Row>

          {!dictationOk ? (
            <p className="px-4 py-3 text-xs text-fg-muted">การรู้จำเสียงไม่พร้อมใช้งานในสภาพแวดล้อมนี้.</p>
          ) : (
            <div className="px-4 py-3">
              <div className="mb-1.5 text-xs font-medium text-fg">ลองพูดว่า:</div>
              <div className="flex flex-wrap gap-1.5">
                {(resolveLang(settings.voiceLang).short === 'th'
                  ? ['แชท', 'งาน', 'การใช้งาน', 'ตั้งค่า', 'แท็บถัดไป', 'อ่าน', 'หยุด', 'เริ่มทำงานต่อ', 'ปิดผู้ช่วย']
                  : ['chat', 'tasks', 'usage', 'settings', 'next tab', 'read', 'pause', 'resume', 'turn off']
                ).map((c) => (
                  <span key={c} className="rounded-full border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted">
                    “{c}”
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Storage */}
        <Section icon={<HardDrive size={16} className="text-accent" />} title="พื้นที่จัดเก็บ (Storage)">
          <Row
            label="ข้อมูลแคช"
            desc={`โมเดลเสียงที่โหลดไว้ (Whisper ออฟไลน์ ฯลฯ) แคชบนเครื่องนี้ — ประมาณ ${formatBytes(cacheUsage)}. การตั้งค่าจะถูกเก็บไว้.`}
          >
            <button
              type="button"
              disabled={clearing}
              onClick={async () => {
                setClearing(true)
                try {
                  await clearCachedData()
                  setCacheUsage(await estimateUsage())
                } finally {
                  setClearing(false)
                }
              }}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-destructive hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Trash2 size={13} />
              {clearing ? 'กำลังล้าง…' : 'ล้างข้อมูลแคช'}
            </button>
          </Row>
        </Section>

        {/* Account */}
        <Section icon={<LogIn size={16} className="text-accent" />} title="บัญชี (Account)">
          {auth.status.loggedIn ? (
            <>
              <Row label="สถานะ" desc={auth.status.authMethod}>
                <span className="flex items-center gap-2 text-sm text-fg">
                  <span className="h-2 w-2 rounded-full bg-emerald-500" /> เข้าสู่ระบบแล้ว
                </span>
              </Row>
              <Row label="บัญชี" desc={auth.status.plan ? `${auth.status.plan} plan` : undefined}>
                <span className="text-sm text-fg">{auth.status.email ?? '—'}</span>
              </Row>
              <Row label="ออกจากระบบ" desc="ล้างข้อมูลรับรองบนเครื่องนี้">
                <LogoutButton onLogout={() => void auth.logout()} />
              </Row>
            </>
          ) : (
            <div className="px-4 py-3">
              <LoginFlow auth={auth} />
            </div>
          )}
        </Section>

        {/* About */}
        <Section icon={<Sparkles size={16} className="text-accent" />} title="เกี่ยวกับ (About)">
          <Row
            label="ClaudeDeck"
            desc={
              appInfo
                ? `เวอร์ชัน ${appInfo.version} · ${appInfo.platform} ${appInfo.arch} · Electron ${appInfo.electron}`
                : 'A dark-mode desktop shell that masks the Claude Code CLI. Phase 1 (design-first) preview.'
            }
          >
            <button
              type="button"
              onClick={async () => {
                setUpdateMsg('กำลังเช็ก…')
                const r = await checkForUpdate()
                setUpdateMsg(
                  !r.ok
                    ? `เช็กไม่ได้: ${r.error ?? ''}`
                    : r.hasUpdate
                      ? `มีเวอร์ชันใหม่ v${r.latest} — เปิดหน้าดาวน์โหลดให้แล้ว`
                      : 'เป็นเวอร์ชันล่าสุดแล้ว ✓',
                )
                if (r.ok && r.hasUpdate && r.url) openExternal(r.url)
              }}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-border-strong hover:text-fg"
            >
              <RefreshCw size={13} />
              เช็กอัปเดต
            </button>
          </Row>
          {updateMsg && <p className="px-4 py-2 text-xs text-fg-muted">{updateMsg}</p>}
          <Row label="พบบั๊ก?" desc="เปิด GitHub Issue พร้อมเวอร์ชันแอป + ระบบปฏิบัติการให้อัตโนมัติ.">
            <button
              type="button"
              onClick={() => openExternal(reportBugUrl(appInfo))}
              className="flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs text-fg-muted transition-colors hover:border-accent hover:text-accent"
            >
              <Bug size={13} />
              รายงานบั๊ก
            </button>
          </Row>
        </Section>
      </div>
    </div>
  )
}

/** A labeled radiogroup of voice chips with roving tabindex + arrow-key navigation. */
function VoiceRadioGroup({
  label,
  hint,
  choices,
  selectedId,
  disabled,
  onSelect,
}: {
  label: string
  hint: string
  choices: VoiceChoice[]
  selectedId: string
  disabled: boolean
  onSelect: (c: VoiceChoice) => void
}): JSX.Element {
  const selectedIdx = choices.findIndex((c) => c.id === selectedId)

  const onKeyDown = (e: React.KeyboardEvent, i: number): void => {
    let next = -1
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') next = (i + 1) % choices.length
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') next = (i - 1 + choices.length) % choices.length
    if (next < 0) return
    e.preventDefault()
    onSelect(choices[next])
    document.getElementById(`voice-${choices[next].id}`)?.focus()
  }

  return (
    <div role="radiogroup" aria-label={label}>
      <div className="mb-1.5 flex items-baseline gap-2">
        <span className="text-xs font-semibold text-fg">{label}</span>
        <span className="text-[10px] text-fg-muted">{hint}</span>
      </div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
        {choices.map((c, i) => {
          const active = c.id === selectedId
          // Roving tabindex: the selected chip is the tab stop; if none selected, the first.
          const isTabStop = active || (selectedIdx === -1 && i === 0)
          return (
            <button
              key={c.id}
              id={`voice-${c.id}`}
              type="button"
              role="radio"
              aria-checked={active}
              aria-label={`${c.name} — ${c.vibe}`}
              tabIndex={isTabStop ? 0 : -1}
              disabled={disabled}
              onClick={() => onSelect(c)}
              onKeyDown={(e) => onKeyDown(e, i)}
              className={`flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors disabled:opacity-50 ${
                active ? 'border-accent bg-accent/10' : 'border-border bg-bg hover:border-border-strong'
              }`}
            >
              <span className="text-sm font-medium text-fg">{c.name}</span>
              <span className="truncate text-[10px] text-fg-muted">{c.vibe}</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

function LogoutButton({ onLogout }: { onLogout: () => void }): JSX.Element {
  const [confirm, setConfirm] = useState(false)
  useEffect(() => {
    if (!confirm) return
    const t = setTimeout(() => setConfirm(false), 3000)
    return () => clearTimeout(t)
  }, [confirm])
  return (
    <button
      onClick={() => (confirm ? onLogout() : setConfirm(true))}
      className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm text-fg-muted hover:text-fg"
    >
      <LogOut size={14} /> {confirm ? 'กดอีกครั้งเพื่อยืนยัน' : 'ออกจากระบบ'}
    </button>
  )
}

function Section({
  icon,
  title,
  children,
}: {
  icon: React.ReactNode
  title: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <section className="mb-8">
      <h2 className="mb-3 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
        {icon}
        {title}
      </h2>
      <div className="space-y-1 rounded-lg border border-border bg-surface">{children}</div>
    </section>
  )
}

function Row({
  label,
  desc,
  children,
}: {
  label: string
  desc?: string
  children: React.ReactNode
}): JSX.Element {
  return (
    <div className="flex items-center justify-between gap-4 border-b border-border px-4 py-3 last:border-b-0">
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">{label}</div>
        {desc && <div className="mt-0.5 text-xs text-fg-muted">{desc}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  )
}
