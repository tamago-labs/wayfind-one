// wayfind image-trust — fetch the published sandbox-image record and
// verify its control-plane signature offline (same keyring as receipts).
// Usage: wayfind image-trust
import { createPublicKey, verify as edVerify } from 'node:crypto';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { apiBase } from '../auth/client.js';

function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value).filter(([, v]) => v !== undefined).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

const KEY_CACHE = path.join(os.homedir(), '.wayfind', 'verify-key.json');

export async function imageTrust() {
  const res = await fetch(`${apiBase()}/image-trust`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error ?? `request failed (${res.status})`);
  const rec = data.imageTrust;
  console.log(`image:   ${rec.imageArn}\nversion:  ${rec.imageVersion ?? '?'}\nbuilt:    ${rec.builtAt ?? '?'}\nzip:      ${rec.zipSha256 ?? '?'}\nsbom:     ${rec.sbomSha256 ?? 'none'}`);
  const sig = rec.signature ?? {};
  let key = null;
  try {
    key = JSON.parse(await fs.readFile(KEY_CACHE, 'utf8'));
  } catch {
    key = rec.signingKey ?? null;
    if (key?.kid && key?.publicKey) {
      await fs.mkdir(path.dirname(KEY_CACHE), { recursive: true });
      await fs.writeFile(KEY_CACHE, JSON.stringify(key));
    }
  }
  if (!sig?.sig || sig?.algo !== 'ed25519') {
    console.log('SIGNATURE: absent — record is unsigned');
    process.exit(1);
  }
  let valid = false;
  if (key && sig.kid === key.kid) {
    // Rebuild exactly the signed manifest (publish-time fields only).
    const body = {
      imageArn: rec.imageArn,
      imageVersion: rec.imageVersion ?? '1.0',
      zipSha256: rec.zipSha256,
      sbomSha256: rec.sbomSha256 ?? null,
      builtAt: rec.builtAt,
    };
    try {
      valid = edVerify(null, Buffer.from(canonicalize(body), 'utf8'), createPublicKey(key.publicKey), Buffer.from(sig.sig, 'base64url'));
    } catch {
      valid = false;
    }
  }
  console.log(valid ? `SIGNATURE VALID (kid ${sig.kid})` : `SIGNATURE INVALID (receipt kid ${sig.kid ?? '?'} vs key ${key?.kid ?? 'none'})`);
  process.exit(valid ? 0 : 1);
}
