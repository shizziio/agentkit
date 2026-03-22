import React, { useState, useEffect } from 'react'
import { Box, Text, useInput } from 'ink'

import type { QueueStats } from '@ui/stores/workerStore.js'
import type { UseMenuStack } from '../hooks/useMenuStack.js'
import type { MenuItem, MenuLevel } from './MenuTypes.js'

import { ChatPanel } from '@ui/chat/ChatPanel.js'
import type { ActionMode } from '../shared/DashboardTypes.js'

const MENUS: Record<MenuLevel, MenuItem[]> = {
  main: [
    { action: 'load',      label: 'Load Story', hotkey: 'L' },
    { action: 'ship',      label: 'Ship Story', hotkey: 'S' },
    { action: 'run-pipeline', label: 'Run Pipeline', hotkey: 'R' },
    { action: 'epic-story-mgmt', label: 'Epic & Story Management', isSubmenu: true, hotkey: 'G' },
    { action: 'task-mgmt',       label: 'Task Management',        isSubmenu: true, hotkey: 'K' },
    { action: 'diagnose',  label: 'Diagnose', hotkey: 'D' },
    { action: 'config',    label: 'Config', isSubmenu: true, hotkey: 'C' },
    { action: 'custom-rules',    label: 'Custom Rules', hotkey: 'U' },
    { action: 'create-planning', label: 'Create Planning', hotkey: 'P' },
    { action: 'ask-agentkit',    label: 'Ask AgentKit', hotkey: 'W' },
    { action: 'ask-agent', label: 'Ask Agent', hotkey: 'A' },
    { action: 'help',      label: 'Help', hotkey: 'H' },
    { action: 'quit',      label: 'Quit', hotkey: 'Q' },
  ],
  'epic-story-mgmt': [
    { action: 'mark-done',    label: 'Mark Story Done', hotkey: 'M' },
    { action: 'reset-story',  label: 'Reset Story', hotkey: 'E' },
    { action: 'cancel-story', label: 'Remove Story from Queue', hotkey: 'X' },
  ],
  'task-mgmt': [
    { action: 'history', label: 'Task List', hotkey: 'Y' },
    { action: 'trace', label: 'Trace Task', hotkey: 'T' },
    { action: 'replay', label: 'Replay Task', hotkey: 'P' },
  ],
  config: [
    { action: 'view-config',   label: 'View Current Config', hotkey: 'V' },
    { action: 'change-team',   label: 'Change Active Team', hotkey: 'T' },
    { action: 'change-models', label: 'Change Models', hotkey: 'M' },
    { action: 'change-provider', label: 'Switch Provider', hotkey: 'P' },
  ],
  action: [],
}

function isMenuLevel(action: string): action is MenuLevel {
  const levels: MenuLevel[] = ['main', 'epic-story-mgmt', 'task-mgmt', 'config', 'action']
  return levels.includes(action as MenuLevel)
}

export interface CommandMenuPanelProps {
  isFocused?: boolean
  onSelectAction: (action: string) => void
  isActionActive?: boolean
  actionMode?: ActionMode
  isPipelineRunning?: boolean
  queueStats?: QueueStats | null
  menuStack: UseMenuStack
  width?: number
  height?: number
}

function CommandMenuPanelInner({
  isFocused = false,
  onSelectAction,
  isActionActive = false,
  actionMode = 'none',
  isPipelineRunning = false,
  queueStats = null,
  menuStack,
  width,
  height,
}: CommandMenuPanelProps): React.JSX.Element {
  const [cursor, setCursor] = useState(0)
  const { currentLevel, push, handleQ } = menuStack

  // Dynamic menu: replace run-pipeline item based on pipeline state
  const menuItems = (MENUS[currentLevel] || []).flatMap(item => {
    if (item.action !== 'run-pipeline') return [item]
    if (!isPipelineRunning) return [item]
    return [
      { action: 'drain-pipeline', label: 'Drain Pipeline (finish current)', hotkey: 'R' },
      { action: 'stop-pipeline',  label: 'Stop Pipeline (force)',          hotkey: 'F' },
    ]
  })

  // Reset cursor when menu level changes
  useEffect(() => {
    setCursor(0)
  }, [currentLevel])

  useInput(
    (input, key) => {
      if (actionMode === 'ask-agent') return;

      const lower = input.toLowerCase()

      if (lower === 'q') {
        handleQ()
        return
      }

      // Handle hotkeys based on CURRENT menu items
      if (lower && !key.return && !key.upArrow && !key.downArrow) {
        const item = menuItems.find(it => it.hotkey?.toLowerCase() === lower)
        if (item) {
          if (item.isSubmenu) {
            if (isMenuLevel(item.action)) {
              push(item.action)
            }
          } else {
            onSelectAction(item.action)
          }
          return
        }
      }

      if (key.upArrow) {
        setCursor(c => Math.max(0, c - 1))
      } else if (key.downArrow) {
        setCursor(c => Math.min(menuItems.length - 1, c + 1))
      } else if (key.return) {
        const item = menuItems[cursor]
        if (item) {
          if (item.isSubmenu) {
            if (isMenuLevel(item.action)) {
              push(item.action)
            }
          } else {
            onSelectAction(item.action)
          }
        }
      }
    },
    { isActive: isFocused && !isActionActive },
  )

  // Special case: Ask Agent opens a separate TUI session in the same panel
  if (actionMode === 'ask-agent') {
    return (
      <ChatPanel
        onExit={handleQ}
        isFocused={isFocused}
        width={width}
        height={height}
      />
    )
  }

  const pipelineSummary = isPipelineRunning
    ? `● Running  queued:${queueStats?.queued ?? 0}  done:${queueStats?.done ?? 0}  failed:${queueStats?.failed ?? 0}`
    : '○ Pipeline stopped'

  const getMenuTitle = (): string => {
    switch (currentLevel) {
      case 'epic-story-mgmt': return ' Epic & Story Management'
      case 'task-mgmt': return ' Task Management'
      case 'config': return ' Configuration'
      default: return ' Command Menu'
    }
  }

  return (
    <Box flexDirection="column" borderStyle="single" borderColor={isFocused ? 'cyan' : 'gray'} paddingX={1} height={height} overflow="hidden">
      <Box flexDirection="row" justifyContent="space-between">
        <Text bold wrap="truncate">{getMenuTitle()}</Text>
        {currentLevel !== 'main' && <Text dimColor> [Q] Back</Text>}
      </Box>
      <Text dimColor wrap="truncate">{pipelineSummary}</Text>
      <Box flexDirection="column" flexGrow={1} overflow="hidden" marginTop={1}>
        {menuItems.map((item, i) => {
          const indicator = item.isSubmenu ? ' ─►' : ''
          const hotkeyStr = item.hotkey ? `[${item.hotkey}] ` : ''

          if (i === cursor) {
            return (
              <Text key={item.action} color="cyan" bold wrap="truncate">{`> ${hotkeyStr}${item.label}${indicator}`}</Text>
            )
          }
          return (
            <Text key={item.action} wrap="truncate">{`  ${hotkeyStr}${item.label}${indicator}`}</Text>
          )
        })}
      </Box>
    </Box>
  )
}

export const CommandMenuPanel = React.memo(CommandMenuPanelInner);
