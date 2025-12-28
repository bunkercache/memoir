/**
 * Logging Service
 *
 * Logging for the Memoir plugin using OpenCode's logging API.
 * Falls back to file-based logging if the client is not available.
 */

import { appendFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir, platform } from 'node:os';
import type { LoggingConfig } from '../types.ts';

type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

/**
 * OpenCode client interface for logging.
 */
interface OpenCodeLogOptions {
  body: {
    service: string;
    level: LogLevel;
    message: string;
    extra?: Record<string, unknown>;
  };
}

interface OpenCodeClient {
  app: {
    log(_options: OpenCodeLogOptions): Promise<unknown>;
  };
}

/**
 * Get the OpenCode log directory path for fallback file logging.
 */
function getOpenCodeLogDir(): string {
  const os = platform();
  if (os === 'darwin') {
    return join(homedir(), '.local', 'share', 'opencode', 'log');
  }
  if (os === 'win32') {
    return join(process.env.APPDATA || join(homedir(), 'AppData', 'Roaming'), 'opencode', 'log');
  }
  const xdgData = process.env.XDG_DATA_HOME || join(homedir(), '.local', 'share');
  return join(xdgData, 'opencode', 'log');
}

/**
 * Format an error for logging.
 */
function formatError(error: Error, depth = 0): string {
  const result = error.message;
  return error.cause instanceof Error && depth < 10
    ? result + ' Caused by: ' + formatError(error.cause, depth + 1)
    : result;
}

/**
 * Singleton logger service for Memoir plugin.
 *
 * Uses OpenCode's logging API when available, falls back to file-based logging.
 */
export class Logger {
  private static instance: Logger | null = null;
  private static client: OpenCodeClient | null = null;

  private readonly config: LoggingConfig;
  private readonly minLevel: LogLevel;
  private readonly fallbackPath: string | null;

  private constructor(config: LoggingConfig, storagePath: string) {
    this.config = config;
    this.minLevel = config.debug ? 'debug' : 'info';

    // Set up fallback file logging path
    if (config.file) {
      this.fallbackPath = join(storagePath, config.file);
    } else if (config.debug) {
      this.fallbackPath = join(getOpenCodeLogDir(), 'memoir.log');
    } else {
      this.fallbackPath = null;
    }

    // Ensure fallback directory exists
    if (this.fallbackPath) {
      const dir = dirname(this.fallbackPath);
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
    }
  }

  /**
   * Set the OpenCode client for API-based logging.
   */
  static setClient(client: OpenCodeClient): void {
    Logger.client = client;
  }

  /**
   * Initialize the logger service.
   */
  static initialize(config: LoggingConfig, storagePath: string): Logger {
    if (Logger.instance) {
      return Logger.instance;
    }
    Logger.instance = new Logger(config, storagePath);

    // Log startup
    Logger.instance.info('logger initialized', {
      debug: config.debug,
      fallbackPath: Logger.instance.fallbackPath,
      hasClient: !!Logger.client,
    });

    return Logger.instance;
  }

  /**
   * Get the logger instance.
   * Returns a no-op logger if not initialized.
   */
  static get(): Logger {
    if (!Logger.instance) {
      return {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        isEnabled: () => false,
        getPath: () => null,
      } as unknown as Logger;
    }
    return Logger.instance;
  }

  /**
   * Reset the logger instance (for testing).
   */
  static reset(): void {
    Logger.instance = null;
    Logger.client = null;
  }

  /**
   * Check if logging is enabled.
   */
  isEnabled(): boolean {
    return this.config.debug || !!Logger.client;
  }

  /**
   * Get the fallback log file path.
   */
  getPath(): string | null {
    return this.fallbackPath;
  }

  /**
   * Check if a level should be logged.
   */
  private shouldLog(level: LogLevel): boolean {
    return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[this.minLevel];
  }

  /**
   * Format extra data for logging.
   */
  private formatExtra(extra?: Record<string, unknown>): Record<string, unknown> | undefined {
    if (!extra) return undefined;

    const formatted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(extra)) {
      if (value instanceof Error) {
        formatted[key] = formatError(value);
      } else {
        formatted[key] = value;
      }
    }
    return formatted;
  }

  /**
   * Write to fallback file.
   */
  private writeToFile(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
    if (!this.fallbackPath) return;

    const timestamp = new Date().toISOString().split('.')[0];
    const levelStr = level.toUpperCase().padEnd(5);
    const extraStr = extra ? ' ' + JSON.stringify(extra) : '';
    const line = `${levelStr} ${timestamp} service=memoir ${message}${extraStr}\n`;

    try {
      appendFileSync(this.fallbackPath, line);
    } catch {
      // Silently fail
    }
  }

  /**
   * Log a message.
   */
  private async log(
    level: LogLevel,
    message: string,
    extra?: Record<string, unknown>
  ): Promise<void> {
    if (!this.shouldLog(level)) return;

    const formattedExtra = this.formatExtra(extra);

    // Try OpenCode API first
    if (Logger.client) {
      try {
        await Logger.client.app.log({
          body: {
            service: 'memoir',
            level,
            message,
            extra: formattedExtra,
          },
        });
        return;
      } catch {
        // Fall through to file logging
      }
    }

    // Fallback to file logging
    this.writeToFile(level, message, formattedExtra);
  }

  /**
   * Log a debug message.
   */
  debug(message: string, extra?: Record<string, unknown>): void {
    void this.log('debug', message, extra);
  }

  /**
   * Log an info message.
   */
  info(message: string, extra?: Record<string, unknown>): void {
    void this.log('info', message, extra);
  }

  /**
   * Log a warning message.
   */
  warn(message: string, extra?: Record<string, unknown>): void {
    void this.log('warn', message, extra);
  }

  /**
   * Log an error message.
   */
  error(message: string, extra?: Record<string, unknown>): void {
    void this.log('error', message, extra);
  }
}
