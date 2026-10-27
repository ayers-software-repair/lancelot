// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { z } from 'zod';
import type { LoggerService } from '../services/logger.js';
import type { ConfigurationService } from '../services/config.js';
import type { LanceDBService } from '../services/lancedb-service.js';
import type { EmbeddingsService } from '../services/embeddings-service.js';
import { ERROR_MESSAGES } from '../config/constants.js';

/** What a tool may use. Every service is optional so a tool can be built in a test. */
export interface ToolContext {
  config: { version: string; transport?: 'stdio' | 'http' };
  logger?: LoggerService;
  configService?: ConfigurationService;
  lancedb?: LanceDBService;
  embeddings?: EmbeddingsService;
}

export type InputSchema = MCPTool['inputSchema'];

/**
 * A tool has one zod schema that checks its arguments and one JSON schema that tells
 * clients what they are. tests/tools.test.ts keeps the two listing the same properties.
 */
export abstract class BaseTool<S extends z.ZodTypeAny = z.ZodTypeAny> {
  abstract readonly schema: S;
  abstract readonly inputSchema: InputSchema;

  constructor(
    readonly name: string,
    readonly description: string,
    protected readonly context: ToolContext,
  ) {}

  getToolDefinition(): MCPTool {
    return { name: this.name, description: this.description, inputSchema: this.inputSchema };
  }

  /** Checks the arguments, then runs. Bad arguments are a protocol error, not a tool result. */
  async execute(args: Record<string, unknown>): Promise<CallToolResult> {
    const parsed = this.schema.safeParse(args);
    if (!parsed.success) {
      const issues = parsed.error.issues
        .map((issue) => `${issue.path.join('.') || 'arguments'}: ${issue.message}`)
        .join('; ');
      throw new McpError(ErrorCode.InvalidParams, `${ERROR_MESSAGES.INVALID_ARGUMENTS}${issues}`);
    }
    return this.run(parsed.data as z.infer<S>);
  }

  protected abstract run(args: z.infer<S>): Promise<CallToolResult>;

  protected formatSuccess(text: string): CallToolResult {
    return { content: [{ type: 'text', text }], isError: false };
  }

  protected formatError(message: string): CallToolResult {
    return { content: [{ type: 'text', text: `Error: ${message}` }], isError: true };
  }
}
