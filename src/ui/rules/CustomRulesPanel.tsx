import React, { useState, useCallback } from 'react'
import { Box, Text, useInput } from 'ink'

import { RulesService } from '@core/RulesService.js'
import type { RuleFile } from '@core/RulesTypes.js'

interface CustomRulesPanelProps {
  onBack: () => void
  compact?: boolean
}

export function CustomRulesPanel({
  onBack,
}: CustomRulesPanelProps): React.JSX.Element {
  const projectRoot = process.cwd()
  const service = new RulesService(projectRoot)

  const [rules, setRules] = useState<RuleFile[]>(() => service.listRules())
  const [cursor, setCursor] = useState(0)

  const refresh = useCallback(() => {
    setRules(service.listRules())
  }, [service])

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor(c => Math.max(0, c - 1))
    } else if (key.downArrow) {
      setCursor(c => Math.min(rules.length - 1, c + 1))
    } else if (input === ' ' && rules.length > 0) {
      const rule = rules[cursor]
      if (rule) {
        service.toggleRule(rule.name)
        refresh()
      }
    } else if (input.toLowerCase() === 'q') {
      onBack()
    }
  })

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold>Custom Rules</Text>
      <Text dimColor>Files in _agentkit-output/rules/*.md</Text>
      <Text> </Text>

      {rules.length === 0 ? (
        <Box flexDirection="column">
          <Text color="gray">No rule files found.</Text>
          <Text> </Text>
          <Text>Create .md files in:</Text>
          <Text bold color="cyan">  _agentkit-output/rules/</Text>
          <Text> </Text>
          <Text dimColor>Example:</Text>
          <Text dimColor>  _agentkit-output/rules/no-any-types.md</Text>
          <Text dimColor>  _agentkit-output/rules/naming-conventions.md</Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {rules.map((rule, i) => (
            <Text
              key={rule.name}
              color={i === cursor ? 'cyan' : undefined}
              bold={i === cursor}
            >
              {i === cursor ? '> ' : '  '}
              [{rule.enabled ? 'x' : ' '}] {rule.name}
            </Text>
          ))}
        </Box>
      )}

      <Text> </Text>
      <Text dimColor>
        {rules.length > 0
          ? '[Space] Toggle  [Q] Back'
          : '[Q] Back'}
      </Text>
    </Box>
  )
}
