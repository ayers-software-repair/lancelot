#!/usr/bin/env node
// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { createServer as createNodeServer } from 'node:http';
import { parseCli } from '../core/cli.js';
import { createHttpHandler } from '../core/http.js';
import { createRuntime, redirectConsoleToStderr } from '../core/runtime.js';
import { LancelotServer } from '../core/server.js';
import { HTTP_DEFAULTS } from '../config/constants.js';

// stdout is the MCP channel on stdio. Anything that prints through console.log would corrupt it.
redirectConsoleToStderr();

async function main(): Promise<void> {
  const { http } = parseCli(process.argv.slice(2));
  const { context, lancedb, logger } = await createRuntime({
    packageJson: new URL('../../package.json', import.meta.url),
    transport: http ? 'http' : 'stdio',
  });
  const server = new LancelotServer(context);

  const shutdown = (): void => {
    void lancedb.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  if (!http) {
    await server.start();
    // The client closes stdin to ask for shutdown.
    process.stdin.on('end', shutdown);
    return;
  }

  const handler = createHttpHandler({
    createServer: () => server.newServer(),
    allowedOrigins: http.allowedOrigins,
    allowedHosts: http.allowedHosts,
    path: HTTP_DEFAULTS.PATH,
    logger,
  });
  if (http.allowedHosts.length === 0) {
    logger.warn('No allowed hosts are set, so the Host header is not checked.');
  }
  createNodeServer((req, res) => void handler(req, res)).listen(http.port, http.host, () => {
    logger.info('Lancelot listening', {
      url: `http://${http.host}:${http.port}${HTTP_DEFAULTS.PATH}`,
      version: context.config.version,
    });
  });
}

main().catch((error: unknown) => {
  console.error('Lancelot failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
