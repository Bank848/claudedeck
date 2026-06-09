import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadIndex, saveIndex, findTranscript } from './sessionStore'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'cds-')) })

describe('index round-trip', () => {
  it('save then load returns the same sessions', () => {
    const file = join(dir, 'sessions.json')
    const sessions = [{ id: 'a', claudeSessionId: 'uuid', cwd: 'D:/x', title: 'T', model: 'opus-4-8', tokens: 5, contextTokens: 5, updatedAt: 'now', createdAt: 'then', open: true }]
    saveIndex(sessions, file)
    expect(loadIndex(file)).toEqual(sessions)
  })
  it('missing file → []', () => { expect(loadIndex(join(dir, 'none.json'))).toEqual([]) })
  it('corrupt file → backed up + []', () => {
    const file = join(dir, 'sessions.json'); writeFileSync(file, '{bad', 'utf8')
    expect(loadIndex(file)).toEqual([])
    expect(existsSync(file + '.bak')).toBe(true)
  })
})

describe('findTranscript globs by uuid', () => {
  it('finds <uuid>.jsonl one level under projects root', () => {
    const projects = join(dir, 'projects'); mkdirSync(join(projects, 'D--x'), { recursive: true })
    const f = join(projects, 'D--x', 'abc-123.jsonl'); writeFileSync(f, '{"type":"user","message":{"role":"user","content":"hi"}}', 'utf8')
    expect(findTranscript(projects, 'abc-123')).toBe(f)
    expect(findTranscript(projects, 'missing')).toBeNull()
  })
})
