import React from 'react'
import { Box } from 'ink'

import { useDashboardStore } from '@ui/stores/dashboardStore.js'
import { CommandMenuPanel } from './CommandMenuPanel.js'
import { ActionRouter } from './ActionRouter.js'
import { ChatPanel } from '@ui/chat/ChatPanel.js'
import { useMenuStore } from '@ui/stores/menuStore.js'

interface TLPanelProps {
  width: number
  height: number
}

/**
 * TLPanel — the top-left panel that switches between:
 * - CommandMenuPanel (idle state)
 * - ActionRouter (active wizard/modal)
 * - ChatPanel (ask-agent mode)
 *
 * Subscribes only to dashboardStore.actionMode for display toggle.
 * Both branches always mounted via display toggle — no tree structure change.
 */
function TLPanelInner({ width, height }: TLPanelProps): React.JSX.Element {
  const actionMode = useDashboardStore(s => s.actionMode)
  const isIdle = actionMode === 'none'
  const isChat = actionMode === 'ask-agent'

  return (
    <Box flexDirection="column" height={height} overflow="hidden">
      {isChat ? (
        <ChatPanel
          onExit={() => useMenuStore.getState().handleQ()}
          isFocused={true}
          width={width}
          height={height}
        />
      ) : isIdle ? (
        <CommandMenuPanel
          width={width}
          height={height}
        />
      ) : (
        <ActionRouter />
      )}
    </Box>
  )
}

export const TLPanel = React.memo(TLPanelInner)
