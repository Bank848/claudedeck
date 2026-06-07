import { describe, it, expect, vi } from 'vitest'
import { dispatchCommand, type VoiceCommand } from './voiceCommands'

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
