import { spawn } from 'node:child_process'
import readline from 'node:readline'

import type { StreamEvent } from '@core/EventTypes.js'
import { ProviderError } from '@core/Errors.js'

import type {
  BaseProvider,
  ProviderCapabilities,
  ProviderConfig,
  SessionIdResolver,
  ValidationResult,
} from '../interfaces/BaseProvider.js'
import type { DrizzleDB } from '@core/db/Connection.js'
import { ClaudeSessionResolver } from '../../workers/SessionResolver.js'
import { processManager } from './ProcessManager.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('ClaudeCliProvider')

export class ClaudeCliProvider implements BaseProvider {
  readonly name = 'claude-cli'
  readonly type = 'agent' as const
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    nativeToolUse: true,
    supportedModels: ['opus', 'sonnet', 'haiku'],
    sessionSupport: true,
  }

  createSessionResolver(db: DrizzleDB, projectPath: string): SessionIdResolver {
    return new ClaudeSessionResolver(db, projectPath)
  }

  async isAvailable(): Promise<boolean> {
    return new Promise<boolean>(resolve => {
      let child
      try {
        child = spawn('claude', ['--version'], { stdio: 'ignore' })
      } catch {
        resolve(false)
        return
      }

      const timer = setTimeout(() => {
        child.kill()
        resolve(false)
      }, 5000)

      child.on('close', code => {
        clearTimeout(timer)
        resolve(code === 0)
      })

      child.on('error', () => {
        clearTimeout(timer)
        resolve(false)
      })
    })
  }

  validateConfig(config: ProviderConfig): ValidationResult {
    if (!this.capabilities.supportedModels.includes(config.model)) {
      return { valid: false, errors: [`Unsupported model: ${config.model}`] }
    }
    return { valid: true, errors: [] }
  }

  async *execute(prompt: string, config: ProviderConfig): AsyncIterable<StreamEvent> {
    const startTime = Date.now()
    logger.info(
      `Spawned Claude task#${config.taskId} [stage=${config.stageName} model=${config.model} timeout=${Math.round(config.timeout / 60000)}m promptLen=${prompt.length}]`
    )
    // Build args array — NOT through a shell, so no escaping needed
    // Use stream-json for structured streaming events (text, tool_use, thinking, etc.)
    const args = [
      '-p', prompt,
      '--model', config.model,
      '--output-format', 'stream-json',
      '--verbose',
      '--include-partial-messages',
    ]

    // Map permissions to the appropriate Claude CLI flag
    if (config.permissions === 'dangerously-skip') {
      args.push('--dangerously-skip-permissions')
    }
    // 'accept-edits' and 'default' add no extra permissions flag

    if (config.settingsPath) {
      args.push('--settings', config.settingsPath)
    }

    // Session flags — mutually exclusive, resumeSession takes priority
    if (config.resumeSession) {
      args.push('--resume', config.resumeSession)
    } else if (config.sessionName) {
      args.push('-n', config.sessionName)
    }

    let child
    try {
      // detached: true gives the child its own process group (PGID = child.pid),
      // enabling process.kill(-pid, signal) to reach the child and its children.
      const spawnEnv = config.providerEnv
        ? { ...process.env, ...config.providerEnv }
        : undefined
      child = spawn('claude', args, {
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: true,
        ...(spawnEnv ? { env: spawnEnv } : {}),
      })
    } catch (err) {
      logger.error('claudeCliProvider: failed', {
        taskId: config.taskId,
        error: err instanceof Error ? err.message : String(err),
      })
      throw new ProviderError(
        `Failed to spawn claude: ${err instanceof Error ? err.message : String(err)}`
      )
    }

    if (child.pid === undefined) {
      yield makeEvent(config.taskId, config.stageName, 'error', {
        error: 'Failed to spawn claude: no PID assigned',
      })
      return
    }

    const pid = child.pid
    processManager.register(pid, child)

    // Guard stdout/stderr with explicit checks to make the invariant visible
    if (!child.stdout || !child.stderr) {
      processManager.unregister(pid)
      yield makeEvent(config.taskId, config.stageName, 'error', {
        error: 'stdio streams unavailable',
      })
      return
    }

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })

    let stderrBuffer = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString()
    })

    const rawStdoutLines: string[] = []
    const pendingEvents: StreamEvent[] = []
    let collectedText = ''
    let exitCode: number | null = null
    let done = false
    let wakeUp: (() => void) | null = null
    let rejectFn: ((err: Error) => void) | null = null
    let inputTokens: number | undefined
    let outputTokens: number | undefined

    rl.on('line', line => {
      rawStdoutLines.push(line)
      if (!line.trim()) return

      try {
        const event = JSON.parse(line) as Record<string, unknown>
        const parsed = parseStreamJsonEvent(event, config.taskId, config.stageName)
        if (parsed) {
          pendingEvents.push(parsed)
          // Collect text for output resolution
          if (parsed.type === 'text' && parsed.data.text) {
            collectedText += parsed.data.text
          }
          // Capture token usage from result messages
          if (event.type === 'result') {
            const usage = (event as { usage?: { input_tokens?: number; output_tokens?: number } }).usage
            if (usage) {
              inputTokens = usage.input_tokens
              outputTokens = usage.output_tokens
            }
          }
        }
      } catch {
        // Not JSON — emit as raw text (fallback)
        pendingEvents.push(makeEvent(config.taskId, config.stageName, 'text', { text: line }))
        collectedText += line + '\n'
      }

      wakeUp?.()
    })

    child.on('close', code => {
      exitCode = code
      done = true
      wakeUp?.()
    })

    child.on('error', err => {
      rejectFn?.(err)
    })

    const timer = setTimeout(() => {
      void (async () => {
        logger.warn(
          `TIMEOUT task#${config.taskId} after ${Math.round(config.timeout / 60000)}m — killing pid=${pid} [stage=${config.stageName}]`,
          { stderrSnippet: stderrBuffer }
        )
        try { process.kill(-pid, 'SIGTERM') } catch { /* already dead */ }
        await new Promise<void>(res => setTimeout(res, 5000))
        try { process.kill(-pid, 'SIGKILL') } catch { /* already dead */ }
      })()
    }, config.timeout)

    try {
      while (!done || pendingEvents.length > 0) {
        if (pendingEvents.length === 0) {
          await new Promise<void>((resolve, reject) => {
            wakeUp = resolve
            rejectFn = err => reject(new ProviderError(`Process error: ${err.message}`))
          })
          wakeUp = null
          rejectFn = null
        }

        while (pendingEvents.length > 0) {
          const event = pendingEvents.shift()
          if (event) yield event
        }
      }

      logger.info(
        `Claude done task#${config.taskId} [stage=${config.stageName} ${Date.now() - startTime}ms lines=${rawStdoutLines.length}]`
      )

      if (exitCode === 0 && stderrBuffer.trim() !== '') {
        logger.debug('claudeCliProvider: stderr diagnostic (exit 0)', {
          taskId: config.taskId,
          snippet: stderrBuffer,
        })
      }

      if (exitCode !== 0) {
        const isTimeout = exitCode === 143 || exitCode === 137
        logger.warn(
          `Claude exit(${exitCode}) task#${config.taskId} [stage=${config.stageName} ${Date.now() - startTime}ms ${isTimeout ? (exitCode === 143 ? 'SIGTERM/timeout' : 'SIGKILL/force') : 'non-zero'}]`,
          { stderr: stderrBuffer.trim() }
        )
        yield makeEvent(config.taskId, config.stageName, 'error', {
          error: `Process exited with code ${String(exitCode)}. stderr: ${stderrBuffer.trim()}`,
        })
      }

      yield makeEvent(config.taskId, config.stageName, 'raw_trace', {
        stdout: collectedText,
        stderr: stderrBuffer,
      })

      yield makeEvent(config.taskId, config.stageName, 'done', {
        inputTokens,
        outputTokens,
      })
    } finally {
      clearTimeout(timer)
      processManager.unregister(pid)
      rl.close()
    }
  }
}

function makeEvent(
  taskId: number,
  stageName: string,
  type: StreamEvent['type'],
  data: StreamEvent['data']
): StreamEvent {
  return { taskId, stageName, type, timestamp: Date.now(), data }
}

/**
 * Parse a Claude stream-json event into an AgentKit StreamEvent.
 *
 * Claude stream-json format (newline-delimited JSON):
 * - { type: "stream_event", event: { delta: { type: "text_delta", text: "..." } } }
 * - { type: "stream_event", event: { delta: { type: "thinking_delta", thinking: "..." } } }
 * - { type: "stream_event", event: { delta: { type: "input_json_delta", ... } } }  (tool input)
 * - { type: "stream_event", event: { type: "content_block_start", content_block: { type: "tool_use", name: "..." } } }
 * - { type: "stream_event", event: { type: "content_block_stop" } }
 * - { type: "result", result: "...", session_id: "...", usage: { input_tokens, output_tokens } }
 * - { type: "system", subtype: "api_retry", ... }
 */
function parseStreamJsonEvent(
  raw: Record<string, unknown>,
  taskId: number,
  stageName: string,
): StreamEvent | null {
  const type = raw.type as string | undefined

  if (type === 'stream_event') {
    const event = raw.event as Record<string, unknown> | undefined
    if (!event) return null

    // Content block start — tool_use
    if (event.type === 'content_block_start') {
      const block = event.content_block as Record<string, unknown> | undefined
      if (block?.type === 'tool_use') {
        return makeEvent(taskId, stageName, 'tool_use', {
          toolName: block.name as string,
        })
      }
      if (block?.type === 'thinking') {
        return makeEvent(taskId, stageName, 'thinking', {
          thinking: '',
        })
      }
      return null
    }

    // Delta events — text, thinking, tool input
    const delta = event.delta as Record<string, unknown> | undefined
    if (!delta) return null

    const deltaType = delta.type as string | undefined

    if (deltaType === 'text_delta') {
      return makeEvent(taskId, stageName, 'text', {
        text: delta.text as string,
      })
    }

    if (deltaType === 'thinking_delta') {
      return makeEvent(taskId, stageName, 'thinking', {
        thinking: delta.thinking as string,
      })
    }

    if (deltaType === 'input_json_delta') {
      // Tool input streaming — show as text for visibility
      return makeEvent(taskId, stageName, 'text', {
        text: delta.partial_json as string ?? '',
      })
    }

    return null
  }

  if (type === 'result') {
    // Final result — contains the complete response text and usage
    return makeEvent(taskId, stageName, 'text', {
      text: '', // result text already streamed via deltas
    })
  }

  if (type === 'system') {
    const subtype = raw.subtype as string | undefined
    if (subtype === 'api_retry') {
      return makeEvent(taskId, stageName, 'error', {
        error: `API retry attempt ${raw.attempt}/${raw.max_retries} (${raw.error}) — retrying in ${raw.retry_delay_ms}ms`,
      })
    }
  }

  return null
}
