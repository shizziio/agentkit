import type { DrizzleDB } from '@core/db/Connection.js'
import { tasks } from '@core/db/schema.js'
import { eq } from 'drizzle-orm'

import { readOutputFile } from './OutputFileManager.js'
import { parseOutput } from './OutputParser.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('OutputResolver')

export type ResolveOutputResult =
  | { kind: 'done'; output: string; source: 'file' | 'stdout'; inputTokens?: number; outputTokens?: number }
  | { kind: 'failed'; rawText: string; error: 'OUTPUT_MISSING' | 'INVALID_OUTPUT_JSON' }

/**
 * Try to parse Gemini CLI `--output-format json` envelope.
 * Gemini wraps the model answer in: { response: string, stats: { ... }, error?: ... }
 * Returns the inner model output (parsed from response text) + token stats, or null.
 */
function tryGeminiJsonEnvelope(
  text: string
): { data: unknown; inputTokens?: number; outputTokens?: number } | null {
  let envelope: { response?: string; stats?: Record<string, unknown>; error?: unknown }
  try {
    envelope = JSON.parse(text) as typeof envelope
  } catch {
    return null
  }

  if (typeof envelope.response !== 'string') return null

  // Extract token stats from Gemini stats.models[*].tokens structure
  let inputTokens: number | undefined
  let outputTokens: number | undefined
  if (envelope.stats && typeof envelope.stats === 'object') {
    const stats = envelope.stats as Record<string, unknown>
    const models = stats.models as Record<string, unknown> | undefined
    if (models && typeof models === 'object') {
      // Take tokens from the first (and usually only) model entry
      const firstModel = Object.values(models)[0] as Record<string, unknown> | undefined
      const tokens = firstModel?.tokens as Record<string, unknown> | undefined
      if (tokens) {
        if (typeof tokens.input === 'number') inputTokens = tokens.input
        if (typeof tokens.candidates === 'number') outputTokens = tokens.candidates
      }
    }
  }

  // Parse model output from the response text (may contain ```json block or raw JSON)
  const innerParsed = parseOutput(envelope.response)
  if (innerParsed.success) {
    return { data: innerParsed.data, inputTokens, outputTokens }
  }

  return null
}

/**
 * Triple-path output resolution:
 * 1. Try reading the output file (Claude uses Write tool to write here)
 * 2. Try Gemini JSON envelope (--output-format json wraps response in { response, stats })
 * 3. Fall back to parsing stdout text directly (regex code-block / balanced braces)
 */
export function resolveOutput(
  outputPath: string,
  collectedText: string,
  inputTokens?: number,
  outputTokens?: number
): ResolveOutputResult {
  // Path 1: file (Claude with Write tool)
  const fileResult = readOutputFile(outputPath)
  if (fileResult.success) {
    return { kind: 'done', output: JSON.stringify(fileResult.data), source: 'file', inputTokens, outputTokens }
  }
  const fileError = fileResult.error

  // Path 2: Gemini --output-format json envelope { response, stats }
  const gemini = tryGeminiJsonEnvelope(collectedText)
  if (gemini) {
    logger.info('resolveOutput: extracted from Gemini JSON envelope', {
      inputTokens: gemini.inputTokens,
      outputTokens: gemini.outputTokens,
    })
    return {
      kind: 'done',
      output: JSON.stringify(gemini.data),
      source: 'stdout',
      inputTokens: gemini.inputTokens ?? inputTokens,
      outputTokens: gemini.outputTokens ?? outputTokens,
    }
  }

  // Path 3: direct stdout parsing (regex code-block / balanced braces fallback)
  const parsed = parseOutput(collectedText)
  if (parsed.success) {
    return { kind: 'done', output: JSON.stringify(parsed.data), source: 'stdout', inputTokens, outputTokens }
  }

  const finalError: 'OUTPUT_MISSING' | 'INVALID_OUTPUT_JSON' =
    fileError === 'INVALID_OUTPUT_JSON' ? 'INVALID_OUTPUT_JSON' : 'OUTPUT_MISSING'
  return { kind: 'failed', rawText: parsed.rawText ?? collectedText, error: finalError }
}

export function buildFailOutput(
  rawOutput: string,
  error: string,
  stdout: string,
  stderr: string,
  events: Array<{ type: string; data: Record<string, unknown> }>
): string {
  const eventTypes = [...new Set(events.map(e => e.type))]
  let eventsForStorage: Array<{ type: string; data: Record<string, unknown> }> = events
  if (JSON.stringify(events).length > 500 * 1024 && events.length > 20) {
    const sentinel: { type: string; data: Record<string, unknown> } = { type: 'truncated', data: { count: events.length - 20 } }
    eventsForStorage = [...events.slice(0, 10), sentinel, ...events.slice(-10)]
  }
  return JSON.stringify({ rawText: rawOutput, error, stderr, stdout, eventCount: events.length, eventTypes, collectedEvents: eventsForStorage })
}

export function updateTaskFailed(
  db: DrizzleDB,
  taskId: number,
  rawOutput: string,
  error: string,
  durationMs: number,
  stdout = '',
  stderr = '',
  collectedEvents: Array<{ type: string; data: Record<string, unknown> }> = []
): void {
  const output = buildFailOutput(rawOutput, error, stdout, stderr, collectedEvents)
  const now = new Date().toISOString()
  db.transaction(tx => {
    tx.update(tasks)
      .set({
        status: 'failed',
        output,
        completedAt: now,
        durationMs,
        updatedAt: now,
      })
      .where(eq(tasks.id, taskId))
      .run()
  })
}
