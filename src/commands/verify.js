// wayfind verify — check a v0 execution receipt offline.
// Usage: wayfind verify <receipt.json | conversationId>
// A file is read locally (fully offline); an id is fetched from the API
// first. v0 receipts are UNSIGNED (class "observed"): this checks shape,
// chain order, and internal consistency — not authenticity. Signature +
// attestation checks land in Phase 2 (same command, same file format).
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { listConversations, loadToken } from '../sandbox/api.js';

function check(name, pass, detail) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

export function checkReceipt(r) {
  const results = [];
  results.push(check('version is wayfind-receipt/v0', r?.version === 'wayfind-receipt/v0', String(r?.version)));
  results.push(check('class is observed (unsigned)', r?.class === 'observed', String(r?.class)));
  const required = ['conversationId', 'model', 'provider', 'securityLevel', 'provisionedAt', 'terminatedAt'];
  const missing = required.filter((k) => r?.[k] == null);
  results.push(check('required fields present', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : `${required.length}/${required.length}`));
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
  results.push(check('checkpoint manifest chained from seq 0', chainOk, manifest ? `${manifest.length} entries` : 'not an array'));
  let timeOk = false;
  if (r?.provisionedAt && r?.terminatedAt) {
    timeOk = new Date(r.provisionedAt).getTime() < new Date(r.terminatedAt).getTime();
  }
  results.push(check('terminated after provisioned', timeOk, `${r?.provisionedAt ?? '?'} → ${r?.terminatedAt ?? '?'}`));
  results.push(check('VM cleanup verified at terminate', r?.cleanup?.vmTerminated === true, String(r?.cleanup?.vmTerminated)));
  // Inference evidence (present when the agent ran attestation checks).
  // Absent on older/standard-tier receipts — noted, not failed.
  const inf = r?.inference ?? null;
  if (inf) {
    const msgs = Array.isArray(inf.messages) ? inf.messages : [];
    const checked = msgs.filter((m) => m?.checked);
    const allValid = checked.length > 0 && checked.every((m) => m.valid === true);
    results.push(check('inference responses verified vs retained attestation', allValid, `${checked.filter((m) => m.valid).length}/${checked.length} checked valid`));
    results.push(check('preflight nonce fresh, model TEEs present', inf.preflight?.nonceEchoed === true && (inf.preflight?.modelTee?.length ?? 0) > 0, `${inf.preflight?.nodes ?? 0} node(s)`));
    results.push(check('NVIDIA verdict clean at preflight', inf.preflight?.nvidia?.overall === true && inf.preflight?.nvidia?.nonceMatch === true, inf.preflight?.nvidia ? `${inf.preflight.nvidia.gpus} GPUs` : 'no GPU evidence'));
  } else {
    console.log('  NOTE  no inference evidence block (older receipt or standard tier)');
  }
  if (r?.class !== 'signed' && r?.class !== 'hardware-attested') {
    console.log('  NOTE  unsigned v0: integrity checked, authenticity not proven (Phase 2 signs receipts)');
  }
  return results.every(Boolean);
}

export async function verify(rawArgs) {
  const [src] = rawArgs;
  if (!src || src === '--help') {
    console.error('Usage: wayfind verify <receipt.json | conversationId>');
    process.exit(1);
  }
  let receipt = null;
  const asPath = path.resolve(src);
  try {
    const st = await fs.stat(asPath).catch(() => null);
    if (st?.isFile()) {
      receipt = JSON.parse(await fs.readFile(asPath, 'utf8'));
      console.log(`Receipt: ${asPath} (local file, offline)`);
    }
  } catch (err) {
    console.error(`Cannot read receipt file: ${err.message}`);
    process.exit(1);
  }
  if (!receipt) {
    const token = await loadToken();
    const list = await listConversations(token);
    const conv = list.find((c) => c.conversationId === src);
    if (!conv) {
      console.error('No such file or conversation id.');
      process.exit(1);
    }
    if (!conv.receipt) {
      console.error('Conversation has no receipt yet (only closed conversations carry one).');
      process.exit(1);
    }
    receipt = conv.receipt;
    console.log(`Receipt: conversation ${src} (fetched, then checked locally)`);
  }
  const ok = checkReceipt(receipt);
  console.log(ok ? 'verify: ALL CHECKS PASSED' : 'verify: CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}
