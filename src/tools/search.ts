// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from '../core/tool-base.js';
import type { InputSchema, ToolContext } from '../core/tool-base.js';
import { ERROR_MESSAGES, LANCEDB_DEFAULTS, SEARCH_TYPES, TOOL_NAMES } from '../config/constants.js';
import { retrieve } from './retrieve.js';
import { queryTerms } from '../services/text-query.js';

function excerpt(text: string, query: string, size: number): string {
  if (text.length <= size) {
    return text;
  }
  const lower = text.toLowerCase();
  const match =
    queryTerms(query)
      .map((term) => lower.indexOf(term))
      .find((at) => at >= 0) ?? 0;
  const start = Math.max(0, Math.min(match - Math.floor(size / 3), text.length - size));
  const end = start + size;
  return `${start ? '...' : ''}${text.slice(start, end)}${end < text.length ? '...' : ''}`;
}

export const searchArgs = z.object({
  query: z.string().min(1),
  limit: z.number().int().min(1).max(LANCEDB_DEFAULTS.MAX_LIMIT).optional(),
  searchType: z.enum(SEARCH_TYPES).default('auto'),
  table: z.string().min(1).optional(),
  textColumn: z.string().min(1).optional(),
  vectorColumn: z.string().min(1).optional(),
});

/** Searches a table and returns the hits, each cut to a short snippet. */
export class SearchTool extends BaseTool<typeof searchArgs> {
  readonly schema = searchArgs;

  readonly inputSchema: InputSchema = {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query string' },
      limit: {
        type: 'number',
        description: `Maximum number of results (default: the configured limit, ${LANCEDB_DEFAULTS.DEFAULT_LIMIT}; at most ${LANCEDB_DEFAULTS.MAX_LIMIT})`,
      },
      searchType: {
        type: 'string',
        enum: [...SEARCH_TYPES],
        description:
          'vector uses OpenAI embeddings, text matches words in the text column, auto uses vector when a key is set and text otherwise',
        default: 'auto',
      },
      table: { type: 'string', description: 'Table to search (default: the configured table)' },
      textColumn: { type: 'string', description: 'Column holding the text' },
      vectorColumn: { type: 'string', description: 'Column holding the vectors' },
    },
    required: ['query'],
  };

  constructor(context: ToolContext) {
    super(
      TOOL_NAMES.SEARCH,
      'Search LanceDB for relevant documents using vector or text search',
      context,
    );
  }

  protected async run(args: z.infer<typeof searchArgs>): Promise<CallToolResult> {
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
      const found = await retrieve(this.context, {
        table,
        query: args.query,
        limit: args.limit ?? config?.defaultLimit ?? LANCEDB_DEFAULTS.DEFAULT_LIMIT,
        searchType: args.searchType,
        textColumn: args.textColumn,
        vectorColumn: args.vectorColumn,
      });
      const cut = LANCEDB_DEFAULTS.SNIPPET_LENGTH;

      return this.formatSuccess(
        JSON.stringify(
          {
            query: args.query,
            table,
            searchType: found.searchType,
            ...(found.note ? { note: found.note } : {}),
            resultCount: found.results.length,
            results: found.results.map((result, index) => ({
              rank: index + 1,
              title: result.title,
              source: result.source,
              text: excerpt(result.text, args.query, cut),
              score: result.score,
              metadata: result.metadata,
            })),
          },
          null,
          2,
        ),
      );
    } catch (error) {
      logger?.error('Search tool failed', { error });
      return this.formatError(error instanceof Error ? error.message : 'Search failed');
    }
  }
}
