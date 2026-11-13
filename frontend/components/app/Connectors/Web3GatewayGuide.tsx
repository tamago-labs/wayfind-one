'use client';

import { AlertTriangle, ExternalLink } from 'lucide-react';

/** Shared Web3 Gateway setup guide — one component for every
 * `Via Web3 Gateway` connector. Mirrors ZohoMcpGuide's look; per-connector
 * callouts arrive via `ConnectorSetup.note` and render underneath. */

const STEPS: Array<{ title: string; body: string }> = [
  {
    title: 'Open Wayfind Web3 Gateway',
    body: 'Go to web3.wayfind.click and sign in.',
  },
  {
    title: 'Get your wallet',
    body: 'Sign in with email to create your Privy wallet. Wayfind is added as a restricted signer under policies you approve.',
  },
  {
    title: 'Copy your endpoint URL',
    body: 'Open the Connect tab and copy your URL — web3.wayfind.click/mcp/…/message. Paste it below in step 2.',
  },
];

export default function Web3GatewayGuide({ note }: { note?: string }) {
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
              <p className="mt-0.5 text-sm text-heroslate">{s.body}</p>
              {i === 0 && (
                <a
                  href="https://web3.wayfind.click/"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-1 inline-flex items-center gap-1 text-sm font-bold text-cta hover:underline"
                >
                  web3.wayfind.click <ExternalLink className="h-3.5 w-3.5" />
                </a>
              )}
            </div>
          </li>
        ))}
      </ol>

      <p className="mt-3 text-sm text-heroslate">
        One URL works for all three Web3 connectors — import each one you want your Bots to use.
      </p>

      {note && (
        <p className="mt-3 rounded-xl bg-bamber/15 px-4 py-2.5 text-sm font-semibold text-navy">{note}</p>
      )}

      <p className="mt-3 flex gap-2 rounded-xl bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-700">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
        Treat your endpoint URL like a password — it can move funds on your wallet. Never paste it into public repos or shared docs.
      </p>
    </div>
  );
}
