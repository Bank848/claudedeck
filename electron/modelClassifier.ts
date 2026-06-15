/**
 * One-shot Haiku "difficulty classifier" used only when the renderer heuristic is
 * borderline (`Suggestion.needsClassifier`). It is a throwaway `claude --model haiku`
 * turn with NO permission protocol and NO `--resume`: no tools, no transcript, no side
 * effects, minimal cost.
 *
 * Critically this does NOT reuse `buildArgs` from claude.ts — that always adds
 * `--permission-prompt-tool stdio`, which would start the control protocol. We build a
 * minimal arg list here instead.
 *
 * `Tier` is duplicated from src/renderer/settings/modelRouting.ts on purpose: the main
 * process has no `@/` alias to the renderer (same rationale as `cleanRules` in claude.ts).
 * Both copies are unit-tested; keep them in sync.
 */
import { spawn } from 'node:child_process'
import { detectClaude, classifyLine } from './claude'
import { buildInitialize, buildUserMessage } from './permissionProtocol'

export type Tier = 'haiku' | 'sonnet' | 'opus' | 'fable'
const TIERS: readonly Tier[] = ['haiku', 'sonnet', 'opus']

const CLASSIFY_TIMEOUT_MS = 4000

/** Minimal argv for the one-shot classify turn (no permission tool, no resume). */
export function buildClassifyArgs(): string[] {
  return [
    '-p',
    '--output-format',
    'stream-json',
    '--verbose',
    '--input-format',
    'stream-json',
    '--model',
    'haiku',
  ]
}

const classifyPrompt = (userPrompt: string): string =>
  'You are a model-routing classifier. Read the user\'s task and reply with EXACTLY ONE ' +
  'word, lowercase, no punctuation, chosen from: haiku, sonnet, opus. ' +
  'haiku = trivial/mechanical; sonnet = normal coding or Q&A; ' +
  'opus = complex, architecture, deep debugging, or high-stakes reasoning.\n\nTASK:\n' +
  userPrompt

/**
 * Pure. Map Haiku's final `result` text → Tier. Strict whole-word allow-list; anything
 * unmatched (empty, a sentence with no tier word, garbage, an error) falls back to the
 * resting tier. NEVER defaults to `fable` and NEVER throws.
 */
export function parseClassifierResult(resultText: string | undefined, restingTier: Tier): Tier {
  if (!resultText) return restingTier
  const t = resultText.toLowerCase()
  for (const tier of TIERS) {
    if (new RegExp(`\\b${tier}\\b`).test(t)) return tier
  }
  return restingTier
}

interface ResultLike {
  type?: string
  result?: string
}

/**
 * Spawn a one-shot Haiku classify turn. Resolves to a Tier. On ANY failure (binary
 * missing, spawn error, timeout, no result) it resolves to `restingTier` — the caller's
 * send must never hang or crash because of routing.
 */
export function classifyTurn(prompt: string, restingTier: Tier): Promise<Tier> {
  return new Promise<Tier>((resolve) => {
    void detectClaude().then((bin) => {
      if (!bin) return resolve(restingTier)

      let settled = false
      const finish = (tier: Tier): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try {
          proc.stdin?.end()
        } catch {
          /* ignore */
        }
        if (proc.pid && !proc.killed) {
          if (process.platform === 'win32') spawn('taskkill', ['/pid', String(proc.pid), '/T', '/F'])
          else proc.kill('SIGTERM')
        }
        resolve(tier)
      }

      const args = buildClassifyArgs()
      const isWin = process.platform === 'win32'
      const proc = isWin
        ? spawn('cmd.exe', ['/c', bin, ...args], { windowsHide: true })
        : spawn(bin, args)

      const timer = setTimeout(() => finish(restingTier), CLASSIFY_TIMEOUT_MS)

      proc.on('error', () => finish(restingTier))

      proc.stdin?.write(buildInitialize() + '\n', 'utf8')
      proc.stdin?.write(buildUserMessage(classifyPrompt(prompt)) + '\n', 'utf8')

      const onResultText = (text: string | undefined): void =>
        finish(parseClassifierResult(text, restingTier))

      let buf = ''
      const consume = (line: string): void => {
        const action = classifyLine(line)
        if (action?.kind === 'event' && action.isResult) {
          onResultText((action.event as ResultLike).result)
        }
      }
      proc.stdout?.on('data', (d) => {
        buf += String(d)
        let nl: number
        while ((nl = buf.indexOf('\n')) !== -1) {
          consume(buf.slice(0, nl))
          buf = buf.slice(nl + 1)
        }
      })
      proc.on('exit', () => {
        if (buf.trim()) consume(buf)
        finish(restingTier) // no result seen → resting
      })
    })
  })
}
