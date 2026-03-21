import React, { useState, useCallback } from 'react'
import { Box, Text, useInput, useApp } from 'ink'
import { TextInput, Spinner } from '@inkjs/ui'

import { execSync } from 'node:child_process'

import type { InitOptions, InitResult } from '@core/InitService.js'
import { AGENTKIT_DIR, DEFAULT_PROVIDER } from '@config/defaults.js'

const PROVIDER_CLI_MAP: Record<string, { bin: string; installHint: string }> = {
  'claude-cli': {
    bin: 'claude',
    installHint: 'npm install -g @anthropic-ai/claude-code',
  },
  'gemini-cli': {
    bin: 'gemini',
    installHint: 'npm install -g @google/gemini-cli',
  },
  'codex-cli': {
    bin: 'codex',
    installHint: 'npm install -g @openai/codex',
  },
}

function isCliInstalled(bin: string): boolean {
  try {
    execSync(`which ${bin}`, { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

type WizardStep =
  | 'welcome'
  | 'project_name'
  | 'owner'
  | 'provider_select'
  | 'provider_check'
  | 'confirm'
  | 'overwrite_confirm'
  | 'scaffolding'
  | 'done'

interface InitWizardProps {
  version: string
  directoryExists: boolean
  onScaffold: (options: InitOptions) => Promise<InitResult>
  onComplete: () => void
}

export function InitWizard({
  version,
  directoryExists,
  onScaffold,
  onComplete,
}: InitWizardProps): React.JSX.Element {
  const { exit } = useApp()
  const [step, setStep] = useState<WizardStep>(directoryExists ? 'overwrite_confirm' : 'welcome')
  const [projectName, setProjectName] = useState('')
  const [owner, setOwner] = useState('')
  const [provider, setProvider] = useState(DEFAULT_PROVIDER)
  const availableProviders = ['claude-cli', 'gemini-cli']
  const [providerCursor, setProviderCursor] = useState(availableProviders.indexOf(DEFAULT_PROVIDER))
  const [, setProviderMissing] = useState(false)
  const [nameError, setNameError] = useState('')
  const [result, setResult] = useState<InitResult | null>(null)
  const [scaffoldError, setScaffoldError] = useState('')

  const handleScaffold = useCallback(
    async (opts: InitOptions) => {
      setStep('scaffolding')
      try {
        const res = await onScaffold(opts)
        setResult(res)
        setStep('done')
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err)
        setScaffoldError(msg)
        setStep('done')
      }
    },
    [onScaffold]
  )

  useInput(
    input => {
      if (step === 'overwrite_confirm') {
        if (input.toLowerCase() === 'y') setStep('welcome')
        else if (input.toLowerCase() === 'n') { onComplete(); exit() }
      }
    },
    { isActive: step === 'overwrite_confirm' }
  )

  useInput(() => { if (step === 'welcome') setStep('project_name') }, { isActive: step === 'welcome' })

  useInput(
    (_input, key) => {
      if (step === 'provider_select') {
        if (key.upArrow) setProviderCursor(c => Math.max(0, c - 1))
        else if (key.downArrow) setProviderCursor(c => Math.min(availableProviders.length - 1, c + 1))
        else if (key.return) {
          const selected = availableProviders[providerCursor]!
          setProvider(selected)
          const info = PROVIDER_CLI_MAP[selected]
          if (info && !isCliInstalled(info.bin)) {
            setProviderMissing(true)
            setStep('provider_check')
          } else {
            setProviderMissing(false)
            setStep('confirm')
          }
        }
      }
    },
    { isActive: step === 'provider_select' }
  )

  useInput(
    input => {
      if (step === 'provider_check') {
        if (input.toLowerCase() === 'y') {
          const info = PROVIDER_CLI_MAP[provider]
          if (info && isCliInstalled(info.bin)) { setProviderMissing(false); setStep('confirm') }
        } else if (input.toLowerCase() === 'b') {
          setStep('provider_select')
        } else if (input.toLowerCase() === 's') {
          setProviderMissing(false)
          setStep('confirm')
        }
      }
    },
    { isActive: step === 'provider_check' }
  )

  useInput(
    (_input, key) => {
      if (step === 'confirm' && key.return) {
        void handleScaffold({
          projectPath: process.cwd(),
          projectName,
          owner: owner || undefined,
          provider,
        })
      }
    },
    { isActive: step === 'confirm' }
  )

  useInput(() => { if (step === 'done') { onComplete(); exit() } }, { isActive: step === 'done' })

  return (
    <Box flexDirection="column" padding={1}>
      {step === 'overwrite_confirm' && (
        <Text color="yellow">Directory {AGENTKIT_DIR}/ already exists. Overwrite? [Y/N]</Text>
      )}

      {step === 'welcome' && (
        <Box flexDirection="column">
          <Text bold color="cyan">@shizziio/agent-kit</Text>
          <Text color="gray">v{version}</Text>
          <Text>{''}</Text>
          <Text>Press any key to continue...</Text>
        </Box>
      )}

      {step === 'project_name' && (
        <Box flexDirection="column">
          <Text bold>Project Name (required):</Text>
          {nameError && <Text color="red">{nameError}</Text>}
          <TextInput
            placeholder="my-project"
            onSubmit={(value: string) => {
              if (!value.trim()) { setNameError('Project name cannot be empty'); return }
              setNameError('')
              setProjectName(value.trim())
              setStep('owner')
            }}
          />
        </Box>
      )}

      {step === 'owner' && (
        <Box flexDirection="column">
          <Text bold>Owner (optional, press Enter to skip):</Text>
          <TextInput
            placeholder=""
            onSubmit={(value: string) => {
              setOwner(value.trim())
              setStep('provider_select')
            }}
          />
        </Box>
      )}

      {step === 'provider_select' && (
        <Box flexDirection="column">
          <Text bold>Select Provider:</Text>
          {availableProviders.map((p, i) => (
            <Text key={p} color={i === providerCursor ? 'cyan' : undefined} bold={i === providerCursor}>
              {i === providerCursor ? '> ' : '  '}{p}
            </Text>
          ))}
          <Text color="gray">[↑↓] Navigate [Enter] Select</Text>
        </Box>
      )}

      {step === 'provider_check' && (
        <Box flexDirection="column">
          <Text color="yellow" bold>CLI not found: `{PROVIDER_CLI_MAP[provider]?.bin}`</Text>
          <Text>{''}</Text>
          <Text>Install it with:</Text>
          <Text color="cyan">  {PROVIDER_CLI_MAP[provider]?.installHint}</Text>
          <Text>{''}</Text>
          <Text>[Y] Check again  [B] Back  [S] Skip</Text>
        </Box>
      )}

      {step === 'confirm' && (
        <Box flexDirection="column">
          <Text bold>Summary:</Text>
          <Text>  Project: {projectName}</Text>
          {owner && <Text>  Owner: {owner}</Text>}
          <Text>  Provider: {provider}</Text>
          <Text>{''}</Text>
          <Text dimColor>Teams will be configured after init via `agentkit start` setup flow.</Text>
          <Text>{''}</Text>
          <Text>Press Enter to create project...</Text>
        </Box>
      )}

      {step === 'scaffolding' && (
        <Box gap={1}><Spinner label="Creating project..." /></Box>
      )}

      {step === 'done' && scaffoldError && (
        <Text color="red">Error: {scaffoldError}</Text>
      )}

      {step === 'done' && result && (
        <Box flexDirection="column">
          <Text bold color="green">Project initialized!</Text>
          <Text>{''}</Text>
          <Text bold>Created:</Text>
          <Text>  {AGENTKIT_DIR}/agentkit.config.json</Text>
          <Text>  {AGENTKIT_DIR}/agentkit.db</Text>
          <Text>  {AGENTKIT_DIR}/resources/</Text>
          <Text>{''}</Text>
          <Text bold>Next step:</Text>
          <Text>  Run <Text bold color="cyan">agentkit start</Text> to setup docs, team, and plan epics.</Text>
          <Text>{''}</Text>
          <Text color="gray">Press any key to exit...</Text>
        </Box>
      )}
    </Box>
  )
}
