import { writeFileSync } from 'node:fs'

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { eq } from 'drizzle-orm'

import { createConnection, type DrizzleDB } from '@core/db/Connection'
import { runMigrations } from '@core/db/RunMigrations'
import { projects } from '@core/db/schema'
import { TeamSwitchService, type PipelineRef } from '@core/TeamSwitchService'
import { TeamSwitchError, ConfigError } from '@core/Errors'
import { eventBus } from '@core/EventBus'
import { ConfigLoader } from '@core/ConfigLoader'
import type { ProjectConfig, TeamConfig } from '@core/ConfigTypes'

// Mock node:fs — keep all real functions, only stub writeFileSync
vi.mock('node:fs', async (importOriginal) => {
  const mod = await importOriginal<typeof import('node:fs')>()
  return { ...mod, writeFileSync: vi.fn() }
})

const BASE_PROJECT_CONFIG: ProjectConfig = {
  version: 2,
  project: { name: 'test-project' },
  activeTeam: 'agentkit',
  teams: ['agentkit'],
  provider: 'claude-cli',
  models: {},
}

const MINIMAL_TEAM_CONFIG: TeamConfig = {
  team: 'content-writing',
  displayName: 'Content Writing',
  version: 1,
  models: { 'claude-cli': { allowed: [], defaults: {} } },
  stages: [],
}

describe('TeamSwitchService', () => {
  let db: DrizzleDB
  let service: TeamSwitchService
  let emitSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    db = createConnection(':memory:')
    runMigrations(db)
    db.insert(projects).values({ projectName: 'test-project' }).run()
    service = new TeamSwitchService(db, '/fake/root')

    emitSpy = vi.spyOn(eventBus, 'emit')
    vi.spyOn(ConfigLoader.prototype, 'loadProjectConfig').mockReturnValue(BASE_PROJECT_CONFIG)
    vi.spyOn(ConfigLoader.prototype, 'loadTeamConfig').mockReturnValue(MINIMAL_TEAM_CONFIG)
    vi.mocked(writeFileSync).mockClear()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  // --- 4a: no-op when switching to same team ---
  describe('no-op when fromTeam === toTeam', () => {
    it('returns without writing or emitting when switching to active team', async () => {
      await service.switchTeam('agentkit') // same as activeTeam in BASE_PROJECT_CONFIG

      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
      expect(emitSpy).not.toHaveBeenCalledWith('team:switched', expect.anything())
    })
  })

  // --- 4b: block when pipeline is running ---
  describe('blocks switch when pipeline is running', () => {
    it('throws TeamSwitchError and does not write file', async () => {
      const pipeline: PipelineRef = { isRunning: () => true }

      await expect(service.switchTeam('content-writing', pipeline)).rejects.toThrow(TeamSwitchError)
      await expect(service.switchTeam('content-writing', pipeline)).rejects.toThrow(
        'Workers dang chay'
      )
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
    })
  })

  // --- 4c: throw TeamSwitchError for nonexistent team ---
  describe('throws for nonexistent team', () => {
    it("throws TeamSwitchError with 'khong ton tai' when team config not found", async () => {
      vi.spyOn(ConfigLoader.prototype, 'loadTeamConfig').mockImplementation(() => {
        throw new ConfigError('Team config not found: nonexistent')
      })

      await expect(service.switchTeam('nonexistent')).rejects.toThrow(TeamSwitchError)
      await expect(service.switchTeam('nonexistent')).rejects.toThrow(
        "Team 'nonexistent' khong ton tai."
      )
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
    })
  })

  // --- 4d: re-throw non-not-found ConfigError ---
  describe('re-throws validation ConfigError without wrapping', () => {
    it('re-throws ConfigError as-is and does not write file (rollback guard)', async () => {
      const validationError = new ConfigError('Invalid stage config: missing required field X')
      vi.spyOn(ConfigLoader.prototype, 'loadTeamConfig').mockImplementation(() => {
        throw validationError
      })

      await expect(service.switchTeam('content-writing')).rejects.toThrow(ConfigError)
      await expect(service.switchTeam('content-writing')).rejects.toThrow(
        'Invalid stage config: missing required field X'
      )
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
    })
  })

  // --- 4e: success path ---
  describe('success path', () => {
    it('writes config file with correct fields', async () => {
      await service.switchTeam('content-writing')

      expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(1)

      const [, rawContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string, string]
      const written = JSON.parse(rawContent) as ProjectConfig

      expect(written.activeTeam).toBe('content-writing')
      expect(written.models).toEqual({})
      expect(written.version).toBe(2)
    })

    it('updates DB projects row with new activeTeam', async () => {
      await service.switchTeam('content-writing')

      const row = db
        .select({ activeTeam: projects.activeTeam })
        .from(projects)
        .where(eq(projects.projectName, 'test-project'))
        .get()

      expect(row?.activeTeam).toBe('content-writing')
    })

    it('increments version in DB projects row on switch', async () => {
      const before = db
        .select({ version: projects.version })
        .from(projects)
        .where(eq(projects.projectName, 'test-project'))
        .get()

      await service.switchTeam('content-writing')

      const after = db
        .select({ version: projects.version })
        .from(projects)
        .where(eq(projects.projectName, 'test-project'))
        .get()

      expect(after?.version).toBe((before?.version ?? 1) + 1)
    })

    it("emits 'team:switched' event with from/to", async () => {
      await service.switchTeam('content-writing')

      expect(emitSpy).toHaveBeenCalledWith('team:switched', {
        from: 'agentkit',
        to: 'content-writing',
      })
    })
  })

  // --- 4f: teams[] always includes toTeam ---
  describe('teams[] updated to always include toTeam', () => {
    it('adds toTeam to teams[] when not already present', async () => {
      await service.switchTeam('content-writing')

      const [, rawContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string, string]
      const written = JSON.parse(rawContent) as ProjectConfig

      expect(written.teams).toContain('agentkit')
      expect(written.teams).toContain('content-writing')
    })

    it('does not duplicate toTeam when already in teams[]', async () => {
      vi.spyOn(ConfigLoader.prototype, 'loadProjectConfig').mockReturnValue({
        ...BASE_PROJECT_CONFIG,
        teams: ['agentkit', 'content-writing'],
      })

      await service.switchTeam('content-writing')

      const [, rawContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string, string]
      const written = JSON.parse(rawContent) as ProjectConfig

      const count = written.teams.filter((t: string) => t === 'content-writing').length
      expect(count).toBe(1)
    })

    it('preserves existing teams and adds new one (v1-normalized config)', async () => {
      vi.spyOn(ConfigLoader.prototype, 'loadProjectConfig').mockReturnValue({
        version: 2,
        project: { name: 'test-project' },
        activeTeam: 'agentkit',
        teams: ['agentkit'],
        provider: 'claude-cli',
        models: {},
      })

      await service.switchTeam('content-writing')

      const [, rawContent] = vi.mocked(writeFileSync).mock.calls[0] as [string, string, string]
      const written = JSON.parse(rawContent) as ProjectConfig

      expect(written.version).toBe(2)
      expect(written.teams).toEqual(['agentkit', 'content-writing'])
    })
  })

  // --- 4g: mutex serializes concurrent calls ---
  describe('mutex serializes concurrent calls', () => {
    it('both concurrent switchTeam calls complete without error', async () => {
      const first = service.switchTeam('content-writing')
      const second = service.switchTeam('content-writing')

      await expect(Promise.all([first, second])).resolves.not.toThrow()
    })

    it('writeFileSync is called for each serialized call', async () => {
      // Both calls see activeTeam='agentkit' (mocked), so both do the full switch
      const first = service.switchTeam('content-writing')
      const second = service.switchTeam('content-writing')

      await Promise.all([first, second])

      // Each call runs _doSwitch in full (no no-op since mock always returns same config)
      expect(vi.mocked(writeFileSync)).toHaveBeenCalledTimes(2)
    })
  })

  // --- 4h: rollback — writeFileSync NOT called if loadTeamConfig throws ---
  describe('rollback guard', () => {
    it('does not write file when loadTeamConfig throws ConfigError not-found', async () => {
      vi.spyOn(ConfigLoader.prototype, 'loadTeamConfig').mockImplementation(() => {
        throw new ConfigError('Team config not found: bad-team')
      })

      await expect(service.switchTeam('bad-team')).rejects.toThrow()
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
    })

    it('does not write file when loadTeamConfig throws validation ConfigError', async () => {
      vi.spyOn(ConfigLoader.prototype, 'loadTeamConfig').mockImplementation(() => {
        throw new ConfigError('stages[0].timeout must be a number')
      })

      await expect(service.switchTeam('content-writing')).rejects.toThrow(ConfigError)
      expect(vi.mocked(writeFileSync)).not.toHaveBeenCalled()
    })
  })
})
