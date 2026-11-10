import path from 'node:path'
import Corestore from 'corestore'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import b4a from 'b4a'
import Identity from 'keet-identity-key'

// Shared team database: one Autobase + Hyperbee view per team.
// Tables: members/<nodeId>, invites/<nonce>, tasks/<taskId>,
//   provider-config (single row), provider-keys/<id>, bots/<botId>.
// Member rows are signed: proof = attestData(canonical bytes) with the
// member's device key; apply() drops anything that does not verify against
// the row's nodeId (which IS the keet identity key — binding is direct).
// Bot ads use the same pattern: the OWNER node signs its own bots' ads, so
// only the owner can publish or withdraw them. Ads carry pubkey + metadata
// only — never secrets.
// Member rows are signed: proof = attestData(canonical bytes) with the
// member's device key; apply() drops anything that does not verify against
// the row's nodeId (which IS the keet identity key — binding is direct).
// Writer rows are appended by writers; any writer can propose one (v1 trust:
// writers are members holding the team secrets).
//
// Provider keys replicate to every member device in plaintext inside the
// team log (swarm-gated, but readable by anyone holding the team secrets).
// Anyone who ever joins keeps a copy: rotate shared keys when membership
// changes (`POST /api/providers/keys` overwrites).

export function canonicalMember({ nodeId, displayName, updatedAt, encPub }) {
  // encPub rides outside the legacy proof so old rows keep verifying;
  // rows that carry it are verified WITH it (see applyBatch).
  const base = { nodeId, displayName, updatedAt }
  return encPub
    ? b4a.from(JSON.stringify({ ...base, encPub }), 'utf8')
    : b4a.from(JSON.stringify(base), 'utf8')
}

// Roster ad for one shared bot. Owner-signed, owner-withdrawable.
export function canonicalBotAd({ botId, ownerNodeId, pubkey, encPub, name, color, shape, isChiefOfStaff, updatedAt }) {
  return b4a.from(JSON.stringify({
    botId, ownerNodeId, pubkey, encPub: encPub ?? '', name, color, shape,
    isChiefOfStaff: isChiefOfStaff === true, updatedAt
  }), 'utf8')
}

function verifyIdentity(proofHex, canonicalBytes, nodeIdHex) {
  try {
    return Identity.verify(b4a.from(proofHex, 'hex'), canonicalBytes, {
      expectedIdentity: b4a.from(nodeIdHex, 'hex')
    })
  } catch {
    return false
  }
}

async function applyBatch(nodes, view, base) {
  for (const node of nodes) {
    const v = node.value
    if (!v || typeof v.op !== 'string') continue
    try {
      if (v.op === 'member') {
        if (!v.nodeId || typeof v.displayName !== 'string' || typeof v.updatedAt !== 'number' || !v.proof) continue
        const ok = v.encPub
          ? verifyIdentity(v.proof, canonicalMember(v), v.nodeId)
          : verifyIdentity(
              v.proof,
              b4a.from(JSON.stringify({ nodeId: v.nodeId, displayName: v.displayName, updatedAt: v.updatedAt }), 'utf8'),
              v.nodeId
            )
        if (!ok) continue
        const cur = await view.get('members/' + v.nodeId)
        if (!cur || v.updatedAt > cur.value.updatedAt) {
          await view.put('members/' + v.nodeId, v)
        }
      } else if (v.op === 'bot-ad') {
        // Only the owner node can publish its bots' ads. updatedAt wins.
        if (!v.botId || !v.ownerNodeId || !v.pubkey || typeof v.updatedAt !== 'number' || !v.proof) continue
        if (!verifyIdentity(v.proof, canonicalBotAd(v), v.ownerNodeId)) continue
        const cur = await view.get('bots/' + v.botId)
        if (!cur || v.updatedAt > cur.value.updatedAt) {
          await view.put('bots/' + v.botId, v)
        }
      } else if (v.op === 'bot-remove') {
        // Withdrawal must come from the same owner that published the ad.
        if (!v.botId || !v.ownerNodeId || typeof v.updatedAt !== 'number' || !v.proof) continue
        const bytes = b4a.from(JSON.stringify({ botId: v.botId, ownerNodeId: v.ownerNodeId, updatedAt: v.updatedAt }), 'utf8')
        if (!verifyIdentity(v.proof, bytes, v.ownerNodeId)) continue
        const cur = await view.get('bots/' + v.botId).catch(() => null)
        if (cur && cur.value.ownerNodeId === v.ownerNodeId) {
          await view.del('bots/' + v.botId)
        }
      } else if (v.op === 'invite') {
        if (!v.nonce || !v.createdBy) continue
        const cur = await view.get('invites/' + v.nonce)
        if (!cur) await view.put('invites/' + v.nonce, v)
      } else if (v.op === 'invite-used') {
        if (!v.nonce || !v.usedBy) continue
        const cur = await view.get('invites/' + v.nonce)
        if (cur && !cur.value.used) {
          await view.put('invites/' + v.nonce, { ...cur.value, used: true, usedBy: v.usedBy, usedAt: v.usedAt })
        }
      } else if (v.op === 'writer') {
        if (!v.key) continue
        await base.addWriter(b4a.from(v.key, 'hex'))
      } else if (v.op === 'task') {
        if (!v.id) continue
        const cur = await view.get('tasks/' + v.id)
        if (!cur || (v.updatedAt ?? 0) > (cur.value.updatedAt ?? 0)) {
          await view.put('tasks/' + v.id, v)
        }
      } else if (v.op === 'provider-config') {
        if (typeof v.provider !== 'string') continue
        const cur = await view.get('provider-config')
        if (!cur || (v.updatedAt ?? 0) > (cur.value.updatedAt ?? 0)) {
          await view.put('provider-config', v)
        }
      } else if (v.op === 'provider-key') {
        if (!v.id || typeof v.key !== 'string') continue
        const cur = await view.get('provider-keys/' + v.id)
        if (!cur || (v.updatedAt ?? 0) > (cur.value.updatedAt ?? 0)) {
          await view.put('provider-keys/' + v.id, v)
        }
      }
    } catch { /* one bad op never breaks the batch */ }
  }
}

export class TeamStore {
  constructor({ home }) {
    this.home = home
    this.store = null
    this.base = null
    this.identity = null
  }

  get keyHex() {
    return this.base?.key ? b4a.toString(this.base.key, 'hex') : null
  }

  get writable() {
    return this.base?.writable ?? false
  }

  // Writer core key for the writer-onboarding handshake. base.local always
  // exists (base.localWriter only once writable) — read it off the open
  // base, never via a standalone core handle (that deadlocks the base).
  get localWriterKeyHex() {
    const k = this.base?.local?.key
    return k ? b4a.toString(k, 'hex') : null
  }

  async open({ key, identity }) {
    this.identity = identity
    this.store = new Corestore(path.join(this.home, 'cores'))
    this.base = new Autobase(this.store, key ?? undefined, {
      valueEncoding: 'json',
      open: (s) => new Hyperbee(s.get('view'), { keyEncoding: 'utf-8', valueEncoding: 'json' }),
      apply: applyBatch
    })
    await this.base.ready()
    return this.keyHex
  }

  get view() {
    return this.base?.view ?? null
  }

  async appendMember(displayName, encPub) {
    const op = {
      op: 'member',
      nodeId: this.identity.identityPublicKey,
      displayName: String(displayName).slice(0, 64),
      updatedAt: Date.now()
    }
    if (encPub) op.encPub = String(encPub)
    const proof = Identity.attestData(
      canonicalMember(op),
      this.identity.deviceKeyPair,
      this.identity.deviceProof
    )
    await this.base.append({ ...op, proof: b4a.toString(proof, 'hex') })
  }

  async appendInvite(nonce) {
    await this.base.append({
      op: 'invite',
      nonce,
      createdBy: this.identity.identityPublicKey,
      createdAt: new Date().toISOString(),
      used: false
    })
  }

  async appendInviteUsed(nonce, usedBy) {
    await this.base.append({ op: 'invite-used', nonce, usedBy, usedAt: new Date().toISOString() })
  }

  async addWriter(keyHex) {
    await this.base.append({ op: 'writer', key: keyHex })
  }

  async list(prefix) {
    const out = []
    if (!this.view) return out
    for await (const { value } of this.view.createReadStream({ gte: prefix, lt: prefix + '\xff' })) {
      out.push(value)
    }
    return out
  }

  async members() {
    return this.list('members/')
  }

  // Shared-bot roster ads. Owner-signed; only the owner publishes.
  async appendBotAd({ botId, pubkey, encPub, name, color, shape, isChiefOfStaff }) {
    const op = {
      op: 'bot-ad',
      botId: String(botId),
      ownerNodeId: this.identity.identityPublicKey,
      pubkey: String(pubkey),
      encPub: String(encPub ?? ''),
      name: String(name ?? '').slice(0, 40),
      color: String(color ?? ''),
      shape: String(shape ?? ''),
      isChiefOfStaff: isChiefOfStaff === true,
      updatedAt: Date.now()
    }
    const proof = Identity.attestData(
      canonicalBotAd(op),
      this.identity.deviceKeyPair,
      this.identity.deviceProof
    )
    await this.base.append({ ...op, proof: b4a.toString(proof, 'hex') })
  }

  async appendBotRemove(botId) {
    const op = {
      op: 'bot-remove',
      botId: String(botId),
      ownerNodeId: this.identity.identityPublicKey,
      updatedAt: Date.now()
    }
    // Sign the canonical triple (no `op` field) — must match applyBatch.
    const bytes = b4a.from(JSON.stringify({
      botId: op.botId, ownerNodeId: op.ownerNodeId, updatedAt: op.updatedAt
    }), 'utf8')
    const proof = Identity.attestData(
      bytes,
      this.identity.deviceKeyPair,
      this.identity.deviceProof
    )
    await this.base.append({ ...op, proof: b4a.toString(proof, 'hex') })
  }

  async sharedBots() {
    return this.list('bots/')
  }

  async invites() {
    return this.list('invites/')
  }

  async appendProviderConfig(provider, model) {
    await this.base.append({
      op: 'provider-config',
      provider: String(provider ?? ''),
      model: String(model ?? ''),
      updatedBy: this.identity.identityPublicKey,
      updatedAt: Date.now()
    })
  }

  async appendProviderKey(id, key) {
    await this.base.append({
      op: 'provider-key',
      id: String(id),
      key: String(key),
      updatedBy: this.identity.identityPublicKey,
      updatedAt: Date.now()
    })
  }

  async providerConfig() {
    if (!this.view) return null
    const row = await this.view.get('provider-config').catch(() => null)
    return row?.value ?? null
  }

  async providerKeys() {
    return this.list('provider-keys/')
  }

  async destroy() {
    if (this.base) await this.base.close()
    if (this.store) await this.store.close()
    this.base = null
    this.store = null
  }
}
