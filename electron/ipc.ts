import type { BrowserWindow } from 'electron'

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
