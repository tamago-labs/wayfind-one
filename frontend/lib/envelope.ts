// Browser-side envelope opening (mirror of the CLI's crypto.js openFile
// and the agent's tools/crypto.ts). AES-256-GCM via WebCrypto, AAD binds
// (path, plaintext sha256). Used to render sealed checkpoints + verify
// pulled files client-side.

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function importWorkspaceKey(b64: string): Promise<CryptoKey> {
  const raw = b64ToBytes(b64);
  return crypto.subtle.importKey('raw', raw as BufferSource, { name: 'AES-GCM' }, false, ['decrypt']);
}

export async function openEnvelope(
  workspaceKeyB64: string,
  relPath: string,
  env: { sha256?: string; nonce?: string; data?: string },
): Promise<Uint8Array> {
  const key = await importWorkspaceKey(workspaceKeyB64);
  const nonce = b64ToBytes(env.nonce ?? '');
  const raw = b64ToBytes(env.data ?? '');
  const aad = new TextEncoder().encode(`${relPath}\n${env.sha256 ?? ''}`);
  let plaintext: ArrayBuffer;
  try {
    plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce as BufferSource, additionalData: aad }, key, raw as BufferSource);
  } catch {
    throw new Error(`decrypt failed for ${relPath} (tampered or wrong session)`);
  }
  const bytes = new Uint8Array(plaintext);
  const digest = await crypto.subtle.digest('SHA-256', bytes as BufferSource);
  const hex = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
  if (hex !== (env.sha256 ?? '').toLowerCase()) throw new Error(`sha mismatch for ${relPath}`);
  return bytes;
}

export interface TranscriptEntry {
  seq: number;
  role: string;
  content: string;
  prev: string;
  hash: string;
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyTranscript(entries: TranscriptEntry[]): Promise<boolean> {
  for (const [i, e] of entries.entries()) {
    if (e.seq !== i) return false;
    if (e.prev !== (i === 0 ? 'GENESIS' : entries[i - 1].hash)) return false;
    if (e.hash !== (await sha256Hex(`${e.seq}\n${e.role}\n${e.content}\n${e.prev}`))) return false;
  }
  return true;
}
