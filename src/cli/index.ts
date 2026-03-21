#!/usr/bin/env node

import { pathToFileURL } from 'node:url'
import { realpathSync } from 'node:fs'
import * as path from 'node:path'

import { Command } from 'commander'

import { Logger } from '@core/Logger.js'
import { ensureGlobalDir } from '@core/GlobalSetup.js'
import { AGENTKIT_DIR } from '@config/defaults.js'

import { registerInitCommand } from './Init.js'
import { registerLoadCommand } from './Load.js'
import { registerStartCommand } from './Start.js'
import { registerShipCommand } from './Ship.js'
import { registerRunCommand } from './Run.js'
import { registerDashboardCommand } from './Dashboard.js'
import { registerDiagnoseCommand } from './Diagnose.js'
import { registerStatusCommand } from './Status.js'
import { registerHistoryCommand } from './History.js'
import { registerReplayCommand } from './Replay.js'
import { registerCleanupCommand } from './Cleanup.js'
import { registerConfigCommand } from './Config.js'
import { registerHelpCommand } from './Help.js'
import { registerLogsCommand } from './Logs.js'
import { registerInspectCommand } from './Inspect.js'
import { registerTraceCommand } from './Trace.js'
import { registerUpdateCommand } from './Update.js'
import { registerSetupCommand } from './Setup.js'
import { registerPlanningCommand } from './Planning.js'
import { registerAskCommand } from './Ask.js'
import { registerGreetCommand } from './greet.js'

export function buildProgram(): Command {
  const program = new Command()

  program
    .name('agentkit')
    .description('@shizziio/agent-kit — AI Pipeline Orchestrator')
    .version('0.1.0')

  // Global options — accessible in subcommand action handlers via program.opts(), not cmd.opts()
  program
    .option('--verbose', 'Enable verbose logging')
    .option('--team <team>', 'Override team template')
    .option('--provider <provider>', 'Override AI provider')
    .option('--model <model>', 'Override model for all stages')

  // Disable Commander's auto-added help command; we register our own below
  program.helpCommand(false)

  // Ensure ~/.agentkit exists with bundled teams and docs (every invocation)
  // Then initialize Logger (skip for commands that run before project exists)
  const SKIP_LOGGER_COMMANDS = new Set(['init', 'help'])
  program.hook('preAction', (thisCommand, actionCommand) => {
    ensureGlobalDir()
    const cmdName = actionCommand.name()
    if (SKIP_LOGGER_COMMANDS.has(cmdName)) return
    const opts = thisCommand.opts<{ verbose?: boolean }>()
    Logger.init({
      logDir: path.join(process.cwd(), AGENTKIT_DIR, 'logs'),
      level: opts.verbose === true ? 'DEBUG' : 'INFO',
    })
  })

  // No-args usage message (fires when no subcommand is given and --help is not passed)
  program.action(() => {
    const version = program.version()
    console.log(`agentkit v${version}  — AI Pipeline Orchestrator\n`)
    console.log(`Commands:`)
    console.log(`  agentkit init       Initialize a new project`)
    console.log(`  agentkit start      Launch the dashboard (main entry point)`)
    console.log(`  agentkit setup      Check project readiness & guided setup`)
    console.log(`  agentkit planning   Create epics & stories interactively`)
    console.log(`  agentkit ask        Ask the AgentKit Master agent anything`)
    console.log(`  agentkit help       Show detailed help`)
    console.log()
    process.exit(0)
  })

  // Primary commands — visible in help
  registerInitCommand(program)
  registerStartCommand(program)
  registerSetupCommand(program)
  registerPlanningCommand(program)
  registerAskCommand(program)
  registerHelpCommand(program)
  registerUpdateCommand(program)

  // Dashboard-accessible commands — still registered but not highlighted in no-args message
  // Users can access these from the dashboard or run directly if needed
  registerLoadCommand(program)
  registerShipCommand(program)
  registerRunCommand(program)
  registerDashboardCommand(program)
  registerDiagnoseCommand(program)
  registerStatusCommand(program)
  registerHistoryCommand(program)
  registerReplayCommand(program)
  registerCleanupCommand(program)
  registerConfigCommand(program)
  registerLogsCommand(program)
  registerInspectCommand(program)
  registerTraceCommand(program)
  registerGreetCommand(program)

  return program
}

// Resolve symlinks so this guard works when run via `npm link`
const resolvedArgv1 = realpathSync(process.argv[1] ?? '')
if (import.meta.url === pathToFileURL(resolvedArgv1).href) {
  buildProgram().parse()
}
