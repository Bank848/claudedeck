import { describe, it, expect, vi } from 'vitest'
import { dispatchCommand, type VoiceCommand } from './voiceCommands'
import { MODE_OPTIONS } from './permissionModes'

function cmds() {
  const read = vi.fn()
  const tasks = vi.fn()
  const resume = vi.fn()
  const send = vi.fn()
  const commands: VoiceCommand[] = [
    { phrases: ['tasks', 'งาน', 'บอร์ด'], run: tasks, confirm: '', label: 'tasks' },
    { phrases: ['resume', 'เริ่มทำงานต่อ', 'ทำงานต่อ'], run: resume, confirm: '', label: 'resume' },
    { phrases: ['read response', 'อ่าน', 'อ่านให้ฟัง'], run: read, confirm: '', label: 'read' },
    { phrases: ['send', 'ส่ง', 'ส่งข้อความ'], run: send, confirm: '', label: 'send' },
  ]
  return { commands, read, tasks, resume, send }
}

describe('dispatchCommand (natural sentences)', () => {
  it('matches a command embedded in a full sentence', () => {
    const { commands, read } = cmds()
    dispatchCommand(commands, 'ช่วยอ่านให้ฟังหน่อย', 'th-TH')
    expect(read).toHaveBeenCalledOnce()
  })

  it('the longest matching phrase wins (resume beats tasks in "เริ่มทำงานต่อ")', () => {
    const { commands, resume, tasks } = cmds()
    dispatchCommand(commands, 'เริ่มทำงานต่อ', 'th-TH')
    expect(resume).toHaveBeenCalledOnce()
    expect(tasks).not.toHaveBeenCalled()
  })

  it('prefers the more specific send phrase in a sentence', () => {
    const { commands, send } = cmds()
    const hit = dispatchCommand(commands, 'ช่วยส่งข้อความให้ที', 'th-TH')
    expect(send).toHaveBeenCalledOnce()
    expect(hit?.label).toBe('send')
  })

  it('returns null when nothing matches', () => {
    const { commands } = cmds()
    expect(dispatchCommand(commands, 'สวัสดีครับ', 'th-TH')).toBeNull()
  })
})

describe('dispatchCommand (Whisper Thai segmentation — STT inserts spaces between Thai words)', () => {
  it('matches a multi-word Thai phrase even when the transcript has spaces inside it', () => {
    const settings = vi.fn()
    const commands: VoiceCommand[] = [
      { phrases: ['settings', 'ตั้งค่า'], run: settings, confirm: '', label: 'settings' },
    ]
    // Local Whisper emits Thai with spaces between words: "ไป หน้า ตั้ง ค่า"
    const hit = dispatchCommand(commands, 'ไป หน้า ตั้ง ค่า', 'th-TH')
    expect(settings).toHaveBeenCalledOnce()
    expect(hit?.label).toBe('settings')
  })

  it('a spaced transcript does not fall through to a shorter embedded phrase (usage ≠ tasks)', () => {
    const usage = vi.fn()
    const tasks = vi.fn()
    const commands: VoiceCommand[] = [
      { phrases: ['tasks', 'งาน'], run: tasks, confirm: '', label: 'tasks' },
      { phrases: ['usage', 'การใช้งาน'], run: usage, confirm: '', label: 'usage' },
    ]
    // "เปิด การ ใช้ งาน": without normalization 'การใช้งาน' cannot match,
    // and the embedded 'งาน' wins → navigates to the WRONG view.
    const hit = dispatchCommand(commands, 'เปิด การ ใช้ งาน', 'th-TH')
    expect(usage).toHaveBeenCalledOnce()
    expect(tasks).not.toHaveBeenCalled()
    expect(hit?.label).toBe('usage')
  })

  it('English matching is unchanged: spaces between Latin words are NOT collapsed', () => {
    const send = vi.fn()
    const next = vi.fn()
    const commands: VoiceCommand[] = [
      { phrases: ['send', 'ส่ง'], run: send, confirm: '', label: 'send' },
      { phrases: ['next tab'], run: next, confirm: '', label: 'next' },
    ]
    // Collapsing all spaces would turn "let's end now" into "let'sendnow" → false 'send'.
    expect(dispatchCommand(commands, "let's end now", 'en-US')).toBeNull()
    expect(send).not.toHaveBeenCalled()
    // Multi-word English phrases still match normally.
    dispatchCommand(commands, 'go to the next tab', 'en-US')
    expect(next).toHaveBeenCalledOnce()
  })
})

describe('mode voice commands resolve through dispatchCommand', () => {
  it('each mode phrase set routes to its mode command, longest-match safe', () => {
    const setMode = vi.fn()
    const commands: VoiceCommand[] = MODE_OPTIONS.map((o) => ({
      phrases: o.phrases, run: () => setMode(o.mode), confirm: '', label: o.label,
    }))
    dispatchCommand(commands, 'please bypass permissions', 'en-US')
    expect(setMode).toHaveBeenCalledWith('bypassPermissions')
    dispatchCommand(commands, 'โหมดวางแผน', 'th-TH')
    expect(setMode).toHaveBeenCalledWith('plan')
  })
})
