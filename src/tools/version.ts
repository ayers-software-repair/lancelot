// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { z } from 'zod';
import { LATEST_PROTOCOL_VERSION } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { BaseTool } from '../core/tool-base.js';
import type { InputSchema, ToolContext } from '../core/tool-base.js';
import { MISC, TOOL_NAMES } from '../config/constants.js';

export const versionArgs = z.object({});

/** Reports the package version, the MCP protocol version of the SDK, and what is enabled. */
export class VersionTool extends BaseTool<typeof versionArgs> {
  readonly schema = versionArgs;

  readonly inputSchema: InputSchema = { type: 'object', properties: {} };

  constructor(context: ToolContext) {
    super(TOOL_NAMES.VERSION, 'Show Lancelot version information', context);
  }

  protected async run(): Promise<CallToolResult> {
    const { embeddings, lancedb, configService, config } = this.context;

    return this.formatSuccess(
      JSON.stringify(
        {
          lancelot: {
            name: MISC.PACKAGE_NAME,
            version: config.version,
            transport: config.transport ?? 'stdio',
            protocolVersion: LATEST_PROTOCOL_VERSION,
          },
          capabilities: {
            vectorSearch: embeddings?.isAvailable() ?? false,
            textSearch: true,
            ragQueries: true,
          },
          database: {
            connected: lancedb?.isConnected() ?? false,
            path: configService?.getConfig().lancedb.path || 'not configured',
          },
        },
        null,
        2,
      ),
    );
  }
}
