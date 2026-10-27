// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from 'vitest';
import { ErrorCode, LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import { ToolRegistry } from '../src/core/tool-registry.js';
import type { ToolContext } from '../src/core/tool-base.js';
import type { SearchResult } from '../src/services/lancedb-service.js';
import { queryTerms, quoteColumn, textFilter } from '../src/services/text-query.js';

const NAMES = ['lancedb_query', 'lancedb_search', 'lancedb_status', 'lancedb_version'];

function registry(context: Partial<ToolContext> = {}): ToolRegistry {
  return new ToolRegistry({ config: { version: '9.9.9' }, ...context });
}

const hit = (text: string): SearchResult => ({ text, title: 't', source: 's' });

/** A LanceDB service and an embeddings client that answer from memory. */
function fakes(options: { vector?: SearchResult[]; vectorFails?: boolean; embedding?: number[] | null }) {
  const vectorSearch = vi.fn(async () => {
    if (options.vectorFails) {
      throw new Error('boom');
    }
    return options.vector ?? [hit('from vector')];
  });
  const textSearch = vi.fn(async () => [hit('from text')]);
  const embedding = options.embedding === undefined ? [0.1, 0.2] : options.embedding;
  const generateEmbedding = vi.fn(async (_text: string) => embedding);
  const context = {
    lancedb: { vectorSearch, textSearch },
    embeddings: { isAvailable: () => embedding !== null, generateEmbedding },
    configService: { getConfig: () => ({ lancedb: { defaultTable: 'docs', defaultLimit: 7, contextBudget: 8000 } }) },
  } as unknown as Partial<ToolContext>;
  return { context, vectorSearch, textSearch, generateEmbedding };
}

async function json(promise: Promise<{ content: unknown[] }>): Promise<Record<string, unknown>> {
  const result = await promise;
  return JSON.parse((result.content[0] as { text: string }).text) as Record<string, unknown>;
}

describe('tool registry', () => {
  it('lists exactly the four tools', () => {
    const names = registry().listTools().map((tool) => tool.name);
    expect(names.sort()).toEqual(NAMES);
    expect(names).not.toContain('lancedb_dashboard');
  });

  it('gives each tool an object input schema', () => {
    for (const tool of registry().listTools()) {
      expect(tool.inputSchema.type).toBe('object');
      expect(tool.description).toBeTruthy();
    }
  });

  it('lists the same properties in the JSON schema and the zod schema', () => {
    const reg = registry();
    for (const name of NAMES) {
      const tool = reg.getTool(name);
      expect(tool).toBeDefined();
      const shape = (tool?.schema as z.AnyZodObject).shape;
      const listed = tool?.inputSchema.properties ?? {};
      expect(Object.keys(listed).sort()).toEqual(Object.keys(shape).sort());
      const required = Object.keys(shape).filter((key) => !shape[key]?.isOptional());
      expect([...(tool?.inputSchema.required ?? [])].sort()).toEqual(required.sort());
    }
  });

  it('rejects an unknown tool as method-not-found', async () => {
    await expect(registry().executeTool('nope', {})).rejects.toMatchObject({
      code: ErrorCode.MethodNotFound,
    });
  });
});

describe('input schemas', () => {
  const schema = (name: string): z.ZodTypeAny => {
    const tool = registry().getTool(name);
    if (!tool) {
      throw new Error(name);
    }
    return tool.schema;
  };

  it('lancedb_search parses its documented arguments', () => {
    const parsed = schema('lancedb_search').safeParse({
      query: 'rate limits',
      limit: 5,
      searchType: 'text',
      table: 'docs',
      textColumn: 'body',
      vectorColumn: 'embedding',
    });
    expect(parsed.success).toBe(true);
    expect(schema('lancedb_search').parse({ query: 'x' })).toMatchObject({ searchType: 'auto' });
  });

  it.each([
    [{}],
    [{ query: 5 }],
    [{ query: '' }],
    [{ query: 'x', limit: '5' }],
    [{ query: 'x', limit: 0 }],
    [{ query: 'x', searchType: 'fuzzy' }],
    [{ query: 'x', table: 7 }],
  ])('lancedb_search rejects %j', (args) => {
    expect(schema('lancedb_search').safeParse(args).success).toBe(false);
  });

  it('lancedb_query parses its documented arguments', () => {
    expect(
      schema('lancedb_query').safeParse({
        question: 'what is the schema',
        contextBudget: 4000,
        warmStart: true,
        table: 'docs',
        limit: 10,
      }).success,
    ).toBe(true);
  });

  it.each([
    [{}],
    [{ question: 1 }],
    [{ question: 'x', contextBudget: 'big' }],
    [{ question: 'x', warmStart: 'yes' }],
  ])('lancedb_query rejects %j', (args) => {
    expect(schema('lancedb_query').safeParse(args).success).toBe(false);
  });

  it('lancedb_status parses verbose and rejects a wrong type', () => {
    expect(schema('lancedb_status').safeParse({ verbose: true }).success).toBe(true);
    expect(schema('lancedb_status').safeParse({}).success).toBe(true);
    expect(schema('lancedb_status').safeParse({ verbose: 'yes' }).success).toBe(false);
  });

  it('lancedb_version takes no arguments', () => {
    expect(schema('lancedb_version').safeParse({}).success).toBe(true);
  });

  it('a wrong type reaches the client as invalid-params', async () => {
    await expect(registry().executeTool('lancedb_search', { query: 5 })).rejects.toMatchObject({
      code: ErrorCode.InvalidParams,
    });
  });
});

describe('lancedb_version', () => {
  it('reports the package version and the SDK protocol version', async () => {
    const info = await json(registry().executeTool('lancedb_version', {}));
    expect(info.lancelot).toMatchObject({
      version: '9.9.9',
      transport: 'stdio',
      protocolVersion: LATEST_PROTOCOL_VERSION,
    });
  });
});

describe('lancedb_search', () => {
  it('reports vector when the vector search ran', async () => {
    const { context, vectorSearch } = fakes({});
    const out = await json(registry(context).executeTool('lancedb_search', { query: 'q' }));
    expect(out.searchType).toBe('vector');
    expect(vectorSearch).toHaveBeenCalledWith('docs', [0.1, 0.2], 7, undefined);
  });

  it('reports text when there is no embeddings client', async () => {
    const { context, vectorSearch, textSearch } = fakes({ embedding: null });
    const out = await json(registry(context).executeTool('lancedb_search', { query: 'q' }));
    expect(out.searchType).toBe('text');
    expect(out.note).toBeUndefined();
    expect(vectorSearch).not.toHaveBeenCalled();
    expect(textSearch).toHaveBeenCalled();
  });

  it('reports text, with a note, when vector was asked for and cannot run', async () => {
    const { context } = fakes({ embedding: null });
    const out = await json(
      registry(context).executeTool('lancedb_search', { query: 'q', searchType: 'vector' }),
    );
    expect(out.searchType).toBe('text');
    expect(out.note).toMatch(/text search used/);
  });

  it('reports text when the vector search throws', async () => {
    const { context } = fakes({ vectorFails: true });
    const out = await json(registry(context).executeTool('lancedb_search', { query: 'q' }));
    expect(out.searchType).toBe('text');
    expect(out.note).toMatch(/failed/);
  });

  it('never uses vector when text is asked for', async () => {
    const { context, vectorSearch } = fakes({});
    const out = await json(
      registry(context).executeTool('lancedb_search', { query: 'q', searchType: 'text' }),
    );
    expect(out.searchType).toBe('text');
    expect(vectorSearch).not.toHaveBeenCalled();
  });

  it('returns an error result when the database service is missing', async () => {
    const result = await registry().executeTool('lancedb_search', { query: 'q' });
    expect(result.isError).toBe(true);
  });
});

describe('lancedb_query', () => {
  it('cuts the context at the budget', async () => {
    const big = 'x'.repeat(400);
    const { context } = fakes({ vector: [hit(big), hit(big), hit(big)] });
    const result = await registry(context).executeTool('lancedb_query', {
      question: 'q',
      contextBudget: 700,
    });
    const text = (result.content[0] as { text: string }).text;
    expect(text.match(/```\n/g)?.length).toBe(2);
    expect(text).toMatch(/more chunks left out/);
  });

  it('asks for an overview when warmStart is set', async () => {
    const { context, generateEmbedding } = fakes({});
    await registry(context).executeTool('lancedb_query', { question: 'ignored', warmStart: true });
    expect(generateEmbedding).toHaveBeenCalledWith(expect.stringContaining('project overview'));
  });

  it.todo('retrieves from a real LanceDB table (needs LanceDB and a fixture database)');
});

describe('text search filter', () => {
  it('splits a query into lowercase terms without quotes or wildcards', () => {
    expect(queryTerms("Foo's  bar_baz 100%")).toEqual(['foo', 's', 'bar', 'baz', '100']);
    expect(queryTerms("x' OR 1=1 --")).not.toContain("x'");
    expect(queryTerms('   ')).toEqual([]);
  });

  it('quotes the column and joins terms with OR', () => {
    expect(quoteColumn('Text Col')).toBe('`Text Col`');
    expect(quoteColumn('a`b')).toBe('`a``b`');
    expect(textFilter('text', ['a', 'b'])).toBe(
      "lower(`text`) LIKE '%a%' OR lower(`text`) LIKE '%b%'",
    );
  });

  it.todo('runs the filter against a real LanceDB table (needs LanceDB)');
});
