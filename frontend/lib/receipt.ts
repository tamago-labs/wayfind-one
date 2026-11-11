import type { ReceiptV0 } from './wayfind';

// Port of the CLI verifier (src/commands/verify.js) for the website panel.
// v0 receipts are UNSIGNED (class "observed"): shape, chain order, internal
// consistency — not authenticity. Signature checks land in Phase 2.
export interface ReceiptCheck {
  name: string;
  pass: boolean;
  detail?: string;
}

export function checkReceipt(r: ReceiptV0 | null | undefined): { ok: boolean; checks: ReceiptCheck[] } {
  const checks: ReceiptCheck[] = [];
  const push = (name: string, pass: boolean, detail?: string) => {
    checks.push({ name, pass, detail });
    return pass;
  };
  let ok = true;
  ok &&= push('version is wayfind-receipt/v0', r?.version === 'wayfind-receipt/v0', String(r?.version));
  ok &&= push('class is observed (unsigned)', r?.class === 'observed', String(r?.class));
  const required = ['conversationId', 'model', 'provider', 'securityLevel', 'provisionedAt', 'terminatedAt'];
  const missing = required.filter((k) => (r as unknown as Record<string, unknown>)?.[k] == null);
  ok &&= push('required fields present', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : 'all present');
  const manifest = Array.isArray(r?.checkpointManifest) ? r.checkpointManifest : null;
  let chainOk = manifest !== null;
  if (manifest) {
    for (const [i, e] of manifest.entries()) {
      const m = typeof e === 'string' ? e.match(/^(\d+):([0-9a-f]{64})$/i) : null;
      if (!m || Number(m[1]) !== i) {
        chainOk = false;
        break;
      }
    }
  }
  ok &&= push('checkpoint manifest chained from seq 0', chainOk, manifest ? `${manifest.length} entries` : 'not an array');
  let timeOk = false;
  if (r?.provisionedAt && r?.terminatedAt) {
    timeOk = new Date(r.provisionedAt).getTime() < new Date(r.terminatedAt).getTime();
  }
  ok &&= push('terminated after provisioned', timeOk);
  ok &&= push('VM cleanup verified at terminate', r?.cleanup?.vmTerminated === true);
  return { ok, checks };
}
