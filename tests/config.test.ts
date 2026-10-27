// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import OpenAI from 'openai';
import { ConfigurationService } from '../src/services/config.js';
import type { CredentialService } from '../src/services/credentials.js';
import { EmbeddingsService } from '../src/services/embeddings-service.js';
import type { LoggerService } from '../src/services/logger.js';

vi.mock('openai', () => ({ default: vi.fn() }));

const credentials = (stored: string | null): CredentialService =>
  ({ getCredential: vi.fn(async () => stored), setCredential: vi.fn() }) as unknown as CredentialService;

const logger = () =>
  ({ info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }) as unknown as LoggerService & {
    warn: ReturnType<typeof vi.fn>;
    error: ReturnType<typeof vi.fn>;
  };

let dir: string;
const config = (stored: string | null = null, log?: LoggerService): ConfigurationService =>
  new ConfigurationService(credentials(stored), log, { cwd: dir });

// A developer's own settings must not leak into the tests.
const ENV_NAMES = [
  'OPENAI_API_KEY',
  'LANCEDB_PATH',
  'LANCEDB_TABLE',
  'LANCEDB_TEXT_COLUMN',
  'LANCEDB_VECTOR_COLUMN',
  'LANCEDB_DEFAULT_LIMIT',
  'LANCEDB_CONTEXT_BUDGET',
  'EMBEDDING_MODEL',
  'EMBEDDING_DIMENSIONS',
];
const saved = new Map<string, string | undefined>();

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'lancelot-test-'));
  for (const name of ENV_NAMES) {
    saved.set(name, process.env[name]);
    delete process.env[name];
  }
  vi.mocked(OpenAI).mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  for (const [name, value] of saved) {
    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }
  rmSync(dir, { recursive: true, force: true });
});

describe('API key', () => {
  it.each([[''], ['   '], ['\t\n']])('treats a blank OPENAI_API_KEY (%j) as unset', async (blank) => {
    vi.stubEnv('OPENAI_API_KEY', blank);
    expect(await config(null).getApiKey('openai')).toBeNull();
  });

  it('falls back to the credential store when the variable is blank', async () => {
    vi.stubEnv('OPENAI_API_KEY', '  ');
    expect(await config('sk-stored').getApiKey('openai')).toBe('sk-stored');
  });

  it('prefers the variable, trimmed, over the credential store', async () => {
    vi.stubEnv('OPENAI_API_KEY', ' sk-env ');
    expect(await config('sk-stored').getApiKey('openai')).toBe('sk-env');
  });

  it.each([[''], ['   ']])(
    'a blank key gives text search: no OpenAI client, no warning, no error (%j)',
    async (blank) => {
      vi.stubEnv('OPENAI_API_KEY', blank);
      const log = logger();
      const embeddings = new EmbeddingsService(config(null, log), log);
      await expect(embeddings.initialize()).resolves.toBeUndefined();
      expect(embeddings.isAvailable()).toBe(false);
      expect(await embeddings.generateEmbedding('anything')).toBeNull();
      expect(OpenAI).not.toHaveBeenCalled();
      expect(log.warn).not.toHaveBeenCalled();
      expect(log.error).not.toHaveBeenCalled();
    },
  );

  it('creates the OpenAI client when a key is set', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'sk-test');
    const embeddings = new EmbeddingsService(config(null));
    await embeddings.initialize();
    expect(embeddings.isAvailable()).toBe(true);
    expect(OpenAI).toHaveBeenCalledWith({ apiKey: 'sk-test' });
  });
});

describe('settings', () => {
  it('uses the defaults when nothing is set', () => {
    expect(config().getConfig()).toEqual({
      lancedb: {
        path: '',
        defaultTable: 'documents',
        textColumn: 'text',
        vectorColumn: 'vector',
        defaultLimit: 20,
        contextBudget: 8000,
      },
      embeddings: { provider: 'openai', model: 'text-embedding-ada-002', dimensions: 1536 },
    });
  });

  it('treats a blank LANCEDB_PATH as unset', () => {
    vi.stubEnv('LANCEDB_PATH', '  ');
    expect(config().getConfig().lancedb.path).toBe('');
  });

  it('lets the environment win over the file written by lancelot-init', () => {
    const service = config();
    service.set('lancedb', { ...service.getConfig().lancedb, path: '/stored' });
    expect(config().getConfig().lancedb.path).toBe('/stored');

    vi.stubEnv('LANCEDB_PATH', '/from-env');
    vi.stubEnv('LANCEDB_DEFAULT_LIMIT', '5');
    const after = config().getConfig().lancedb;
    expect(after.path).toBe('/from-env');
    expect(after.defaultLimit).toBe(5);
  });

  it('ignores a number that is not a positive integer', () => {
    vi.stubEnv('LANCEDB_DEFAULT_LIMIT', 'many');
    vi.stubEnv('LANCEDB_CONTEXT_BUDGET', '-3');
    const { defaultLimit, contextBudget } = config().getConfig().lancedb;
    expect([defaultLimit, contextBudget]).toEqual([20, 8000]);
  });
});
