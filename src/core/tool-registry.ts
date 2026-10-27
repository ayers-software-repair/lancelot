// Copyright Ayers Electronics Inc. All rights reserved.
// SPDX-License-Identifier: Apache-2.0
import { ErrorCode, McpError } from '@modelcontextprotocol/sdk/types.js';
import type { CallToolResult, Tool as MCPTool } from '@modelcontextprotocol/sdk/types.js';
import type { BaseTool, ToolContext } from './tool-base.js';
import { ERROR_MESSAGES } from '../config/constants.js';
import { SearchTool } from '../tools/search.js';
import { QueryTool } from '../tools/query.js';
import { StatusTool } from '../tools/status.js';
import { VersionTool } from '../tools/version.js';

/** Every tool the server offers. */
const TOOL_CLASSES: (new (context: ToolContext) => BaseTool)[] = [
  SearchTool,
  QueryTool,
  StatusTool,
  VersionTool,
];

export class ToolRegistry {
  private tools = new Map<string, BaseTool>();

  constructor(context: ToolContext) {
    for (const ToolClass of TOOL_CLASSES) {
      const tool = new ToolClass(context);
      this.tools.set(tool.name, tool);
    }
  }

  listTools(): MCPTool[] {
    return [...this.tools.values()].map((tool) => tool.getToolDefinition());
  }

  async executeTool(name: string, args: Record<string, unknown>): Promise<CallToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      throw new McpError(ErrorCode.MethodNotFound, `${ERROR_MESSAGES.TOOL_NOT_FOUND}${name}`);
    }
    return tool.execute(args);
  }

  getTool(name: string): BaseTool | undefined {
    return this.tools.get(name);
  }
}
