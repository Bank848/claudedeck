/**
 * Write the spawn-task MCP config under userData and copy the built server next to
 * it (real disk, never inside asar). Returns the config-file path, or `undefined`
 * on any failure — injection is best-effort and must NEVER break a turn (the chip
 * still renders from the tool_use block even with no working server).
 *
 * The config launches the server via the Electron binary with
 * ELECTRON_RUN_AS_NODE=1, so no system `node` is required.
 */
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export function writeSpawnTaskMcpConfig(
  userDataDir: string,
  serverSrcPath: string,
  execPath: string,
): string | undefined {
  try {
    if (!existsSync(serverSrcPath)) return undefined
    const mcpDir = join(userDataDir, 'mcp')
    mkdirSync(mcpDir, { recursive: true })

    const serverDest = join(mcpDir, 'spawnTaskServer.js')
    copyFileSync(serverSrcPath, serverDest)

    const config = {
      mcpServers: {
        claudedeck: {
          command: execPath,
          args: [serverDest],
          env: { ELECTRON_RUN_AS_NODE: '1' },
        },
      },
    }
    const cfgPath = join(mcpDir, 'claudedeck-mcp.json')
    writeFileSync(cfgPath, JSON.stringify(config, null, 2), 'utf8')
    return cfgPath
  } catch {
    return undefined // non-fatal
  }
}
