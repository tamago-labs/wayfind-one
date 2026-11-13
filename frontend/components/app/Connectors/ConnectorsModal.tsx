'use client';

import { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ArrowLeft, Check, Loader2, Plug, Search, X } from 'lucide-react';
import {
  CONNECTORS,
  CONNECTOR_TYPES,
  connectorServerName,
  connectorSetup,
} from '@/lib/connectors';
import type { Connector, ConnectorTypeFilter } from '@/lib/connectors';
import { getMcpServers, patchMcpServer, restartMcpServer, saveMcpServer } from '@/lib/team';
import type { McpServer } from '@/lib/team';
import ZohoMcpGuide from './ZohoMcpGuide';
import Web3GatewayGuide from './Web3GatewayGuide';

interface ConnectorsModalProps {
  open: boolean;
  onClose: () => void;
  /** Import writes to the computer — disabled until it is usable. */
  computerReady: boolean;
}

function ConnectorBadge({ c }: { c: Connector }) {
  const [failed, setFailed] = useState(false);
  if (c.image && !failed) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={c.image} alt="" onError={() => setFailed(true)} className="h-10 w-10 object-contain" loading="lazy" />;
  }
  return (
    <span className="grid h-10 w-10 place-items-center rounded-xl bg-ice text-cta">
      <Plug className="h-5 w-5" />
    </span>
  );
}

export default function ConnectorsModal({ open, onClose, computerReady }: ConnectorsModalProps) {
  const [cat, setCat] = useState<ConnectorTypeFilter>('Zoho-based services');
  const [q, setQ] = useState('');
  const [selected, setSelected] = useState<Connector | null>(null);
  const [servers, setServers] = useState<Record<string, McpServer>>({});
  const [url, setUrl] = useState('');
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Load the computer's MCP registry when the modal opens (global import —
  // one entry per connector, every bot sees it immediately).
  useEffect(() => {
    if (!open || !computerReady) return;
    let alive = true;
    getMcpServers()
      .then((list) => {
        if (!alive) return;
        const map: Record<string, McpServer> = {};
        for (const s of list) map[s.name] = s;
        setServers(map);
      })
      .catch(() => {
        /* registry unreadable — import will surface the error */
      });
    return () => {
      alive = false;
    };
  }, [open, computerReady]);

  // Reset the drill-in when the modal closes; keep filters for next open.
  useEffect(() => {
    if (!open) {
      setSelected(null);
      setUrl('');
      setResult(null);
    }
  }, [open]);

  useEffect(() => {
    setUrl('');
    setResult(null);
  }, [selected?.name]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const list = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return CONNECTORS.filter(
      (c) =>
        c.type === cat &&
        (!needle || c.name.toLowerCase().includes(needle) || c.blurb.toLowerCase().includes(needle)),
    );
  }, [cat, q]);

  async function doImport(c: Connector): Promise<void> {
    const endpoint = url.trim();
    if (!endpoint || importing) return;
    setImporting(true);
    setResult(null);
    const name = connectorServerName(c);
    try {
      const cfg = { command: ['npx'], args: ['mcp-remote', endpoint, '--transport', 'http-only'] };
      try {
        await saveMcpServer(name, cfg);
      } catch (err) {
        // Already registered — update the endpoint in place instead.
        if (err instanceof Error && /exists/i.test(err.message)) {
          await patchMcpServer(name, cfg);
        } else {
          throw err;
        }
      }
      const after = await restartMcpServer(name);
      const live = after.find((s) => s.name === name);
      setServers((prev) => {
        const next = { ...prev };
        for (const s of after) next[s.name] = s;
        return next;
      });
      setResult({
        ok: true,
        message:
          live && live.tools > 0
            ? `Connected — ${live.tools} tools live for all your Bots.`
            : c.status === 'Via Web3 Gateway'
              ? 'Saved, but the computer reports 0 tools — check the endpoint URL and wallet connection in the Web3 app, then retry.'
              : 'Saved, but the computer reports 0 tools — check the endpoint URL and permissions in Zoho, then retry.',
      });
    } catch (err) {
      setResult({ ok: false, message: err instanceof Error ? err.message : String(err) });
    } finally {
      setImporting(false);
    }
  }

  const setup = selected ? connectorSetup(selected) : undefined;
  const installed = selected ? servers[connectorServerName(selected)] : undefined;

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-4 sm:p-6"
          onClick={onClose}
        >
          <motion.div
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.97, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-white shadow-xl"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Connectors"
          >
            <div className="flex items-center justify-between border-b border-navy/10 px-5 py-4">
              <h3 className="flex items-center gap-2 font-brico text-lg font-bold text-navy">
                {selected && (
                  <button
                    onClick={() => setSelected(null)}
                    aria-label="Back to list"
                    className="grid h-7 w-7 place-items-center rounded-full text-heroslate hover:bg-ice hover:text-navy"
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                )}
                {selected ? selected.name : 'Connectors'}
              </h3>
              <button
                onClick={onClose}
                aria-label="Close connectors"
                className="grid h-8 w-8 place-items-center rounded-full text-heroslate hover:bg-ice hover:text-navy"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {!selected ? (
              <>
                <div className="border-b border-navy/10 px-5 py-3">
                  <div className="flex flex-wrap gap-2" role="tablist" aria-label="Filter by type">
                    {CONNECTOR_TYPES.map((t) => (
                      <button
                        key={t}
                        role="tab"
                        aria-selected={cat === t}
                        onClick={() => setCat(t)}
                        className={`rounded-full px-3 py-1 text-xs font-bold transition-colors ${
                          cat === t ? 'bg-navy text-white' : 'bg-ice text-navy hover:bg-navy/10'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                  <label className="relative mt-2 block">
                    <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-heroslate" />
                    <input
                      value={q}
                      onChange={(e) => setQ(e.target.value)}
                      placeholder="Search connectors…"
                      aria-label="Search connectors"
                      className="w-full rounded-xl border border-navy/15 bg-ice py-2 pl-10 pr-4 text-sm text-navy outline-none placeholder:text-heroslate/60 focus:border-cta"
                    />
                  </label>
                </div>
                <div className="flex-1 overflow-y-auto px-5 py-3">
                  {list.length === 0 && (
                    <p className="py-8 text-center text-sm font-semibold text-heroslate">
                      No connectors match “{q}”.
                    </p>
                  )}
                  <ul className="divide-y divide-navy/5">
                    {list.map((c) => {
                      const live = servers[connectorServerName(c)];
                      return (
                        <li key={c.name}>
                          <button
                            onClick={() => setSelected(c)}
                            className="flex w-full items-center gap-3 py-2.5 text-left hover:bg-ice/50"
                          >
                            <ConnectorBadge c={c} />
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-sm font-bold text-navy">{c.name}</span>
                              <span className="block truncate text-xs text-heroslate">{c.blurb}</span>
                            </span>
                            {live ? (
                              <span className="flex shrink-0 items-center gap-1 rounded-full bg-blagoon/10 px-2.5 py-1 text-xs font-bold text-blagoon">
                                <Check className="h-3 w-3" /> Installed{live.tools > 0 ? ` · ${live.tools}` : ''}
                              </span>
                            ) : (
                              <span className="shrink-0 rounded-full bg-ice px-2.5 py-1 text-xs font-bold text-navy">
                                {c.status ?? 'Import'}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              </>
            ) : (
              <div className="flex-1 overflow-y-auto px-5 py-4">
                <div className="flex items-center gap-3">
                  <ConnectorBadge c={selected} />
                  <p className="min-w-0 flex-1 text-sm text-heroslate">{selected.description ?? selected.blurb}</p>
                </div>

                {installed && (
                  <p className="mt-3 flex items-center gap-1.5 rounded-xl bg-blagoon/10 px-4 py-2.5 text-sm font-bold text-blagoon">
                    <Check className="h-4 w-4" />
                    Installed{installed.tools > 0 ? ` — ${installed.tools} tools live` : ''} · all Bots can use it.
                    Import again to update the endpoint.
                  </p>
                )}

                {setup && (
                  <>
                    <h4 className="mt-4 font-brico text-sm font-extrabold text-navy">
                      {setup.provider === 'web3-gateway' ? '1 · Get your remote MCP endpoint' : '1 · Set up Zoho MCP'}
                    </h4>
                    {setup.provider === 'web3-gateway' ? (
                      <Web3GatewayGuide note={setup.note} />
                    ) : (
                      <ZohoMcpGuide service={setup.service ?? ''} note={setup.note} />
                    )}
                  </>
                )}

                <h4 className="mt-4 font-brico text-sm font-extrabold text-navy">
                  {setup ? '2 · Import to your computer' : 'Import to your computer'}
                </h4>
                {!computerReady ? (
                  <p className="mt-2 rounded-xl bg-bamber/15 px-4 py-3 text-sm font-semibold text-navy">
                    Start your computer first — importing writes to its MCP registry.
                  </p>
                ) : (
                  <>
                    <input
                      value={url}
                      onChange={(e) => setUrl(e.target.value)}
                      placeholder={
                        selected.status === 'Via Web3 Gateway'
                          ? 'Paste your Web3 Gateway URL…'
                          : 'Paste your Zoho MCP endpoint URL…'
                      }
                      aria-label="MCP endpoint URL"
                      inputMode="url"
                      spellCheck={false}
                      className="mt-2 w-full rounded-xl border border-navy/15 bg-ice px-4 py-2.5 font-mono text-xs text-navy outline-none placeholder:font-sans placeholder:text-sm placeholder:text-heroslate/60 focus:border-cta"
                    />
                    <div className="mt-3 flex items-center justify-end gap-2">
                      <button
                        onClick={() => void doImport(selected)}
                        disabled={!url.trim() || importing}
                        className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-cta px-5 py-2 text-sm font-bold text-white hover:bg-ctahover disabled:opacity-50"
                      >
                        {importing && <Loader2 className="h-4 w-4 animate-spin" />}
                        {importing ? 'Importing…' : installed ? 'Update' : 'Import'}
                      </button>
                    </div>
                    {result && (
                      <p
                        className={`mt-2 rounded-xl px-4 py-2.5 text-sm font-semibold ${
                          result.ok ? 'bg-blagoon/10 text-blagoon' : 'bg-red-50 text-red-700'
                        }`}
                      >
                        {result.message}
                      </p>
                    )}
                  </>
                )}

                {!setup && (
                  <p className="mt-3 text-sm text-heroslate">
                    This connector has no self-serve import yet — ask any Bot in chat to connect it.
                  </p>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
