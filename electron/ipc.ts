import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'

/**
 * Send an IPC message to a window's renderer, skipping the send if the window
 * or its webContents is already destroyed. During app quit the BrowserWindow
 * can still exist while its webContents has been torn down, and calling
 * `webContents.send` on it throws "TypeError: Object has been destroyed" as an
 * uncaught exception in the main process. This guard makes every renderer-bound
 * send safe to fire from async callbacks (process exit handlers, health polls,
 * window events) without racing the shutdown sequence.
 */
export function safeSend(
  win: BrowserWindow | null | undefined,
  channel: string,
  ...args: unknown[]
): void {
  if (!win || win.isDestroyed()) return
  const wc = win.webContents
  if (wc && !wc.isDestroyed()) wc.send(channel, ...args)
}

/**
 * Register an `ipcMain.handle` that can NEVER reject and NEVER returns a value
 * that fails structured-clone. A throwing/rejecting handler makes the renderer's
 * `ipcRenderer.invoke` reject with "Error invoking remote method '…'", which —
 * if the caller forgot a `.catch` — surfaces as an unhandled rejection (the red
 * error overlay in dev). Wrapping every channel here means no single handler can
 * produce that toast: on failure we log to the main-process console and return a
 * caller-supplied fallback that matches the channel's existing success shape, so
 * preload typings (electron/preload.ts) stay correct.
 *
 * `ipc` is injected (not the module-level `ipcMain`) so the wrapper is unit-
 * testable without a live Electron main process.
 */
export function safeHandle<T>(
  ipc: Pick<IpcMain, 'handle'>,
  channel: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- mirrors Electron's own handle() arg typing
  handler: (event: IpcMainInvokeEvent, ...args: any[]) => T | Promise<T>,
  onError: (err: unknown) => T,
): void {
  ipc.handle(channel, async (event, ...args) => {
    try {
      return await handler(event, ...args)
    } catch (err) {
      // eslint-disable-next-line no-console -- main-process diagnostic; visible in the terminal / DevTools
      console.error(`[ipc] handler "${channel}" failed:`, err)
      return onError(err)
    }
  })
}

/** Normalize any thrown value to a message string for `{ ok:false, error }` returns. */
export function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
