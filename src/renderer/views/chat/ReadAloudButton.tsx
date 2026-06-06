import { useState } from 'react'
import { Volume2, Square } from 'lucide-react'
import { useSettings } from '@/settings/SettingsContext'
import { isSpeechSupported } from '@/settings/speech'
import { speakSmart, cancelSmart } from '@/settings/tts'

/** Speaker button shown on assistant messages when read-aloud is enabled. */
export function ReadAloudButton({ text }: { text: string }): JSX.Element | null {
  const { settings } = useSettings()
  const [speaking, setSpeaking] = useState(false)

  if (!settings.readAloud || !isSpeechSupported() || !text) return null

  const toggle = (): void => {
    if (speaking) {
      cancelSmart()
      setSpeaking(false)
      return
    }
    setSpeaking(true)
    void speakSmart(text, {
      rate: settings.speechRate,
      pitch: settings.speechPitch,
      voiceURI: settings.voiceURI,
    }).finally(() => setSpeaking(false))
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={speaking ? 'Stop reading' : 'Read message aloud'}
      title={speaking ? 'Stop reading' : 'Read message aloud'}
      className={`flex h-6 w-6 items-center justify-center rounded transition-colors hover:bg-surface-2 ${
        speaking ? 'text-accent' : 'text-fg-muted hover:text-fg'
      }`}
    >
      {speaking ? <Square size={13} className="fill-current" /> : <Volume2 size={14} />}
    </button>
  )
}
