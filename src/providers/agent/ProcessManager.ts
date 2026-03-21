import type { ChildProcess } from 'node:child_process';

import { Logger } from '@core/Logger.js';

const logger = Logger.getOrNoop('ProcessManager');

export class ProcessManager {
  private processes = new Map<number, ChildProcess>();
  private maxConcurrent: number = Infinity;
  private teamCounts = new Map<string, number>();

  /**
   * Set the global cap on concurrent sessions.
   */
  setMaxConcurrent(max: number): void {
    this.maxConcurrent = max;
    logger.info('processManager: maxConcurrent set', { max });
  }

  /**
   * Check whether a new session can be acquired.
   * Returns false if the global limit has been reached.
   */
  canAcquire(_team?: string): boolean {
    if (this.processes.size >= this.maxConcurrent) return false;
    // Per-team quotas reserved for future use
    return true;
  }

  /**
   * Get the current active session count.
   */
  getActiveCount(): number {
    return this.processes.size;
  }

  /**
   * Get the max concurrent session limit.
   */
  getMaxConcurrent(): number {
    return this.maxConcurrent;
  }

  register(pid: number, child: ChildProcess, team?: string): void {
    this.processes.set(pid, child);
    if (team) {
      this.teamCounts.set(team, (this.teamCounts.get(team) ?? 0) + 1);
    }
    logger.info('processManager: spawned', { pid, team, active: this.processes.size, max: this.maxConcurrent });
  }

  unregister(pid: number, team?: string): void {
    this.processes.delete(pid);
    if (team) {
      const count = this.teamCounts.get(team) ?? 1;
      if (count <= 1) {
        this.teamCounts.delete(team);
      } else {
        this.teamCounts.set(team, count - 1);
      }
    }
  }

  /**
   * Sends SIGTERM to all registered process groups and clears the registry.
   * This is SIGTERM-only — the caller is responsible for any SIGKILL follow-up
   * if a stubborn child needs force-killing (e.g. graceful-shutdown handler).
   */
  killAll(): void {
    for (const [pid] of this.processes) {
      try {
        process.kill(-pid, 'SIGTERM');
        logger.info('processManager: killed', { pid });
      } catch {
        // Silently swallow errors for already-dead processes
      }
    }
    this.processes.clear();
    this.teamCounts.clear();
  }
}

export const processManager = new ProcessManager();
