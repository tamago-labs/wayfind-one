// wayfind evidence — download a conversation's DPA/audit bundle.
// Usage: wayfind evidence <conversationId> [--out bundle.json] [--decrypt]
// The bundle carries sealed blobs; --decrypt opens transcripts locally
// with the escrowed workspace key (fetched owner-authenticated, like the
// website's history view). Nothing decrypted ever leaves the machine.
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { apiBase } from '../auth/client.js';
import { loadToken } from '../sandbox/api.js';
import { openFile } from '../sandbox/crypto.js';

export async function evidence(rawArgs) {
  const args = [...rawArgs];
  let id = '';
  let out = '';
  let decrypt = false;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--out' || flag === '-o') out = args.shift() ?? '';
    else if (flag === '--decrypt') decrypt = true;
    else if (flag.startsWith('--')) {
      console.error(`Unknown flag: ${flag}`);
      process.exit(1);
    } else id = flag;
  }
  if (!id) {
    console.error('Usage: wayfind evidence <conversationId> [--out bundle.json] [--decrypt]');
    process.exit(1);
  }
  const token = await loadToken();
  const res = await fetch(`${apiBase()}/conversations/${id}/export-evidence`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: '{}',
  });
  const bundle = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(bundle?.error ?? `request failed (${res.status})`);
  if (decrypt) {
    const keyRes = await fetch(`${apiBase()}/conversations/${id}/key`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const keyData = await keyRes.json().catch(() => ({}));
    if (!keyRes.ok || !keyData?.workspaceKey) throw new Error(keyData?.error ?? 'key release failed');
    const key = Buffer.from(keyData.workspaceKey, 'base64');
    bundle.transcripts = (bundle.checkpoints ?? []).map((c) => {
      try {
        const pt = openFile(key, 'transcript.jsonl', { sha256: c.envelope?.sha256, nonce: c.envelope?.nonce, data: c.envelope?.data });
        return { seq: c.seq, entries: JSON.parse(pt.toString('utf8')) };
      } catch (e) {
        return { seq: c.seq, error: e.message };
      }
    });
    delete bundle.checkpoints;
  }
  const text = JSON.stringify(bundle, null, 2);
  if (out) {
    await fs.writeFile(path.resolve(out), text);
    console.log(`Evidence bundle written: ${out} (${(bundle.checkpoints ?? bundle.transcripts ?? []).length} checkpoints)`);
  } else {
    process.stdout.write(text + '\n');
  }
}
