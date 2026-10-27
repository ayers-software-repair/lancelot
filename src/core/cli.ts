// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { HTTP_DEFAULTS, HTTP_ENV } from '../config/constants.js';

export interface HttpOptions {
  port: number;
  host: string;
  allowedOrigins: string[];
  allowedHosts: string[];
}

/** `http` is undefined for stdio, which is what runs without --http. */
export interface CliOptions {
  http?: HttpOptions;
}

/** A comma list from an environment variable. Blank items and a blank variable count as none. */
export function csvList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

function parsePort(value: string): number {
  const port = Number(value);
  if (!/^\d+$/.test(value) || port < 1 || port > 65535) {
    throw new Error(`--http takes a port from 1 to 65535, not "${value}"`);
  }
  return port;
}

const isLoopback = (host: string): boolean =>
  host === '127.0.0.1' || host === 'localhost' || host === '::1';

/**
 * `--http [port]` (default 3000), `--host <address>` (default 127.0.0.1), and the two
 * allow-list variables. With no allowed hosts set and a loopback bind, the Host header must be
 * one of the loopback names on the port. Anything else on argv is ignored, as before.
 */
export function parseCli(argv: string[], env: NodeJS.ProcessEnv = process.env): CliOptions {
  let port: number | undefined;
  let host: string | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string;
    if (arg === '--http') {
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('-')) {
        port = parsePort(next);
        i++;
      } else {
        port = HTTP_DEFAULTS.PORT;
      }
    } else if (arg.startsWith('--http=')) {
      port = parsePort(arg.slice('--http='.length));
    } else if (arg === '--host') {
      host = argv[++i];
      if (!host || host.startsWith('-')) {
        throw new Error('--host needs an address, such as 0.0.0.0');
      }
    } else if (arg.startsWith('--host=')) {
      host = arg.slice('--host='.length);
    }
  }

  if (port === undefined) {
    if (host !== undefined) {
      throw new Error('--host only applies with --http');
    }
    return {};
  }

  const bind = host || HTTP_DEFAULTS.HOST;
  let allowedHosts = csvList(env[HTTP_ENV.ALLOWED_HOSTS]);
  if (allowedHosts.length === 0 && isLoopback(bind)) {
    allowedHosts = [`127.0.0.1:${port}`, `localhost:${port}`, `[::1]:${port}`];
  }
  return {
    http: { port, host: bind, allowedOrigins: csvList(env[HTTP_ENV.ALLOWED_ORIGINS]), allowedHosts },
  };
}
