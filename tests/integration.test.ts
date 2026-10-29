// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import type { Readable } from 'node:stream';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { connect } from '@lancedb/lancedb';
import * as runtimeModule from '../src/core/runtime.js';
import type { Runtime } from '../src/core/runtime.js';
import { ToolRegistry } from '../src/core/tool-registry.js';

vi.mock('../src/services/credentials.js', () => ({
  CredentialService: class {
    async getCredential(): Promise<null> {
      return null;
    }
  },
}));

const run = promisify(execFile);
const root = fileURLToPath(new URL('../', import.meta.url));
let folder: string;
let database: string;
let runtime: Runtime;
let registry: ToolRegistry;

function text(result: CallToolResult): string {
  expect(result.isError).not.toBe(true);
  const content = result.content[0];
  if (content?.type !== 'text') {
    throw new Error('Expected a text result');
  }
  return content.text;
}

function snapshot(folder: string): Record<string, string> {
  return Object.fromEntries(
    readdirSync(folder, { recursive: true, withFileTypes: true })
      .filter((file) => file.isFile())
      .map((file) => {
        const path = join(file.parentPath, file.name);
        return [
          path.slice(folder.length),
          createHash('sha256').update(readFileSync(path)).digest('hex'),
        ];
      }),
  );
}

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), 'lancelot-integration-'));
  database = join(folder, 'db');
  const docs = join(folder, 'docs');
  mkdirSync(docs);
  writeFileSync(
    join(docs, 'retention.md'),
    '# Retention\n\nCobalt otter snapshots last thirty days.',
  );
  writeFileSync(join(docs, 'routing.md'), '# Routing\n\nAmber fox routes traffic.');
  // Explicit environment prevents API keys, database locations and column overrides leaking in.
  for (const name of Object.keys(process.env)) {
    if (/^(LANCEDB_|EMBEDDING_|LANCELOT_|OPENAI_)/.test(name)) {
      vi.stubEnv(name, '');
    }
  }
  vi.stubEnv('LANCEDB_PATH', database);
  vi.stubEnv('LANCELOT_LOG_LEVEL', 'error');
  vi.stubEnv('TMPDIR', folder);
  vi.stubEnv('TEMP', folder);
  vi.stubEnv('TMP', folder);
  await run(process.execPath, [join(root, 'dist/bin/lancelot-index.js'), docs, database], {
    timeout: 15000,
  });
  runtime = await runtimeModule.createRuntime({
    packageJson: new URL('../package.json', import.meta.url),
    transport: 'stdio',
    configDir: join(folder, 'config'),
  });
  registry = new ToolRegistry(runtime.context);
}, 20000);

afterAll(async () => {
  await runtime?.lancedb.close();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  if (folder) {
    rmSync(folder, { recursive: true, force: true });
  }
});

describe('real database and transports', () => {
  it('indexes documents with the CLI and searches the resulting table', async () => {
    const out = JSON.parse(
      text(await registry.executeTool('lancedb_search', { query: 'cobalt otter' })),
    );
    expect(out).toMatchObject({ searchType: 'text', resultCount: 1 });
    expect(out.results[0]).toMatchObject({ title: 'Retention', source: 'retention.md' });
    expect(out.results[0].text).toContain('thirty days');
    const status = await runtime.lancedb.getStatus();
    expect(status.tables).toEqual([expect.objectContaining({ name: 'documents', rowCount: 2 })]);
  });

  it('retrieves a real chunk with its citation and excludes unrelated text', async () => {
    const answer = text(await registry.executeTool('lancedb_query', { question: 'cobalt' }));
    expect(answer).toContain('Source: retention.md');
    expect(answer).toContain('Cobalt otter snapshots last thirty days.');
    expect(answer).not.toContain('Amber fox');
  });

  it('runs escaped filters against LanceDB, including a spaced column and quote/wildcard input', async () => {
    const db = await connect(database);
    try {
      await db.createTable('custom', [
        { title: 'Match', 'Text Col': "Beta's 100% value" },
        { title: 'Other', 'Text Col': 'Unrelated item' },
      ]);
    } finally {
      db.close();
    }
    const hits = await runtime.lancedb.textSearch('custom', 'BETA', 5, 'Text Col');
    expect(hits.map((hit) => hit.title)).toEqual(['Match']);
    expect(await runtime.lancedb.textSearch('custom', "zzqq'%_", 5, 'Text Col')).toEqual([]);
    expect(await runtime.lancedb.textSearch('custom', "%'_", 5, 'Text Col')).toEqual([]);
  });

  it('runs all four tools without changing any database file or adding files', async () => {
    const before = snapshot(database);
    expect(Object.keys(before).length).toBeGreaterThan(0);
    for (const [name, args] of [
      ['lancedb_search', { query: 'cobalt', searchType: 'text' }],
      ['lancedb_query', { question: 'cobalt' }],
      ['lancedb_status', { verbose: true }],
      ['lancedb_version', {}],
    ] as const) {
      text(await registry.executeTool(name, args));
    }
    expect(snapshot(database)).toEqual(before);
  });

  it('speaks valid MCP over the built stdio CLI, without non-JSON output', async () => {
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [
        '--experimental-loader',
        join(root, 'tests/fixtures/isolated-config.mjs'),
        join(root, 'dist/bin/lancelot.js'),
      ],
      env: {
        LANCEDB_PATH: database,
        LANCELOT_TEST_CONFIG_DIR: join(folder, 'stdio-config'),
        LANCELOT_LOG_LEVEL: 'error',
      },
      stderr: 'pipe',
    });
    (transport.stderr as Readable | null)?.resume();
    const client = new Client({ name: 'integration-test', version: '1.0.0' });
    const errors: Error[] = [];
    client.onerror = (error) => errors.push(error);
    try {
      await client.connect(transport);
      expect(client.getServerVersion()?.name).toBe('lancelot');
      expect((await client.listTools()).tools.map((tool) => tool.name).sort()).toEqual([
        'lancedb_query',
        'lancedb_search',
        'lancedb_status',
        'lancedb_version',
      ]);
      const answer = await client.callTool({
        name: 'lancedb_search',
        arguments: { query: 'cobalt', searchType: 'text' },
      });
      expect(answer.isError).not.toBe(true);
      expect(JSON.stringify(answer.content)).toContain('thirty days');
    } finally {
      await client.close();
    }
    expect(errors).toEqual([]);
  }, 15000);

  it('opens a real database once through the exported Lambda handler and reuses it warm', async () => {
    const create = vi.spyOn(runtimeModule, 'createRuntime');
    vi.stubEnv('LANCELOT_BASE_PATH', '/lancelot');
    const { handler } = await import('../src/lambda.js');
    try {
      for (const id of [1, 2]) {
        const response = await handler({
          rawPath: '/lancelot',
          requestContext: { http: { method: 'POST' } },
          headers: {
            'content-type': 'application/json',
            host: 'mcp.example.test',
            accept: 'application/json, text/event-stream',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id,
            method: 'tools/call',
            params: {
              name: 'lancedb_search',
              arguments: { query: 'cobalt', searchType: 'text' },
            },
          }),
        });
        expect(response.statusCode).toBe(200);
        const reply = JSON.parse(response.body);
        expect(reply.id).toBe(id);
        expect(text(reply.result)).toContain('thirty days');
      }
      expect(create).toHaveBeenCalledTimes(1);
    } finally {
      for (const result of create.mock.results) {
        if (result.type === 'return') {
          await (await result.value).lancedb.close();
        }
      }
      create.mockRestore();
    }
  });
});
