// wayfind-sandbox: thin HTTP router over the tool modules.
// Transports: plain REST (relay, thin CLI, tests) + MCP over Streamable
// HTTP (harnesses via the wayfind-api relay). Tool logic lives in
// src/tools/*, lifecycle hooks in src/lifecycle.ts, MCP in src/mcp.ts.
// No agent loop, no inference, no provider keys in this process.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { mkdirSync } from 'node:fs';
import { PORT, WORKSPACE_DIR } from './config.js';
import { HttpError, json, readBody, requireSession } from './http.js';
import { handleLifecycle } from './lifecycle.js';
import { handleMcp } from './mcp.js';
import { hasSession } from './session.js';
import { run as runExec } from './tools/exec.js';
import { editTool, readEncTool, readTool, writeTool } from './tools/files.js';
import { globTool, grepTool } from './tools/search.js';
import { syncInTool, syncOutTool } from './tools/sync.js';

async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://x');
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /health') {
    return json(res, 200, { ok: true, service: 'wayfind-sandbox', session: hasSession() });
  }

  // Root probe insurance: some builders probe / instead of /ready.
  if (route === 'GET /') {
    return json(res, 200, { ok: true, service: 'wayfind-sandbox' });
  }

  if (await handleLifecycle(route, req, res)) return;

  // MCP over Streamable HTTP (stateless: one POST per request, no SSE).
  // Harnesses reach this through the wayfind-api relay, which injects the
  // per-session bearer — the endpoint itself also enforces it.
  if (route === 'POST /mcp') {
    try {
      requireSession(req);
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: err.message });
      throw err;
    }
    return handleMcp(req, res);
  }
  if (route === 'GET /mcp' || route === 'DELETE /mcp') {
    res.writeHead(405, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'stateless MCP: use POST only' }));
    return;
  }

  try {
    requireSession(req);
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    throw err;
  }

  try {
    if (route === 'POST /exec') {
      const body = (await readBody(req)) as { cmd?: unknown; cwd?: unknown; timeoutMs?: unknown };
      return json(res, 200, await runExec({ cmd: body.cmd as string, cwd: body.cwd as string | undefined, timeoutMs: body.timeoutMs as number | undefined }));
    }
    if (route === 'POST /read') {
      const body = (await readBody(req)) as { path?: unknown };
      return json(res, 200, await readTool.run({ path: body.path as string }));
    }
    if (route === 'POST /read_enc') {
      const body = (await readBody(req)) as { path?: unknown };
      return json(res, 200, await readEncTool.run({ path: body.path as string }));
    }
    if (route === 'POST /write') {
      const body = (await readBody(req)) as { path?: unknown; content?: unknown };
      return json(
        res,
        200,
        await writeTool.run({ path: body.path as string, content: body.content as string }),
      );
    }
    if (route === 'POST /glob') {
      const body = (await readBody(req)) as { pattern?: unknown; root?: unknown };
      return json(res, 200, await globTool.run({ pattern: body.pattern as string, root: body.root as string | undefined }));
    }
    if (route === 'POST /grep') {
      const body = (await readBody(req)) as {
        pattern?: unknown;
        flags?: unknown;
        root?: unknown;
        include?: unknown;
      };
      return json(
        res,
        200,
        await grepTool.run({
          pattern: body.pattern as string,
          flags: body.flags as string | undefined,
          root: body.root as string | undefined,
          include: body.include as string | undefined,
        }),
      );
    }
    if (route === 'POST /sync/in') {
      const body = (await readBody(req)) as { files?: unknown };
      return json(
        res,
        200,
        await syncInTool.run({ files: body.files as Array<{ path?: unknown; contentBase64?: unknown }> }),
      );
    }
    // GET and POST both: browsers/probes use GET, the MCP relay always POSTs.
    if (route === 'GET /sync/out' || route === 'POST /sync/out') {
      return json(res, 200, await syncOutTool.run());
    }

    return json(res, 404, { error: 'unknown route' });
  } catch (err) {
    if (err instanceof HttpError) return json(res, err.status, { error: err.message });
    return json(res, 400, { error: err instanceof Error ? err.message : 'request failed' });
  }
}

mkdirSync(WORKSPACE_DIR, { recursive: true });
createServer((req, res) => {
  handle(req, res).catch(() => {
    try {
      json(res, 500, { error: 'internal error' });
    } catch { /* socket already gone */ }
  });
// Bind IPv4 explicitly: hook probes may not speak IPv6, and a dual-stack
// wildcard bind is one more thing to differ from the proven computer agent.
}).listen(PORT, '0.0.0.0', () => {
  console.log(`[wayfind-sandbox] listening on :${PORT}, workspace=${WORKSPACE_DIR}`);
});
