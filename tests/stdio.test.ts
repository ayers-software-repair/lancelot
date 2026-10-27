// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from 'vitest';
import winston from 'winston';
import { LOG_LEVELS, LoggerService } from '../src/services/logger.js';

type Writable = { write: (...args: unknown[]) => boolean };
type Spy = { mock: { calls: unknown[][] } };
type Method = (...args: unknown[]) => unknown;

function spy(target: object, method: string): Spy {
  const watcher = vi.spyOn(target as Record<string, Method>, method);
  watcher.mockImplementation(() => true);
  return watcher;
}

/**
 * winston's Console transport writes through console._stdout / console._stderr, or through
 * console.log / console.error when those are missing. Watch every one of them.
 */
function watch(): { stdout: Spy[]; stderr: Spy[] } {
  const c = console as unknown as { _stdout?: Writable; _stderr?: Writable };
  const stdout = [spy(process.stdout, 'write'), spy(console, 'log')];
  const stderr = [spy(process.stderr, 'write'), spy(console, 'error'), spy(console, 'warn')];
  if (c._stdout) {
    stdout.push(spy(c._stdout, 'write'));
  }
  if (c._stderr) {
    stderr.push(spy(c._stderr, 'write'));
  }
  return { stdout, stderr };
}

const calls = (spies: Spy[]): number => spies.reduce((sum, spy) => sum + spy.mock.calls.length, 0);
const tick = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

afterEach(() => {
  vi.restoreAllMocks();
});

describe('logger', () => {
  it('covers every winston level', () => {
    expect(LOG_LEVELS).toEqual(Object.keys(winston.config.npm.levels));
    expect(LOG_LEVELS).toEqual(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']);
  });

  it('has only console transports, each sending every level to stderr', () => {
    const logger = new LoggerService({ level: 'silly' });
    const { transports } = (logger as unknown as { logger: winston.Logger }).logger;
    expect(transports.length).toBeGreaterThan(0);
    for (const transport of transports) {
      expect(transport).toBeInstanceOf(winston.transports.Console);
      const levels = (transport as unknown as { stderrLevels: Record<string, boolean> }).stderrLevels;
      expect(Object.keys(levels).sort()).toEqual([...LOG_LEVELS].sort());
    }
  });

  it('writes nothing to stdout at any level', async () => {
    const logger = new LoggerService({ level: 'silly' });
    const { stdout, stderr } = watch();
    for (const level of LOG_LEVELS) {
      logger.log(level, `message at ${level}`, { level });
    }
    await tick();
    expect(calls(stdout)).toBe(0);
    expect(calls(stderr)).toBeGreaterThanOrEqual(LOG_LEVELS.length);
  });
});

describe('server module', () => {
  it('writes nothing to stdout when imported, built, or asked for its tools', async () => {
    const { stdout } = watch();
    const { LancelotServer } = await import('../src/core/server.js');
    const logger = new LoggerService({ level: 'silly' });
    const server = new LancelotServer({ config: { version: '0.0.0' }, logger });
    expect(server.getToolRegistry().listTools()).toHaveLength(4);
    await server.getToolRegistry().executeTool('lancedb_version', {});
    await tick();
    expect(calls(stdout)).toBe(0);
  });

  it.todo(
    'answers an initialize request with JSON lines only on stdout (needs a built dist: spawn node dist/bin/lancelot.js with a temp LANCEDB_PATH)',
  );
});
