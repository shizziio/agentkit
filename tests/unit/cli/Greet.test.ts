import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'

// Mock GreetingService (Story 1.1 dependency — may not exist yet)
vi.mock('@core/GreetingService.js', () => ({
  GreetingService: {
    greet: vi.fn((name: string) => `Hello, ${name}! Welcome aboard.`),
  },
}))

import { registerGreetCommand } from '../../../src/cli/greet.js'
import { GreetingService } from '@core/GreetingService.js'

describe('registerGreetCommand', () => {
  let program: Command
  let consoleSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    vi.clearAllMocks()
    program = new Command()
    program.exitOverride() // prevent process.exit in tests
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    registerGreetCommand(program)
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  // -----------------------------------------------------------------------
  // Command registration
  // -----------------------------------------------------------------------
  describe('command registration', () => {
    it('should register a greet command on the program', () => {
      const greetCmd = program.commands.find((c) => c.name() === 'greet')
      expect(greetCmd).toBeDefined()
    })

    it('should have a non-empty description on the greet command', () => {
      const greetCmd = program.commands.find((c) => c.name() === 'greet')
      expect(greetCmd?.description()).toBeDefined()
      expect(greetCmd?.description()?.length).toBeGreaterThan(0)
    })

    it('should register --name option with a required value placeholder', () => {
      const greetCmd = program.commands.find((c) => c.name() === 'greet')!
      const nameOpt = greetCmd.options.find((o) => o.long === '--name')
      expect(nameOpt).toBeDefined()
      // --name <name> requires a value (required === true in Commander terminology)
      expect(nameOpt?.required).toBe(true)
    })

    it('should not register any other local options besides --name', () => {
      const greetCmd = program.commands.find((c) => c.name() === 'greet')!
      // Fresh program has no parent global options, so .options contains only
      // the command's own registered options
      expect(greetCmd.options).toHaveLength(1)
      expect(greetCmd.options[0].long).toBe('--name')
    })

    it('should not register any positional arguments', () => {
      const greetCmd = program.commands.find((c) => c.name() === 'greet')!
      expect(greetCmd.registeredArguments).toHaveLength(0)
    })
  })

  // -----------------------------------------------------------------------
  // Acceptance criteria: happy path
  // -----------------------------------------------------------------------
  describe('action handler — happy path', () => {
    it('should print "Hello, Alice! Welcome aboard." when --name Alice is passed', async () => {
      vi.mocked(GreetingService.greet).mockReturnValue('Hello, Alice! Welcome aboard.')

      await program.parseAsync(['node', 'myapp', 'greet', '--name', 'Alice'], { from: 'user' })

      expect(consoleSpy).toHaveBeenCalledWith('Hello, Alice! Welcome aboard.')
    })

    it('should call GreetingService.greet with the provided name', async () => {
      vi.mocked(GreetingService.greet).mockReturnValue('Hello, Alice! Welcome aboard.')

      await program.parseAsync(['node', 'myapp', 'greet', '--name', 'Alice'], { from: 'user' })

      expect(GreetingService.greet).toHaveBeenCalledWith('Alice')
    })

    it('should print "Hello, Guest! Welcome aboard." when no --name flag is provided', async () => {
      vi.mocked(GreetingService.greet).mockReturnValue('Hello, Guest! Welcome aboard.')

      await program.parseAsync(['node', 'myapp', 'greet'], { from: 'user' })

      expect(consoleSpy).toHaveBeenCalledWith('Hello, Guest! Welcome aboard.')
    })

    it('should call GreetingService.greet with "Guest" when no --name flag is provided', async () => {
      vi.mocked(GreetingService.greet).mockReturnValue('Hello, Guest! Welcome aboard.')

      await program.parseAsync(['node', 'myapp', 'greet'], { from: 'user' })

      expect(GreetingService.greet).toHaveBeenCalledWith('Guest')
    })

    it('should print exactly one line of output for a valid greeting', async () => {
      vi.mocked(GreetingService.greet).mockReturnValue('Hello, Alice! Welcome aboard.')

      await program.parseAsync(['node', 'myapp', 'greet', '--name', 'Alice'], { from: 'user' })

      expect(consoleSpy).toHaveBeenCalledTimes(1)
    })
  })

  // -----------------------------------------------------------------------
  // Edge cases
  // -----------------------------------------------------------------------
  describe('action handler — edge cases', () => {
    it('should fall back to "Guest" when --name is provided as empty string', async () => {
      vi.mocked(GreetingService.greet).mockReturnValue('Hello, Guest! Welcome aboard.')

      await program.parseAsync(['node', 'myapp', 'greet', '--name', ''], { from: 'user' })

      // Empty string is falsy — handler must treat it as missing and use 'Guest'
      expect(GreetingService.greet).toHaveBeenCalledWith('Guest')
      expect(consoleSpy).toHaveBeenCalledWith('Hello, Guest! Welcome aboard.')
    })

    it('should handle a name with spaces and output the full name', async () => {
      vi.mocked(GreetingService.greet).mockReturnValue('Hello, Alice Smith! Welcome aboard.')

      await program.parseAsync(['node', 'myapp', 'greet', '--name', 'Alice Smith'], { from: 'user' })

      expect(GreetingService.greet).toHaveBeenCalledWith('Alice Smith')
      expect(consoleSpy).toHaveBeenCalledWith('Hello, Alice Smith! Welcome aboard.')
    })

    it('should output exactly what GreetingService.greet returns (no extra formatting)', async () => {
      const expectedOutput = 'Hello, Alice! Welcome aboard.'
      vi.mocked(GreetingService.greet).mockReturnValue(expectedOutput)

      await program.parseAsync(['node', 'myapp', 'greet', '--name', 'Alice'], { from: 'user' })

      // Must match exactly — no prefix, no suffix, no extra whitespace
      expect(consoleSpy).toHaveBeenCalledWith(expectedOutput)
      const [firstArg] = consoleSpy.mock.calls[0]
      expect(firstArg).toBe(expectedOutput)
    })
  })

  // -----------------------------------------------------------------------
  // Duplicate registration guard
  // -----------------------------------------------------------------------
  describe('duplicate registration', () => {
    it('should not throw when registerGreetCommand is called on a fresh program', () => {
      const freshProgram = new Command()
      freshProgram.exitOverride()
      expect(() => registerGreetCommand(freshProgram)).not.toThrow()
    })

    it('should register greet command exactly once', () => {
      // Count occurrences after a single registration (already done in beforeEach)
      const names = program.commands.map((c) => c.name())
      const greetCount = names.filter((n) => n === 'greet').length
      expect(greetCount).toBe(1)
    })
  })

  // -----------------------------------------------------------------------
  // Help output
  // -----------------------------------------------------------------------
  describe('help integration', () => {
    it('should include "greet" in the parent program help text', () => {
      const helpText = program.helpInformation()
      expect(helpText).toContain('greet')
    })

    it('should include "--name" in the greet sub-command help text', () => {
      const greetCmd = program.commands.find((c) => c.name() === 'greet')!
      const helpText = greetCmd.helpInformation()
      expect(helpText).toContain('--name')
    })
  })
})

// -----------------------------------------------------------------------
// Integration: greet command registered in CLI entry point
// -----------------------------------------------------------------------
describe('CLI index — greet command registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('should register "greet" command in the root CLI program', async () => {
    // This test will fail until src/cli/index.ts imports and registers greetCommand
    const { buildProgram } = await import('../../../src/cli/index.js')
    const built = buildProgram()
    const names = built.commands.map((c) => c.name())
    expect(names).toContain('greet')
  })

  it('should register "greet" command exactly once in the root CLI program', async () => {
    const { buildProgram } = await import('../../../src/cli/index.js')
    const built = buildProgram()
    const names = built.commands.map((c) => c.name())
    const greetCount = names.filter((n) => n === 'greet').length
    expect(greetCount).toBe(1)
  })
})
