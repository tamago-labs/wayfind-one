// Workspace envelope crypto (mirrors packages/sandbox/src/tools/crypto.ts —
// keep the two in sync; the wire format is the contract).
//
// Key: HKDF-SHA256 over the session bearer (256-bit entropy, already known
// to exactly CLI + agent, never persisted). Zero key transport, zero new
// secrets, key dies with the session. Salt/info are fixed domain-
// separation strings — uniqueness comes from the bearer itself.
//
// Envelope per file: AES-256-GCM, fresh 12-byte nonce per file, AAD binds
// (path, plaintext sha256) so ciphertext can't be swapped across paths and
// tampering fails closed. Metadata (path/size/sha in the manifest) stays
// visible to the relay — contents do not.
import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from 'node:crypto';

const SALT = 'wayfind-workspace-v1';
const INFO = 'wayfind-workspace/v1';
const NONCE_LEN = 12;
const TAG_LEN = 16;

export function deriveWorkspaceKey(sessionToken) {
  if (typeof sessionToken !== 'string' || !sessionToken) throw new Error('sessionToken required');
  return hkdfSync('sha256', Buffer.from(sessionToken, 'utf8'), SALT, INFO, 32);
}

function aadFor(relPath, sha256hex) {
  return Buffer.from(`${relPath}\n${sha256hex}`, 'utf8');
}

export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Seal a file buffer → { sha256, nonce, data } (base64 fields for JSON). */
export function sealFile(key, relPath, buf) {
  const plaintext = Buffer.isBuffer(buf) ? buf : Buffer.from(buf);
  const sha256 = sha256Hex(plaintext);
  const nonce = randomBytes(NONCE_LEN);
  const cipher = createCipheriv('aes-256-gcm', key, nonce);
  cipher.setAAD(aadFor(relPath, sha256));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final(), cipher.getAuthTag()]);
  return { sha256, nonce: nonce.toString('base64'), data: ct.toString('base64') };
}

/** Open an envelope → Buffer. Throws on auth failure or sha mismatch. */
export function openFile(key, relPath, env) {
  const nonce = Buffer.from(env?.nonce ?? '', 'base64');
  const raw = Buffer.from(env?.data ?? '', 'base64');
  if (nonce.length !== NONCE_LEN || raw.length < TAG_LEN) throw new Error(`bad envelope for ${relPath}`);
  const ct = raw.subarray(0, raw.length - TAG_LEN);
  const tag = raw.subarray(raw.length - TAG_LEN);
  const decipher = createDecipheriv('aes-256-gcm', key, nonce);
  decipher.setAAD(aadFor(relPath, env.sha256 ?? ''));
  decipher.setAuthTag(tag);
  let plaintext;
  try {
    plaintext = Buffer.concat([decipher.update(ct), decipher.final()]);
  } catch {
    throw new Error(`decrypt failed for ${relPath} (tampered or wrong session)`);
  }
  if (sha256Hex(plaintext) !== env.sha256) throw new Error(`sha mismatch for ${relPath}`);
  return plaintext;
}
