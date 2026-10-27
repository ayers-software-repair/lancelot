// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from 'vitest';
import { createHttpHandler } from '../src/core/http.js';
import { createLambdaHandler } from '../src/lambda.js';
import type { ApiGatewayV2Event } from '../src/lambda.js';
import { LancelotServer } from '../src/core/server.js';

const lancelot = new LancelotServer({ config: { version: '1.2.3', transport: 'http' } });
const invoke = createLambdaHandler(
  createHttpHandler({
    createServer: () => lancelot.newServer(),
    allowedOrigins: ['https://ayers.repair'],
    path: '/mcp/lancelot',
  }),
);

/** An API Gateway HTTP API payload 2.0 event. Header names are lower case. */
function event(overrides: Partial<ApiGatewayV2Event> & { method?: string } = {}): ApiGatewayV2Event {
  const { method = 'POST', ...rest } = overrides;
  return {
    rawPath: '/mcp/lancelot',
    rawQueryString: '',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json, text/event-stream',
      host: 'ayers.repair',
    },
    requestContext: { http: { method } },
    isBase64Encoded: false,
    ...rest,
  };
}

const rpc = (id: number, method: string, params: object = {}): string =>
  JSON.stringify({ jsonrpc: '2.0', id, method, params });

const INITIALIZE = rpc(1, 'initialize', {
  protocolVersion: '2025-06-18',
  capabilities: {},
  clientInfo: { name: 'test', version: '0.0.0' },
});

describe('lambda shim', () => {
  it('answers initialize with statusCode, headers and a JSON body', async () => {
    const result = await invoke(event({ body: INITIALIZE }));
    expect(result.statusCode).toBe(200);
    expect(result.headers['content-type']).toBe('application/json');
    expect(JSON.parse(result.body).result.serverInfo.name).toBe('lancelot');
  });

  it('calls a tool, with the body base64 encoded', async () => {
    const body = Buffer.from(rpc(2, 'tools/call', { name: 'lancedb_version', arguments: {} }));
    const result = await invoke(
      event({
        body: body.toString('base64'),
        isBase64Encoded: true,
        headers: { ...event().headers, 'mcp-protocol-version': '2025-06-18' },
      }),
    );
    expect(result.statusCode).toBe(200);
    const text = JSON.parse(result.body).result.content[0].text as string;
    expect(JSON.parse(text).lancelot).toMatchObject({ version: '1.2.3', transport: 'http' });
  });

  it('answers a notification with 202 and no body', async () => {
    const body = JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' });
    const result = await invoke(event({ body }));
    expect(result.statusCode).toBe(202);
    expect(result.body).toBe('');
  });

  it('answers GET with 405', async () => {
    const result = await invoke(event({ method: 'GET' }));
    expect(result.statusCode).toBe(405);
    expect(result.headers.allow).toBe('POST');
  });

  it('answers another path with 404', async () => {
    expect((await invoke(event({ rawPath: '/mcp/other', body: INITIALIZE }))).statusCode).toBe(404);
  });

  it('answers an Origin that is not listed with 403', async () => {
    const headers = { ...event().headers, origin: 'https://evil.example' };
    expect((await invoke(event({ headers, body: INITIALIZE }))).statusCode).toBe(403);
  });

  it('answers an empty body with 400', async () => {
    expect((await invoke(event())).statusCode).toBe(400);
  });

  it.todo(
    'the exported handler opens LanceDB at LANCEDB_PATH once and reuses it on a warm invocation (needs LanceDB)',
  );
});
