/**
 * Shared format/display utilities — consolidated from scattered files.
 */

/** Truncate string to maxLen, adding '…' if cut. Pads with spaces if shorter. */
export function truncate(str: string, maxLen: number): string {
  if (maxLen <= 0) return ''
  if (str.length <= maxLen) return str.padEnd(maxLen)
  return str.slice(0, maxLen - 1) + '…'
}

/** Status → Ink color mapping. */
export function getStatusColor(status: string): string {
  if (status === 'RUN' || status === 'running') return 'green'
  if (status === 'QUEUE' || status === 'queued') return 'yellow'
  if (status === 'DONE' || status === 'done') return 'cyan'
  if (status === 'WAIT' || status === 'waiting') return 'yellowBright'
  return 'red'
}

/** Priority → Ink color. High priority (>=3) = yellow. */
export function getPriorityColor(priority: number): string | undefined {
  if (priority >= 3) return 'yellow'
  return undefined
}

/** Priority 0 should be dimmed. */
export function getPriorityDim(priority: number): boolean {
  return priority === 0
}
