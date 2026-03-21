import chalk from 'chalk'

import type { LogEntry } from '@core/LogsTypes.js'

const STAGE_COLOR_FNS: Record<string, (s: string) => string> = {
  sm: s => chalk.blue(s),
  dev: s => chalk.cyan(s),
  review: s => chalk.yellow(s),
  tester: s => chalk.magenta(s),
}

function stageColor(stageName: string): (s: string) => string {
  return STAGE_COLOR_FNS[stageName] ?? ((s: string) => chalk.bold.white(s))
}

function getTimestamp(createdAt: string): string {
  const d = new Date(createdAt)
  if (isNaN(d.getTime())) {
    return '??:??:??'
  }
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  const ss = String(d.getSeconds()).padStart(2, '0')
  return `${hh}:${mm}:${ss}`
}

function getIcon(eventType: string, eventData: Record<string, unknown>): string {
  switch (eventType) {
    case 'thinking':
      return '💭'
    case 'tool_use': {
      const toolName = typeof eventData['toolName'] === 'string' ? eventData['toolName'] : ''
      if (toolName === 'read') return '📖'
      if (toolName === 'edit') return '✏️'
      if (toolName === 'bash' || toolName === 'execute') return '⚡'
      if (toolName === 'grep') return '🔍'
      return '🔧'
    }
    case 'tool_result':
      return '↩'
    case 'text':
      return '💬'
    case 'error':
      return '✖'
    case 'done':
      return '✓'
    default:
      return '·'
  }
}

function getMessage(eventType: string, eventData: Record<string, unknown>): string {
  switch (eventType) {
    case 'thinking': {
      const t = eventData['thinking']
      return typeof t === 'string' ? t : ''
    }
    case 'tool_use': {
      const toolName = typeof eventData['toolName'] === 'string' ? eventData['toolName'] : ''
      const toolInput = eventData['toolInput']
      let arg = ''
      if (toolInput !== null && typeof toolInput === 'object' && !Array.isArray(toolInput)) {
        const inp = toolInput as Record<string, unknown>
        const fp = inp['file_path']
        const cmd = inp['command']
        if (typeof fp === 'string') arg = fp
        else if (typeof cmd === 'string') arg = cmd
      }
      return `${toolName}(${arg})`
    }
    case 'tool_result': {
      const tr = eventData['toolResult']
      return String(tr ?? '')
    }
    case 'text': {
      const txt = eventData['text']
      return String(txt ?? '')
    }
    case 'error': {
      const err = eventData['error']
      return String(err ?? '')
    }
    case 'done':
      return 'done'
    default:
      return JSON.stringify(eventData)
  }
}

export function formatLogEntry(entry: LogEntry): string {
  const ts = getTimestamp(entry.createdAt)
  const colorFn = stageColor(entry.stageName)
  const stageLabel = colorFn(`[${entry.stageName.toUpperCase()}]`)
  const icon = getIcon(entry.eventType, entry.eventData)
  const message = getMessage(entry.eventType, entry.eventData)
  return `[${ts}] ${stageLabel} ${icon}  ${message}`
}
