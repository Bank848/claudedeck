import { useState } from 'react'
import { Volume2, Eye, Sparkles, RotateCcw, Play, Mic } from 'lucide-react'
import { useSettings } from '@/settings/SettingsContext'
import {
  isSpeechSupported,
  useVoices,
  speak,
  resolveLang,
  findGenderVoice,
  VOICE_PRESETS,
  type VoicePreset,
} from '@/settings/speech'
import { isDictationSupported } from '@/settings/speechRecognition'
import { useAudioInputs, useMicLevel } from '@/settings/audioDevices'
import { speakSmart } from '@/settings/tts'
import { fishHealth } from '@/settings/fishTts'
import { EDGE_VOICES, edgeSpeak } from '@/settings/edgeTts'
import { FISH_VOICES } from '@/mock/fixtures'
import { Toggle, Segmented, Select, Slider } from '@/components/controls'

export default function SettingsView(): JSX.Element {
  const { settings, update, reset } = useSettings()
  const voices = useVoices()
  const speechOk = isSpeechSupported()
  const { inputs } = useAudioInputs()
  const [micTest, setMicTest] = useState(false)
  const micLevel = useMicLevel(micTest, settings.micDeviceId)

  const voiceOptions = [
    { value: '', label: 'System default' },
    ...voices.map((v) => ({ value: v.voiceURI, label: `${v.name} (${v.lang})` })),
  ]
  const micOptions = [
    { value: '', label: 'System default' },
    ...inputs.map((d) => ({ value: d.deviceId, label: d.label })),
  ]

  const dictationOk = isDictationSupported()
  const sample = resolveLang(settings.voiceLang).short === 'th' ? 'สวัสดีครับ นี่คือเสียงผู้ช่วย' : 'Hi, this is your assistant voice.'

  const [fishStatus, setFishStatus] = useState('')

  const testVoice = (): void =>
    void speakSmart(sample, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
      lang: resolveLang(settings.voiceLang).code,
    })

  const testFish = async (): Promise<void> => {
    setFishStatus('กำลังพูด…')
    // Health check is best-effort (cloud may not expose it without auth).
    if (!settings.fishApiKey) {
      const ok = await fishHealth(settings.fishUrl)
      if (!ok) {
        setFishStatus('เชื่อมต่อ server ไม่ได้')
        return
      }
    }
    try {
      await speakSmart(sample, { lang: resolveLang(settings.voiceLang).code })
      setFishStatus('สำเร็จ ✓')
    } catch {
      setFishStatus('ผิดพลาด')
    }
  }

  const applyPreset = (p: VoicePreset): void => {
    const langShort = resolveLang(settings.voiceLang).short
    const voiceURI = findGenderVoice(voices, langShort, p.gender)
    update('voiceURI', voiceURI)
    update('speechPitch', p.pitch)
    update('speechRate', p.rate)
    update('voiceName', p.name)
    speak(sample, { rate: p.rate, pitch: p.pitch, voiceURI, lang: resolveLang(settings.voiceLang).code })
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

        {/* Accessibility */}
        <Section icon={<Volume2 size={16} className="text-accent" />} title="Accessibility">
          <Row
            label="Read text aloud"
            desc="Adds a speaker button on each assistant message to hear it spoken (text-to-speech). Press Esc to stop."
          >
            <Toggle
              label="Read text aloud"
              checked={settings.readAloud}
              onChange={(v) => update('readAloud', v)}
            />
          </Row>

          {!speechOk && (
            <p className="rounded-md border border-border bg-muted px-3 py-2 text-xs text-fg-muted">
              Text-to-speech is not available in this environment.
            </p>
          )}

          <Row label="Voice" desc="Choose which system voice reads the text.">
            <Select
              ariaLabel="Speech voice"
              value={settings.voiceURI}
              onChange={(v) => update('voiceURI', v)}
              options={voiceOptions}
            />
          </Row>

          <Row
            label="Voice persona"
            desc="Voice styles — tap to preview. The assistant's call-name is set separately below (default “กุ้ง”)."
          >
            <div className="flex flex-wrap justify-end gap-1.5">
              {VOICE_PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => applyPreset(p)}
                  disabled={!speechOk}
                  title={p.style}
                  className="flex flex-col items-center rounded-lg border border-border bg-bg px-2.5 py-1 transition-colors hover:border-accent disabled:opacity-50"
                >
                  <span className="text-xs font-medium text-fg">{p.name}</span>
                  <span className="text-[10px] text-fg-muted">{p.style}</span>
                </button>
              ))}
            </div>
          </Row>

          <Row label="Pitch" desc={`Higher = more anime · ${settings.speechPitch.toFixed(2)}`}>
            <Slider
              ariaLabel="Voice pitch"
              min={0.5}
              max={2}
              step={0.05}
              value={settings.speechPitch}
              onChange={(v) => update('speechPitch', v)}
            />
          </Row>

          <Row label="Speaking speed" desc={`Rate ${settings.speechRate.toFixed(1)}×`}>
            <div className="flex items-center gap-3">
              <Slider
                ariaLabel="Speaking speed"
                min={0.7}
                max={1.6}
                step={0.1}
                value={settings.speechRate}
                onChange={(v) => update('speechRate', v)}
              />
              <button
                type="button"
                onClick={testVoice}
                disabled={!speechOk}
                className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play size={13} />
                Test
              </button>
            </div>
          </Row>

          <Row
            label="Voice input (speech-to-text)"
            desc={
              dictationOk
                ? 'Show a microphone button in the composer to dictate messages by voice.'
                : 'Speech recognition is not available in this environment.'
            }
          >
            <Toggle
              label="Voice input"
              checked={settings.speechToText && dictationOk}
              onChange={(v) => update('speechToText', v)}
            />
          </Row>
        </Section>

        {/* Voice output engine */}
        <Section icon={<Volume2 size={16} className="text-accent" />} title="Voice output engine">
          <Row
            label="Engine"
            desc={
              settings.ttsEngine === 'fish'
                ? 'fish-speech (local server) — Miku/anime. Falls back to system voice if offline.'
                : settings.ttsEngine === 'edge'
                  ? 'Edge-TTS — free neural voices (incl. Thai), no API key, unlimited. Needs internet.'
                  : 'System voices with pitch personas — instant & offline.'
            }
          >
            <Segmented
              ariaLabel="Voice output engine"
              value={settings.ttsEngine}
              onChange={(v) => update('ttsEngine', v)}
              options={[
                { value: 'system', label: 'System' },
                { value: 'edge', label: 'Edge-TTS (free)' },
                { value: 'fish', label: 'fish-speech' },
              ]}
            />
          </Row>

          {settings.ttsEngine === 'edge' && (
            <div className="border-b border-border px-4 py-3">
              <div className="mb-2 text-sm font-medium text-fg">Edge-TTS voice (free)</div>
              <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                {EDGE_VOICES.map((v) => {
                  const active = settings.edgeVoice === v.id
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => {
                        update('edgeVoice', v.id)
                        update('voiceName', v.name)
                        void edgeSpeak(sample, {
                          voice: v.id,
                          rate: settings.speechRate,
                          pitch: settings.speechPitch,
                        }).catch(() => undefined)
                      }}
                      title={v.vibe}
                      className={`flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                        active ? 'border-accent bg-accent/10' : 'border-border bg-bg hover:border-border-strong'
                      }`}
                    >
                      <span className="text-sm font-medium text-fg">{v.name}</span>
                      <span className="truncate text-[10px] text-fg-muted">{v.vibe}</span>
                    </button>
                  )
                })}
              </div>
              <p className="mt-2 text-xs text-fg-muted">
                Free, no key, unlimited. Tip: raise Pitch above for a brighter, anime-ish tone.
              </p>
            </div>
          )}

          {settings.ttsEngine === 'fish' && (
            <>
              <Row label="Server URL" desc="Where your fish-speech server is running.">
                <input
                  aria-label="fish-speech server URL"
                  value={settings.fishUrl}
                  onChange={(e) => update('fishUrl', e.target.value)}
                  className="w-56 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
                />
              </Row>
              <div className="border-b border-border px-4 py-3">
                <div className="mb-2 text-sm font-medium text-fg">Anime / Miku voices</div>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
                  {FISH_VOICES.map((v) => {
                    const active = settings.fishReferenceId === v.id
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => {
                          update('fishReferenceId', v.id)
                          update('voiceName', v.name)
                        }}
                        title={v.vibe}
                        className={`flex flex-col items-start rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
                          active
                            ? 'border-accent bg-accent/10'
                            : 'border-border bg-bg hover:border-border-strong'
                        }`}
                      >
                        <span className="text-sm font-medium text-fg">{v.name}</span>
                        <span className="truncate text-[10px] text-fg-muted">{v.vibe}</span>
                      </button>
                    )
                  })}
                </div>
              </div>

              <Row
                label="Reference id"
                desc="Auto-filled by the buttons above, or paste a custom voice id."
              >
                <input
                  aria-label="fish-speech reference id"
                  value={settings.fishReferenceId}
                  onChange={(e) => update('fishReferenceId', e.target.value)}
                  placeholder="(default)"
                  className="w-56 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                />
              </Row>

              <Row
                label="API key (cloud)"
                desc="Set to use Fish Audio cloud (api.fish.audio) where these voices live. Leave blank for self-host."
              >
                <input
                  aria-label="fish-speech API key"
                  type="password"
                  value={settings.fishApiKey}
                  onChange={(e) => update('fishApiKey', e.target.value)}
                  placeholder="(self-host)"
                  className="w-56 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg placeholder:text-fg-muted focus:border-accent focus:outline-none"
                />
              </Row>
              <Row label="Test fish-speech" desc="Check the server and play a sample.">
                <div className="flex items-center gap-2">
                  {fishStatus && <span className="text-xs text-fg-muted">{fishStatus}</span>}
                  <button
                    type="button"
                    onClick={() => void testFish()}
                    className="flex items-center gap-1.5 rounded-md bg-accent px-2.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-accent-hover"
                  >
                    <Play size={13} />
                    Test
                  </button>
                </div>
              </Row>
              <p className="px-4 py-3 text-xs text-fg-muted">
                <strong className="text-fg">Cloud:</strong> set URL to{' '}
                <code className="text-fg">https://api.fish.audio</code> + paste an API key (free
                credit) — the voices above work instantly.{' '}
                <strong className="text-fg">Self-host (GPU):</strong>{' '}
                <code className="text-fg">python tools/api_server.py --listen 0.0.0.0:8080</code> and
                import the reference clips.
              </p>
            </>
          )}
        </Section>

        {/* Voice assistant (accessibility) */}
        <Section icon={<Mic size={16} className="text-accent" />} title="Voice assistant">
          <Row
            label="Hands-free voice control"
            desc="Operate the app by voice — say a command to change views, switch tabs, or toggle panels. Built for blind and low-vision users. Toggle anytime with Ctrl+Shift+V."
          >
            <Toggle
              label="Hands-free voice control"
              checked={settings.voiceCommands && dictationOk}
              onChange={(v) => update('voiceCommands', v)}
            />
          </Row>

          <Row
            label="Assistant name"
            desc={`Call it by this name OR the selected voice's name${settings.voiceName ? ` (“${settings.voiceName}”)` : ''} — e.g. “กุ้ง เปิดตั้งค่า”. Rename by voice: “เปลี่ยนชื่อเป็น …”.`}
          >
            <input
              aria-label="Assistant name"
              value={settings.assistantName}
              onChange={(e) => update('assistantName', e.target.value)}
              className="w-32 rounded-md border border-border bg-bg px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none"
            />
          </Row>

          <Row
            label="Require name before command"
            desc="Only act when you say the assistant's name first — avoids accidental triggers."
          >
            <Toggle
              label="Require name before command"
              checked={settings.requireWakeWord}
              onChange={(v) => update('requireWakeWord', v)}
            />
          </Row>

          <Row label="Assistant language" desc="Language the assistant listens in and replies with.">
            <Segmented
              ariaLabel="Assistant language"
              value={settings.voiceLang}
              onChange={(v) => update('voiceLang', v)}
              options={[
                { value: 'auto', label: 'Auto' },
                { value: 'th-TH', label: 'ไทย' },
                { value: 'en-US', label: 'English' },
              ]}
            />
          </Row>

          <Row
            label="Speech engine"
            desc={
              settings.sttEngine === 'local'
                ? 'Local Whisper runs on-device (offline after the model downloads once). Hold Ctrl+Shift+Space to talk.'
                : 'Browser engine is fast but may use an online service.'
            }
          >
            <Segmented
              ariaLabel="Speech engine"
              value={settings.sttEngine}
              onChange={(v) => update('sttEngine', v)}
              options={[
                { value: 'browser', label: 'Browser' },
                { value: 'local', label: 'Local (Whisper)' },
              ]}
            />
          </Row>

          {settings.sttEngine === 'local' && (
            <Row label="Local model" desc="Base is more accurate for Thai; Tiny is faster and smaller.">
              <Segmented
                ariaLabel="Local model"
                value={settings.whisperModel}
                onChange={(v) => update('whisperModel', v)}
                options={[
                  { value: 'Xenova/whisper-tiny', label: 'Tiny' },
                  { value: 'Xenova/whisper-base', label: 'Base' },
                ]}
              />
            </Row>
          )}
          <Row label="Microphone" desc="Input device for the local (Whisper) engine and the test below.">
            <Select
              ariaLabel="Microphone"
              value={settings.micDeviceId}
              onChange={(v) => update('micDeviceId', v)}
              options={micOptions}
            />
          </Row>

          <Row label="Test microphone" desc="Speak and watch the level move to confirm it works.">
            <div className="flex items-center gap-3">
              <div className="h-2 w-32 overflow-hidden rounded-full bg-bg">
                <div
                  className="h-full rounded-full bg-success transition-[width] duration-75"
                  style={{ width: `${Math.round(micLevel * 100)}%` }}
                />
              </div>
              <button
                type="button"
                onClick={() => setMicTest((v) => !v)}
                className={`flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  micTest
                    ? 'bg-destructive/20 text-destructive'
                    : 'bg-accent text-white hover:bg-accent-hover'
                }`}
              >
                <Mic size={13} />
                {micTest ? 'Stop' : 'Test'}
              </button>
            </div>
          </Row>

          {!dictationOk ? (
            <p className="px-4 py-3 text-xs text-fg-muted">
              Speech recognition is not available in this environment.
            </p>
          ) : (
            <div className="px-4 py-3">
              <div className="mb-1.5 text-xs font-medium text-fg">Try saying:</div>
              <div className="flex flex-wrap gap-1.5">
                {(resolveLang(settings.voiceLang).short === 'th'
                  ? ['แชท', 'งาน', 'การใช้งาน', 'ตั้งค่า', 'แท็บถัดไป', 'อ่าน', 'หยุด', 'เริ่มทำงานต่อ', 'ปิดผู้ช่วย']
                  : ['chat', 'tasks', 'usage', 'settings', 'next tab', 'read', 'pause', 'resume', 'turn off']
                ).map((c) => (
                  <span
                    key={c}
                    className="rounded-full border border-border bg-bg px-2 py-0.5 text-xs text-fg-muted"
                  >
                    “{c}”
                  </span>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* Appearance */}
        <Section icon={<Eye size={16} className="text-accent" />} title="Appearance">
          <Row label="Interface scale" desc="Zoom the whole interface up or down.">
            <Segmented
              ariaLabel="Interface scale"
              value={settings.uiScale}
              onChange={(v) => update('uiScale', v)}
              options={[
                { value: 'small', label: 'Small' },
                { value: 'normal', label: 'Default' },
                { value: 'large', label: 'Large' },
              ]}
            />
          </Row>
          <Row
            label="High contrast text"
            desc="Brighter text and stronger borders for low-vision readability."
          >
            <Toggle
              label="High contrast text"
              checked={settings.highContrast}
              onChange={(v) => update('highContrast', v)}
            />
          </Row>
          <Row label="Reduce motion" desc="Minimize animations and the streaming caret.">
            <Toggle
              label="Reduce motion"
              checked={settings.reduceMotion}
              onChange={(v) => update('reduceMotion', v)}
            />
          </Row>
        </Section>

        {/* About */}
        <Section icon={<Sparkles size={16} className="text-accent" />} title="About">
          <p className="text-sm text-fg-muted">
            ClaudeDeck — a dark-mode desktop shell that masks the Claude Code CLI. Phase 1
            (design-first) preview.
          </p>
        </Section>
      </div>
    </div>
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
