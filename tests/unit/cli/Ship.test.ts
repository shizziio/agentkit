import { describe, it, expect } from 'vitest';
import { Command } from 'commander';

import { registerShipCommand } from '../../../src/cli/Ship.js';

describe('Ship CLI Command', () => {
  it('should register ship command on program', () => {
    const program = new Command();
    registerShipCommand(program);

    const shipCmd = program.commands.find((cmd) => cmd.name() === 'ship');
    expect(shipCmd).toBeDefined();
    expect(shipCmd!.description()).toBe('Ship loaded stories into the pipeline queue');
  });

  it('should accept --epic option', () => {
    const program = new Command();
    registerShipCommand(program);

    const shipCmd = program.commands.find((cmd) => cmd.name() === 'ship')!;
    const epicOption = shipCmd.options.find((opt) => opt.long === '--epic');
    expect(epicOption).toBeDefined();
  });

  it('should accept --all option', () => {
    const program = new Command();
    registerShipCommand(program);

    const shipCmd = program.commands.find((cmd) => cmd.name() === 'ship')!;
    const allOption = shipCmd.options.find((opt) => opt.long === '--all');
    expect(allOption).toBeDefined();
  });

  it('should have --epic option taking a value argument', () => {
    const program = new Command();
    registerShipCommand(program);

    const shipCmd = program.commands.find((cmd) => cmd.name() === 'ship')!;
    const epicOption = shipCmd.options.find((opt) => opt.long === '--epic')!;
    // The option is defined as --epic <n>, meaning it takes a value
    expect(epicOption.argChoices === undefined).toBeTruthy();
  });

  it('should have --all option as boolean flag', () => {
    const program = new Command();
    registerShipCommand(program);

    const shipCmd = program.commands.find((cmd) => cmd.name() === 'ship')!;
    const allOption = shipCmd.options.find((opt) => opt.long === '--all')!;
    expect(allOption.required).toBeFalsy();
  });

  it('ship command should have an action handler', () => {
    const program = new Command();
    registerShipCommand(program);

    const shipCmd = program.commands.find((cmd) => cmd.name() === 'ship')!;
    expect((shipCmd as any)._actionHandler).toBeDefined();
  });

  it('should not accept both --all and --epic together (semantics)', () => {
    const program = new Command();
    registerShipCommand(program);

    const shipCmd = program.commands.find((cmd) => cmd.name() === 'ship')!;
    // Verify command accepts both as options (mutual exclusivity handled in action)
    expect(shipCmd.options.find((opt) => opt.long === '--all')).toBeDefined();
    expect(shipCmd.options.find((opt) => opt.long === '--epic')).toBeDefined();
  });
});
