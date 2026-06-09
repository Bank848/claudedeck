/**
 * The subset of `claude --output-format stream-json` events ClaudeDeck consumes
 * in Slice A (message-level; token-level partial deltas are Slice C). Shapes
 * verified against `claude --help` (2026-06-08) and a captured event log; see
 * src/renderer/cli/__fixtures__/.
 */

export interface SystemInitEvent {
  type: 'system'
  subtype: 'init'
  session_id: string
  model?: string
  cwd?: string
  tools?: string[]
}

export interface TextBlock {
  type: 'text'
  text: string
}
export interface ThinkingBlock {
  type: 'thinking'
  thinking: string
}
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input?: unknown
}
export type ContentBlock = TextBlock | ThinkingBlock | ToolUseBlock

export interface AssistantEvent {
  type: 'assistant'
  session_id?: string
  message: {
    id?: string
    role: 'assistant'
    content: ContentBlock[]
  }
}

export type ToolResultContent =
  | string
  | Array<{ type: 'text'; text: string } | { type: string; [k: string]: unknown }>

export interface ToolResultBlock {
  type: 'tool_result'
  tool_use_id: string
  content: ToolResultContent
  is_error?: boolean
}

export interface UserEvent {
  type: 'user'
  session_id?: string
  message: {
    role: 'user'
    content: ToolResultBlock[]
  }
}

export interface ResultEvent {
  type: 'result'
  subtype?: string
  session_id?: string
  is_error?: boolean
  result?: string
  total_cost_usd?: number
  usage?: { input_tokens?: number; output_tokens?: number }
}

export type ClaudeEvent = SystemInitEvent | AssistantEvent | UserEvent | ResultEvent

/** Wire payloads from the main process (mirror electron/claude.ts). */
export interface ClaudeEventMsg { turnId: string; event: ClaudeEvent }
export interface ClaudeStderrMsg { turnId: string; text: string }
export interface ClaudeDoneMsg { turnId: string; code: number }

export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default'

/** Reasoning effort levels accepted by `claude --effort` (mirror electron/claude.ts). */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

export interface StartTurnRequest {
  turnId: string
  prompt: string
  cwd: string
  sessionId?: string
  model?: string
  permissionMode: PermissionMode
  /** Optional reasoning effort. Omitted → the CLI picks its own default. */
  effort?: Effort
}
