// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { createServer, request } from 'node:http';
import type { IncomingHttpHeaders } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpHandler } from '../src/core/http.js';
import type { HttpHandlerOptions } from '../src/core/http.js';
import { LancelotServer } from '../src/core/server.js';
import { HTTP_DEFAULTS } from '../src/config/constants.js';

const closers: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(closers.splice(0).map((close) => close()));
});

/** The handler on a real HTTP server on a free loopback port, over a server with no database. */
async function listen(options: Partial<HttpHandlerOptions> = {}): Promise<string> {
  const lancelot = new LancelotServer({ config: { version: '1.2.3', transport: 'http' } });
  const handler = createHttpHandler({ createServer: () => lancelot.newServer(), ...options });
  const server = createServer((req, res) => void handler(req, res));
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  closers.push(
    () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      }),
  );
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp`;
}

interface Reply {
  status: number;
  headers: IncomingHttpHeaders;
  body: string;
}

/** node:http rather than fetch, so that Origin and Host can be set. */
function send(
  url: string,
  options: { method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: options.method ?? 'POST', headers: options.headers }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () =>
        resolve({
          status: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks).toString('utf8'),
        }),
      );
    });
    req.on('error', reject);
    req.end(options.body);
  });
}

const JSON_HEADERS = {
  'content-type': 'application/json',
  accept: 'application/json, text/event-stream',
};

const INITIALIZE = JSON.stringify({
  jsonrpc: '2.0',
  id: 1,
  method: 'initialize',
  params: {
    protocolVersion: '2025-06-18',
    capabilities: {},
    clientInfo: { name: 'test', version: '0.0.0' },
  },
});

const post = (url: string, headers: Record<string, string> = {}, body = INITIALIZE): Promise<Reply> =>
  send(url, { headers: { ...JSON_HEADERS, ...headers }, body });

describe('http handler with the SDK client', () => {
  it('initializes, lists the four tools and calls lancedb_version', async () => {
    const stdout = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);
    const url = await listen();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));

    const { tools } = await client.listTools();
    expect(tools.map((tool) => tool.name).sort()).toEqual([
      'lancedb_query',
      'lancedb_search',
      'lancedb_status',
      'lancedb_version',
    ]);

    const result = await client.callTool({ name: 'lancedb_version', arguments: {} });
    const text = (result as { content: { text: string }[] }).content[0]?.text ?? '';
    expect(JSON.parse(text).lancelot).toMatchObject({ version: '1.2.3', transport: 'http' });

    await client.close();
    expect(stdout).not.toHaveBeenCalled();
  });

  it('serves requests at the same time, each on its own server', async () => {
    const url = await listen();
    const client = new Client({ name: 'test', version: '0.0.0' });
    await client.connect(new StreamableHTTPClientTransport(new URL(url)));
    const lists = await Promise.all(Array.from({ length: 8 }, () => client.listTools()));
    expect(lists.every((list) => list.tools.length === 4)).toBe(true);
    await client.close();
  });

  it('answers initialize with JSON and no session id', async () => {
    const reply = await post(await listen());
    expect(reply.status).toBe(200);
    expect(reply.headers['content-type']).toContain('application/json');
    expect(reply.headers['mcp-session-id']).toBeUndefined();
    expect(JSON.parse(reply.body).result.serverInfo.name).toBe('lancelot');
  });
});

describe('http handler refusals', () => {
  it('refuses an Origin that is not listed with 403', async () => {
    const url = await listen({ allowedOrigins: ['https://ayers.repair'] });
    const reply = await post(url, { origin: 'https://evil.example' });
    expect(reply.status).toBe(403);
    expect(JSON.parse(reply.body).error.message).toContain('Origin');
  });

  it('refuses every Origin when none are listed', async () => {
    expect((await post(await listen(), { origin: 'https://ayers.repair' })).status).toBe(403);
  });

  it('accepts a listed Origin, and a request with no Origin', async () => {
    const url = await listen({ allowedOrigins: ['https://ayers.repair'] });
    expect((await post(url, { origin: 'https://ayers.repair' })).status).toBe(200);
    expect((await post(url)).status).toBe(200);
  });

  it('refuses a Host that is not listed with 403', async () => {
    const url = await listen({ allowedHosts: ['ayers.repair'] });
    expect((await post(url)).status).toBe(403);
    expect((await post(url, { host: 'ayers.repair' })).status).toBe(200);
  });

  it('answers GET and DELETE with 405 and says POST is allowed', async () => {
    const url = await listen();
    for (const method of ['GET', 'DELETE']) {
      const reply = await send(url, { method, headers: { accept: 'text/event-stream' } });
      expect(reply.status).toBe(405);
      expect(reply.headers.allow).toBe('POST');
    }
  });

  it('answers a body over 64 KB with 413', async () => {
    const url = await listen();
    const limit = HTTP_DEFAULTS.MAX_BODY_BYTES;
    const big = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'x', params: { pad: 'x'.repeat(limit) } });
    expect(big.length).toBeGreaterThan(limit);
    expect((await post(url, {}, big)).status).toBe(413);
  });

  it('answers a body that is not JSON with 400', async () => {
    expect((await post(await listen(), {}, '{not json')).status).toBe(400);
  });

  it('answers an unsupported MCP-Protocol-Version with 400', async () => {
    const list = JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
    const reply = await post(await listen(), { 'mcp-protocol-version': '1999-01-01' }, list);
    expect(reply.status).toBe(400);
  });

  it('serves only the configured path', async () => {
    const url = await listen({ path: '/mcp' });
    expect((await post(url)).status).toBe(200);
    expect((await post(url.replace('/mcp', '/other'))).status).toBe(404);
  });
});
