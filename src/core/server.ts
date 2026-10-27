// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from '@modelcontextprotocol/sdk/types.js';
import { ToolRegistry } from './tool-registry.js';
import type { ToolContext } from './tool-base.js';
import { MISC } from '../config/constants.js';

/**
 * One MCP server over a tool registry. Stdio builds one for the life of the process; the HTTP
 * transport builds one per request, because an SDK server serves one transport at a time.
 */
export function createServer(context: ToolContext, registry: ToolRegistry): Server {
  const server = new Server(
    {
      name: MISC.SERVICE_NAME,
      vendor: MISC.VENDOR_NAME,
      version: context.config.version || MISC.DEFAULT_VERSION,
    },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, () => {
    return { tools: registry.listTools() };
  });

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;
    try {
      return await registry.executeTool(name, args ?? {});
    } catch (error) {
      if (error instanceof McpError) {
        throw error;
      }
      const message = error instanceof Error ? error.message : MISC.UNKNOWN_ERROR;
      context.logger?.error(`Tool ${name} failed`, { error });
      throw new McpError(ErrorCode.InternalError, message);
    }
  });

  return server;
}

/**
 * The tools and the context they run in. `start()` serves over stdio, where stdout carries MCP
 * messages and nothing else and every log line goes to stderr. `newServer()` gives the HTTP
 * transport a server per request over the same tools.
 */
export class LancelotServer {
  private server: Server;
  private toolRegistry: ToolRegistry;
  private context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
    this.toolRegistry = new ToolRegistry(context);
    this.server = createServer(context, this.toolRegistry);
  }

  /** Connects to stdin and stdout. */
  async start(): Promise<void> {
    await this.server.connect(new StdioServerTransport());
    this.context.logger?.info('Lancelot server started', { version: this.context.config.version });
  }

  /** A new MCP server over the same tool registry, for one HTTP request. */
  newServer(): Server {
    return createServer(this.context, this.toolRegistry);
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
