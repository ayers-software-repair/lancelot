// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from '../core/tool-base.js';
import type { InputSchema, ToolContext } from '../core/tool-base.js';
import { ERROR_MESSAGES, TOOL_NAMES } from '../config/constants.js';

export const statusArgs = z.object({
  verbose: z.boolean().default(false),
});

/** Reports the connection, the tables and the embeddings state. */
export class StatusTool extends BaseTool<typeof statusArgs> {
  readonly schema = statusArgs;

  readonly inputSchema: InputSchema = {
    type: 'object',
    properties: {
      verbose: {
        type: 'boolean',
        description: 'Include the column names of each table',
        default: false,
      },
    },
  };

  constructor(context: ToolContext) {
    super(TOOL_NAMES.STATUS, 'Get LanceDB status and statistics', context);
  }

  protected async run(args: z.infer<typeof statusArgs>): Promise<CallToolResult> {
    const { lancedb, embeddings, logger, config } = this.context;
    if (!lancedb) {
      return this.formatError(ERROR_MESSAGES.LANCEDB_NOT_INITIALIZED);
    }

    try {
      const db = await lancedb.getStatus();
      return this.formatSuccess(
        JSON.stringify(
          {
            database: {
              connected: db.connected,
              path: db.path,
              tableCount: db.tables.length,
              tables: db.tables.map((table) =>
                args.verbose
                  ? table
                  : { name: table.name, rowCount: table.rowCount },
              ),
            },
            embeddings: embeddings?.getModelInfo() ?? { available: false },
            server: { version: config.version, uptimeSeconds: Math.round(process.uptime()) },
          },
          null,
          2,
        ),
      );
    } catch (error) {
      logger?.error('Status tool failed', { error });
      return this.formatError(error instanceof Error ? error.message : 'Failed to get status');
    }
  }
}
