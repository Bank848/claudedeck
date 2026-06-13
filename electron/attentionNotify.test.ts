import { describe, it, expect } from 'vitest'
import { notificationContent } from './attentionNotify'

describe('notificationContent', () => {
  it('needsInput → waiting-for-answer, with session name', () => {
    const c = notificationContent('needsInput', 'API limiter')
    expect(c.title).toContain('🟠')
    expect(c.body).toContain('API limiter')
  })
  it('done → finished, with session name', () => {
    const c = notificationContent('done', 'Dark mode')
    expect(c.title).toContain('🟢')
    expect(c.body).toContain('Dark mode')
  })
})
