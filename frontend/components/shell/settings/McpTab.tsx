'use client';

import { useEffect, useState } from 'react';
import {
  getMcpServers,
  saveMcpServer,
  patchMcpServer,
  removeMcpServer,
  restartMcpServer,
  type McpServer,
  type McpServerInput,
} from '@/lib/team';
import TabHeader from './TabHeader';

export default function McpTab() {
  const [servers, setServers] = useState<McpServer[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [restarting, setRestarting] = useState<string | null>(null);
  // Add form.
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'stdio' | 'remote'>('stdio');
  const [command, setCommand] = useState('');
  const [envText, setEnvText] = useState('');
  const [url, setUrl] = useState('');
  const [headersText, setHeadersText] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const refresh = async () => {
    setServers(await getMcpServers());
  };

  useEffect(() => {
    let alive = true;
    getMcpServers()
      .then((s) => {
        if (alive) setServers(s);
      })
      .catch((err) => {
        if (alive) setError(err instanceof Error ? err.message : 'Failed to load MCP servers.');
      });
    return () => {
      alive = false;
    };
  }, []);

  const onToggle = async (s: McpServer) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      setServers(await patchMcpServer(s.name, { isActive: !s.isActive }));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Toggle failed.');
    } finally {
      setBusy(false);
    }
  };

  const onRemove = async (srvName: string) => {
    // Two-click confirm: first click arms, second click removes.
    if (confirming !== srvName) {
      setConfirming(srvName);
      return;
    }
    if (busy) return;
    setConfirming(null);
    setRestarting(null);
    setBusy(true);
    setError(null);
    try {
      await removeMcpServer(srvName);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed.');
    } finally {
      setBusy(false);
    }
  };

  const onRestart = async (srvName: string) => {
    if (busy) return;
    setRestarting(srvName);
    setConfirming(null);
    setBusy(true);
    setError(null);
    try {
      setServers(await restartMcpServer(srvName));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restart failed.');
      // Refresh anyway — the server row carries the latest error.
      try {
        await refresh();
      } catch {
        // Refresh failure already surfaced above; ignore.
      }
    } finally {
      setRestarting(null);
      setBusy(false);
    }
  };

  /** Parse KEY=value lines; returns null + sets formError on bad input. */
  const parsePairs = (text: string, label: string): Record<string, string> | null => {
    const out: Record<string, string> = {};
    for (const line of text.split('\n')) {
      const t = line.trim();
      if (!t) continue;
      const eq = t.indexOf('=');
      if (eq <= 0) {
        setFormError(`${label}: each line must be KEY=value — bad line: ${t.slice(0, 40)}`);
        return null;
      }
      out[t.slice(0, eq).trim()] = t.slice(eq + 1).trim();
    }
    return out;
  };

  const onAdd = async () => {
    setFormError(null);
    const cleanName = name.trim();
    if (!cleanName) {
      setFormError('Name is required.');
      return;
    }
    const cfg: McpServerInput = {};
    if (kind === 'stdio') {
      const parts = command.trim().split(/\s+/).filter(Boolean);
      if (parts.length === 0) {
        setFormError('Command is required for stdio servers, e.g. npx -y @modelcontextprotocol/server-filesystem /data.');
        return;
      }
      cfg.command = parts;
      const env = parsePairs(envText, 'Environment');
      if (!env) return;
      if (Object.keys(env).length > 0) cfg.environment = env;
    } else {
      if (!url.trim()) {
        setFormError('URL is required for remote servers.');
        return;
      }
      cfg.url = url.trim();
      const headers = parsePairs(headersText, 'Headers');
      if (!headers) return;
      if (Object.keys(headers).length > 0) cfg.headers = headers;
    }
    if (busy) return;
    setBusy(true);
    try {
      setServers(await saveMcpServer(cleanName, cfg));
      setAdding(false);
      setName('');
      setCommand('');
      setEnvText('');
      setUrl('');
      setHeadersText('');
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Add failed.');
    } finally {
      setBusy(false);
    }
  };

  if (error && !servers) {
    return <p className="p-5 text-sm font-medium text-red-600">{error}</p>;
  }
  if (!servers) {
    return <p className="p-5 text-sm text-navy/50">Loading MCP servers…</p>;
  }

  const dot = (s: McpServer) =>
    s.status === 'connected' ? 'bg-emerald-500' : s.status === 'error' ? 'bg-red-500' : 'bg-navy/20';

  return (
    <div className="space-y-4 p-5">
      <TabHeader
        title="MCP servers"
        sub="Servers that run on your computer or connect remotely. Values you enter stay on the computer."
        action={
          <button
            onClick={() => void refresh()}
            disabled={busy}
            className="rounded-full border border-navy/15 px-3 py-1 text-xs font-bold text-navy hover:bg-ice disabled:opacity-50"
          >
            Refresh
          </button>
        }
      />
      {error && <p className="text-sm font-medium text-red-600">{error}</p>}
      {servers.length === 0 && !adding ? (
        <p className="text-sm text-navy/50">No MCP servers yet.</p>
      ) : (
        <ul className="space-y-2">
          {servers.map((s) => (
            <li key={s.name} className="rounded-xl border border-navy/10 bg-ice p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h4 className="flex items-center gap-2 font-brico text-sm font-bold text-navy">
                    <i className={`h-2 w-2 shrink-0 rounded-full ${dot(s)}`} title={s.status} />
                    {s.name}
                    <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-bold text-navy/50">
                      {s.type === 'stdio' ? 'local' : 'remote'} · {s.tools} tool{s.tools === 1 ? '' : 's'}
                    </span>
                    {!s.isActive && (
                      <span className="rounded-full bg-navy/10 px-2 py-0.5 text-[10px] font-bold text-navy/50">
                        off
                      </span>
                    )}
                  </h4>
                  {s.configKeys.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-navy/50" title={s.configKeys.join(', ')}>
                      {s.configKeys.join(', ')}
                    </p>
                  )}
                  {s.status === 'error' && s.lastError && (
                    <p className="mt-0.5 line-clamp-2 text-xs font-medium text-red-600" title={s.lastError}>
                      {s.lastError.slice(0, 200)}
                    </p>
                  )}
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <button
                    onClick={() => void onRestart(s.name)}
                    disabled={busy || !s.isActive}
                    title={s.isActive ? 'Reconnect this server' : 'Turn on first'}
                    className="rounded-full border border-navy/15 px-3 py-1 text-xs font-bold text-navy hover:bg-white disabled:opacity-50"
                  >
                    {restarting === s.name ? '…' : 'Restart'}
                  </button>
                  <button
                    onClick={() => void onToggle(s)}
                    disabled={busy}
                    className={`rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-50 ${
                      s.isActive
                        ? 'border-navy/15 text-navy hover:bg-white'
                        : 'border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700'
                    }`}
                  >
                    {s.isActive ? 'Off' : 'On'}
                  </button>
                  <button
                    onClick={() => void onRemove(s.name)}
                    onBlur={() => setConfirming((c) => (c === s.name ? null : c))}
                    disabled={busy}
                    className={`rounded-full border px-3 py-1 text-xs font-bold disabled:opacity-50 ${
                      confirming === s.name
                        ? 'border-red-600 bg-red-600 text-white hover:bg-red-700'
                        : 'border-red-200 text-red-600 hover:bg-red-50'
                    }`}
                  >
                    {confirming === s.name ? 'Confirm?' : 'Remove'}
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {adding ? (
        <div className="space-y-2.5 rounded-xl border border-navy/10 bg-ice p-3">
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name (letters, numbers, - _)"
              className="min-w-0 flex-1 rounded-lg border border-navy/15 bg-white px-3 py-1.5 text-sm text-navy outline-none focus:border-cta"
            />
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as 'stdio' | 'remote')}
              className="rounded-lg border border-navy/15 bg-white px-2 py-1.5 text-sm font-semibold text-navy outline-none"
            >
              <option value="stdio">Local</option>
              <option value="remote">Remote</option>
            </select>
          </div>
          {kind === 'stdio' ? (
            <>
              <input
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder="Command, e.g. npx -y @modelcontextprotocol/server-filesystem /data"
                className="w-full rounded-lg border border-navy/15 bg-white px-3 py-1.5 font-mono text-xs text-navy outline-none focus:border-cta"
              />
              <textarea
                value={envText}
                onChange={(e) => setEnvText(e.target.value)}
                placeholder="Environment, one KEY=value per line (optional)"
                rows={2}
                className="w-full rounded-lg border border-navy/15 bg-white px-3 py-1.5 font-mono text-xs text-navy outline-none focus:border-cta"
              />
              <p className="text-xs text-navy/50">
                This runs on your computer with the values above — only add servers you trust.
              </p>
            </>
          ) : (
            <>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="Server URL, e.g. https://example.com/mcp"
                className="w-full rounded-lg border border-navy/15 bg-white px-3 py-1.5 font-mono text-xs text-navy outline-none focus:border-cta"
              />
              <textarea
                value={headersText}
                onChange={(e) => setHeadersText(e.target.value)}
                placeholder="Headers, one KEY=value per line (optional)"
                rows={2}
                className="w-full rounded-lg border border-navy/15 bg-white px-3 py-1.5 font-mono text-xs text-navy outline-none focus:border-cta"
              />
            </>
          )}
          {formError && <p className="text-xs font-medium text-red-600">{formError}</p>}
          <div className="flex gap-2">
            <button
              onClick={() => void onAdd()}
              disabled={busy}
              className="rounded-full bg-cta px-4 py-1.5 text-xs font-bold text-white hover:bg-ctahover disabled:opacity-50"
            >
              Add server
            </button>
            <button
              onClick={() => {
                setAdding(false);
                setFormError(null);
              }}
              className="rounded-full border border-navy/15 px-4 py-1.5 text-xs font-bold text-navy hover:bg-white"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="rounded-full border-2 border-navy px-4 py-1.5 text-xs font-bold text-navy hover:bg-navy hover:text-white"
        >
          + Add MCP server
        </button>
      )}
    </div>
  );
}
