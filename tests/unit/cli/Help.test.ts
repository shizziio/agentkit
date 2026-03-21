import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Command } from 'commander'

import {
  buildGeneralHelpText,
  printGeneralHelp,
  registerHelpCommand,
} from '../../../src/cli/Help.js'

function makeProgram(): Command {
  const program = new Command()
  program
    .name('agentkit')
    .description('@shizziio/agent-kit — AI Pipeline Orchestrator')
    .version('0.1.0')
  program.helpCommand(false)
  // Register stub commands matching the real 11
  const stubs: [string, string][] = [
    ['init', 'Initialize a new agentkit project'],
    ['load', 'Load epics and stories from a markdown file'],
    ['start', 'Launch the interactive pipeline menu'],
    ['ship', 'Ship loaded stories into the pipeline queue'],
    ['run', 'Start pipeline workers for all stages'],
    ['dashboard', 'Open the real-time TUI pipeline dashboard'],
    ['diagnose', 'Diagnose pipeline health and surface errors'],
    ['status', 'Show current pipeline and task status'],
    ['history', 'View completed task history and reports'],
    ['config', 'View or update project configuration'],
  ]
  for (const [name, desc] of stubs) {
    program
      .command(name)
      .description(desc)
      .action(() => undefined)
  }
  registerHelpCommand(program)
  return program
}

describe('buildGeneralHelpText', () => {
  let program: Command

  beforeEach(() => {
    program = makeProgram()
  })

  it('includes all 11 command names', () => {
    const text = buildGeneralHelpText(program)
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
    ]
    for (const name of expected) {
      expect(text).toContain(name)
    }
  })

  it('includes all 5 global option flags', () => {
    const text = buildGeneralHelpText(program)
    expect(text).toContain('--simple')
    expect(text).toContain('--verbose')
    expect(text).toContain('--team')
    expect(text).toContain('--provider')
    expect(text).toContain('--model')
  })

  it('includes Typical workflow block', () => {
    const text = buildGeneralHelpText(program)
    expect(text).toContain('Typical workflow')
  })

  it('includes Quick one-liner block', () => {
    const text = buildGeneralHelpText(program)
    expect(text).toContain('Quick one-liner')
  })

  it('is a pure function (does not call process.exit)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit called unexpectedly')
    })
    expect(() => buildGeneralHelpText(program)).not.toThrow()
    expect(exitSpy).not.toHaveBeenCalled()
    exitSpy.mockRestore()
  })
})

describe('printGeneralHelp', () => {
  it('calls console.log and process.exit(0)', () => {
    const program = makeProgram()
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit 0')
    })

    expect(() => printGeneralHelp(program)).toThrow('exit 0')
    expect(logSpy).toHaveBeenCalledOnce()
    expect(exitSpy).toHaveBeenCalledWith(0)

    logSpy.mockRestore()
    exitSpy.mockRestore()
  })
})

describe('registerHelpCommand action', () => {
  let program: Command
  let logSpy: ReturnType<typeof vi.spyOn>
  let exitSpy: ReturnType<typeof vi.spyOn>
  let stderrSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    program = makeProgram()
    logSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined)
    exitSpy = vi.spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('process.exit')
    })
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true)
  })

  afterEach(() => {
    logSpy.mockRestore()
    exitSpy.mockRestore()
    stderrSpy.mockRestore()
  })

  it('calls printGeneralHelp (process.exit(0)) when no topic given', () => {
    expect(() => {
      program.parse(['node', 'agentkit', 'help'])
    }).toThrow('process.exit')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('prints teams topic content and exits 0', () => {
    expect(() => {
      program.parse(['node', 'agentkit', 'help', 'teams'])
    }).toThrow('process.exit')
    expect(logSpy).toHaveBeenCalledOnce()
    const output: string = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('team')
    expect(output).toContain('Stages')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('prints providers topic content and exits 0', () => {
    expect(() => {
      program.parse(['node', 'agentkit', 'help', 'providers'])
    }).toThrow('process.exit')
    expect(logSpy).toHaveBeenCalledOnce()
    const output: string = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('provider')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('prints prompts topic content and exits 0', () => {
    expect(() => {
      program.parse(['node', 'agentkit', 'help', 'prompts'])
    }).toThrow('process.exit')
    expect(logSpy).toHaveBeenCalledOnce()
    const output: string = logSpy.mock.calls[0]?.[0] as string
    expect(output).toContain('prompt')
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('writes to stderr and falls through to general help for unknown topic', () => {
    expect(() => {
      program.parse(['node', 'agentkit', 'help', 'unknown-xyz'])
    }).toThrow('process.exit')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown topic'))
    expect(exitSpy).toHaveBeenCalledWith(0)
  })

  it('is case-sensitive: Teams (capital T) falls through to unknown-topic branch', () => {
    expect(() => {
      program.parse(['node', 'agentkit', 'help', 'Teams'])
    }).toThrow('process.exit')
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('Unknown topic'))
  })

  it('delegates to cmd.help() for a valid command name', () => {
    const initCmd = program.commands.find(c => c.name() === 'init')!
    const helpSpy = vi.spyOn(initCmd, 'help').mockImplementation(() => {
      throw new Error('cmd.help called')
    })

    expect(() => {
      program.parse(['node', 'agentkit', 'help', 'init'])
    }).toThrow('cmd.help called')

    expect(helpSpy).toHaveBeenCalledOnce()
    helpSpy.mockRestore()
  })

  it('topic check runs before command lookup (isHelpTopic checked first)', () => {
    // Register a command named 'teams' — the topic branch should still win
    const fakeTeamsCmd = program.command('teams').description('fake teams command')
    const cmdHelpSpy = vi.spyOn(fakeTeamsCmd, 'help').mockImplementation(() => {
      throw new Error('cmd.help called')
    })

    expect(() => {
      program.parse(['node', 'agentkit', 'help', 'teams'])
    }).toThrow('process.exit') // topic branch, not cmd.help

    expect(cmdHelpSpy).not.toHaveBeenCalled()
    cmdHelpSpy.mockRestore()
  })
})

describe('help command registration', () => {
  it('argument is named topic', () => {
    const program = makeProgram()
    const helpCmd = program.commands.find(c => c.name() === 'help')!
    expect(helpCmd.registeredArguments[0]?.name()).toBe('topic')
  })

  it('has correct description', () => {
    const program = makeProgram()
    const helpCmd = program.commands.find(c => c.name() === 'help')!
    expect(helpCmd.description()).toBe(
      'Show help for agentkit or a specific topic (teams, providers, prompts)'
    )
  })
})
