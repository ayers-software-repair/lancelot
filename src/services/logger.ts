// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import winston from 'winston';

/** Every winston level. All of them go to stderr: stdout carries MCP messages only. */
export const LOG_LEVELS: string[] = Object.keys(winston.config.npm.levels);

export interface LoggingConfig {
  level?: string;
  silent?: boolean;
}

const serialize = (_key: string, value: unknown): unknown =>
  value instanceof Error ? { message: value.message, stack: value.stack } : value;

export class LoggerService {
  private logger: winston.Logger;

  constructor(config?: LoggingConfig) {
    this.logger = winston.createLogger({
      level: config?.level ?? process.env.LANCELOT_LOG_LEVEL ?? 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const tail = Object.keys(meta).length > 0 ? ` ${JSON.stringify(meta, serialize)}` : '';
          return `[${String(timestamp)}] ${level.toUpperCase()}: ${String(message)}${tail}`;
        }),
      ),
      transports: [
        new winston.transports.Console({ stderrLevels: LOG_LEVELS, silent: config?.silent }),
      ],
    });
  }

  log(level: string, message: string, meta?: Record<string, unknown>): void {
    if (meta) {
      this.logger.log(level, message, meta);
    } else {
      this.logger.log(level, message);
    }
  }

  info(message: string, meta?: Record<string, unknown>): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: Record<string, unknown>): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: Record<string, unknown>): void {
    this.log('error', message, meta);
  }

  debug(message: string, meta?: Record<string, unknown>): void {
    this.log('debug', message, meta);
  }
}
