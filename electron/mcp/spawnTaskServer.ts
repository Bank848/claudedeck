/**
 * Minimal stdio MCP server owned by ClaudeDeck. Registered to the inner `claude`
 * CLI as the `claudedeck` server, so its one tool gets the wire name
 * `mcp__claudedeck__spawn_task`. It is a SIGNAL CARRIER, not an executor: the
 * tool returns synthetic success so the model keeps working (non-blocking); the
 * real spawn happens in the renderer when the user clicks the chip built from the
 * tool_use block. Newline-delimited JSON-RPC 2.0 over stdin/stdout, dependency-free
 * (node builtins only) so it runs under `process.execPath` with ELECTRON_RUN_AS_NODE.
 */
import { createInterface } from 'node:readline'

const PROTOCOL_VERSION = '2024-11-05'

export const SPAWN_TASK_TOOL_DEF = {
  name: 'spawn_task',
  description:
    'Suggest spinning off out-of-scope follow-up work into a NEW ClaudeDeck session. ' +
    'Renders a chip the user can accept or dismiss; it does not run anything itself.',
  inputSchema: {
    type: 'object',
    properties: {
      title: { type: 'string', description: 'Short imperative title, e.g. "Fix stale README badge".' },
      prompt: {
        type: 'string',
        description:
          'Self-contained instructions for the new session (it has NO memory of this chat — ' +
          'include file paths and enough detail to act cold).',
      },
      tldr: { type: 'string', description: 'One-line plain-English summary shown on the chip.' },
      cwd: { type: 'string', description: 'Optional working dir; defaults to the current session folder.' },
    },
    required: ['title', 'prompt', 'tldr'],
  },
} as const

export interface ToolCallResult {
  content: Array<{ type: 'text'; text: string }>
  isError?: boolean
}

/** Build the synthetic success payload. `now` is injectable for deterministic tests. */
export function buildSpawnTaskCallResult(
  args: { title?: string; prompt?: string; tldr?: string; cwd?: string },
  now: number = Date.now(),
): ToolCallResult {
  const title = typeof args?.title === 'string' && args.title.trim() ? args.title.trim() : 'task'
  const taskId = `task_${now.toString(36)}`
  return {
    content: [
      {
        type: 'text',
        text: `Recorded suggestion "${title}" (${taskId}). The user will see a chip to spawn it into a new session.`,
      },
    ],
  }
}

interface JsonRpcMessage {
  jsonrpc?: string
  id?: number | string
  method?: string
  params?: { name?: string; arguments?: Record<string, unknown>; [k: string]: unknown }
}

/**
 * Handle one JSON-RPC message. Returns the response object to write back, or
 * `null` for notifications (no `id`) and anything we intentionally drop.
 */
export function dispatch(msg: JsonRpcMessage): object | null {
  const { id, method } = msg
  // Notifications carry no id and expect no response.
  if (id === undefined || id === null) return null

  switch (method) {
    case 'initialize':
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {} },
          serverInfo: { name: 'claudedeck', version: '1.0.0' },
        },
      }
    case 'tools/list':
      return { jsonrpc: '2.0', id, result: { tools: [SPAWN_TASK_TOOL_DEF] } }
    case 'tools/call': {
      if (msg.params?.name === 'spawn_task') {
        return { jsonrpc: '2.0', id, result: buildSpawnTaskCallResult(msg.params.arguments ?? {}) }
      }
      return { jsonrpc: '2.0', id, error: { code: -32602, message: `Unknown tool: ${msg.params?.name}` } }
    }
    default:
      return { jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } }
  }
}

/** Run the stdio loop. Only invoked when this file is the process entry. */
function runServer(): void {
  const rl = createInterface({ input: process.stdin })
  rl.on('line', (line) => {
    const trimmed = line.trim()
    if (!trimmed) return
    let msg: JsonRpcMessage
    try {
      msg = JSON.parse(trimmed) as JsonRpcMessage
    } catch {
      return // ignore malformed lines
    }
    const res = dispatch(msg)
    if (res) process.stdout.write(JSON.stringify(res) + '\n')
  })
}

// Run only when launched directly (claude spawns this as the MCP server entry).
// When imported by the test runner, `require.main !== module`, so the loop stays off.
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) {
  runServer()
}
