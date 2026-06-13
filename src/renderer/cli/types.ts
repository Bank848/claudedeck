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
  usage?: {
    input_tokens?: number
    output_tokens?: number
    /** Cache tokens still occupy the context window — required for an accurate context %. */
    cache_read_input_tokens?: number
    cache_creation_input_tokens?: number
  }
}

/** Normalised token usage surfaced from a result event. */
export interface TurnUsage {
  input: number
  output: number
  cacheRead: number
  cacheCreation: number
}

/** Renderer mirror of electron/sessionStore.ts StoredSession — keep the two in sync. */
export interface StoredSession {
  id: string; claudeSessionId?: string; cwd: string; title: string; model: string
  tokens: number; contextTokens: number; updatedAt: string; createdAt: string; open: boolean
  /** Soft-delete: hidden from the main library, shown only in the Archive view. */
  archived?: boolean
  /** Pinned sessions float to the top of their project group. */
  pinned?: boolean
}

export type ClaudeEvent = SystemInitEvent | AssistantEvent | UserEvent | ResultEvent

/** Wire payloads from the main process (mirror electron/claude.ts). */
export interface ClaudeEventMsg { turnId: string; event: ClaudeEvent }
export interface ClaudeStderrMsg { turnId: string; text: string }
export interface ClaudeDoneMsg { turnId: string; code: number }

export type PermissionDecision = 'allow' | 'deny'

/** A mid-turn tool-permission request from the CLI (mirror permissionProtocol.ts). */
export interface PermissionRequestMsg {
  turnId: string
  id: string
  tool: string
  input: unknown
  toolUseId?: string
}

export type PermissionMode = 'plan' | 'acceptEdits' | 'bypassPermissions' | 'default' | 'auto' | 'dontAsk'

/** Reasoning effort levels accepted by `claude --effort` (mirror electron/claude.ts). */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'

/**
 * Persistent permission layer (mirror electron/permissions.ts PermissionSettings).
 * Serialized to a single `--settings` JSON token in the main process.
 */
export interface PermissionSettings {
  allow?: string[]
  deny?: string[]
  ask?: string[]
  defaultMode?: string
  additionalDirectories?: string[]
}

export interface ImageAttachment {
  mediaType: string
  /** Raw base64, no data-URI prefix. */
  data: string
}

/**
 * A message the user typed while a turn was already running. Queued in FIFO
 * order on the session; flushed one-at-a-time as its own turn when the session
 * returns to 'idle'. `modelId`/`effort`/`images` are captured at enqueue time so
 * the queued send reproduces the model/effort/images the user composed (model
 * routing is intentionally bypassed for queued sends — the choice was already
 * made). Permission mode is NOT captured; the flush uses the session's current
 * permission mode (latest-wins), which is the desired behavior.
 */
export interface QueuedMessage {
  id: string
  text: string
  modelId: string
  effort?: Effort
  images?: ImageAttachment[]
}

export interface StartTurnRequest {
  turnId: string
  prompt: string
  cwd: string
  sessionId?: string
  model?: string
  permissionMode: PermissionMode
  /** Optional reasoning effort. Omitted → the CLI picks its own default. */
  effort?: Effort
  /** Per-turn tool allow rules (e.g. `Bash(git *)`, `Edit`). Each is one argv token. */
  allowedTools?: string[]
  /** Per-turn tool deny rules. Each is one argv token. */
  disallowedTools?: string[]
  /** Extra directories granted to claude this turn (`--add-dir`). */
  additionalDirs?: string[]
  /** Persistent permission settings, sent via `--settings`. */
  settings?: PermissionSettings
  /** Which config layers to load (`--setting-sources`). */
  settingSources?: string
  /** Fork the resumed session into a new id (`--fork-session`) instead of appending. */
  forkSession?: boolean
  /** Images to send as content blocks alongside the prompt. */
  images?: ImageAttachment[]
}
