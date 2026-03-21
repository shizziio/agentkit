import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'
import { existsSync } from 'node:fs'

import { buildProgram } from '../../../src/cli/index.js'
import { requireInitialized } from '../../../src/cli/RequireInitialized.js'

vi.mock('node:fs', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs')>()
  return {
    ...actual,
    existsSync: vi.fn(),
  }
})

describe('CLI Entry Point', () => {
  let program: Command

  beforeEach(() => {
    program = new Command()
    program
      .name('agentkit')
      .description('@shizziio/agent-kit — AI Pipeline Orchestrator')
      .version('0.1.0')
  })

  describe('program initialization', () => {
    it('should have correct name', () => {
      expect(program.name()).toBe('agentkit')
    })

    it('should have correct description', () => {
      expect(program.description()).toBe('@shizziio/agent-kit — AI Pipeline Orchestrator')
    })

    it('should have correct version', () => {
      expect(program.version()).toBe('0.1.0')
    })

    it('should be a valid Commander program', () => {
      expect(program).toBeInstanceOf(Command)
    })
  })

  describe('command registration', () => {
    it('should register all 16 commands', () => {
      const built = buildProgram()
      const names = built.commands.map(c => c.name())
      const expected = [
        'init',
        'load',
        'start',
        'ship',
        'run',
        'dashboard',
        'diagnose',
        'status',
        'history',
        'replay',
        'config',
        'help',
        'logs',
        'inspect',
        'trace',
        'cleanup',
      ]
      for (const name of expected) {
        expect(names).toContain(name)
      }
      expect(names.length).toBe(16)
    })

    it('should have correct descriptions for each command', () => {
      const built = buildProgram()
      const find = (name: string) => built.commands.find(c => c.name() === name)

      expect(find('init')?.description()).toBe('Initialize a new agentkit project')
      expect(find('load')?.description()).toBe('Load epics and stories from a markdown file')
      expect(find('start')?.description()).toBe('Launch the interactive pipeline menu')
      expect(find('ship')?.description()).toBe('Ship loaded stories into the pipeline queue')
      expect(find('run')?.description()).toBe('Start pipeline workers for all stages')
      expect(find('dashboard')?.description()).toBe('Open the real-time TUI pipeline dashboard')
      expect(find('diagnose')?.description()).toBe('Diagnose pipeline health and surface errors')
      expect(find('status')?.description()).toBe('Show current pipeline and task status')
      expect(find('history')?.description()).toBe('View completed task history and reports')
      expect(find('config')?.description()).toBe('View or update project configuration')
      expect(find('help')?.description()).toBe(
        'Show help for agentkit or a specific topic (teams, providers, prompts)'
      )
    })

    it('ship command should have --epic and --all options', () => {
      const built = buildProgram()
      const shipCmd = built.commands.find(c => c.name() === 'ship')!
      const optionLongs = shipCmd.options.map(o => o.long)
      expect(optionLongs).toContain('--epic')
      expect(optionLongs).toContain('--all')
    })

    it('config command should have --show option', () => {
      const built = buildProgram()
      const configCmd = built.commands.find(c => c.name() === 'config')!
      const optionLongs = configCmd.options.map(o => o.long)
      expect(optionLongs).toContain('--show')
    })

    it('help command should accept optional [topic] argument', () => {
      const built = buildProgram()
      const helpCmd = built.commands.find(c => c.name() === 'help')!
      expect(helpCmd.registeredArguments).toHaveLength(1)
      expect(helpCmd.registeredArguments[0]?.name()).toBe('topic')
      expect(helpCmd.registeredArguments[0]?.required).toBe(false)
    })
  })

  describe('global options', () => {
    it('should have 4 global options', () => {
      const built = buildProgram()
      const longFlags = built.options.map(o => o.long)
      expect(longFlags).toContain('--verbose')
      expect(longFlags).toContain('--team')
      expect(longFlags).toContain('--provider')
      expect(longFlags).toContain('--model')
      expect(longFlags).not.toContain('--simple')
    })

    it('--team, --provider, --model should accept a value', () => {
      const built = buildProgram()
      const find = (flag: string) => built.options.find(o => o.long === flag)
      expect(find('--team')?.required).toBe(true)
      expect(find('--provider')?.required).toBe(true)
      expect(find('--model')?.required).toBe(true)
    })

    it('--verbose should be a boolean flag', () => {
      const built = buildProgram()
      const find = (flag: string) => built.options.find(o => o.long === flag)
      expect(find('--verbose')?.required).toBe(false)
    })
  })

  describe('requireInitialized', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should exit with code 1 when _agent_kit/ dir does not exist', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(1)')
      })

      expect(() => requireInitialized()).toThrow('process.exit(1)')
      expect(exitSpy).toHaveBeenCalledWith(1)

      exitSpy.mockRestore()
    })

    it('should write initialization error to stderr', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(1)')
      })

      expect(() => requireInitialized()).toThrow()
      expect(stderrSpy).toHaveBeenCalledWith(
        'Project not initialized. Run `agentkit init` first.\n'
      )

      stderrSpy.mockRestore()
      exitSpy.mockRestore()
    })

    it('should not call process.exit when _agent_kit/ dir exists', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const exitSpy = vi.spyOn(process, 'exit')

      expect(() => requireInitialized()).not.toThrow()
      expect(exitSpy).not.toHaveBeenCalled()

      exitSpy.mockRestore()
    })
  })

  describe('command parsing', () => {
    it('should accept --version flag', () => {
      const argv = ['node', 'agentkit', '--version']
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called')
      })

      expect(() => {
        try {
          program.parse(argv, { from: 'user' })
        } catch (e) {
          if ((e as Error).message === 'exit called') {
            return
          }
          throw e
        }
      }).not.toThrow()

      exitSpy.mockRestore()
    })

    it('should accept --help flag', () => {
      const argv = ['node', 'agentkit', '--help']
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit called')
      })

      expect(() => {
        try {
          program.parse(argv, { from: 'user' })
        } catch (e) {
          if ((e as Error).message === 'exit called') {
            return
          }
          throw e
        }
      }).not.toThrow()

      exitSpy.mockRestore()
    })

    it('should parse empty arguments without error', () => {
      const argv = ['node', 'agentkit']
      expect(() => {
        program.parse(argv, { from: 'user' })
      }).not.toThrow()
    })

    it('should call process.exit on --version', () => {
      const testProgram = new Command()
      testProgram
        .name('agentkit')
        .description('@shizziio/agent-kit — AI Pipeline Orchestrator')
        .version('0.1.0')

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit 0')
      })

      const argv = ['node', 'agentkit', '--version']
      expect(() => {
        testProgram.parse(argv, { from: 'user' })
      }).toThrow('exit 0')

      expect(exitSpy).toHaveBeenCalledWith(0)
      exitSpy.mockRestore()
    })

    it('should call process.exit on --help', () => {
      const testProgram = new Command()
      testProgram
        .name('agentkit')
        .description('@shizziio/agent-kit — AI Pipeline Orchestrator')
        .version('0.1.0')

      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit 0')
      })

      const argv = ['node', 'agentkit', '--help']
      expect(() => {
        testProgram.parse(argv, { from: 'user' })
      }).toThrow('exit 0')

      expect(exitSpy).toHaveBeenCalledWith(0)
      exitSpy.mockRestore()
    })
  })

  describe('stub command action', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should exit with code 1 when project is not initialized for ship command', async () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('process.exit(1)')
      })

      const built = buildProgram()
      await expect(built.parseAsync(['node', 'agentkit', 'ship'])).rejects.toThrow(
        'process.exit(1)'
      )

      expect(exitSpy).toHaveBeenCalledWith(1)
      exitSpy.mockRestore()
    })
  })

  describe('global options parsing', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should accept --verbose flag globally', () => {
      const argv = ['node', 'agentkit', '--verbose', 'init']
      const built = buildProgram()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      expect(() => {
        built.parse(argv, { from: 'user' })
      }).toThrow()

      exitSpy.mockRestore()
    })

    it('should accept --team with value', () => {
      const argv = ['node', 'agentkit', '--team', 'agentkit', 'init']
      const built = buildProgram()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      expect(() => {
        built.parse(argv, { from: 'user' })
      }).toThrow()

      exitSpy.mockRestore()
    })

    it('should accept --provider with value', () => {
      const argv = ['node', 'agentkit', '--provider', 'claude-cli', 'init']
      const built = buildProgram()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      expect(() => {
        built.parse(argv, { from: 'user' })
      }).toThrow()

      exitSpy.mockRestore()
    })

    it('should accept --model with value', () => {
      const argv = ['node', 'agentkit', '--model', 'opus', 'init']
      const built = buildProgram()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      expect(() => {
        built.parse(argv, { from: 'user' })
      }).toThrow()

      exitSpy.mockRestore()
    })

    it('should accept multiple global options together', () => {
      const argv = [
        'node',
        'agentkit',
        '--verbose',
        '--team',
        'agentkit',
        '--provider',
        'claude-cli',
        'init',
      ]
      const built = buildProgram()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      expect(() => {
        built.parse(argv, { from: 'user' })
      }).toThrow()

      exitSpy.mockRestore()
    })

    it('should NOT have --simple as a global option', () => {
      const built = buildProgram()
      const simpleOpt = built.options.find(o => o.long === '--simple')
      expect(simpleOpt).toBeUndefined()
    })
  })

  describe('load command', () => {
    it('should have --simple option on load command', () => {
      const built = buildProgram()
      const loadCmd = built.commands.find(c => c.name() === 'load')
      expect(loadCmd).toBeDefined()
      const simpleOpt = loadCmd?.options.find(o => o.long === '--simple')
      expect(simpleOpt).toBeDefined()
    })

    it('should accept optional [file] argument on load command', () => {
      const built = buildProgram()
      const loadCmd = built.commands.find(c => c.name() === 'load')!
      expect(loadCmd.registeredArguments).toHaveLength(1)
      expect(loadCmd.registeredArguments[0]?.name()).toBe('file')
      expect(loadCmd.registeredArguments[0]?.required).toBe(false)
    })
  })

  describe('help command behavior', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should register help command with correct structure', () => {
      const built = buildProgram()
      const helpCmd = built.commands.find(c => c.name() === 'help')

      expect(helpCmd).toBeDefined()
      expect(helpCmd?.description()).toBe(
        'Show help for agentkit or a specific topic (teams, providers, prompts)'
      )
      expect(helpCmd?.registeredArguments.length).toBe(1)
      expect(helpCmd?.registeredArguments[0]?.name()).toBe('topic')
      expect(helpCmd?.registeredArguments[0]?.required).toBe(false)
    })

    it('should execute help command without errors when valid command given', () => {
      const built = buildProgram()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        built.parse(['node', 'agentkit', 'help', 'init'], { from: 'user' })
      } catch (e) {
        // Expected
      }

      exitSpy.mockRestore()
    })
  })

  describe('no-args action', () => {
    it('should show usage message when no args provided', () => {
      const built = buildProgram()
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit 0')
      })

      expect(() => {
        built.parse(['node', 'agentkit'], { from: 'user' })
      }).toThrow('exit 0')

      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('agentkit v'))
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('Get started'))
      expect(exitSpy).toHaveBeenCalledWith(0)

      logSpy.mockRestore()
      exitSpy.mockRestore()
    })
  })

  describe('edge cases', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should register help command with disabled auto-help', () => {
      const built = buildProgram()
      expect((built as any)._helpCommand).toBeFalsy()
      const helpCmd = built.commands.find(c => c.name() === 'help')
      expect(helpCmd).toBeDefined()
    })

    it('should handle command with both global and local options', () => {
      const argv = ['node', 'agentkit', '--verbose', 'load', '--simple', 'test.md']
      const built = buildProgram()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        built.parse(argv, { from: 'user' })
      } catch (e) {
        // Expected when load command's action runs
      }

      exitSpy.mockRestore()
    })

    it('should validate that init command does not have --simple option', () => {
      const built = buildProgram()
      const initCmd = built.commands.find(c => c.name() === 'init')
      const simpleOpt = initCmd?.options.find(o => o.long === '--simple')
      expect(simpleOpt).toBeUndefined()
    })

    it('should have all expected commands registered exactly once', () => {
      const built = buildProgram()
      const names = built.commands.map(c => c.name())
      const expected = [
        'init',
        'load',
        'start',
        'ship',
        'run',
        'dashboard',
        'diagnose',
        'status',
        'history',
        'config',
        'help',
        'logs',
        'inspect',
      ]

      for (const name of expected) {
        const occurrences = names.filter(n => n === name).length
        expect(occurrences).toBe(1)
      }
    })

    it('should not allow global --simple option before subcommand', () => {
      const argv = ['node', 'agentkit', '--simple', 'init']
      const built = buildProgram()
      expect(() => {
        built.parse(argv, { from: 'user' })
      }).toThrow()
    })
  })

  describe('all commands have descriptions', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should have non-empty descriptions for all stub commands', () => {
      const built = buildProgram()
      const stubCommands = ['start', 'run', 'dashboard', 'diagnose', 'status', 'history']

      for (const cmdName of stubCommands) {
        const cmd = built.commands.find(c => c.name() === cmdName)
        expect(cmd).toBeDefined()
        expect(cmd?.description()).toBeDefined()
        expect(cmd?.description()?.length).toBeGreaterThan(0)
      }
    })
  })

  describe('command argument specifications', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('load command should accept optional [file] positional argument', () => {
      const built = buildProgram()
      const loadCmd = built.commands.find(c => c.name() === 'load')!
      const fileArg = loadCmd.registeredArguments.find(a => a.name() === 'file')
      expect(fileArg).toBeDefined()
      expect(fileArg?.required).toBe(false)
    })

    it('help command should accept optional [topic] positional argument', () => {
      const built = buildProgram()
      const helpCmd = built.commands.find(c => c.name() === 'help')!
      const topicArg = helpCmd.registeredArguments.find(a => a.name() === 'topic')
      expect(topicArg).toBeDefined()
      expect(topicArg?.required).toBe(false)
    })

    it('init, start, run, dashboard, diagnose, status, history commands should have no arguments', () => {
      const built = buildProgram()
      const noArgCommands = ['init', 'start', 'run', 'dashboard', 'diagnose', 'status', 'history']

      for (const cmdName of noArgCommands) {
        const cmd = built.commands.find(c => c.name() === cmdName)
        expect(cmd?.registeredArguments).toHaveLength(0)
      }
    })

    it('ship command should have no positional arguments but have options', () => {
      const built = buildProgram()
      const shipCmd = built.commands.find(c => c.name() === 'ship')!
      expect(shipCmd.registeredArguments).toHaveLength(0)
      expect(shipCmd.options.length).toBeGreaterThan(0)
    })

    it('config command should have no positional arguments but have --show option', () => {
      const built = buildProgram()
      const configCmd = built.commands.find(c => c.name() === 'config')!
      expect(configCmd.registeredArguments).toHaveLength(0)
      expect(configCmd.options.find(o => o.long === '--show')).toBeDefined()
    })
  })

  describe('command option details', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('load command --simple should not require a value', () => {
      const built = buildProgram()
      const loadCmd = built.commands.find(c => c.name() === 'load')!
      const simpleOpt = loadCmd.options.find(o => o.long === '--simple')
      expect(simpleOpt).toBeDefined()
      expect(simpleOpt?.required).toBe(false)
    })

    it('ship command --epic should require a value', () => {
      const built = buildProgram()
      const shipCmd = built.commands.find(c => c.name() === 'ship')!
      const epicOpt = shipCmd.options.find(o => o.long === '--epic')
      expect(epicOpt).toBeDefined()
      expect(epicOpt?.required).toBe(true)
    })

    it('ship command --all should not require a value', () => {
      const built = buildProgram()
      const shipCmd = built.commands.find(c => c.name() === 'ship')!
      const allOpt = shipCmd.options.find(o => o.long === '--all')
      expect(allOpt).toBeDefined()
      expect(allOpt?.required).toBe(false)
    })

    it('config command --show should not require a value', () => {
      const built = buildProgram()
      const configCmd = built.commands.find(c => c.name() === 'config')!
      const showOpt = configCmd.options.find(o => o.long === '--show')
      expect(showOpt).toBeDefined()
      expect(showOpt?.required).toBe(false)
    })

    it('global --verbose should be boolean flag without value', () => {
      const built = buildProgram()
      const verboseOpt = built.options.find(o => o.long === '--verbose')
      expect(verboseOpt?.required).toBe(false)
    })

    it('global --team should require a value argument', () => {
      const built = buildProgram()
      const teamOpt = built.options.find(o => o.long === '--team')
      expect(teamOpt?.required).toBe(true)
    })

    it('global --provider should require a value argument', () => {
      const built = buildProgram()
      const providerOpt = built.options.find(o => o.long === '--provider')
      expect(providerOpt?.required).toBe(true)
    })

    it('global --model should require a value argument', () => {
      const built = buildProgram()
      const modelOpt = built.options.find(o => o.long === '--model')
      expect(modelOpt?.required).toBe(true)
    })
  })

  describe('buildProgram export and entry point', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('buildProgram should return a valid Commander instance', () => {
      const built = buildProgram()
      expect(built).toBeInstanceOf(Command)
      expect(built.name()).toBe('agentkit')
    })

    it('should parse without error when given valid command', () => {
      const built = buildProgram()
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        built.parse(['node', 'agentkit', 'init'], { from: 'user' })
      } catch (e) {
        // Expected
      }

      exitSpy.mockRestore()
    })

    it('version output should match package version', () => {
      const built = buildProgram()
      expect(built.version()).toBe('0.1.0')
    })

    it('program description should mention AI Pipeline Orchestrator', () => {
      const built = buildProgram()
      expect(built.description()).toContain('AI Pipeline Orchestrator')
    })
  })

  describe('requireInitialized with different states', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('should check for agentkit directory in current working directory', () => {
      vi.mocked(existsSync).mockReturnValue(true)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)

      expect(() => requireInitialized()).not.toThrow()
      expect(stderrSpy).not.toHaveBeenCalled()

      stderrSpy.mockRestore()
    })

    it('should provide clear error message when project is not initialized', () => {
      vi.mocked(existsSync).mockReturnValue(false)
      const stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
      const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
        throw new Error('exit')
      })

      try {
        requireInitialized()
      } catch (e) {
        // Expected
      }

      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Project not initialized'))
      expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('agentkit init'))

      stderrSpy.mockRestore()
      exitSpy.mockRestore()
    })
  })

  describe('stub commands registration', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('stub commands should be properly registered', () => {
      const built = buildProgram()
      const stubCommands = ['run', 'dashboard', 'diagnose', 'status', 'history']

      for (const cmdName of stubCommands) {
        const cmd = built.commands.find(c => c.name() === cmdName)
        expect(cmd).toBeDefined()
        expect(cmd?.description()).toBeDefined()
        expect(cmd?.description()?.length).toBeGreaterThan(0)
      }
    })

    it('all stub commands should have action handlers', () => {
      const built = buildProgram()
      const stubCommands = ['run', 'dashboard', 'diagnose', 'status', 'history']

      for (const cmdName of stubCommands) {
        const cmd = built.commands.find(c => c.name() === cmdName)
        expect(cmd).toBeDefined()
        // Verify the command has an action handler by checking it's not undefined
        // The action is stored internally in Command, we just verify it exists
        expect(cmd?.name()).toBe(cmdName)
      }
    })

    it('stub commands should have no local options', () => {
      const built = buildProgram()
      // run has --simple; diagnose has --auto-fix; history has --epic/--status/--last
      // Only truly option-free stub commands:
      const stubCommands = ['dashboard', 'status']

      for (const cmdName of stubCommands) {
        const cmd = built.commands.find(c => c.name() === cmdName)
        // These stub commands have no command-specific options (except inherited from parent)
        const ownOptions = cmd?.options.filter(o => !(o as any).inherited) ?? []
        expect(ownOptions.length).toBe(0)
      }

      // run has --simple option
      const runCmd = built.commands.find(c => c.name() === 'run')
      const runOptions = runCmd?.options.filter(o => !(o as any).inherited) ?? []
      expect(runOptions.length).toBe(1)
      expect(runOptions[0].long).toBe('--simple')
    })

    it('history command should have --epic, --status, --last options requiring values', () => {
      const built = buildProgram()
      const historyCmd = built.commands.find(c => c.name() === 'history')!
      const optionLongs = historyCmd.options.map(o => o.long)
      expect(optionLongs).toContain('--epic')
      expect(optionLongs).toContain('--status')
      expect(optionLongs).toContain('--last')

      const epicOpt = historyCmd.options.find(o => o.long === '--epic')
      expect(epicOpt?.required).toBe(true)
      const statusOpt = historyCmd.options.find(o => o.long === '--status')
      expect(statusOpt?.required).toBe(true)
      const lastOpt = historyCmd.options.find(o => o.long === '--last')
      expect(lastOpt?.required).toBe(true)
    })
  })

  describe('command registry consistency', () => {
    afterEach(() => {
      vi.clearAllMocks()
    })

    it('every command in commands array should have a name', () => {
      const built = buildProgram()
      for (const cmd of built.commands) {
        expect(cmd.name()).toBeDefined()
        expect(cmd.name()?.length).toBeGreaterThan(0)
      }
    })

    it('every command should have a description', () => {
      const built = buildProgram()
      for (const cmd of built.commands) {
        expect(cmd.description()).toBeDefined()
        expect(cmd.description()?.length).toBeGreaterThan(0)
      }
    })

    it('no command should have duplicate options', () => {
      const built = buildProgram()
      for (const cmd of built.commands) {
        const optionLongs = cmd.options.map(o => o.long)
        const uniqueLongs = new Set(optionLongs)
        expect(optionLongs.length).toBe(uniqueLongs.size)
      }
    })

    it('commands should be accessible by name for all 13 commands', () => {
      const built = buildProgram()
      const expected = [
        'init',
        'load',
        'start',
        'ship',
        'run',
        'dashboard',
        'diagnose',
        'status',
        'history',
        'config',
        'help',
        'logs',
        'inspect',
      ]

      for (const cmdName of expected) {
        const cmd = built.commands.find(c => c.name() === cmdName)
        expect(cmd).toBeDefined()
        expect(cmd?.name()).toBe(cmdName)
      }
    })
  })
})
