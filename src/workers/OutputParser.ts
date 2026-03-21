import type { ParsedOutput } from './StageWorkerTypes.js'
import { Logger } from '@core/Logger.js'

const logger = Logger.getOrNoop('OutputParser')

const CODE_BLOCK_REGEX = /```json\s*([\s\S]*?)```/g

function tryCodeBlock(rawText: string): ParsedOutput | null {
  const matches = rawText.matchAll(CODE_BLOCK_REGEX)

  for (const match of matches) {
    if (!match[1]) continue
    try {
      const data: unknown = JSON.parse(match[1].trim())
      return { success: true, data }
    } catch {
      // Try next code block
    }
  }

  return null
}

function tryBalancedBraces(rawText: string): ParsedOutput | null {
  const lastBrace = rawText.lastIndexOf('}')
  if (lastBrace === -1) return null

  let depth = 0
  let start = -1

  for (let i = lastBrace; i >= 0; i--) {
    const char = rawText[i]
    if (char === '}') depth++
    if (char === '{') depth--
    if (depth === 0) {
      start = i
      break
    }
  }

  if (start === -1) return null

  const candidate = rawText.slice(start, lastBrace + 1)
  try {
    const data: unknown = JSON.parse(candidate)
    return { success: true, data }
  } catch {
    return null
  }
}

export function parseOutput(rawText: string): ParsedOutput {
  logger.debug('outputParser: parsing', { contentLength: rawText.length })

  const fromCodeBlock = tryCodeBlock(rawText)
  if (fromCodeBlock) return fromCodeBlock

  const fromBraces = tryBalancedBraces(rawText)
  if (fromBraces) return fromBraces

  logger.warn('outputParser: parse failed', {
    hint: 'no JSON code block or balanced braces found',
    rawTextPreview: rawText,
  })
  return { success: false, rawText, error: 'JSON_PARSE_ERROR' }
}
