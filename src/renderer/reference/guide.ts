/**
 * Curated, hand-maintained reference for the in-app Guide page.
 * Explicitly NOT auto-updated — corrections live in this one file.
 */

export interface GuideEntry {
  /** The command, flag, or shortcut (rendered mono/accent). */
  command: string
  /** Plain-language description of what it does. */
  desc: string
  /** Optional usage example (rendered mono/muted). */
  example?: string
}

export interface GuideSection {
  /** Stable anchor id (used for the jump-nav). */
  id: string
  /** Section heading. */
  title: string
  entries: GuideEntry[]
}

export const GUIDE: GuideSection[] = [
  {
    id: 'cli',
    title: 'Claude CLI commands',
    entries: [
      { command: 'claude', desc: 'Start an interactive session in the current folder.' },
      { command: 'claude "prompt"', desc: 'Start a session with an initial prompt.', example: 'claude "fix the failing test"' },
      { command: 'claude -p, --print "prompt"', desc: 'Print mode: run once, print the result, and exit (non-interactive / scripting).', example: 'claude -p "summarize README.md"' },
      { command: 'claude -c, --continue', desc: 'Continue the most recent conversation in this folder.' },
      { command: 'claude -r, --resume <id>', desc: 'Resume a specific past session by id.', example: 'claude -r 1a2b3c' },
      { command: 'claude config', desc: 'Read or change configuration. Subcommands: get, set, list.', example: 'claude config set -g theme dark' },
      { command: 'claude mcp', desc: 'Manage MCP servers. Subcommands: add, list, remove.', example: 'claude mcp add my-server -- node server.js' },
      { command: 'claude update', desc: 'Update the CLI to the latest version.' },
      { command: 'claude doctor', desc: 'Diagnose installation and configuration problems.' },
      { command: '--version', desc: 'Print the installed CLI version.' },
      { command: '--model <name>', desc: 'Pick the model for this run.', example: 'claude --model opus' },
      { command: '--permission-mode <mode>', desc: 'Set the permission mode: default, acceptEdits, plan, bypassPermissions, auto, or dontAsk.', example: 'claude --permission-mode plan' },
      { command: '--add-dir <path>', desc: 'Give Claude access to an extra directory beyond the working folder.' },
      { command: '--output-format <fmt>', desc: 'Output format: text, json, or stream-json (ClaudeDeck uses stream-json under the hood).' },
      { command: '--allowedTools <rules...>', desc: 'Pre-allow specific tools without prompting. Each rule is a separate pattern token.', example: '--allowedTools "Bash(git *)" Edit' },
      { command: '--disallowedTools <rules...>', desc: 'Block specific tools outright. Each rule is a separate pattern token.', example: '--disallowedTools WebFetch' },
      { command: '--settings <json|file>', desc: 'Apply a settings object (permissions allow/deny/ask, defaultMode, additionalDirectories). ClaudeDeck passes a JSON string directly.' },
      { command: '--dangerously-skip-permissions', desc: 'Skip all permission prompts. Use with care — only in trusted, sandboxed contexts.' },
      { command: '--verbose', desc: 'Show detailed turn-by-turn output (events, tool calls).' },
    ],
  },
  {
    id: 'auth',
    title: 'Login / Auth',
    entries: [
      { command: 'Subscription login (Pro / Max)', desc: 'Sign in with your Claude.ai account via browser OAuth — the usual choice, no API key needed.' },
      { command: 'Anthropic Console API key', desc: 'Pay-as-you-go alternative: authenticate with a Console API key instead of a subscription.' },
      { command: 'First-run login', desc: 'On first launch the CLI opens a browser to authenticate; do it once and it remembers you.' },
      { command: '/login', desc: 'Switch account or re-authenticate from inside a session.' },
      { command: '/logout', desc: 'Sign out the current account.' },
      { command: 'claude setup-token', desc: 'Create a long-lived token for non-interactive / CI use.' },
      { command: 'ANTHROPIC_API_KEY', desc: 'Environment variable holding a Console API key; when set, the CLI uses it for auth.', example: 'set ANTHROPIC_API_KEY=sk-ant-...' },
      { command: 'ClaudeDeck live mode', desc: 'Live mode runs the real CLI, so you must already be logged in: run `claude login` (CLI OAuth, not username/password) in a terminal first. An in-app login screen is a future feature.' },
    ],
  },
  {
    id: 'slash',
    title: 'Slash commands (in a session)',
    entries: [
      { command: '/help', desc: 'List available commands and basic usage.' },
      { command: '/clear', desc: 'Clear the conversation and free up context.' },
      { command: '/compact', desc: 'Summarize the conversation so far to reclaim context while keeping the gist.' },
      { command: '/model', desc: 'Switch the active model mid-session.' },
      { command: '/config', desc: 'Open configuration / settings.' },
      { command: '/mcp', desc: 'View and manage connected MCP servers.' },
      { command: '/memory', desc: 'Edit project / user memory (CLAUDE.md and friends).' },
      { command: '/cost', desc: 'Show token usage and cost for the session.' },
      { command: '/doctor', desc: 'Run diagnostics from inside the session.' },
      { command: '/init', desc: 'Generate a CLAUDE.md for the current project.' },
      { command: '/review', desc: 'Request a code review of the current changes.' },
      { command: '/resume', desc: 'Pick a past session to resume.' },
      { command: '/agents', desc: 'Browse and manage subagents.' },
      { command: '/permissions', desc: 'View or change tool permissions.' },
      { command: '/status', desc: 'Show account, model, and connection status.' },
      { command: '/vim', desc: 'Toggle vim key-bindings in the input.' },
      { command: 'Exit', desc: 'Leave the session.', example: 'Ctrl+C twice (or /exit)' },
    ],
  },
  {
    id: 'deck',
    title: 'ClaudeDeck shortcuts',
    entries: [
      { command: 'Ctrl+Shift+V', desc: 'Toggle the hands-free voice assistant on / off.' },
      { command: 'Hold Ctrl+Shift+Space', desc: 'Push-to-talk (local Whisper engine): hold to speak, release to send.' },
      { command: 'Esc', desc: 'Stop the current read-aloud / speech.' },
      { command: 'Enter', desc: 'Send the message.' },
      { command: 'Shift+Enter', desc: 'Insert a newline instead of sending.' },
      { command: '/', desc: 'Open the skills menu from the composer.' },
      { command: 'Voice phrases', desc: 'Spoken navigation when the assistant is on.', example: 'chat · tasks · usage · next tab · read · send · mode · model · guide' },
    ],
  },
]

/**
 * Pure filter: case-insensitive substring over a section's title plus each
 * entry's command/desc/example. Sections with no matching entry are dropped;
 * matching sections keep only their matching entries. Empty/blank query → all.
 */
export function filterGuide(query: string): GuideSection[] {
  const q = query.trim().toLowerCase()
  if (!q) return GUIDE
  const result: GuideSection[] = []
  for (const section of GUIDE) {
    const entries = section.entries.filter(
      (e) =>
        e.command.toLowerCase().includes(q) ||
        e.desc.toLowerCase().includes(q) ||
        (e.example?.toLowerCase().includes(q) ?? false),
    )
    if (entries.length) {
      result.push({ ...section, entries })
    } else if (section.title.toLowerCase().includes(q)) {
      result.push({ ...section })
    }
  }
  return result
}
