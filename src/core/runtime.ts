// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { ToolContext } from './tool-base.js';
import { ConfigurationService } from '../services/config.js';
import { CredentialService } from '../services/credentials.js';
import { EmbeddingsService } from '../services/embeddings-service.js';
import { LanceDBService } from '../services/lancedb-service.js';
import { LoggerService } from '../services/logger.js';

/**
 * Anything that prints through console.log, console.info or console.debug goes to stderr.
 * On stdio, stdout is the MCP channel and one stray line breaks the client.
 */
export function redirectConsoleToStderr(): void {
  /* eslint-disable no-console */
  console.log = console.error;
  console.info = console.error;
  console.debug = console.error;
  /* eslint-enable no-console */
}

export interface RuntimeOptions {
  /** The package.json to read the version from, as a URL relative to the entry file. */
  packageJson: URL;
  transport: 'stdio' | 'http';
  /** Where settings and credentials are kept. Default: the per-user config folder. */
  configDir?: string;
}

export interface Runtime {
  context: ToolContext;
  configService: ConfigurationService;
  lancedb: LanceDBService;
  logger: LoggerService;
}

/** Opens `lancedb` when a path is configured. A failure is logged and the tools report it. */
export async function connectLanceDb(
  configService: ConfigurationService,
  lancedb: LanceDBService,
  logger: LoggerService,
): Promise<void> {
  if (!configService.getConfig().lancedb.path) {
    return;
  }
  try {
    await lancedb.initialize();
  } catch (error) {
    logger.warn('Could not open the LanceDB database. The tools report errors until it can.', {
      error,
    });
  }
}

/** The services every transport shares: settings, embeddings, the database and the logger. */
export async function createRuntime(options: RuntimeOptions): Promise<Runtime> {
  const logger = new LoggerService();
  const cwd = options.configDir ? { cwd: options.configDir } : undefined;
  const credentialService = new CredentialService(logger, cwd);
  const configService = new ConfigurationService(credentialService, logger, cwd);
  configService.initialize();

  const embeddings = new EmbeddingsService(configService, logger);
  await embeddings.initialize();

  const lancedb = new LanceDBService(configService, logger);
  await connectLanceDb(configService, lancedb, logger);

  const version = (
    JSON.parse(readFileSync(fileURLToPath(options.packageJson), 'utf-8')) as { version: string }
  ).version;
  const context: ToolContext = {
    config: { version, transport: options.transport },
    logger,
    configService,
    lancedb,
    embeddings,
  };
  return { context, configService, lancedb, logger };
}
