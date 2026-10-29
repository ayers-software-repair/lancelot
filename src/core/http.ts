// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { LoggerService } from '../services/logger.js';
import { HTTP_DEFAULTS } from '../config/constants.js';

/**
 * The Streamable HTTP transport, stateless and read-only.
 * MCP Streamable HTTP transport (the SDK negotiates the supported protocol version):
 * https://modelcontextprotocol.io/specification/2025-06-18/basic/transports
 *
 * - Origin: the spec says a server MUST validate it. A request that carries an Origin not in
 *   `allowedOrigins` gets 403. A request with no Origin passes; absence does not authenticate it.
 *   (The SDK's own `allowedOrigins` option rejects a missing Origin, so it is not used.)
 * - Host: `allowedHosts` goes to the SDK's DNS rebinding protection, which answers 403.
 * - Stateless: no session id. A new server and transport serve each request and are closed when
 *   the response ends, as in the SDK's stateless example. Only POST is served; GET (the optional
 *   SSE stream) and DELETE (session end) answer 405, which the spec allows for both.
 * - The `MCP-Protocol-Version` header is checked by the SDK: an unsupported value is 400, and a
 *   missing one is taken as 2025-03-26.
 * - Responses are plain JSON (`enableJsonResponse`), so a buffering gateway needs no streaming.
 */
export interface HttpHandlerOptions {
  /** Builds the MCP server for one request. Each request gets its own. */
  createServer: () => Server;
  /** Origins allowed to call. An empty list refuses every request that carries an Origin. */
  allowedOrigins?: string[];
  /** Host header values allowed. An empty list turns the Host check off. */
  allowedHosts?: string[];
  /** Serve only this path. Anything else is 404. Unset serves every path. */
  path?: string;
  logger?: LoggerService;
}

export type HttpHandler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const JSON_TYPE = { 'content-type': 'application/json' };

function reply(
  res: ServerResponse,
  status: number,
  message: string,
  code = -32000,
  headers: Record<string, string> = {},
): void {
  res
    .writeHead(status, { ...JSON_TYPE, ...headers })
    .end(JSON.stringify({ jsonrpc: '2.0', error: { code, message }, id: null }));
}

/** The request body, or undefined when it passes the limit. The rest of a long body is read and dropped. */
function readBody(req: IncomingMessage, limit: number): Promise<Buffer | undefined> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size <= limit) {
        chunks.push(chunk);
      }
    });
    req.on('end', () => resolve(size > limit ? undefined : Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function pathOf(req: IncomingMessage): string {
  const { pathname } = new URL(req.url ?? '/', 'http://localhost');
  return pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
}

export function createHttpHandler(options: HttpHandlerOptions): HttpHandler {
  const allowedOrigins = options.allowedOrigins ?? [];
  const allowedHosts = options.allowedHosts ?? [];
  const path = options.path?.replace(/\/+$/, '');

  return async (req, res) => {
    try {
      const { origin } = req.headers;
      if (origin !== undefined && !allowedOrigins.includes(origin)) {
        reply(res, 403, `Invalid Origin header: ${origin}`);
        return;
      }
      if (path !== undefined && pathOf(req) !== path) {
        reply(res, 404, 'Not found');
        return;
      }
      if (req.method !== 'POST') {
        reply(res, 405, 'Method not allowed.', -32000, { allow: 'POST' });
        return;
      }

      // ponytail: a body over the limit is read to its end and dropped, so the client sees the
      // 413. A client that never ends its body is cut off by the server's request timeout.
      const raw = await readBody(req, HTTP_DEFAULTS.MAX_BODY_BYTES);
      if (raw === undefined) {
        reply(res, 413, `Request body is over ${HTTP_DEFAULTS.MAX_BODY_BYTES} bytes`);
        return;
      }
      let body: unknown;
      try {
        body = JSON.parse(raw.toString('utf8'));
      } catch {
        reply(res, 400, 'Parse error', -32700);
        return;
      }

      const server = options.createServer();
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
        allowedHosts,
        enableDnsRebindingProtection: allowedHosts.length > 0,
      });
      res.on('close', () => {
        void server.close().catch(() => undefined);
      });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch (error) {
      options.logger?.error('MCP request failed', { error });
      if (!res.headersSent) {
        reply(res, 500, 'Internal server error', -32603);
      }
    }
  };
}
