import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ChildProcess } from 'node:child_process';

import { ProcessManager } from '../../../src/providers/agent/ProcessManager.js';

describe('ProcessManager', () => {
  let pm: ProcessManager;

  beforeEach(() => {
    pm = new ProcessManager();
  });

  it('register adds a process; killAll sends SIGTERM to negative PID', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    pm.register(1234, {} as ChildProcess);
    pm.killAll();

    expect(killSpy).toHaveBeenCalledWith(-1234, 'SIGTERM');
    killSpy.mockRestore();
  });

  it('unregister removes a process so killAll does not kill it', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    pm.register(5678, {} as ChildProcess);
    pm.unregister(5678);
    pm.killAll();

    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });

  it('killAll calls process.kill with negative PID for each registered process', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    pm.register(100, {} as ChildProcess);
    pm.register(200, {} as ChildProcess);
    pm.register(300, {} as ChildProcess);
    pm.killAll();

    expect(killSpy).toHaveBeenCalledTimes(3);
    expect(killSpy).toHaveBeenCalledWith(-100, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(-200, 'SIGTERM');
    expect(killSpy).toHaveBeenCalledWith(-300, 'SIGTERM');
    killSpy.mockRestore();
  });

  it('killAll clears the map after killing — second call is a no-op', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    pm.register(111, {} as ChildProcess);
    pm.killAll();
    pm.killAll(); // second call should not send any signals

    expect(killSpy).toHaveBeenCalledTimes(1);
    killSpy.mockRestore();
  });

  it('killAll does not throw when a process is already dead (ESRCH swallowed)', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => {
      const err = new Error('No such process') as NodeJS.ErrnoException;
      err.code = 'ESRCH';
      throw err;
    });

    pm.register(999, {} as ChildProcess);

    expect(() => pm.killAll()).not.toThrow();
    killSpy.mockRestore();
  });

  it('killAll is a no-op when no processes are registered', () => {
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(() => true);

    expect(() => pm.killAll()).not.toThrow();
    expect(killSpy).not.toHaveBeenCalled();
    killSpy.mockRestore();
  });
});
