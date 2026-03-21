import React, { useState, useEffect, useRef } from 'react'
import { Box, Text, useInput } from 'ink'
import { Select } from '@inkjs/ui'

import type { EpicFolderInfo } from '@core/LoadTypes.js'
import { findEpicFolders, findEpicFiles } from '@core/EpicDiscovery.js'

interface EpicSourceSelectProps {
  onSelectFolder: (path: string) => void
  onSelectFile: (path: string) => void
  onLoadAll: (folderPaths: string[]) => void
  onManualEntry: () => void
  onCancel: () => void
}

export function EpicSourceSelect({
  onSelectFolder,
  onSelectFile,
  onLoadAll,
  onManualEntry,
}: EpicSourceSelectProps): React.JSX.Element {
  const [discoveredFolders, setDiscoveredFolders] = useState<EpicFolderInfo[]>([])
  const [discoveredFiles, setDiscoveredFiles] = useState<string[]>([])
  const initRan = useRef(false)

  useEffect(() => {
    if (initRan.current) return
    initRan.current = true
    setDiscoveredFolders(findEpicFolders(process.cwd()))
    setDiscoveredFiles(findEpicFiles(process.cwd()))
  }, [])

  useInput((input, _key) => {
    // Esc disabled; A = load all
    if ((input === 'a' || input === 'A') && discoveredFolders.length > 0) {
      onLoadAll(discoveredFolders.map(f => f.folderPath))
    }
  })

  return (
    <Box flexDirection="column">
      <Text bold color="cyan">
        Select an epic source to load:
      </Text>
      <Box marginTop={1} flexDirection="column">
        <Select
          visibleOptionCount={12}
          options={[
            ...(discoveredFolders.length > 0
              ? [
                  { label: `📦 [A] Load All Folders (${discoveredFolders.length} epics)`, value: '__load_all__' },
                  { label: '📁 Epic Folders:', value: '__sep_folders__' },
                  ...discoveredFolders.map(f => ({
                    label: `epic-${f.epicNumber}: ${f.title} (${f.storyCount} stories)`,
                    value: f.folderPath,
                  })),
                ]
              : []),
            ...(discoveredFiles.length > 0
              ? [
                  { label: '📄 Epic Files:', value: '__sep_files__' },
                  ...discoveredFiles.map(f => ({
                    label: f.replace(process.cwd() + '/', ''),
                    value: f,
                  })),
                ]
              : []),
            { label: '⌨️  Manual entry...', value: '__manual__' },
          ]}
          onChange={(value: string) => {
            if (value === '__sep_folders__' || value === '__sep_files__') return
            if (value === '__load_all__') {
              onLoadAll(discoveredFolders.map(f => f.folderPath))
            } else if (value === '__manual__') {
              onManualEntry()
            } else if (discoveredFolders.some(f => f.folderPath === value)) {
              onSelectFolder(value)
            } else {
              onSelectFile(value)
            }
          }}
        />
      </Box>
    </Box>
  )
}
