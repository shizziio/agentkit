import React from 'react';
import { Box, Text } from 'ink';
import type { RobotEntry, RobotState } from './CrewTypes.js';

interface RobotCharProps {
  robot: RobotEntry;
  isOrchestrator?: boolean;
  dimmed?: boolean;
}

const STATE_MAPPING: Record<RobotState, { icon: string; color: string; bold?: boolean }> = {
  idle: { icon: '○', color: 'gray' },
  queued: { icon: '◎', color: 'yellow' },
  running: { icon: '◉', color: 'green', bold: true },
  done: { icon: '✓', color: 'cyan' },
  error: { icon: '✗', color: 'red', bold: true },
};

export function RobotChar({ robot, isOrchestrator = false, dimmed = false }: RobotCharProps): React.JSX.Element {
  const stateInfo = STATE_MAPPING[robot.state] || STATE_MAPPING.idle;
  
  let headIcon = stateInfo.icon;
  if (robot.state === 'running' && robot.blinkPhase) {
    headIcon = '◎';
  }

  const color = dimmed ? 'gray' : stateInfo.color;
  const bold = dimmed ? false : !!stateInfo.bold;
  const dimColor = dimmed;

  const topFrame = isOrchestrator ? '╔═══╗' : '┌───┐';
  const bottomFrame = isOrchestrator ? '╚═╦═╝' : '└─┬─┘';
  const sideChar = isOrchestrator ? '║' : '│';

  // SM Plan: Ensure the display name is truncated and centered below the robot frame to maintain ASCII alignment.
  // Edge Case: Display names longer than 5 characters: Must be truncated to ensure the 5-column ASCII grid is not broken.
  const rawName = robot.displayName || '';
  const truncatedName = rawName.length > 5 ? rawName.slice(0, 5) : rawName;
  
  // Center padding for 5-char wide label area
  const padding = Math.max(0, 5 - truncatedName.length);
  const leftPadding = Math.floor(padding / 2);
  const rightPadding = padding - leftPadding;
  const paddedName = ' '.repeat(leftPadding) + truncatedName + ' '.repeat(rightPadding);

  return (
    <Box flexDirection="column" alignItems="center" width={5}>
      <Text color={color} dimColor={dimColor}>{topFrame}</Text>
      <Box flexDirection="row">
        <Text color={color} dimColor={dimColor}>{sideChar}</Text>
        <Text color={color} bold={bold} dimColor={dimColor}>{` ${headIcon} `}</Text>
        <Text color={color} dimColor={dimColor}>{sideChar}</Text>
      </Box>
      <Box flexDirection="row">
        <Text color={color} dimColor={dimColor}>{sideChar}</Text>
        <Text color={color} dimColor={dimColor}>/█\</Text>
        <Text color={color} dimColor={dimColor}>{sideChar}</Text>
      </Box>
      <Text color={color} dimColor={dimColor}>{bottomFrame}</Text>
      <Text color={color} dimColor={dimColor} wrap="truncate">{paddedName}</Text>
    </Box>
  );
}
