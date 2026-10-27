#!/usr/bin/env node
// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * Interactive setup. Writes the database settings to the config file and the OpenAI API key
 * to the credential store. The server does not need it when LANCEDB_PATH and OPENAI_API_KEY
 * are set in its environment. This command talks to a person at a terminal, so it uses
 * stdout; the server never does.
 */
import { existsSync } from 'node:fs';
import inquirer from 'inquirer';
import { ConfigurationService } from '../services/config.js';
import { CredentialService } from '../services/credentials.js';
import { LoggerService } from '../services/logger.js';
import { EMBEDDING_DEFAULTS, LANCEDB_DEFAULTS } from '../config/constants.js';

const say = (line = ''): void => {
  process.stdout.write(`${line}\n`);
};

interface Answers {
  dbPath: string;
  advanced: boolean;
  configureEmbeddings: boolean;
}

interface AdvancedAnswers {
  defaultTable: string;
  textColumn: string;
  vectorColumn: string;
  defaultLimit: number;
  contextBudget: number;
  model: string;
}

async function main(): Promise<void> {
  const logger = new LoggerService({ level: 'error' });
  const credentialService = new CredentialService(logger);
  const configService = new ConfigurationService(credentialService, logger);
  const current = configService.getConfig();

  if (current.lancedb.path) {
    const { overwrite } = await inquirer.prompt<{ overwrite: boolean }>([
      {
        type: 'confirm',
        name: 'overwrite',
        message: 'Lancelot is already configured. Reconfigure?',
        default: false,
      },
    ]);
    if (!overwrite) {
      say('Setup cancelled. The existing settings are unchanged.');
      return;
    }
  }

  say('Lancelot setup');
  const basic = await inquirer.prompt<Answers>([
    {
      type: 'input',
      name: 'dbPath',
      message: 'LanceDB database folder:',
      default: current.lancedb.path || undefined,
      validate: (input: string) => {
        if (!input) {
          return 'A database folder is required';
        }
        return existsSync(input) ? true : `Path does not exist: ${input}`;
      },
    },
    { type: 'confirm', name: 'advanced', message: 'Change table, column and limit settings?', default: false },
    {
      type: 'confirm',
      name: 'configureEmbeddings',
      message: 'Store an OpenAI API key for vector search?',
      default: true,
    },
  ]);

  let advanced: AdvancedAnswers = {
    defaultTable: current.lancedb.defaultTable,
    textColumn: current.lancedb.textColumn,
    vectorColumn: current.lancedb.vectorColumn,
    defaultLimit: current.lancedb.defaultLimit,
    contextBudget: current.lancedb.contextBudget,
    model: current.embeddings.model,
  };
  if (basic.advanced) {
    advanced = await inquirer.prompt<AdvancedAnswers>([
      { type: 'input', name: 'defaultTable', message: 'Default table:', default: advanced.defaultTable },
      { type: 'input', name: 'textColumn', message: 'Text column:', default: advanced.textColumn },
      { type: 'input', name: 'vectorColumn', message: 'Vector column:', default: advanced.vectorColumn },
      { type: 'number', name: 'defaultLimit', message: 'Default result limit:', default: advanced.defaultLimit },
      { type: 'number', name: 'contextBudget', message: 'Context budget (characters):', default: advanced.contextBudget },
      { type: 'input', name: 'model', message: 'Embedding model:', default: advanced.model },
    ]);
  }

  let apiKey: string | undefined;
  if (basic.configureEmbeddings) {
    ({ apiKey } = await inquirer.prompt<{ apiKey: string }>([
      {
        type: 'password',
        name: 'apiKey',
        message: 'OpenAI API key:',
        mask: '*',
        validate: (input: string) =>
          input.trim().startsWith('sk-') ? true : 'An OpenAI API key starts with sk-',
      },
    ]));
  }

  configService.set('lancedb', {
    path: basic.dbPath,
    defaultTable: advanced.defaultTable,
    textColumn: advanced.textColumn,
    vectorColumn: advanced.vectorColumn,
    defaultLimit: advanced.defaultLimit || LANCEDB_DEFAULTS.DEFAULT_LIMIT,
    contextBudget: advanced.contextBudget || LANCEDB_DEFAULTS.CONTEXT_BUDGET,
  });
  configService.set('embeddings', {
    provider: EMBEDDING_DEFAULTS.PROVIDER,
    model: advanced.model || EMBEDDING_DEFAULTS.MODEL,
    dimensions: current.embeddings.dimensions,
  });
  say('Database settings saved.');

  if (apiKey) {
    const backend = await credentialService.setCredential('OPENAI_API_KEY', apiKey.trim());
    say(`OpenAI API key stored in the ${backend} credential store.`);
  }

  say('Start the server with: lancelot');
}

main()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    process.stderr.write(`Setup failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
