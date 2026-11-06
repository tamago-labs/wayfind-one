import fs from 'node:fs'
import path from 'node:path'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import Identity from 'keet-identity-key'

// Member identity (keet, portable) + per-node device key (attested, never leaves disk).
// Layout in WAYFIND_HOME:
//   identity.json { mnemonic, devicePublicKey, deviceSecretKey, deviceProof }
//   team.json     { teamName, teamId, teamSecret, topic }

export async function loadOrCreateIdentity(home) {
  fs.mkdirSync(home, { recursive: true })
  const file = path.join(home, 'identity.json')
  if (fs.existsSync(file)) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'))
    const identity = await Identity.from({ mnemonic: saved.mnemonic })
    // Buffers survive JSON as { type: 'Buffer', data: [...] } — revive them.
    const revive = (v) => (v && typeof v === 'object' && Array.isArray(v.data) ? b4a.from(v.data) : b4a.from(v, 'hex'))
    return {
      identity,
      identityPublicKey: b4a.toString(identity.identityPublicKey, 'hex'),
      deviceKeyPair: {
        publicKey: revive(saved.devicePublicKey),
        secretKey: revive(saved.deviceSecretKey)
      },
      deviceProof: revive(saved.deviceProof)
    }
  }

  const mnemonic = Identity.generateMnemonic()
  const identity = await Identity.from({ mnemonic })
  const deviceKeyPair = crypto.keyPair()
  const deviceProof = await identity.bootstrap(deviceKeyPair.publicKey)

  fs.writeFileSync(
    file,
    JSON.stringify(
      {
        mnemonic,
        devicePublicKey: b4a.toString(deviceKeyPair.publicKey, 'hex'),
        deviceSecretKey: b4a.toString(deviceKeyPair.secretKey, 'hex'),
        deviceProof
      },
      null,
      2
    ),
    { mode: 0o600 }
  )
  return {
    identity,
    identityPublicKey: b4a.toString(identity.identityPublicKey, 'hex'),
    deviceKeyPair,
    deviceProof,
    created: true
  }
}
