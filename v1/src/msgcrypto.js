import {
  generateKeyPairSync, sign, verify, diffieHellman, createPrivateKey, createPublicKey,
  randomBytes, createCipheriv, createDecipheriv, createHash
} from 'node:crypto'

// App-level message crypto. Transport is already Noise-encrypted inside the
// topic-gated swarm; these signatures bind a sender identity (bot keypair or
// node device key via keet attest) to each envelope so receivers can verify
// WHO wrote it, not just that it arrived on an encrypted channel.

// ---- ed25519: per-bot signing identity ----
export function genBotKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519')
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
    sec: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }
}

export function edSign(secPem, bytes) {
  return sign(null, bytes, secPem).toString('base64')
}

export function edVerify(pubPem, bytes, sigB64) {
  try {
    return verify(null, bytes, pubPem, Buffer.from(String(sigB64), 'base64'))
  } catch {
    return false
  }
}

// ---- x25519 + AES-GCM: per-recipient DM sealing ----
// Static ECDH: both sides derive the same secret from (own sec, peer pub).
// Secret never leaves the machine; only ciphertext crosses the swarm.
export function genEncKeys() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519')
  return {
    pub: publicKey.export({ type: 'spki', format: 'pem' }),
    sec: privateKey.export({ type: 'pkcs8', format: 'pem' })
  }
}

function dmKey(ownSecPem, peerPubPem) {
  // diffieHellman needs KeyObjects for x25519 — PEM strings are rejected.
  const secret = diffieHellman({
    privateKey: createPrivateKey(ownSecPem),
    publicKey: createPublicKey(peerPubPem)
  })
  return createHash('sha256').update(secret).update('wayfind-one/dm-v1').digest()
}

export function sealDm(ownSecPem, peerPubPem, plaintext) {
  const key = dmKey(ownSecPem, peerPubPem)
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: cipher.getAuthTag().toString('base64') }
}

export function openDm(ownSecPem, peerPubPem, sealed) {
  const key = dmKey(ownSecPem, peerPubPem)
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(sealed.iv, 'base64'))
  decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  return Buffer.concat([decipher.update(Buffer.from(sealed.ct, 'base64')), decipher.final()]).toString('utf8')
}

// Canonical bytes for signing: stable field order, no signature inside.
export function canonicalEnvelope({ v, id, to, from, text, ts, sealed, payload }) {
  return Buffer.from(JSON.stringify({ v, id, to, from, text, ts, sealed, payload }), 'utf8')
}

export function newId() {
  return randomBytes(8).toString('hex')
}
