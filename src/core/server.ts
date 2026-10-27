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
 * The MCP server. It speaks over stdio only: stdout carries MCP messages and nothing else,
 * and every log line goes to stderr.
 */
export class LancelotServer {
  private server: Server;
  private toolRegistry: ToolRegistry;
  private context: ToolContext;

  constructor(context: ToolContext) {
    this.context = context;
    this.toolRegistry = new ToolRegistry(context);
    this.server = new Server(
      {
        name: MISC.SERVICE_NAME,
        vendor: MISC.VENDOR_NAME,
        version: context.config.version || MISC.DEFAULT_VERSION,
      },
      { capabilities: { tools: {} } },
    );
    this.setupHandlers();
  }

  private setupHandlers(): void {
    this.server.setRequestHandler(ListToolsRequestSchema, () => {
      return { tools: this.toolRegistry.listTools() };
    });

    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;
      try {
        return await this.toolRegistry.executeTool(name, args ?? {});
      } catch (error) {
        if (error instanceof McpError) {
          throw error;
        }
        const message = error instanceof Error ? error.message : MISC.UNKNOWN_ERROR;
        this.context.logger?.error(`Tool ${name} failed`, { error });
        throw new McpError(ErrorCode.InternalError, message);
      }
    });
  }

  /** Connects to stdin and stdout. */
  async start(): Promise<void> {
    await this.server.connect(new StdioServerTransport());
    this.context.logger?.info('Lancelot server started', { version: this.context.config.version });
  }

  getToolRegistry(): ToolRegistry {
    return this.toolRegistry;
  }
}
