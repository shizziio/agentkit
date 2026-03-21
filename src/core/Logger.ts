import * as fs from 'node:fs';
import * as path from 'node:path';

import { LOG_FILE_MAX_SIZE, LOG_MAX_BACKUPS } from '@config/defaults.js';

import eventBus from './EventBus.js';
import type { LogEvent } from './EventTypes.js';
import { LoggerError } from './Errors.js';
import { formatLocalDateTime } from '@shared/FormatTime.js';

type LogLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR';

export type LoggerLike = {
  debug(message: string, data?: Record<string, unknown>): void;
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
};

interface LoggerOptions {
  logDir: string;
  level: 'DEBUG' | 'INFO';
}

export class LoggerInstance {
  constructor(
    private readonly module: string,
    private readonly logger: Logger,
  ) {}

  debug(message: string, data?: Record<string, unknown>): void {
    this.logger.log('DEBUG', this.module, message, data);
  }

  info(message: string, data?: Record<string, unknown>): void {
    this.logger.log('INFO', this.module, message, data);
  }

  warn(message: string, data?: Record<string, unknown>): void {
    this.logger.log('WARN', this.module, message, data);
  }

  error(message: string, data?: Record<string, unknown>): void {
    this.logger.log('ERROR', this.module, message, data);
  }
}

export class Logger {
  private static instance: Logger | null = null;

  private logDir: string;
  private level: 'DEBUG' | 'INFO';

  private constructor(options: LoggerOptions) {
    this.logDir = path.resolve(options.logDir);
    this.level = options.level;
    fs.mkdirSync(this.logDir, { recursive: true });
  }

  static init(options: LoggerOptions): void {
    if (Logger.instance !== null) {
      return;
    }
    Logger.instance = new Logger(options);
  }

  /**
   * For testing only. Resets the singleton so init() can be called again.
   * @internal
   */
  static reset(): void {
    if (process.env['NODE_ENV'] !== 'test') {
      return;
    }
    Logger.instance = null;
  }

  static getLogger(module: string): LoggerInstance {
    if (Logger.instance === null) {
      throw new LoggerError('Logger not initialized. Call Logger.init() first.');
    }
    return new LoggerInstance(module, Logger.instance);
  }

  /**
   * Returns a real LoggerInstance when initialized, or a lazy proxy that no-ops until
   * Logger.init() is called. Safe to call at module scope.
   */
  static getOrNoop(module: string): LoggerLike {
    if (Logger.instance !== null) {
      return new LoggerInstance(module, Logger.instance)
    }
    let cached: LoggerInstance | null = null
    const resolve = (): LoggerLike => {
      if (cached !== null) return cached
      if (Logger.instance !== null) {
        cached = new LoggerInstance(module, Logger.instance)
        return cached
      }
      return { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    }
    return {
      debug: (m, d) => resolve().debug(m, d),
      info:  (m, d) => resolve().info(m, d),
      warn:  (m, d) => resolve().warn(m, d),
      error: (m, d) => resolve().error(m, d),
    }
  }

  log(level: LogLevel, module: string, message: string, data?: Record<string, unknown>): void {
    if (level === 'DEBUG' && this.level === 'INFO') {
      return;
    }

    const timestamp = new Date().toISOString();
    const entry: LogEvent = { level, module, message, timestamp, data };

    const line = this.formatLine(timestamp, level, module, message, data);
    this.writeToFile(line);

    if (level !== 'DEBUG') {
      this.emitEvent(entry);
    }
  }

  private formatLine(
    timestamp: string,
    level: LogLevel,
    module: string,
    message: string,
    data?: Record<string, unknown>,
  ): string {
    const localTs = formatLocalDateTime(timestamp);
    let line = `[${localTs}] [${level}]  [${module}] ${message}`;
    if (data !== undefined && Object.keys(data).length > 0) {
      let jsonStr: string;
      try {
        jsonStr = JSON.stringify(data);
      } catch {
        jsonStr = JSON.stringify({ _serializationError: true });
      }
      line += ` ${jsonStr}`;
    }
    return line;
  }

  private writeToFile(line: string): void {
    const logPath = path.join(this.logDir, 'agentkit.log');

    let size = 0;
    try {
      const stat = fs.statSync(logPath);
      size = stat.size;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    if (size >= LOG_FILE_MAX_SIZE) {
      this.rotate(logPath);
    }

    fs.appendFileSync(logPath, line + '\n', 'utf8');
  }

  private rotate(logPath: string): void {
    const backup = (n: number) => `${logPath}.${n}`;

    // Delete oldest backup if it exists
    try {
      fs.unlinkSync(backup(LOG_MAX_BACKUPS));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }

    // Shift backups down: .log.2 -> .log.3, .log.1 -> .log.2
    for (let i = LOG_MAX_BACKUPS - 1; i >= 1; i--) {
      try {
        fs.renameSync(backup(i), backup(i + 1));
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw err;
        }
      }
    }

    // agentkit.log -> agentkit.log.1
    try {
      fs.renameSync(logPath, backup(1));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw err;
      }
    }
  }

  private emitEvent(entry: LogEvent): void {
    try {
      eventBus.emit('app:log', entry);
    } catch {
      // best-effort: never throws
    }
  }
}

export default Logger;
