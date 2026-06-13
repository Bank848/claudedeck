/**
 * SHARED DATA CONTRACT for ClaudeDeck Phase 1 (mock/design-first).
 *
 * Every view consumes these types and sample instances. Field names are fixed —
 * view components must NOT invent or rename fields. If a view needs a new field,
 * it is added here first.
 */

/* ─────────────────────────── Activity / navigation ─────────────────────────── */

export type ActivityId =
  | 'chat'
  | 'sessions'
  | 'tasks'
  | 'changes'
  | 'skills'
  | 'usage'
  | 'guide'
  | 'settings'

/* ──────────────────────────── Providers / models ───────────────────────────── */

export type Provider = 'claude'

export interface ModelOption {
  id: string
  provider: Provider
  label: string
  /** Short note shown under the label in the picker. */
  sublabel?: string
}

export const MODELS: ModelOption[] = [
  { id: 'fable-5', provider: 'claude', label: 'Claude Fable 5', sublabel: 'Hardest / high-stakes' },
  { id: 'opus-4-8', provider: 'claude', label: 'Claude Opus 4.8', sublabel: 'Deepest reasoning' },
  { id: 'sonnet-4-6', provider: 'claude', label: 'Claude Sonnet 4.6', sublabel: 'Best all-round' },
  { id: 'haiku-4-5', provider: 'claude', label: 'Claude Haiku 4.5', sublabel: 'Fast & cheap' },
]

/* ─────────────────────────────── Chat messages ─────────────────────────────── */

export type MessageRole = 'user' | 'assistant'

export type ToolStatus = 'running' | 'done' | 'error'

export interface ToolCall {
  id: string
  /** Tool name, e.g. "Read", "Edit", "Bash", "Grep". */
  tool: string
  /** Short human label, e.g. "src/app.ts" or "npm test". */
  label: string
  status: ToolStatus
  /** Optional preview body (command output, file snippet). Monospace. */
  output?: string
  /** Optional duration label, e.g. "1.2s". */
  durationMs?: number
  /** Raw tool input from the stream-json tool_use block (used to derive todos/diffs). */
  input?: unknown
}

export interface CodeBlockContent {
  language: string
  /** Optional filename shown in the code block header. */
  filename?: string
  code: string
}

/**
 * A message is composed of ordered parts so the chat can interleave prose,
 * code blocks, tool-call cards and a thinking block like the real Claude app.
 */
export type MessagePart =
  | { kind: 'markdown'; text: string }
  | { kind: 'code'; content: CodeBlockContent }
  | { kind: 'tool'; call: ToolCall }
  | { kind: 'thinking'; text: string }

export interface ChatMessage {
  id: string
  role: MessageRole
  /** ISO timestamp string. */
  createdAt: string
  parts: MessagePart[]
  /** When true, the assistant message renders the streaming caret/animation. */
  streaming?: boolean
  /** Picker id of the model this turn actually ran on (per-turn routing badge). */
  model?: string
}

/* ───────────────────────────────── Sessions ────────────────────────────────── */

export type SessionStatus = 'active' | 'idle' | 'running' | 'error'

export interface Session {
  id: string
  title: string
  /** Project / working directory shown in the tab + sidebar. */
  cwd: string
  status: SessionStatus
  model: string
  /** ISO timestamp of last activity. */
  updatedAt: string
  /** Cumulative token count for the session. */
  tokens: number
  messages: ChatMessage[]
  /** Live terminal/event log for this session (empty until a live turn runs). */
  terminalLines: TerminalLine[]
  /** claude CLI session id captured from the init event, used for --resume. */
  claudeSessionId?: string
  /** Current context-window occupancy in tokens (input + cache). */
  contextTokens?: number
  /** ISO creation time (for the session list). */
  createdAt?: string
  /** Whether this session is an open tab (restored on boot). */
  open?: boolean
  /** Soft-delete: hidden from the main library, shown only in the Archive view. */
  archived?: boolean
  /** Pinned sessions float to the top of their project group. */
  pinned?: boolean
  /**
   * Transient: set on a forked session so its FIRST turn passes `--fork-session`,
   * making the CLI copy the parent's transcript into a new id instead of appending
   * to it. Cleared after that turn starts. Never persisted.
   */
  forkPending?: boolean
  /**
   * FIFO queue of messages the user typed while a turn was running. Flushed
   * one-at-a-time (each as its own turn) when this session goes back to 'idle'.
   * Transient UI state — not persisted via StoredSession.
   */
  queued?: import('@/cli/types').QueuedMessage[]
}

/* ───────────────────────────────── Todos ───────────────────────────────────── */

export type TodoStatus = 'pending' | 'in_progress' | 'completed'

export interface Todo {
  id: string
  title: string
  status: TodoStatus
  /** Optional active-form label shown while in_progress. */
  activeForm?: string
}

/* ─────────────────────────────── Kanban board ──────────────────────────────── */

export type KanbanColumnId = 'backlog' | 'in_progress' | 'review' | 'done'

export interface KanbanCard {
  id: string
  title: string
  column: KanbanColumnId
  /** Optional session this card belongs to. */
  sessionId?: string
  /** Short tag chips, e.g. ["chat", "ui"]. */
  tags: string[]
  /** Priority for subtle accent treatment. */
  priority: 'low' | 'medium' | 'high'
}

export interface KanbanColumn {
  id: KanbanColumnId
  title: string
}

/* ─────────────────────────────── File diffs ────────────────────────────────── */

export type DiffLineKind = 'add' | 'remove' | 'context' | 'hunk'

export interface DiffLine {
  kind: DiffLineKind
  /** Old-file line number (blank for adds / hunk headers). */
  oldNo?: number
  /** New-file line number (blank for removes / hunk headers). */
  newNo?: number
  text: string
}

export type FileChangeStatus = 'added' | 'modified' | 'deleted' | 'renamed'

export interface FileChange {
  id: string
  path: string
  status: FileChangeStatus
  additions: number
  deletions: number
  lines: DiffLine[]
}

/* ───────────────────────────────── Skills ──────────────────────────────────── */

export interface Skill {
  id: string
  name: string
  /** Marketplace / plugin namespace, e.g. "superpowers" or "core". */
  namespace: string
  description: string
  /** Category for grouping/filtering. */
  category: string
  /** Slash trigger, e.g. "/brainstorm". */
  trigger?: string
}

/* ───────────────────────────────── Terminal ────────────────────────────────── */

export type TerminalLineKind = 'stdout' | 'stderr' | 'command' | 'system'

export interface TerminalLine {
  id: string
  kind: TerminalLineKind
  text: string
}

/* ───────────────────────────────── Status bar ──────────────────────────────── */

export interface StatusInfo {
  model: string
  tokens: number
  cwd: string
  connected: boolean
  branch?: string
}

/* ════════════════════════════════ SAMPLE DATA ═══════════════════════════════ */

export const KANBAN_COLUMNS: KanbanColumn[] = [
  { id: 'backlog', title: 'Backlog' },
  { id: 'in_progress', title: 'In Progress' },
  { id: 'review', title: 'Review' },
  { id: 'done', title: 'Done' },
]

const chatMessages: ChatMessage[] = [
  {
    id: 'm1',
    role: 'user',
    createdAt: '2026-06-06T09:12:00Z',
    parts: [
      {
        kind: 'markdown',
        text: 'Add a dark-mode toggle to the settings page and persist the choice. Run the tests when you are done.',
      },
    ],
  },
  {
    id: 'm2',
    role: 'assistant',
    createdAt: '2026-06-06T09:12:04Z',
    parts: [
      {
        kind: 'thinking',
        text: 'The settings page lives in src/pages/Settings.tsx. There is already a ThemeContext — I should reuse its setter instead of adding new state.',
      },
      {
        kind: 'markdown',
        text: "I'll reuse the existing `ThemeContext` and persist to `localStorage`. Here's the plan:\n\n1. Read the current settings page\n2. Add a `Toggle` bound to the theme context\n3. Persist on change\n4. Run the test suite",
      },
      {
        kind: 'tool',
        call: {
          id: 't1',
          tool: 'Read',
          label: 'src/pages/Settings.tsx',
          status: 'done',
          durationMs: 220,
          output:
            'export function Settings() {\n  return (\n    <section>\n      <h1>Settings</h1>\n    </section>\n  )\n}',
        },
      },
      {
        kind: 'markdown',
        text: 'Now wiring the toggle to the theme context:',
      },
      {
        kind: 'code',
        content: {
          language: 'tsx',
          filename: 'src/pages/Settings.tsx',
          code: `import { useTheme } from '@/theme/ThemeContext'
import { Toggle } from '@/components/Toggle'

export function Settings() {
  const { theme, setTheme } = useTheme()
  return (
    <section className="space-y-4">
      <h1>Settings</h1>
      <label className="flex items-center gap-3">
        <span>Dark mode</span>
        <Toggle
          checked={theme === 'dark'}
          onChange={(on) => setTheme(on ? 'dark' : 'light')}
        />
      </label>
    </section>
  )
}`,
        },
      },
      {
        kind: 'tool',
        call: {
          id: 't2',
          tool: 'Bash',
          label: 'npm test',
          status: 'done',
          durationMs: 4300,
          output: 'PASS  src/pages/Settings.test.tsx\n\nTests: 12 passed, 12 total\nTime:  3.9 s',
        },
      },
      {
        kind: 'markdown',
        text: 'Done — the toggle is wired to `ThemeContext`, persisted to `localStorage`, and **all 12 tests pass**.',
      },
    ],
  },
  {
    id: 'm3',
    role: 'user',
    createdAt: '2026-06-06T09:14:10Z',
    parts: [{ kind: 'markdown', text: 'Nice. Now refactor the toggle into a reusable component.' }],
  },
  {
    id: 'm4',
    role: 'assistant',
    createdAt: '2026-06-06T09:14:12Z',
    streaming: true,
    parts: [
      {
        kind: 'tool',
        call: { id: 't3', tool: 'Grep', label: '"Toggle" across src/', status: 'running' },
      },
      {
        kind: 'markdown',
        text: 'Scanning for existing toggle usages so the extracted component keeps the same API',
      },
    ],
  },
]

export const TERMINAL_LINES: TerminalLine[] = [
  { id: 'tl1', kind: 'command', text: 'claude --resume s1' },
  { id: 'tl2', kind: 'system', text: 'Resuming session "Dark-mode settings" (Opus 4.8)' },
  { id: 'tl3', kind: 'stdout', text: '● Read(src/pages/Settings.tsx)' },
  { id: 'tl4', kind: 'stdout', text: '  ⎿  Read 6 lines' },
  { id: 'tl5', kind: 'stdout', text: '● Edit(src/pages/Settings.tsx)' },
  { id: 'tl6', kind: 'stdout', text: '  ⎿  Updated with 14 additions and 2 removals' },
  { id: 'tl7', kind: 'stdout', text: '● Bash(npm test)' },
  { id: 'tl8', kind: 'stdout', text: '  ⎿  Tests: 12 passed, 12 total' },
  { id: 'tl9', kind: 'stderr', text: 'warning: 1 deprecation notice in test runner' },
  { id: 'tl10', kind: 'system', text: 'Grep("Toggle") running…' },
]

export const SESSIONS: Session[] = [
  {
    id: 's1',
    title: 'Dark-mode settings',
    cwd: 'D:/projects/web-app',
    status: 'running',
    model: 'Opus 4.8',
    updatedAt: '2026-06-06T09:14:12Z',
    tokens: 48210,
    messages: chatMessages,
    terminalLines: TERMINAL_LINES,
  },
  {
    id: 's2',
    title: 'API rate limiter',
    cwd: 'D:/projects/api-gateway',
    status: 'idle',
    model: 'Sonnet 4.6',
    updatedAt: '2026-06-06T08:40:00Z',
    tokens: 21940,
    messages: [
      {
        id: 'm1',
        role: 'user',
        createdAt: '2026-06-06T08:40:00Z',
        parts: [{ kind: 'markdown', text: 'Add a token-bucket rate limiter to the gateway.' }],
      },
    ],
    terminalLines: [],
  },
  {
    id: 's3',
    title: 'Flaky test triage',
    cwd: 'D:/projects/web-app',
    status: 'error',
    model: 'Opus 4.8',
    updatedAt: '2026-06-05T22:05:00Z',
    tokens: 9120,
    messages: [],
    terminalLines: [],
  },
]

export const TODOS: Todo[] = [
  { id: 'todo1', title: 'Read settings page', status: 'completed' },
  { id: 'todo2', title: 'Add toggle bound to ThemeContext', status: 'completed' },
  {
    id: 'todo3',
    title: 'Extract reusable Toggle component',
    status: 'in_progress',
    activeForm: 'Extracting reusable Toggle component',
  },
  { id: 'todo4', title: 'Update Storybook story', status: 'pending' },
  { id: 'todo5', title: 'Run full test suite', status: 'pending' },
]

export const KANBAN_CARDS: KanbanCard[] = [
  {
    id: 'k1',
    title: 'Extract reusable Toggle component',
    column: 'in_progress',
    sessionId: 's1',
    tags: ['ui', 'refactor'],
    priority: 'medium',
  },
  {
    id: 'k2',
    title: 'Token-bucket rate limiter',
    column: 'in_progress',
    sessionId: 's2',
    tags: ['api'],
    priority: 'high',
  },
  { id: 'k3', title: 'Update Storybook story', column: 'backlog', sessionId: 's1', tags: ['ui', 'docs'], priority: 'low' },
  { id: 'k4', title: 'Investigate flaky auth test', column: 'review', sessionId: 's3', tags: ['tests'], priority: 'high' },
  { id: 'k5', title: 'Dark-mode toggle wiring', column: 'done', sessionId: 's1', tags: ['ui'], priority: 'medium' },
  { id: 'k6', title: 'ThemeContext persistence', column: 'done', sessionId: 's1', tags: ['ui'], priority: 'low' },
]

export const FILE_CHANGES: FileChange[] = [
  {
    id: 'f1',
    path: 'src/pages/Settings.tsx',
    status: 'modified',
    additions: 14,
    deletions: 2,
    lines: [
      { kind: 'hunk', text: '@@ -1,5 +1,17 @@' },
      { kind: 'remove', oldNo: 1, text: 'export function Settings() {' },
      { kind: 'add', newNo: 1, text: "import { useTheme } from '@/theme/ThemeContext'" },
      { kind: 'add', newNo: 2, text: "import { Toggle } from '@/components/Toggle'" },
      { kind: 'add', newNo: 3, text: '' },
      { kind: 'add', newNo: 4, text: 'export function Settings() {' },
      { kind: 'add', newNo: 5, text: '  const { theme, setTheme } = useTheme()' },
      { kind: 'context', oldNo: 2, newNo: 6, text: '  return (' },
      { kind: 'context', oldNo: 3, newNo: 7, text: '    <section>' },
      { kind: 'add', newNo: 8, text: '      <Toggle checked={theme === "dark"} />' },
      { kind: 'context', oldNo: 4, newNo: 9, text: '    </section>' },
      { kind: 'context', oldNo: 5, newNo: 10, text: '  )' },
    ],
  },
  {
    id: 'f2',
    path: 'src/components/Toggle.tsx',
    status: 'added',
    additions: 22,
    deletions: 0,
    lines: [
      { kind: 'hunk', text: '@@ -0,0 +1,8 @@' },
      { kind: 'add', newNo: 1, text: 'interface ToggleProps {' },
      { kind: 'add', newNo: 2, text: '  checked: boolean' },
      { kind: 'add', newNo: 3, text: '  onChange?: (on: boolean) => void' },
      { kind: 'add', newNo: 4, text: '}' },
    ],
  },
  {
    id: 'f3',
    path: 'src/theme/legacy-theme.css',
    status: 'deleted',
    additions: 0,
    deletions: 31,
    lines: [
      { kind: 'hunk', text: '@@ -1,3 +0,0 @@' },
      { kind: 'remove', oldNo: 1, text: '.theme-light { background: #fff; }' },
      { kind: 'remove', oldNo: 2, text: '.theme-dark { background: #000; }' },
    ],
  },
]

export const SKILLS: Skill[] = [
  {
    id: 'sk1',
    name: 'brainstorming',
    namespace: 'superpowers',
    description: 'Explore intent and requirements before any creative or build work.',
    category: 'Process',
    trigger: '/brainstorm',
  },
  {
    id: 'sk2',
    name: 'systematic-debugging',
    namespace: 'superpowers',
    description: 'Reproduce, trace, and falsify before proposing a fix.',
    category: 'Process',
    trigger: '/debug',
  },
  {
    id: 'sk3',
    name: 'test-driven-development',
    namespace: 'superpowers',
    description: 'Write the failing test first, then the minimal implementation.',
    category: 'Testing',
  },
  {
    id: 'sk4',
    name: 'code-review',
    namespace: 'ecc',
    description: 'Review the current diff for correctness bugs and cleanups.',
    category: 'Review',
    trigger: '/code-review',
  },
  {
    id: 'sk5',
    name: 'ui-ux-pro-max',
    namespace: 'core',
    description: 'Design intelligence: styles, palettes, font pairings, UX rules.',
    category: 'Design',
  },
  {
    id: 'sk6',
    name: 'deep-research',
    namespace: 'core',
    description: 'Fan-out web research, verify claims, synthesize a cited report.',
    category: 'Research',
    trigger: '/deep-research',
  },
  {
    id: 'sk7',
    name: 'graphify',
    namespace: 'core',
    description: 'Turn any input into a clustered knowledge graph.',
    category: 'Knowledge',
    trigger: '/graphify',
  },
  {
    id: 'sk8',
    name: 'docx',
    namespace: 'anthropic',
    description: 'Create, read, and edit Word documents with rich formatting.',
    category: 'Documents',
  },
]

export const STATUS: StatusInfo = {
  model: 'Opus 4.8',
  tokens: 48210,
  cwd: 'D:/projects/web-app',
  connected: true,
  branch: 'feat/dark-mode',
}

/* ───────────────────────────────── Usage ───────────────────────────────────── */

/** A rolling usage limit window (e.g. the 5-hour or weekly cap). */
export interface UsageWindow {
  id: string
  label: string
  used: number
  limit: number
  /** Human label for time until the window resets, e.g. "2h 14m". */
  resetsIn: string
}

export interface UsageModelItem {
  label: string
  tokens: number
}

/** Usage grouped under one provider, each with its own limits. */
export interface ProviderUsage {
  provider: Provider
  label: string
  total: number
  windows: UsageWindow[]
  models: UsageModelItem[]
}

export interface UsageStats {
  /** Tokens used so far today (all providers). */
  today: number
  providers: ProviderUsage[]
}

export const USAGE: UsageStats = {
  today: 312_540,
  providers: [
    {
      provider: 'claude',
      label: 'Claude',
      total: 3_710_000,
      windows: [
        { id: 'claude-5h', label: '5-hour limit', used: 86_400, limit: 220_000, resetsIn: '2h 14m' },
        { id: 'claude-week', label: 'Weekly limit', used: 3_710_000, limit: 8_000_000, resetsIn: '4d 6h' },
      ],
      models: [
        { label: 'Claude Opus 4.8', tokens: 2_640_000 },
        { label: 'Claude Sonnet 4.6', tokens: 980_000 },
        { label: 'Claude Haiku 4.5', tokens: 90_000 },
      ],
    },
  ],
}

/** Convenience: the session shown by default. */
export const ACTIVE_SESSION_ID = 's1'
