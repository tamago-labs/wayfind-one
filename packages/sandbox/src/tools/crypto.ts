// Workspace envelope crypto (mirrors src/sandbox/crypto.js on the CLI —
// keep the two in sync; the wire format is the contract).
// Key: HKDF-SHA256 over the in-memory session bearer (injected via
// /hooks/run, never persisted). Envelope: AES-256-GCM, fresh nonce per
// file, AAD binds (path, plaintext sha256).
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const SALT = 'wayfind-workspace-v1';
const INFO = 'wayfind-workspace/v1';
const NONCE_LEN = 12;
const TAG_LEN = 16;

export function deriveWorkspaceKey(sessionToken: string): Buffer {
  if (!sessionToken) throw new Error('sessionToken required');
  return Buffer.from(hkdfSync('sha256', Buffer.from(sessionToken, 'utf8'), SALT, INFO, 32));
}

function aadFor(relPath: string, sha256hex: string): Buffer {
  return Buffer.from(`${relPath}\n${sha256hex}`, 'utf8');
}

export function sha256Hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export function sealFile(
  key: Buffer,
  relPath: string,
  plaintext: Buffer,
): { sha256: string; nonce: string; data: string } {
  const sha256 = sha256Hex(plaintext);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aadFor(relPath, sha256));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { sha256, nonce: nonce.toString('base64'), data: ct.toString('base64') };
}

export function openFile(
  key: Buffer,
  relPath: string,
  env: { sha256?: unknown; nonce?: unknown; data?: unknown },
): Buffer {
  const nonce = Buffer.from((env?.nonce as string) ?? '', 'base64');
  const raw = Buffer.from((env?.data as string) ?? '', 'base64');
  if (nonce.length !== NONCE_LEN || raw.length < TAG_LEN) {
    throw new Error(`bad envelope for ${relPath}`);
  }
  const ct = raw.subarray(0, raw.length - TAG_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aadFor(relPath, (env?.sha256 as string) ?? ''));
  decipher.setAuthTag(tag);
  let plaintext: Buffer;
  try {
    plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error(`decrypt failed for ${relPath} (tampered or wrong session)`);
  }
  if (sha256Hex(plaintext) !== env.sha256) throw new Error(`sha mismatch for ${relPath}`);
  return plaintext;
}
