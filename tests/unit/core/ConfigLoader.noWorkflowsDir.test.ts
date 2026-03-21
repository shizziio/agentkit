/**
 * Tests verifying that ensureCoreWorkflowsDir() has been removed from ConfigLoader
 * and that load() no longer creates any directories as a side effect.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, writeFileSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'

import { ConfigLoader } from '../../../src/core/ConfigLoader.js'

const mockResourcePath = vi.hoisted(() => ({ teamsDir: '' }))

vi.mock('@shared/ResourcePath.js', () => ({
  getBundledTeamsDir: () => mockResourcePath.teamsDir,
  getBundledTeamDir: (name: string) => `${mockResourcePath.teamsDir}/${name}`,
  getBundledWorkflowPath: (name: string) =>
    `${mockResourcePath.teamsDir}/../workflows/${name}.md`,
}))

function createTempDir(): string {
  const dir = join(tmpdir(), `agentkit-nowf-test-${randomUUID()}`)
  mkdirSync(dir, { recursive: true })
  return dir
}

function writeJson(filePath: string, data: Record<string, unknown>): void {
  mkdirSync(join(filePath, '..'), { recursive: true })
  writeFileSync(filePath, JSON.stringify(data, null, 2))
}

function writeTeamConfig(
  teamsDir: string,
  teamName: string,
  config: Record<string, unknown>,
): void {
  const teamDir = join(teamsDir, teamName)
  mkdirSync(teamDir, { recursive: true })
  writeFileSync(join(teamDir, 'config.json'), JSON.stringify(config))
}

function makeProjectConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    version: 2,
    project: { name: 'test-project' },
    activeTeam: 'agentkit',
    teams: ['agentkit'],
    provider: 'claude-cli',
    models: {},
    ...overrides,
  }
}
function makeTeamConfig(overrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    team: 'agentkit',
    displayName: 'Software Development Pipeline',
    version: 1,
    models: {
      'claude-cli': {
        allowed: ['opus', 'sonnet', 'haiku'],
        defaults: { sm: 'sonnet', dev: 'sonnet', review: 'sonnet', tester: 'haiku' },
      },
    },
    stages: [
      {
        name: 'sm',
        displayName: 'SM',
        icon: '📋',
        prompt: './prompts/sm.md',
        timeout: 300,
        workers: 1,
        retries: 0,
        next: 'dev',
      },
      {
        name: 'dev',
        displayName: 'Dev',
        icon: '💻',
        prompt: './prompts/dev.md',
        timeout: 600,
        workers: 1,
        retries: 0,
        // terminal stage — no next
      },
    ],
    ...overrides,
  }
}

describe('ConfigLoader — ensureCoreWorkflowsDir removal', () => {
  let projectRoot: string
  let teamsDir: string

  beforeEach(() => {
    projectRoot = createTempDir()
    teamsDir = createTempDir()
    mockResourcePath.teamsDir = teamsDir
  })

  afterEach(() => {
    rmSync(projectRoot, { recursive: true, force: true })
    rmSync(teamsDir, { recursive: true, force: true })
  })

  describe('method removal', () => {
    it('ensureCoreWorkflowsDir does not exist on ConfigLoader instance', () => {
      const loader = new ConfigLoader(projectRoot)
      expect(
        (loader as unknown as Record<string, unknown>)['ensureCoreWorkflowsDir'],
      ).toBeUndefined()
    })

    it('ConfigLoader prototype does not have ensureCoreWorkflowsDir', () => {
      expect(
        Object.getOwnPropertyDescriptor(ConfigLoader.prototype, 'ensureCoreWorkflowsDir'),
      ).toBeUndefined()
    })
  })

  describe('load() does not create directories as a side effect', () => {
    it('does not create _agent_kit/core/workflows directory when load() succeeds', () => {
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), makeProjectConfig())
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig())

      const loader = new ConfigLoader(projectRoot)
      loader.load()

      const workflowsDir = join(projectRoot, '_agent_kit', 'core', 'workflows')
      expect(existsSync(workflowsDir)).toBe(false)
    })

    it('does not create _agent_kit/core directory when load() succeeds', () => {
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), makeProjectConfig())
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig())

      const loader = new ConfigLoader(projectRoot)
      loader.load()

      const coreDir = join(projectRoot, '_agent_kit', 'core')
      expect(existsSync(coreDir)).toBe(false)
    })

    it('does not create any unexpected directories beyond _agent_kit/ when load() runs', () => {
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), makeProjectConfig())
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig())

      const loader = new ConfigLoader(projectRoot)
      loader.load()

      // Only _agent_kit/ dir should exist (created by writeJson above), no subdirs besides it
      const unexpectedDirs = ['_agent_kit/core', '_agent_kit/core/workflows', '_agent_kit/teams'].filter(
        (d) => existsSync(join(projectRoot, d)),
      )
      expect(unexpectedDirs).toEqual([])
    })

    it('does not attempt to create directories even when load() throws ConfigError', () => {
      // activeTeam not in teams — load() throws before doing anything else
      writeJson(
        join(projectRoot, '_agent_kit', 'agentkit.config.json'),
        makeProjectConfig({ activeTeam: 'ghost', teams: ['agentkit'] }),
      )

      const loader = new ConfigLoader(projectRoot)
      expect(() => loader.load()).toThrow()

      const workflowsDir = join(projectRoot, '_agent_kit', 'core', 'workflows')
      expect(existsSync(workflowsDir)).toBe(false)
    })
  })

  describe('load() still works correctly after method removal (regression)', () => {
    it('returns PipelineConfig with team, stages, and models', () => {
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), makeProjectConfig())
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig())

      const loader = new ConfigLoader(projectRoot)
      const config = loader.load()

      expect(config.team).toBe('agentkit')
      expect(config.displayName).toBe('Software Development Pipeline')
      expect(config.stages).toHaveLength(2)
      expect(config.stages[0].name).toBe('sm')
      expect(config.stages[1].name).toBe('dev')
    })

    it('load() resolves bundled team config when no local override exists', () => {
      writeJson(join(projectRoot, '_agent_kit', 'agentkit.config.json'), makeProjectConfig())
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig())

      const loader = new ConfigLoader(projectRoot)
      const config = loader.load()

      expect(config.team).toBe('agentkit')
      expect(config.provider).toBe('claude-cli')
    })

    it('load() merges project-level model overrides into resolved models', () => {
      writeJson(
        join(projectRoot, '_agent_kit', 'agentkit.config.json'),
        makeProjectConfig({ models: { 'claude-cli': { sm: 'opus', dev: 'haiku' } } }),
      )
      writeTeamConfig(teamsDir, 'agentkit', makeTeamConfig())

      const loader = new ConfigLoader(projectRoot)
      const config = loader.load()

      expect(config.models.resolved['sm']).toBe('opus')
      expect(config.models.resolved['dev']).toBe('haiku')
    })
  })
})
