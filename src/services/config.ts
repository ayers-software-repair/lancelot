// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import Conf from 'conf';
import type { LoggerService } from './logger.js';
import type { CredentialService } from './credentials.js';
import { LANCEDB_DEFAULTS, EMBEDDING_DEFAULTS, MISC } from '../config/constants.js';

export interface LancelotConfig {
  lancedb: {
    path: string;
    defaultTable: string;
    textColumn: string;
    vectorColumn: string;
    defaultLimit: number;
    contextBudget: number;
  };
  embeddings: {
    provider: string;
    model: string;
    dimensions: number;
  };
}

const DEFAULT_CONFIG: LancelotConfig = {
  lancedb: {
    path: '',
    defaultTable: LANCEDB_DEFAULTS.TABLE,
    textColumn: LANCEDB_DEFAULTS.TEXT_COLUMN,
    vectorColumn: LANCEDB_DEFAULTS.VECTOR_COLUMN,
    defaultLimit: LANCEDB_DEFAULTS.DEFAULT_LIMIT,
    contextBudget: LANCEDB_DEFAULTS.CONTEXT_BUDGET,
  },
  embeddings: {
    provider: EMBEDDING_DEFAULTS.PROVIDER,
    model: EMBEDDING_DEFAULTS.MODEL,
    dimensions: EMBEDDING_DEFAULTS.DIMENSIONS,
  },
};

/**
 * An environment variable that is unset, empty or only whitespace counts as not set.
 * An MCP client that substitutes a blank optional value passes an empty string.
 */
function envString(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function envPositiveInt(name: string): number | undefined {
  const value = Number.parseInt(envString(name) ?? '', 10);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

function definedOnly<T extends object>(values: { [K in keyof T]?: T[K] | undefined }): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * Settings come from, in order of priority: environment variables, the file written by
 * lancelot-init, the defaults.
 */
export class ConfigurationService {
  private conf: Conf<LancelotConfig>;
  private credentialService: CredentialService;
  private logger?: LoggerService;
  private config: LancelotConfig;

  constructor(
    credentialService: CredentialService,
    logger?: LoggerService,
    options?: { cwd?: string },
  ) {
    this.credentialService = credentialService;
    this.logger = logger;
    this.conf = new Conf<LancelotConfig>({
      projectName: MISC.SERVICE_NAME,
      configName: 'config',
      clearInvalidConfig: true,
      defaults: DEFAULT_CONFIG,
      ...(options?.cwd ? { cwd: options.cwd } : {}),
    });
    this.config = this.load();
  }

  private load(): LancelotConfig {
    const stored = this.conf.store;
    return {
      lancedb: {
        ...stored.lancedb,
        ...definedOnly<LancelotConfig['lancedb']>({
          path: envString('LANCEDB_PATH'),
          defaultTable: envString('LANCEDB_TABLE'),
          textColumn: envString('LANCEDB_TEXT_COLUMN'),
          vectorColumn: envString('LANCEDB_VECTOR_COLUMN'),
          defaultLimit: envPositiveInt('LANCEDB_DEFAULT_LIMIT'),
          contextBudget: envPositiveInt('LANCEDB_CONTEXT_BUDGET'),
        }),
      },
      embeddings: {
        ...stored.embeddings,
        ...definedOnly<LancelotConfig['embeddings']>({
          model: envString('EMBEDDING_MODEL'),
          dimensions: envPositiveInt('EMBEDDING_DIMENSIONS'),
        }),
      },
    };
  }

  initialize(): void {
    if (!this.config.lancedb.path) {
      this.logger?.warn('LanceDB path not configured. Set LANCEDB_PATH or run lancelot-init.');
    }
    this.logger?.info('Configuration loaded', {
      lancedbPath: this.config.lancedb.path ? 'configured' : 'not configured',
      defaultTable: this.config.lancedb.defaultTable,
    });
  }

  getConfig(): LancelotConfig {
    return this.config;
  }

  /** Writes one section to the config file. Environment variables still win when read. */
  set<K extends keyof LancelotConfig>(key: K, value: LancelotConfig[K]): void {
    this.conf.set(key, value);
    this.config = this.load();
  }

  /**
   * The API key for a provider: OPENAI_API_KEY from the environment, else the credential
   * store. A blank value is the same as none.
   */
  async getApiKey(provider: string): Promise<string | null> {
    const keyName = `${provider.toUpperCase()}_API_KEY`;
    const fromEnv = envString(keyName);
    if (fromEnv) {
      return fromEnv;
    }
    const stored = (await this.credentialService.getCredential(keyName))?.trim();
    return stored ? stored : null;
  }
}
