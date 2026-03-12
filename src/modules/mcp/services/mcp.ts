/**
 * MCP Server - Remote Mac Tools
 * Provides shell_exec, osascript, file_read, file_write for remote Mac control.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { getRemoteToolDefinitions, handleRemoteTool } from "./remote-mac-tools.js";

interface McpServerWrapper {
  server: Server;
  cleanup: () => void;
}

export const createMcpServer = (): McpServerWrapper => {
  const server = new Server(
    { name: "remote-mac-mcp", version: "1.0.0" },
    { capabilities: { tools: {} } }
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: getRemoteToolDefinitions(),
  }));

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const result = await handleRemoteTool(
      request.params.name,
      request.params.arguments ?? {}
    );
    if (result) return result;
    return {
      content: [{ type: "text" as const, text: `Unknown tool: ${request.params.name}` }],
      isError: true,
    };
  });

  return { server, cleanup: () => {} };
};
