import { describe, it, expect } from 'vitest'
import { isDirectExe, quoteForCmd } from './spawnCli'

describe('isDirectExe', () => {
  it('treats a real .exe as directly executable', () => {
    expect(isDirectExe('C:/x/claude.exe')).toBe(true)
  })

  it('treats a .cmd/.bat shim as NOT directly executable (needs cmd.exe)', () => {
    // Only meaningful on win32; on POSIX everything is "direct" (no shim).
    if (process.platform === 'win32') {
      expect(isDirectExe('C:/x/claude.cmd')).toBe(false)
      expect(isDirectExe('C:/x/claude.bat')).toBe(false)
    } else {
      expect(isDirectExe('/usr/bin/claude')).toBe(true)
    }
  })
})

describe('quoteForCmd', () => {
  it('wraps the token in quotes so shell metacharacters are inert', () => {
    // Inside double quotes cmd.exe does not treat & as a command separator.
    expect(quoteForCmd('a&calc')).toBe('"a&calc"')
  })

  it('escapes an embedded double quote per CommandLineToArgvW', () => {
    expect(quoteForCmd('x"y')).toBe('"x\\"y"')
  })

  it('THROWS on a token containing % (cannot be escaped under verbatim args)', () => {
    expect(() => quoteForCmd('%PATH%')).toThrow()
  })

  it('doubles a trailing backslash so the closing quote is not escaped', () => {
    expect(quoteForCmd('C:/dir\\')).toBe('"C:/dir\\\\"')
  })
})
