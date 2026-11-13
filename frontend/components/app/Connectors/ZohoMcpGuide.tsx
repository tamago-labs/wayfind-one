'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';

/** Shared Zoho MCP setup guide — one component for every `Via Zoho MCP`
 * connector. Only the service name interpolates; per-connector callouts
 * arrive via `ConnectorSetup.note` and render underneath. */

const STEPS: Array<{ title: string; body: (service: string) => string }> = [
  {
    title: 'Open the Zoho MCP dashboard',
    body: () => 'Go to zoho.com/mcp and sign in with your Zoho account.',
  },
  {
    title: 'Create a new MCP server',
    body: () => 'Create a server — one server can expose several services.',
  },
  {
    title: 'Add tools for your service',
    body: (service) => `Add tools and select the service you want to use (for us: ${service}), then enable permission for those tools.`,
  },
  {
    title: 'Switch the authorization type',
    body: () =>
      'Open the Connection tab and change the default Authorization On Demand to Authorization via Connection — this pre-authorises the tools so your Bots can use them.',
  },
  {
    title: 'Copy the endpoint URL',
    body: () =>
      'Open the Connect tab and copy the endpoint to your MCP server — it looks like https://…zohomcp.com/mcp/…/message. Paste it below in step 2.',
  },
];

export default function ZohoMcpGuide({ service, note }: { service: string; note?: string }) {

  return (
    <div>
      <ol className="mt-3 space-y-3">
        {STEPS.map((s, i) => (
          <li key={s.title} className="flex gap-3">
            <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-cta/10 text-xs font-extrabold text-cta">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-bold text-navy">{s.title}</p>
              <p className="mt-0.5 text-sm text-heroslate">{s.body(service)}</p>
              {i === 0 && (
                <a
                  href="https://www.zoho.com/mcp/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-cta hover:underline"
                >
                  zoho.com/mcp <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      {note && (
        <p className="mt-3 rounded-xl bg-bamber/15 px-4 py-2.5 text-sm font-semibold text-navy">{note}</p>
      )}

      <p className="mt-3 flex gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Treat your endpoint URL like a password — it can trigger tools on your account. Never paste it into public repos or shared docs.
      </p>
    </div>
  );
}
