import { readFileSync, statSync } from 'node:fs'

import React, { useState, useEffect, useCallback, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { TextInput, Spinner } from '@inkjs/ui'

import { AgentKitError } from '@core/Errors.js'
import type {
  ComparisonResult,
  LoadResult,
} from '@core/LoadTypes.js'
import { findEpicFolders } from '@core/EpicDiscovery.js'
import { LoadSummaryTable } from '@ui/load/LoadSummaryTable.js'
import { DiffViewer } from '@ui/load/DiffViewer.js'
import { EpicSourceSelect } from '@ui/load/EpicSourceSelect.js'
import { useProjectId, useLoadService, useMarkdownParser } from '@ui/stores/appStore.js'

type WizardStep =
  | 'file_selection'
  | 'file_input'
  | 'loading'
  | 'summary'
  | 'diff'
  | 'saving'
  | 'done'

interface LoadWizardProps {
  filePath?: string
  isSimple: boolean
  onComplete: () => void
  onCancel: () => void
  compact?: boolean
}

export function LoadWizard({
  filePath: initialFilePath,
  isSimple,
  onComplete,
  onCancel,
  compact = false,
}: LoadWizardProps): React.JSX.Element {
  const projectId = useProjectId()
  const loadService = useLoadService()
  const markdownParser = useMarkdownParser()
  const [step, setStep] = useState<WizardStep>('loading')
  const [normalizedPath, setNormalizedPath] = useState('')
  const [comparison, setComparison] = useState<ComparisonResult | null>(null)
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null)
  const [error, setError] = useState('')

  const runComparison = useCallback(
    (filePath: string) => {
      try {
        const normalized = loadService.normalizePath(filePath)
        setNormalizedPath(normalized)
        const content = readFileSync(normalized, 'utf-8')
        const parsed = markdownParser.parseEpicsAndStories(content)
        const result = loadService.compareWithDatabase(projectId, parsed)
        setComparison(result)

        if (isSimple) {
          const { summary } = result
          console.log(`\nLoad Summary:`)
          for (const epic of result.epics) {
            console.log(`  Epic ${epic.epicKey}: ${epic.title} [${epic.status.toUpperCase()}]`)
            for (const story of epic.storyComparisons) {
              console.log(
                `    Story ${story.storyKey}: ${story.title} [${story.status.toUpperCase()}]`
              )
            }
          }
          console.log(
            `\nEpics: ${summary.newEpics} new, ${summary.updatedEpics} updated, ${summary.skippedEpics} skipped`
          )
          console.log(
            `Stories: ${summary.newStories} new, ${summary.updatedStories} updated, ${summary.skippedStories} skipped\n`
          )
          setStep('saving')
        } else {
          setStep('summary')
        }
      } catch (err: unknown) {
        if (err instanceof AgentKitError) {
          setError(err.message)
          // Safe: 'code' in err guard confirms ErrnoException shape
        } else if (
          err instanceof Error &&
          'code' in err &&
          (err as NodeJS.ErrnoException).code === 'ENOENT'
        ) {
          setError(`File not found: ${filePath}`)
        } else {
          setError(err instanceof Error ? err.message : String(err))
        }
        setStep('done')
      }
    },
    [loadService, markdownParser, projectId, isSimple]
  )

  const resetToFileSelection = useCallback(() => {
    setStep('file_selection')
    setComparison(null)
    setLoadResult(null)
    setError('')
    setNormalizedPath('')
  }, [])

  const runAllFoldersComparison = useCallback(() => {
    try {
      setStep('loading')
      const folders = findEpicFolders(process.cwd())
      if (folders.length === 0) {
        setError('No epic folders found in current directory')
        setStep('done')
        return
      }
      const mergedEpics = folders.flatMap((folder, i) => {
        const parsed = markdownParser.parseEpicFolder(folder.folderPath)
        return parsed.epics.map(epic => ({ ...epic, orderIndex: epic.orderIndex + i * 1000 }))
      })
      const merged = { epics: mergedEpics }
      const result = loadService.compareWithDatabase(projectId, merged)
      setComparison(result)
      setNormalizedPath(`(${folders.length} epic folders)`)
      if (isSimple) {
        setStep('saving')
      } else {
        setStep('summary')
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('done')
    }
  }, [loadService, markdownParser, projectId, isSimple])

  const runFolderComparison = useCallback(
    (folderPath: string) => {
      try {
        setNormalizedPath(folderPath)
        const parsed = markdownParser.parseEpicFolder(folderPath)
        const result = loadService.compareWithDatabase(projectId, parsed)
        setComparison(result)

        if (isSimple) {
          const { summary } = result
          console.log(`\nLoad Summary:`)
          for (const epic of result.epics) {
            console.log(`  Epic ${epic.epicKey}: ${epic.title} [${epic.status.toUpperCase()}]`)
            for (const story of epic.storyComparisons) {
              console.log(
                `    Story ${story.storyKey}: ${story.title} [${story.status.toUpperCase()}]`
              )
            }
          }
          console.log(
            `\nEpics: ${summary.newEpics} new, ${summary.updatedEpics} updated, ${summary.skippedEpics} skipped`
          )
          console.log(
            `Stories: ${summary.newStories} new, ${summary.updatedStories} updated, ${summary.skippedStories} skipped\n`
          )
          setStep('saving')
        } else {
          setStep('summary')
        }
      } catch (err: unknown) {
        if (err instanceof AgentKitError) {
          setError(err.message)
        } else {
          setError(err instanceof Error ? err.message : String(err))
        }
        setStep('done')
      }
    },
    [loadService, markdownParser, projectId, isSimple]
  )

  const initRan = useRef(false)
  useEffect(() => {
    if (initRan.current) return
    initRan.current = true

    if (initialFilePath) {
      try {
        const isDir = statSync(initialFilePath).isDirectory()
        if (isDir) {
          runFolderComparison(initialFilePath)
        } else {
          runComparison(initialFilePath)
        }
      } catch {
        runComparison(initialFilePath)
      }
    } else {
      setStep('file_selection')
    }
  }, [initialFilePath, runComparison, runFolderComparison])

  useEffect(() => {
    if (step === 'saving' && comparison) {
      try {
        const result = loadService.saveToDatabase(projectId, comparison, normalizedPath)
        setLoadResult(result)
        setStep('done')
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : String(err))
        setStep('done')
      }
    }
  }, [step, comparison, loadService, projectId, normalizedPath])

  useInput(
    (_input, _key) => {
      // Esc disabled
    },
    { isActive: step === 'file_input' }
  )

  useInput(
    (input, _key) => {
      if (step === 'summary') {
        if (input.toLowerCase() === 'y') {
          setStep('saving')
        } else if (input.toLowerCase() === 'n') {
          onCancel()
        } else if (input.toLowerCase() === 'd' && comparison) {
          const hasUpdated = comparison.summary.updatedStories > 0
          if (hasUpdated) {
            setStep('diff')
          }
        }
      }
      if (step === 'done') {
        if (input.toLowerCase() === 'q') {
          onComplete()
        } else {
          resetToFileSelection()
        }
      }
    },
    { isActive: step === 'summary' || step === 'done' }
  )

  return (
    <Box flexDirection="column" padding={compact ? 0 : 1}>
      {step === 'file_selection' && (
        <EpicSourceSelect
          onSelectFolder={p => {
            setStep('loading')
            runFolderComparison(p)
          }}
          onSelectFile={p => {
            setStep('loading')
            runComparison(p)
          }}
          onLoadAll={runAllFoldersComparison}
          onManualEntry={() => setStep('file_input')}
          onCancel={onCancel}
        />
      )}

      {step === 'file_input' && (
        <Box flexDirection="column">
          <Text bold color="cyan">
            Enter path to markdown file:
          </Text>
          <TextInput
            placeholder="path/to/epics.md"
            onSubmit={(value: string) => {
              setStep('loading')
              runComparison(value)
            }}
          />
        </Box>
      )}

      {step === 'loading' && (
        <Box gap={1}>
          <Spinner label="Parsing and comparing..." />
        </Box>
      )}

      {step === 'summary' && comparison && (
        <Box flexDirection="column">
          <LoadSummaryTable comparison={comparison} />
          <Box marginTop={1}>
            <Text>
              [Y] Confirm [N] Cancel
              {comparison.summary.updatedStories > 0 ? '  [D] View diff' : ''}
            </Text>
          </Box>
        </Box>
      )}

      {step === 'diff' && comparison && (
        <DiffViewer
          storyComparisons={comparison.epics
            .flatMap(e => e.storyComparisons)
            .filter(s => s.status === 'updated')}
          onClose={() => setStep('summary')}
        />
      )}

      {step === 'saving' && (
        <Box gap={1}>
          <Spinner label="Saving to database..." />
        </Box>
      )}

      {step === 'done' && error && (
        <Box flexDirection="column">
          <Text color="red">Error: {error}</Text>
          <Text color="gray">[Q] Exit  [any key] Load another</Text>
        </Box>
      )}

      {step === 'done' && loadResult && (
        <Box flexDirection="column">
          <Text bold color="green">
            Load complete!
          </Text>
          <Text>
            Inserted: {loadResult.insertedEpics} epics, {loadResult.insertedStories} stories
          </Text>
          <Text>
            Updated: {loadResult.updatedEpics} epics, {loadResult.updatedStories} stories
          </Text>
          <Text color="gray">[Q] Exit  [any key] Load another</Text>
        </Box>
      )}
    </Box>
  )
}
