#!/usr/bin/env node
// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { LancelotServer } from '../core/server.js';
import type { ToolContext } from '../core/tool-base.js';
import { ConfigurationService } from '../services/config.js';
import { CredentialService } from '../services/credentials.js';
import { EmbeddingsService } from '../services/embeddings-service.js';
import { LanceDBService } from '../services/lancedb-service.js';
import { LoggerService } from '../services/logger.js';

// stdout is the MCP channel. Anything that prints through console.log would corrupt it,
// so every console method that writes to stdout writes to stderr instead.
/* eslint-disable no-console */
console.log = console.error;
console.info = console.error;
console.debug = console.error;
/* eslint-enable no-console */

function readVersion(): string {
  const url = new URL('../../package.json', import.meta.url);
  return (JSON.parse(readFileSync(fileURLToPath(url), 'utf-8')) as { version: string }).version;
}

async function main(): Promise<void> {
  const logger = new LoggerService();
  const credentialService = new CredentialService(logger);
  const configService = new ConfigurationService(credentialService, logger);
  configService.initialize();

  const embeddings = new EmbeddingsService(configService, logger);
  await embeddings.initialize();

  const lancedb = new LanceDBService(configService, logger);
  if (configService.getConfig().lancedb.path) {
    try {
      await lancedb.initialize();
    } catch (error) {
      logger.warn('Could not open the LanceDB database. The tools report errors until it can.', {
        error,
      });
    }
  }

  const context: ToolContext = {
    config: { version: readVersion() },
    logger,
    configService,
    lancedb,
    embeddings,
  };
  const server = new LancelotServer(context);
  await server.start();

  const shutdown = (): void => {
    void lancedb.close().then(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  // The client closes stdin to ask for shutdown.
  process.stdin.on('end', shutdown);
}

main().catch((error: unknown) => {
  console.error('Lancelot failed to start:', error instanceof Error ? error.message : error);
  process.exit(1);
});
