// MCP server: the same tool implementations over Streamable HTTP.
// Harnesses (Claude Code, opencode, Cursor via the wayfind-api relay)
// drive these natively. Stateless transport: one POST per request.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { z } from 'zod';
import { json, readBody } from './http.js';
import { editTool, readTool, writeTool } from './tools/files.js';
import { globTool, grepTool } from './tools/search.js';
import { syncInTool, syncOutTool } from './tools/sync.js';
import * as execTool from './tools/exec.js';

export const mcp = new McpServer({ name: 'wayfind-sandbox', version: '0.1.0' });

mcp.registerTool(execTool.name, { description: execTool.description, inputSchema: execTool.schema }, async (args) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(await execTool.run(args)) }],
}));

for (const t of [readTool, writeTool, editTool, globTool, grepTool, syncInTool, syncOutTool] as Array<{
  name: string;
  description: string;
  schema: z.ZodTypeAny;
  run: (args: any) => Promise<unknown>;
}>) {
  mcp.registerTool(t.name, { description: t.description, inputSchema: t.schema }, async (args) => ({
    content: [{ type: 'text' as const, text: JSON.stringify(await t.run(args)) }],
  }));
}

export async function handleMcp(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  res.on('close', () => transport.close().catch(() => {}));
  try {
    await mcp.connect(transport);
    await transport.handleRequest(req, res, await readBody(req));
  } catch (err) {
    if (!res.headersSent) {
      json(res, 500, { error: err instanceof Error ? err.message : 'mcp error' });
    }
    transport.close().catch(() => {});
  }
}
