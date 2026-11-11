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
  const signed = r?.class === 'signed';
  ok &&= push('class is observed or signed', r?.class === 'observed' || signed, String(r?.class));
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
  if (r?.class === 'signed' && r.signature?.kid) {
    ok &&= push('control-plane signature present (verified below / CLI offline)', true, `kid ${r.signature.kid}`);
  } else {
    checks.push({ name: 'control-plane signature', pass: true, detail: 'absent — receipt is observed-only' });
  }
  const inf = (r as unknown as { inference?: unknown })?.inference as {
    preflight?: { nonceEchoed?: boolean; modelTee?: string[]; nodes?: number; nvidia?: { overall?: boolean; nonceMatch?: boolean; gpus?: number } };
    messages?: Array<{ checked?: boolean; valid?: boolean }>;
  } | null;
  if (inf) {
    const msgs = Array.isArray(inf.messages) ? inf.messages : [];
    const checked = msgs.filter((m) => m?.checked);
    ok &&= push('inference responses verified vs retained attestation', checked.length > 0 && checked.every((m) => m.valid === true), `${checked.filter((m) => m.valid).length}/${checked.length} checked valid`);
    ok &&= push('preflight nonce fresh, model TEEs present', inf.preflight?.nonceEchoed === true && (inf.preflight?.modelTee?.length ?? 0) > 0);
    ok &&= push('NVIDIA verdict clean at preflight', inf.preflight?.nvidia?.overall === true && inf.preflight?.nvidia?.nonceMatch === true);
  }
  return { ok, checks };
}
