import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

import { registerLoadCommand } from '../../../src/cli/Load.js';

describe('Load CLI Command', () => {
  it('should register load command on program', () => {
    const program = new Command();
    registerLoadCommand(program);

    const loadCmd = program.commands.find((cmd) => cmd.name() === 'load');
    expect(loadCmd).toBeDefined();
    expect(loadCmd!.description()).toBe('Load epics and stories from a markdown file');
  });

  it('should accept optional file argument', () => {
    const program = new Command();
    registerLoadCommand(program);

    const loadCmd = program.commands.find((cmd) => cmd.name() === 'load')!;
    const args = loadCmd.registeredArguments;
    expect(args).toHaveLength(1);
    expect(args[0]!.name()).toBe('file');
    expect(args[0]!.required).toBe(false);
  });

  it('should accept --simple option', () => {
    const program = new Command();
    registerLoadCommand(program);

    const loadCmd = program.commands.find((cmd) => cmd.name() === 'load')!;
    const simpleOption = loadCmd.options.find((opt) => opt.long === '--simple');
    expect(simpleOption).toBeDefined();
  });
});
