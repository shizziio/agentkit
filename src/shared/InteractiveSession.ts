import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('InteractiveSession')

export interface InteractiveSessionOptions {
  /** Provider identifier: 'claude-cli' | 'gemini-cli' | 'codex-cli' */
  provider: string
  /** Absolute paths to files to load as system prompt context */
  systemPromptFiles: string[]
  /** Optional first user message — if not set, builds from systemPromptFiles content */
  initialMessage?: string
  /** Optional model override */
  model?: string
}

/**
 * Build a directive initial message that includes the full workflow/agent content.
 * This ensures the AI actually follows the instructions regardless of its own system prompt.
 */
function buildDirectiveMessage(promptFiles: string[], fallbackMessage?: string): string {
  const parts: string[] = []

  for (const filePath of promptFiles) {
    if (!existsSync(filePath)) continue
    try {
      parts.push(readFileSync(filePath, 'utf-8'))
    } catch {
      // skip
    }
  }

  if (parts.length === 0) return fallbackMessage ?? 'Hello!'

  const directive = fallbackMessage
    ? `Now start: ${fallbackMessage}`
    : 'Now start: follow the "On First Interaction" sequence above. Load the project docs, greet me, show the menu, and wait for my input.'

  return `Read and follow the instructions below carefully. This is your role and workflow for this session.

---

${parts.join('\n\n---\n\n')}

---

${directive}`
}

const PROVIDER_BINARY: Record<string, string> = {
  'claude-cli': 'claude',
  'gemini-cli': 'gemini',
  'codex-cli': 'codex',
}

/**
 * Spawn a provider CLI in interactive chat mode with pre-loaded system prompt.
 * Agentkit passes stdio through and exits when the provider CLI exits.
 *
 * This is a reusable utility for any feature that needs to hand control
 * to the provider CLI (setup wizards, team creation, doc generation, etc.)
 */
export function launchInteractiveSession(options: InteractiveSessionOptions): void {
  const binary = PROVIDER_BINARY[options.provider]
  if (!binary) {
    process.stderr.write(`Unknown provider: ${options.provider}\n`)
    process.exit(1)
  }

  const args = buildArgs(options)

  logger.info('InteractiveSession: launching', {
    provider: options.provider,
    binary,
    promptFiles: options.systemPromptFiles,
  })

  // Print a brief message so the user knows what's happening
  process.stdout.write(`\nLaunching ${binary} in interactive mode...\n`)
  process.stdout.write(`When done, exit ${binary} and run \`agentkit start\` again.\n\n`)

  // Use spawnSync to block the process entirely.
  // This ensures agentkit's event loop (Ink, etc.) is fully paused while
  // the provider CLI has control of the terminal.
  const result = spawnSync(binary, args, {
    stdio: 'inherit',
    env: process.env,
  })

  if (result.error) {
    process.stderr.write(`Failed to start ${binary}: ${result.error.message}\n`)
    process.stderr.write(`Make sure ${binary} is installed and in your PATH.\n`)
    process.exit(1)
  }

  process.exit(result.status ?? 0)
}

function buildArgs(options: InteractiveSessionOptions): string[] {
  switch (options.provider) {
    case 'claude-cli':
      return buildClaudeArgs(options)
    case 'gemini-cli':
      return buildGeminiArgs(options)
    case 'codex-cli':
      return buildCodexArgs(options)
    default:
      return []
  }
}

function buildClaudeArgs(options: InteractiveSessionOptions): string[] {
  const args: string[] = []

  // No -p flag = interactive mode

  if (options.model) {
    args.push('--model', options.model)
  }

  // Build a directive initial message that includes the workflow content directly.
  // This is more reliable than --append-system-prompt-file because Claude Code's
  // own system prompt can override appended system prompts.
  const message = buildDirectiveMessage(options.systemPromptFiles, options.initialMessage)
  args.push(message)

  return args
}

function buildGeminiArgs(options: InteractiveSessionOptions): string[] {
  const args: string[] = []

  if (options.model) {
    args.push('-m', options.model)
  }

  // Build directive message with workflow content
  const message = buildDirectiveMessage(options.systemPromptFiles, options.initialMessage)

  if (message.length > 100_000) {
    const tempPath = writeTempFile(message, 'gemini-prompt')
    args.push('-i', `See system prompt in: ${tempPath}`)
  } else {
    args.push('-i', message)
  }

  return args
}

function buildCodexArgs(options: InteractiveSessionOptions): string[] {
  const args: string[] = []

  if (options.model) {
    args.push('-m', options.model)
  }

  // Codex: pass workflow content as --instructions
  const combined = combinePromptFiles(options.systemPromptFiles)
  if (combined) {
    args.push('--instructions', combined)
  }

  const message = options.initialMessage ?? 'Start by following the instructions above.'
  args.push(message)

  return args
}

function combinePromptFiles(filePaths: string[]): string | null {
  const parts: string[] = []
  for (const filePath of filePaths) {
    if (!existsSync(filePath)) continue
    try {
      parts.push(readFileSync(filePath, 'utf-8'))
    } catch {
      // skip unreadable files
    }
  }
  return parts.length > 0 ? parts.join('\n\n---\n\n') : null
}

function writeTempFile(content: string, prefix: string): string {
  const dir = join(tmpdir(), 'agentkit')
  mkdirSync(dir, { recursive: true })
  const path = join(dir, `${prefix}-${Date.now()}.md`)
  writeFileSync(path, content, 'utf-8')
  return path
}
