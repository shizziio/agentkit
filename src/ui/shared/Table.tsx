import React from 'react'
import { Box, Text } from 'ink'

import { truncate } from './format.js'

export interface ColumnDef<T> {
  /** Unique column identifier */
  key: string
  /** Header text */
  header: string
  /** Fixed character width (0 = use flexGrow) */
  width: number
  /** Cell content renderer */
  render: (row: T, index: number) => string
  /** Optional per-cell Ink color */
  color?: (row: T) => string | undefined
  /** Optional per-cell bold */
  bold?: (row: T) => boolean
  /** Dim entire column */
  dimColor?: boolean
}

export interface TableProps<T> {
  columns: ColumnDef<T>[]
  data: T[]
  /** Dim entire table (unfocused panel) */
  dimmed?: boolean
  /** Column key that gets flexGrow=1 */
  flexColumn?: string
  /** Show ─ separator below header (default: true) */
  separator?: boolean
  /** Separator line width */
  separatorWidth?: number
}

function TableInner<T>({
  columns,
  data,
  dimmed = false,
  flexColumn,
  separator = true,
  separatorWidth,
}: TableProps<T>): React.JSX.Element {
  return (
    <Box flexDirection="column" overflow="hidden">
      {/* Header row */}
      <Box flexDirection="row" width="100%" overflow="hidden">
        {columns.map(col =>
          col.key === flexColumn ? (
            <Box key={col.key} flexGrow={1} overflow="hidden">
              <Text bold color="white" dimColor={dimmed} wrap="truncate">
                {col.header}
              </Text>
            </Box>
          ) : (
            <Text key={col.key} bold color="white" dimColor={dimmed} wrap="truncate">
              {col.header.padEnd(col.width)}
            </Text>
          ),
        )}
      </Box>

      {/* Separator */}
      {separator && (
        <Text color="gray" dimColor={dimmed} wrap="truncate">
          {'─'.repeat(Math.max(0, separatorWidth ?? 50))}
        </Text>
      )}

      {/* Data rows */}
      {data.map((row, idx) => (
        <Box key={idx} flexDirection="row" width="100%" overflow="hidden">
          {columns.map(col => {
            const content = col.render(row, idx)
            const cellColor = col.color?.(row)
            const cellBold = col.bold?.(row) ?? false
            const cellDim = dimmed || (col.dimColor ?? false)

            if (col.key === flexColumn) {
              return (
                <Box key={col.key} flexGrow={1} overflow="hidden">
                  <Text bold={cellBold} color={cellColor} dimColor={cellDim} wrap="truncate">
                    {content}
                  </Text>
                </Box>
              )
            }

            return (
              <Text key={col.key} bold={cellBold} color={cellColor} dimColor={cellDim} wrap="truncate">
                {truncate(content, col.width)}
              </Text>
            )
          })}
        </Box>
      ))}
    </Box>
  )
}

export const Table = React.memo(TableInner) as typeof TableInner
