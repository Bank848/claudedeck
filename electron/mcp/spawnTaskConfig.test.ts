import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { writeSpawnTaskMcpConfig } from './spawnTaskConfig'

let dir: string
let serverSrc: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'cdk-mcp-'))
  serverSrc = join(dir, 'spawnTaskServer.js')
  writeFileSync(serverSrc, '// server', 'utf8')
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('writeSpawnTaskMcpConfig', () => {
  it('copies the server and writes a config pointing the claudedeck server at execPath', () => {
    const cfgPath = writeSpawnTaskMcpConfig(dir, serverSrc, 'C:/electron.exe')
    expect(cfgPath).toBeTruthy()
    expect(existsSync(join(dir, 'mcp', 'spawnTaskServer.js'))).toBe(true)
    const cfg = JSON.parse(readFileSync(cfgPath!, 'utf8'))
    const srv = cfg.mcpServers.claudedeck
    expect(srv.command).toBe('C:/electron.exe')
    expect(srv.args[0]).toBe(join(dir, 'mcp', 'spawnTaskServer.js'))
    expect(srv.env.ELECTRON_RUN_AS_NODE).toBe('1')
  })

  it('returns undefined (non-fatal) when the server source is missing', () => {
    expect(writeSpawnTaskMcpConfig(dir, join(dir, 'nope.js'), 'C:/electron.exe')).toBeUndefined()
  })
})
