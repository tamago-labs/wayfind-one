// wayfind verify — check a v0 execution receipt offline.
// Usage: wayfind verify <receipt.json | conversationId | microvm-...>
// A file is read locally (fully offline); an id is fetched first, then
// checked locally. Unsigned v0 ("observed") receipts: shape, chain order,
// internal consistency. Signed receipts ("signed"): all of the above PLUS
// a local Ed25519 check against the control-plane key (cached in
// ~/.wayfind/verify-key.json, refreshed when the kid rotates).
import { verify as edVerify } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiBase } from '../auth/client.js';
import { fetchInnerEvidence, listConversations, loadToken } from '../sandbox/api.js';

/** Canonical JSON — must match the backend byte-for-byte (sorted keys). */
export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

const KEY_CACHE = path.join(os.homedir(), '.wayfind', 'verify-key.json');

async function loadVerifyKey() {
  try {
    const cached = JSON.parse(await fs.readFile(KEY_CACHE, 'utf8'));
    if (cached?.kid && cached?.publicKey) return { cached: true, ...cached };
  } catch {
    // No cache — fetch below (public endpoint, no auth needed).
  }
  return loadVerifyKeyForce();
}

function check(name, pass, detail) {
  console.log(`  ${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  return pass;
}

export function checkReceipt(r) {
  const results = [];
  results.push(check('version is wayfind-receipt/v0', r?.version === 'wayfind-receipt/v0', String(r?.version)));
  const signed = r?.class === 'signed';
  results.push(check('class is observed or signed', r?.class === 'observed' || signed, String(r?.class)));
  const isInner = r?.kind === 'inner-sandbox';
  const required = isInner
    ? ['sandboxId', 'model', 'provider', 'securityLevel', 'provisionedAt', 'terminatedAt']
    : ['conversationId', 'model', 'provider', 'securityLevel', 'provisionedAt', 'terminatedAt'];
  const missing = required.filter((k) => r?.[k] == null);
  results.push(check('required fields present', missing.length === 0, missing.length ? `missing: ${missing.join(',')}` : `${required.length}/${required.length}`));
  if (isInner) {
    const snap = r?.finalSnapshot;
    const snapOk = snap?.recorded === true && typeof snap.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(snap.sha256);
    results.push(check('final snapshot sealed at close', snapOk, snap?.recorded ? `sha256 ${String(snap.sha256).slice(0, 12)}…` : 'not recorded'));
  } else {
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
  }
  let timeOk = false;
  if (r?.provisionedAt && r?.terminatedAt) {
    timeOk = new Date(r.provisionedAt).getTime() < new Date(r.terminatedAt).getTime();
  }
  results.push(check('terminated after provisioned', timeOk, `${r?.provisionedAt ?? '?'} → ${r?.terminatedAt ?? '?'}`));
  results.push(check('VM cleanup verified at terminate', r?.cleanup?.vmTerminated === true, String(r?.cleanup?.vmTerminated)));
  // Inference evidence (present when the agent ran attestation checks).
  // Absent on older/standard-tier receipts — noted, not failed.
  // Closeout binds it nested (inference.botEvidence); unwrap with a flat
  // fallback so older receipts keep checking.
  const inf = r?.inference?.botEvidence ?? r?.inference ?? null;
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
    console.log('  NOTE  unsigned v0: integrity checked, authenticity not proven (signed receipts verify below when present)');
  }
  return { ok: results.every(Boolean), signed: !!signed, signature: r?.signature ?? null };
}

export async function verify(rawArgs) {
  const [src] = rawArgs;
  if (!src || src === '--help') {
    console.error('Usage: wayfind verify <receipt.json | conversationId | microvm-...>');
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
    if (/^microvm-[A-Za-z0-9-]+$/.test(src)) {
      // Inner sandbox run: receipt lives in the outer's stored evidence
      // bundle (same id as chat and the Sessions panel).
      const ev = await fetchInnerEvidence(token, src);
      receipt = ev?.receipt ?? null;
      if (!receipt) {
        console.error('No stored evidence for that sandbox yet — close the session first.');
        process.exit(1);
      }
      console.log(`Receipt: inner sandbox ${src} (fetched, then checked locally)`);
    } else {
      const list = await listConversations(token);
      const conv = list.find((c) => c.conversationId === src);
      if (!conv) {
        console.error('No such file, conversation id, or sandbox id.');
        process.exit(1);
      }
      if (!conv.receipt) {
        console.error('Conversation has no receipt yet (only closed conversations carry one).');
        process.exit(1);
      }
      receipt = conv.receipt;
      console.log(`Receipt: conversation ${src} (fetched, then checked locally)`);
    }
  }
  let { ok } = checkReceipt(receipt);
  // Offline Ed25519 check for signed receipts. Unsigned (observed-only)
  // receipts skip this — the NOTE above already says so.
  if (receipt?.class === 'signed' && receipt?.signature?.sig) {
    const sig = await verifySignature(receipt);
    ok = check('Ed25519 receipt signature verifies (offline)', sig.ok, sig.detail) && ok;
  }
  console.log(ok ? 'verify: ALL CHECKS PASSED' : 'verify: CHECKS FAILED');
  process.exit(ok ? 0 : 1);
}

/** Offline Ed25519 check for a receipt object. Shared with `wayfind demo`. */
export async function verifySignature(receipt) {
  try {
    const key = await loadVerifyKey();
    const { signature, ...body } = receipt;
    if (signature.kid !== key.kid) {
      try {
        const fresh = await loadVerifyKeyForce();
        if (fresh.kid === signature.kid) {
          return { ok: edVerifyCheck(body, signature, fresh.publicKey), detail: `key rotated (now ${fresh.kid})` };
        }
        return { ok: false, detail: `unknown kid ${signature.kid} (current ${key.kid})` };
      } catch (e) {
        return { ok: false, detail: e.message };
      }
    }
    return { ok: edVerifyCheck(body, signature, key.publicKey), detail: `kid ${key.kid}` };
  } catch (e) {
    return { ok: false, detail: e.message };
  }
}

function edVerifyCheck(body, signature, publicKeyPem) {
  if (signature?.algo !== 'ed25519' || typeof signature.sig !== 'string') return false;
  try {
    return edVerify(null, Buffer.from(canonicalize(body), 'utf8'), publicKeyPem, Buffer.from(signature.sig, 'base64url'));
  } catch {
    return false;
  }
}

async function loadVerifyKeyForce() {
  const res = await fetch(`${apiBase()}/verify-key`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.kid || !data?.publicKey) throw new Error(data?.error ?? 'verify-key unavailable');
  await fs.mkdir(path.dirname(KEY_CACHE), { recursive: true });
  await fs.writeFile(KEY_CACHE, JSON.stringify(data));
  return data;
}
