// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from '../core/tool-base.js';
import type { InputSchema, ToolContext } from '../core/tool-base.js';
import { ERROR_MESSAGES, LANCEDB_DEFAULTS, TOOL_NAMES } from '../config/constants.js';
import type { SearchResult } from '../services/lancedb-service.js';
import { retrieve } from './retrieve.js';

/** The question used in place of the caller's when warmStart is set. */
const WARM_START_QUESTION =
  'project overview architecture patterns key modules interfaces database schema';

export const queryArgs = z.object({
  question: z.string().min(1),
  contextBudget: z.number().int().min(1).optional(),
  warmStart: z.boolean().default(false),
  table: z.string().min(1).optional(),
  limit: z.number().int().min(1).max(LANCEDB_DEFAULTS.MAX_LIMIT).optional(),
});

/** Retrieves chunks for a question and returns them as one block of context, within a budget. */
export class QueryTool extends BaseTool<typeof queryArgs> {
  readonly schema = queryArgs;

  readonly inputSchema: InputSchema = {
    type: 'object',
    properties: {
      question: { type: 'string', description: "The user's question" },
      contextBudget: {
        type: 'number',
        description: `Maximum characters of context to return (default: the configured budget, ${LANCEDB_DEFAULTS.CONTEXT_BUDGET})`,
      },
      warmStart: {
        type: 'boolean',
        description: 'Retrieve a general project overview instead of answering the question',
        default: false,
      },
      table: { type: 'string', description: 'Table to query (default: the configured table)' },
      limit: {
        type: 'number',
        description: `Maximum number of chunks to retrieve (default: the configured limit, ${LANCEDB_DEFAULTS.DEFAULT_LIMIT}; at most ${LANCEDB_DEFAULTS.MAX_LIMIT})`,
      },
    },
    required: ['question'],
  };

  constructor(context: ToolContext) {
    super(TOOL_NAMES.QUERY, 'RAG query with context retrieval from LanceDB', context);
  }

  protected async run(args: z.infer<typeof queryArgs>): Promise<CallToolResult> {
    const { lancedb, configService, logger } = this.context;
    if (!lancedb) {
      return this.formatError(ERROR_MESSAGES.LANCEDB_NOT_INITIALIZED);
    }

    const config = configService?.getConfig().lancedb;
    const table = args.table ?? config?.defaultTable;
    if (!table) {
      return this.formatError(ERROR_MESSAGES.NO_TABLE);
    }

    try {
      const question = args.warmStart ? WARM_START_QUESTION : args.question;
      const found = await retrieve(this.context, {
        table,
        query: question,
        limit: args.limit ?? config?.defaultLimit ?? LANCEDB_DEFAULTS.DEFAULT_LIMIT,
        searchType: 'auto',
      });
      const budget =
        args.contextBudget ?? config?.contextBudget ?? LANCEDB_DEFAULTS.CONTEXT_BUDGET;

      return this.formatSuccess(
        this.buildContextBlock(question, found.results, budget, args.warmStart, found.searchType),
      );
    } catch (error) {
      logger?.error('Query tool failed', { error });
      return this.formatError(error instanceof Error ? error.message : 'Query failed');
    }
  }

  private buildContextBlock(
    query: string,
    results: SearchResult[],
    budget: number,
    warmStart: boolean,
    searchType: string,
  ): string {
    const header =
      '# RAG Context (LanceDB)\n' +
      `- Mode: ${warmStart ? 'warm-start' : 'on-demand'}\n` +
      `- Search: ${searchType}\n` +
      `- Query: ${query.substring(0, 100)}${query.length > 100 ? '...' : ''}\n\n`;

    const buffer = [header];
    let used = header.length;
    let added = 0;

    for (const result of results) {
      if (!result.text.trim()) {
        continue;
      }
      const chunk =
        `### ${result.title ?? 'Document'}\n` +
        `Source: ${result.source ?? 'unknown'}\n` +
        `\`\`\`\n${result.text}\n\`\`\`\n\n`;

      if (used + chunk.length > budget) {
        if (added > 0) {
          buffer.push(`_... ${results.length - added} more chunks left out (budget reached)_\n`);
        }
        break;
      }
      buffer.push(chunk);
      used += chunk.length;
      added++;
    }

    if (results.length === 0) {
      buffer.push('_No relevant chunks found_\n');
    } else if (added === 0) {
      buffer.push('_No chunk fit the budget or all were empty_\n');
    }

    return buffer.join('');
  }
}
