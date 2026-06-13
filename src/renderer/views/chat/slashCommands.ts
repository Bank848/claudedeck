/**
 * Slash-command autocomplete data + pure matching logic for the composer.
 * Kept separate from the component so the filter/navigation is unit-testable.
 *
 * The menu pops up the moment the input is a lone "/token" (a command name
 * still being typed). Once the user types a space — i.e. starts passing
 * arguments — the command is considered chosen and the menu hides.
 */

export interface SlashCommand {
  /** Includes the leading slash, e.g. "/help". */
  name: string
  /** Plain-language description of what the command does. */
  desc: string
}

/**
 * Curated list of in-session slash commands, hand-maintained alongside the
 * Guide page's "slash" section. Order here is the display order.
 */
export const SLASH_COMMANDS: SlashCommand[] = [
  { name: '/help', desc: 'List available commands and basic usage.' },
  { name: '/clear', desc: 'Clear the conversation and free up context.' },
  { name: '/compact', desc: 'Summarize the conversation so far to reclaim context.' },
  { name: '/model', desc: 'Switch the active model mid-session.' },
  { name: '/config', desc: 'Open configuration / settings.' },
  { name: '/mcp', desc: 'View and manage connected MCP servers.' },
  { name: '/memory', desc: 'Edit project / user memory (CLAUDE.md and friends).' },
  { name: '/cost', desc: 'Show token usage and cost for the session.' },
  { name: '/doctor', desc: 'Run diagnostics from inside the session.' },
  { name: '/init', desc: 'Generate a CLAUDE.md for the current project.' },
  { name: '/review', desc: 'Request a code review of the current changes.' },
  { name: '/resume', desc: 'Pick a past session to resume.' },
  { name: '/agents', desc: 'Browse and manage subagents.' },
  { name: '/permissions', desc: 'View or change tool permissions.' },
  { name: '/status', desc: 'Show account, model, and connection status.' },
  { name: '/login', desc: 'Switch account or re-authenticate.' },
  { name: '/logout', desc: 'Sign out the current account.' },
  { name: '/vim', desc: 'Toggle vim key-bindings in the input.' },
]

/**
 * The command-name fragment currently being typed, or null if the menu should
 * not show. Returns "" right after the bare "/" (show the full list). Returns
 * null when the value doesn't start with "/" or already contains whitespace
 * (a command was chosen and arguments are being typed).
 */
export function slashQuery(value: string): string | null {
  if (!value.startsWith('/')) return null
  const rest = value.slice(1)
  if (/\s/.test(rest)) return null
  return rest
}

/**
 * Matches for the current input, or [] when the menu should not show.
 * Prefix matches on the command name rank above description substring hits;
 * within each group, original list order is preserved.
 */
export function matchSlashCommands(value: string): SlashCommand[] {
  const q = slashQuery(value)
  if (q === null) return []
  if (q === '') return SLASH_COMMANDS
  const lower = q.toLowerCase()
  const prefix: SlashCommand[] = []
  const other: SlashCommand[] = []
  for (const cmd of SLASH_COMMANDS) {
    if (cmd.name.slice(1).toLowerCase().startsWith(lower)) prefix.push(cmd)
    else if (cmd.desc.toLowerCase().includes(lower)) other.push(cmd)
  }
  return [...prefix, ...other]
}

/** Wrap-around list navigation for ArrowUp/ArrowDown (delta -1 / +1). */
export function moveIndex(current: number, length: number, delta: number): number {
  if (length === 0) return 0
  return (current + delta + length) % length
}
