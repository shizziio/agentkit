import { spawn } from 'node:child_process'
import readline from 'node:readline'

import type {
  BaseProvider,
  ProviderConfig,
  ProviderCapabilities,
  ValidationResult,
  SessionIdResolver,
} from '../interfaces/BaseProvider.js'
import type { StreamEvent } from '@core/EventTypes.js'
import type { DrizzleDB } from '@core/db/Connection.js'
import { processManager } from './ProcessManager.js'
import { Logger } from '@core/Logger.js'
// GeminiSessionResolver is implemented in Story 22.2 — imported here for createSessionResolver()
import { GeminiSessionResolver } from '../session/GeminiSessionResolver.js'

const logger = Logger.getOrNoop('GeminiCliProvider')

export class GeminiCliProvider implements BaseProvider {
  readonly name = 'gemini-cli'
  readonly type = 'agent'
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    nativeToolUse: true,
    supportedModels: [
      'gemini-3.1-pro-preview',
      'gemini-3-flash',
      'gemini-2.5-pro',
      'gemini-2.5-flash',
      'gemini-2.5-flash-lite',
      'gemini-2.0-pro-exp',
    ],
    sessionSupport: true,
  }

  isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const p = spawn('gemini', ['--version'])
      p.on('error', () => resolve(false))
      p.on('close', code => resolve(code === 0))
    })
  }

  validateConfig(config: ProviderConfig): ValidationResult {
    if (!this.capabilities.supportedModels.includes(config.model)) {
      return {
        valid: false,
        errors: [`Model ${config.model} is not supported by ${this.name}`],
      }
    }
    return { valid: true, errors: [] }
  }

  async *execute(prompt: string, config: ProviderConfig): AsyncIterable<StreamEvent> {
    const startTime = Date.now()
    const timeoutMs = config.timeout

    logger.info(
      `Spawned Gemini task#${config.taskId} [stage=${config.stageName} model=${config.model} timeout=${Math.round(timeoutMs / 60000)}m promptLen=${prompt.length}]`
    )

    // Pass prompt via stdin to avoid OS ARG_MAX limits for very large prompts.
    // -p ' ' triggers headless/non-interactive mode. Per gemini CLI docs, -p value is appended to stdin.
    // We use default text output rather than --output-format json to keep it simple and avoid parsing issues.
    // The OutputParser will still extract the required JSON block from the raw text stream.

    // Inject TaskName marker for new sessions (not for resume — it's already in session history).
    // Note: we assume the pipeline never calls execute() with a pre-injected TaskName prefix.
    // Resume takes precedence: if resumeSession is set, skip TaskName injection even if sessionName is also set.
    const effectivePrompt =
      config.sessionName && !config.resumeSession
        ? `TaskName: ${config.sessionName}\n${prompt}`
        : prompt

    const args = ['-m', config.model, '--approval-mode=yolo']

    if (config.resumeSession) {
      args.push('-r', config.resumeSession)
    }

    if (config.settingsPath) {
      args.push('--settings', config.settingsPath)
    }

    args.push('-p', ' ')

    const spawnEnv = config.providerEnv ? { ...process.env, ...config.providerEnv } : undefined

    const child = spawn('gemini', args, {
      detached: true,
      stdio: ['pipe', 'pipe', 'pipe'],
      ...(spawnEnv ? { env: spawnEnv } : {}),
    })

    if (child.pid === undefined || !child.stdout || !child.stderr || !child.stdin) {
      yield makeEvent(config.taskId, config.stageName, 'error', {
        error: 'Failed to spawn gemini: no PID or streams',
      })
      return
    }

    const pid = child.pid
    processManager.register(pid, child)

    // Write full prompt to stdin and close so gemini starts processing
    child.stdin.write(effectivePrompt, 'utf-8')
    child.stdin.end()

    // ── Event-based line collection (same pattern as ClaudeCliProvider) ──
    // Avoids readline async iterator hangs with detached processes.
    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })

    let stderrBuffer = ''
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBuffer += chunk.toString()
    })

    const lines: string[] = []
    const rawStdoutLines: string[] = []
    let done = false
    let exitCode: number | null = null
    let wakeUp: (() => void) | null = null
    let rejectFn: ((err: Error) => void) | null = null

    rl.on('line', line => {
      rawStdoutLines.push(line)
      lines.push(line)
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

    // Timeout: kill the process group after timeoutMs
    const timer = setTimeout(() => {
      void (async () => {
        logger.warn(
          `TIMEOUT task#${config.taskId} after ${Math.round(timeoutMs / 60000)}m — killing pid=${pid} [stage=${config.stageName} linesCollected=${rawStdoutLines.length}]`,
          {
            stderrSnippet: stderrBuffer,
          }
        )
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          /* already dead */
        }
        await new Promise<void>(res => setTimeout(res, 5000))
        try {
          process.kill(-pid, 'SIGKILL')
        } catch {
          /* already dead */
        }
      })()
    }, timeoutMs)

    try {
      while (!done || lines.length > 0) {
        if (lines.length === 0) {
          await new Promise<void>((resolve, reject) => {
            wakeUp = resolve
            rejectFn = err => reject(new Error(`Process error: ${err.message}`))
          })
          wakeUp = null
          rejectFn = null
        }

        while (lines.length > 0) {
          const line = lines.shift()
          if (line === undefined) continue
          yield makeEvent(config.taskId, config.stageName, 'text', { text: line })
        }
      }

      logger.info(
        `Gemini done task#${config.taskId} [stage=${config.stageName} ${Date.now() - startTime}ms lines=${rawStdoutLines.length}]`
      )

      if (exitCode !== 0 && exitCode !== null) {
        const isTimeout = exitCode === 143 || exitCode === 137
        const stderr = stderrBuffer.trim()

        // Detect Gemini API quota exhaustion (HTTP 429) — surface clearly so
        // StageWorker can show a meaningful error instead of OUTPUT_MISSING.
        const isQuota =
          stderr.includes('QUOTA_EXHAUSTED') ||
          stderr.includes('TerminalQuotaError') ||
          stderr.includes('exhausted your capacity') ||
          stderr.includes('"code":429') ||
          stderr.includes("'code': 429")

        const resetMatch = stderr.match(/quota will reset after ([^.\\n]+)/i)
        const resetIn = resetMatch?.[1] ?? 'unknown'

        if (isQuota) {
          logger.warn(
            `Gemini QUOTA_EXHAUSTED task#${config.taskId} [stage=${config.stageName} model=${config.model} resetIn=${resetIn}]`
          )
          yield makeEvent(config.taskId, config.stageName, 'error', {
            error: `QUOTA_EXHAUSTED: Gemini model "${config.model}" quota exhausted. Resets in ${resetIn}. Switch provider or wait.`,
          })
        } else {
          logger.warn(
            `Gemini exit(${exitCode}) task#${config.taskId} [stage=${config.stageName} ${Date.now() - startTime}ms ${isTimeout ? 'SIGTERM/timeout' : 'non-zero'}]`,
            { stderr }
          )
          yield makeEvent(config.taskId, config.stageName, 'error', {
            error: `Process exited with code ${String(exitCode)}. stderr: ${stderr}`,
          })
        }
      }

      // Provide raw_trace event so StageWorker can log stderr on failure
      yield makeEvent(config.taskId, config.stageName, 'raw_trace', {
        stdout: rawStdoutLines.join('\n'),
        stderr: stderrBuffer,
      })

      yield makeEvent(config.taskId, config.stageName, 'done', {})
    } finally {
      clearTimeout(timer)
      processManager.unregister(pid)
      rl.close()
    }
  }

  createSessionResolver(db: DrizzleDB, projectPath: string): SessionIdResolver | null {
    try {
      return new GeminiSessionResolver(db, projectPath)
    } catch {
      return null
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
