import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import type { IpcMain, IpcMainInvokeEvent } from 'electron'
import { safeHandle, errMsg } from './ipc'

/**
 * A minimal stand-in for ipcMain: captures the registered listener so the test
 * can invoke it exactly as Electron would (event + args), then inspect what the
 * renderer would receive back.
 */
function fakeIpc(): {
  ipc: Pick<IpcMain, 'handle'>
  invoke: (...args: unknown[]) => Promise<unknown>
} {
  let registered: ((event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) | null = null
  const ipc = {
    handle: (_channel: string, listener: (event: IpcMainInvokeEvent, ...a: unknown[]) => unknown) => {
      registered = listener
    },
  } as unknown as Pick<IpcMain, 'handle'>
  const invoke = (...args: unknown[]): Promise<unknown> => {
    if (!registered) throw new Error('no handler registered')
    return Promise.resolve(registered({} as IpcMainInvokeEvent, ...args))
  }
  return { ipc, invoke }
}

describe('errMsg', () => {
  it('returns the message for Error instances', () => {
    expect(errMsg(new Error('boom'))).toBe('boom')
  })
  it('stringifies non-Error values', () => {
    expect(errMsg('plain')).toBe('plain')
    expect(errMsg(42)).toBe('42')
    expect(errMsg(null)).toBe('null')
  })
})

describe('safeHandle', () => {
  beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
  afterEach(() => vi.restoreAllMocks())

  it('passes through the success value (sync handler)', async () => {
    const { ipc, invoke } = fakeIpc()
    safeHandle(ipc, 'c', () => ({ ok: true, n: 1 }), () => ({ ok: false }))
    expect(await invoke()).toEqual({ ok: true, n: 1 })
  })

  it('passes through the success value (async handler) and forwards args', async () => {
    const { ipc, invoke } = fakeIpc()
    safeHandle(ipc, 'c', async (_e, a: number, b: number) => a + b, () => -1)
    expect(await invoke(2, 3)).toBe(5)
  })

  it('returns the fallback instead of rejecting when the handler throws', async () => {
    const { ipc, invoke } = fakeIpc()
    safeHandle(ipc, 'c', () => { throw new Error('sync boom') }, (e) => ({ ok: false, error: errMsg(e) }))
    // The promise resolves (never rejects) with the normalized fallback.
    await expect(invoke()).resolves.toEqual({ ok: false, error: 'sync boom' })
  })

  it('returns the fallback when an async handler rejects', async () => {
    const { ipc, invoke } = fakeIpc()
    safeHandle(ipc, 'c', async () => { throw new Error('async boom') }, () => ({ ok: false }))
    await expect(invoke()).resolves.toEqual({ ok: false })
  })

  it('logs the failure to the main-process console', async () => {
    const { ipc, invoke } = fakeIpc()
    const spy = vi.spyOn(console, 'error')
    safeHandle(ipc, 'mychannel', () => { throw new Error('x') }, () => null)
    await invoke()
    expect(spy).toHaveBeenCalledWith(expect.stringContaining('mychannel'), expect.anything())
  })
})
