import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest'
import { validateTeamConfig } from '../../../src/core/ConfigValidator.js'
import { ConfigError } from '../../../src/core/Errors.js'

// Minimal valid team config factory — caller can override individual stage fields
function makeConfig(stageOverrides?: Record<string, unknown>): Record<string, unknown> {
  return {
    team: 'test-team',
    displayName: 'Test Team',
    version: 1,
    models: {
      'claude-cli': {
        allowed: ['sonnet'],
        defaults: { sm: 'sonnet' },
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
        ...stageOverrides,
      },
    ],
  }
}

describe('validateTeamConfig', () => {
  describe('skipDeps field', () => {
    let warnSpy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    })

    afterEach(() => {
      warnSpy.mockRestore()
    })

    // ── Happy-path: skipDeps: true only ────────────────────────────────────

    it('should not throw and should not warn when skipDeps is true without skipDepsLevel', () => {
      const config = makeConfig({ skipDeps: true })
      expect(() => validateTeamConfig(config)).not.toThrow()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    // ── Happy-path: skipDeps: false + skipDepsLevel: 'story' ───────────────

    it('should not throw and should not warn when skipDeps is false and skipDepsLevel is "story"', () => {
      const config = makeConfig({ skipDeps: false, skipDepsLevel: 'story' })
      expect(() => validateTeamConfig(config)).not.toThrow()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    // ── Happy-path: skipDeps: false + skipDepsLevel: 'epic' ────────────────

    it('should not throw and should not warn when skipDeps is false and skipDepsLevel is "epic"', () => {
      const config = makeConfig({ skipDeps: false, skipDepsLevel: 'epic' })
      expect(() => validateTeamConfig(config)).not.toThrow()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    // ── Happy-path: both fields absent (backwards compatibility) ───────────

    it('should not throw and should not warn when both skipDeps and skipDepsLevel are absent', () => {
      const config = makeConfig()
      expect(() => validateTeamConfig(config)).not.toThrow()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    // ── Happy-path: skipDepsLevel present, skipDeps absent ─────────────────

    it('should not throw when skipDepsLevel is set and skipDeps is absent (consumer applies default)', () => {
      const config = makeConfig({ skipDepsLevel: 'story' })
      expect(() => validateTeamConfig(config)).not.toThrow()
      expect(warnSpy).not.toHaveBeenCalled()
    })

    // ── Warning: skipDeps: true + skipDepsLevel: 'story' ───────────────────

    it('should call console.warn (not throw) when skipDeps is true and skipDepsLevel is "story"', () => {
      const config = makeConfig({ skipDeps: true, skipDepsLevel: 'story' })
      expect(() => validateTeamConfig(config)).not.toThrow()
      expect(warnSpy).toHaveBeenCalledOnce()
      const warnMsg: string = warnSpy.mock.calls[0][0] as string
      expect(warnMsg).toContain('sm')
      expect(warnMsg).toContain('skipDepsLevel')
    })

    // ── Warning: skipDeps: true + skipDepsLevel: 'epic' ────────────────────

    it('should call console.warn (not throw) when skipDeps is true and skipDepsLevel is "epic"', () => {
      const config = makeConfig({ skipDeps: true, skipDepsLevel: 'epic' })
      expect(() => validateTeamConfig(config)).not.toThrow()
      expect(warnSpy).toHaveBeenCalledOnce()
      const warnMsg: string = warnSpy.mock.calls[0][0] as string
      expect(warnMsg).toContain('sm')
      expect(warnMsg).toContain('skipDepsLevel')
    })

    // ── Error: skipDeps non-boolean ('yes') ────────────────────────────────

    it('should throw ConfigError when skipDeps is a non-boolean string', () => {
      const config = makeConfig({ skipDeps: 'yes' })
      expect(() => validateTeamConfig(config)).toThrow(ConfigError)
      expect(() => validateTeamConfig(config)).toThrow(/skipDeps/)
      expect(() => validateTeamConfig(config)).toThrow(/sm/)
    })

    // ── Error: skipDeps is a number ────────────────────────────────────────

    it('should throw ConfigError when skipDeps is a number', () => {
      const config = makeConfig({ skipDeps: 1 })
      expect(() => validateTeamConfig(config)).toThrow(ConfigError)
      expect(() => validateTeamConfig(config)).toThrow(/skipDeps/)
    })

    // ── Error: skipDeps is null (typeof null === 'object') ─────────────────

    it('should throw ConfigError when skipDeps is null', () => {
      const config = makeConfig({ skipDeps: null })
      expect(() => validateTeamConfig(config)).toThrow(ConfigError)
      expect(() => validateTeamConfig(config)).toThrow(/skipDeps/)
    })

    // ── Error: skipDepsLevel invalid string ('task') ───────────────────────

    it('should throw ConfigError when skipDepsLevel is an invalid string "task"', () => {
      const config = makeConfig({ skipDepsLevel: 'task' })
      expect(() => validateTeamConfig(config)).toThrow(ConfigError)
      expect(() => validateTeamConfig(config)).toThrow(/skipDepsLevel/)
      expect(() => validateTeamConfig(config)).toThrow(/sm/)
    })

    // ── Error: skipDepsLevel invalid string ('all') ────────────────────────

    it('should throw ConfigError when skipDepsLevel is an invalid string "all"', () => {
      const config = makeConfig({ skipDepsLevel: 'all' })
      expect(() => validateTeamConfig(config)).toThrow(ConfigError)
      expect(() => validateTeamConfig(config)).toThrow(/skipDepsLevel/)
    })

    // ── Error: skipDepsLevel is null ───────────────────────────────────────

    it('should throw ConfigError when skipDepsLevel is null', () => {
      const config = makeConfig({ skipDepsLevel: null })
      expect(() => validateTeamConfig(config)).toThrow(ConfigError)
      expect(() => validateTeamConfig(config)).toThrow(/skipDepsLevel/)
    })

    // ── Backwards compatibility: existing configs without new fields ────────

    it('should load existing team configs without skipDeps/skipDepsLevel without error', () => {
      // Simulates a pre-existing config that has no knowledge of these fields
      const config: Record<string, unknown> = {
        team: 'legacy-team',
        displayName: 'Legacy Team',
        version: 1,
        models: {
          'claude-cli': {
            allowed: ['sonnet'],
            defaults: { sm: 'sonnet' },
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
          },
          {
            name: 'dev',
            displayName: 'Dev',
            icon: '💻',
            prompt: './prompts/dev.md',
            timeout: 600,
            workers: 1,
            retries: 0,
          },
        ],
      }
      expect(() => validateTeamConfig(config)).not.toThrow()
      expect(warnSpy).not.toHaveBeenCalled()
    })
  })
})
