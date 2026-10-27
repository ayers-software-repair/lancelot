// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0

/**
 * The AWS Lambda entry: Lancelot's HTTP transport behind an API Gateway HTTP API.
 *
 * Event and response shape, payload format 2.0 (header names are lower case; a response with a
 * statusCode, headers and body is passed through):
 * https://docs.aws.amazon.com/apigateway/latest/developerguide/http-api-develop-integrations-lambda.html
 * Container image, base image and `CMD [ "dist/lambda.handler" ]`:
 * https://docs.aws.amazon.com/lambda/latest/dg/nodejs-image.html
 *
 * The SDK's transport wants Node's request and response, so the event is turned into a small
 * stand-in for each. Settings come from the environment: LANCEDB_PATH, LANCELOT_BASE_PATH (the
 * path the endpoint is served under, such as /mcp/lancelot), LANCELOT_ALLOWED_ORIGINS and
 * LANCELOT_ALLOWED_HOSTS. The database connection is opened once and kept across warm invocations.
 */
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { csvList } from './core/cli.js';
import { createHttpHandler } from './core/http.js';
import type { HttpHandler } from './core/http.js';
import { LancelotServer } from './core/server.js';
import { HTTP_ENV } from './config/constants.js';

export interface ApiGatewayV2Event {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

export interface ApiGatewayV2Result {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

/** Enough of ServerResponse for the handler and the SDK transport. It collects the reply. */
class LambdaResponse extends EventEmitter {
  statusCode = 200;
  headersSent = false;
  readonly done: Promise<ApiGatewayV2Result>;
  private headers: Record<string, string> = {};
  private chunks: Buffer[] = [];
  private ended = false;
  private finish!: (result: ApiGatewayV2Result) => void;

  constructor() {
    super();
    this.done = new Promise((resolve) => {
      this.finish = resolve;
    });
  }

  setHeader(name: string, value: string | number | string[]): this {
    this.headers[name.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
    return this;
  }

  getHeader(name: string): string | undefined {
    return this.headers[name.toLowerCase()];
  }

  writeHead(status: number, headers: Record<string, string | number | string[]> = {}): this {
    this.statusCode = status;
    for (const [name, value] of Object.entries(headers)) {
      this.setHeader(name, value);
    }
    this.headersSent = true;
    return this;
  }

  flushHeaders(): void {
    this.headersSent = true;
  }

  write(chunk: string | Uint8Array): boolean {
    this.chunks.push(typeof chunk === 'string' ? Buffer.from(chunk, 'utf8') : Buffer.from(chunk));
    return true;
  }

  end(chunk?: string | Uint8Array): this {
    if (this.ended) {
      return this;
    }
    this.ended = true;
    this.headersSent = true;
    if (chunk) {
      this.write(chunk);
    }
    this.finish({
      statusCode: this.statusCode,
      headers: this.headers,
      body: Buffer.concat(this.chunks).toString('utf8'),
    });
    this.emit('finish');
    this.emit('close');
    return this;
  }
}

function toRequest(event: ApiGatewayV2Event): IncomingMessage {
  const body = event.body
    ? Buffer.from(event.body, event.isBase64Encoded ? 'base64' : 'utf8')
    : Buffer.alloc(0);
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) {
      headers[name.toLowerCase()] = value;
    }
  }
  const query = event.rawQueryString ? `?${event.rawQueryString}` : '';
  return Object.assign(Readable.from(body.length > 0 ? [body] : []), {
    method: event.requestContext.http.method,
    url: `${event.rawPath}${query}`,
    headers,
  }) as unknown as IncomingMessage;
}

/** Runs one API Gateway event through an HTTP handler and returns the reply. */
export function createLambdaHandler(
  handle: HttpHandler,
): (event: ApiGatewayV2Event) => Promise<ApiGatewayV2Result> {
  return async (event) => {
    const res = new LambdaResponse();
    await handle(toRequest(event), res as unknown as ServerResponse);
    return res.done;
  };
}

interface Ready {
  handle: HttpHandler;
  reconnect: () => Promise<void>;
}

let ready: Promise<Ready> | undefined;

/** Built on the first invocation and kept for the life of the execution environment. */
async function start(): Promise<Ready> {
  // Loaded here so that importing this file does not load the native LanceDB module.
  const { connectLanceDb, createRuntime } = await import('./core/runtime.js');
  const { context, configService, lancedb, logger } = await createRuntime({
    packageJson: new URL('../package.json', import.meta.url),
    transport: 'http',
    // The task folder is read-only. /tmp is the one place a function may write.
    configDir: join(tmpdir(), 'lancelot'),
  });
  const lancelot = new LancelotServer(context);
  const handle = createHttpHandler({
    createServer: () => lancelot.newServer(),
    allowedOrigins: csvList(process.env[HTTP_ENV.ALLOWED_ORIGINS]),
    allowedHosts: csvList(process.env[HTTP_ENV.ALLOWED_HOSTS]),
    path: process.env[HTTP_ENV.BASE_PATH]?.trim() || undefined,
    logger,
  });
  return {
    handle,
    // A failed connect on a cold start is tried again on the next invocation.
    reconnect: async () => {
      if (!lancedb.isConnected()) {
        await connectLanceDb(configService, lancedb, logger);
      }
    },
  };
}

export const handler = createLambdaHandler(async (req, res) => {
  ready ??= start().catch((error: unknown) => {
    ready = undefined;
    throw error;
  });
  const { handle, reconnect } = await ready;
  await reconnect();
  await handle(req, res);
});
