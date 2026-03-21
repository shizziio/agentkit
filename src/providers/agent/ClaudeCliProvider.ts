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
    const args = ['-p', prompt, '--model', config.model, '--verbose']

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
    const lines: string[] = []
    let exitCode: number | null = null
    let done = false
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

    const timer = setTimeout(() => {
      void (async () => {
        logger.warn(
          `TIMEOUT task#${config.taskId} after ${Math.round(config.timeout / 60000)}m — killing pid=${pid} [stage=${config.stageName} linesCollected=${rawStdoutLines.length}]`,
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
    }, config.timeout)

    try {
      while (!done || lines.length > 0) {
        if (lines.length === 0) {
          await new Promise<void>((resolve, reject) => {
            wakeUp = resolve
            rejectFn = err => reject(new ProviderError(`Process error: ${err.message}`))
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
          {
            stderr: stderrBuffer.trim(),
          }
        )
        yield makeEvent(config.taskId, config.stageName, 'error', {
          error: `Process exited with code ${String(exitCode)}. stderr: ${stderrBuffer.trim()}`,
        })
      }

      yield makeEvent(config.taskId, config.stageName, 'raw_trace', {
        stdout: rawStdoutLines.join('\n'),
        stderr: stderrBuffer,
      })

      // tokens unavailable in plain text mode — accepted trade-off (see story 8.8)
      yield makeEvent(config.taskId, config.stageName, 'done', {})
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
