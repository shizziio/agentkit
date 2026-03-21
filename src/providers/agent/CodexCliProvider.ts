import { spawn } from 'node:child_process'
import readline from 'node:readline'

import type {
  BaseProvider,
  ProviderConfig,
  ProviderCapabilities,
  ValidationResult,
} from '../interfaces/BaseProvider.js'
import type { StreamEvent } from '@core/EventTypes.js'
import { processManager } from './ProcessManager.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('CodexCliProvider')

export class CodexCliProvider implements BaseProvider {
  readonly name = 'codex-cli'
  readonly type = 'agent'
  readonly capabilities: ProviderCapabilities = {
    streaming: true,
    nativeToolUse: true,
    supportedModels: ['gpt-5.3-codex'],
    sessionSupport: false,
  }

  isAvailable(): Promise<boolean> {
    return new Promise(resolve => {
      const p = spawn('codex', ['--version'])
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
      `Spawned Codex task#${config.taskId} [stage=${config.stageName} model=${config.model} timeout=${Math.round(timeoutMs / 60000)}m promptLen=${prompt.length}]`
    )

    // codex exec --model <model> --dangerously-bypass-approvals-and-sandbox <prompt>
    const args = ['exec', '-m', config.model, '--dangerously-bypass-approvals-and-sandbox', prompt]

    if (config.settingsPath) {
      args.push('--settings', config.settingsPath)
    }

    const spawnEnv = config.providerEnv ? { ...process.env, ...config.providerEnv } : undefined

    const child = spawn('codex', args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      ...(spawnEnv ? { env: spawnEnv } : {}),
    })

    if (child.pid === undefined || !child.stdout || !child.stderr) {
      yield makeEvent(config.taskId, config.stageName, 'error', {
        error: 'Failed to spawn codex: no PID or streams',
      })
      return
    }

    const pid = child.pid
    processManager.register(pid, child)

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

    const timer = setTimeout(() => {
      void (async () => {
        logger.warn(
          `TIMEOUT task#${config.taskId} after ${Math.round(timeoutMs / 60000)}m — killing pid=${pid} [stage=${config.stageName} linesCollected=${rawStdoutLines.length}]`,
          { stderrSnippet: stderrBuffer }
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
        `Codex done task#${config.taskId} [stage=${config.stageName} ${Date.now() - startTime}ms lines=${rawStdoutLines.length}]`
      )

      if (exitCode !== 0 && exitCode !== null) {
        const isTimeout = exitCode === 143 || exitCode === 137
        const stderr = stderrBuffer.trim()

        logger.warn(
          `Codex exit(${exitCode}) task#${config.taskId} [stage=${config.stageName} ${Date.now() - startTime}ms ${isTimeout ? 'SIGTERM/timeout' : 'non-zero'}]`,
          { stderr }
        )
        yield makeEvent(config.taskId, config.stageName, 'error', {
          error: `Process exited with code ${String(exitCode)}. stderr: ${stderr}`,
        })
      }

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
}

function makeEvent(
  taskId: number,
  stageName: string,
  type: StreamEvent['type'],
  data: StreamEvent['data']
): StreamEvent {
  return { taskId, stageName, type, timestamp: Date.now(), data }
}
