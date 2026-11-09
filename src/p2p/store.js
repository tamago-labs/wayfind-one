import path from 'node:path'
import Corestore from 'corestore'
import Autobase from 'autobase'
import Hyperbee from 'hyperbee'
import b4a from 'b4a'
import Identity from 'keet-identity-key'

// Shared team database (goji-shaped): one Autobase + Hyperbee view per team.
// Tables: members/<nodeId>, invites/<nonce>, tasks/<taskId>.
// Member rows are signed: proof = attestData(canonical bytes) with the
// member's device key; apply() drops anything that does not verify against
// the row's nodeId (which IS the keet identity key — binding is direct).
// Writer rows are appended by writers; any writer can propose one (v1 trust:
// writers are members holding the team secrets).

export function canonicalMember({ nodeId, displayName, updatedAt }) {
  return b4a.from(JSON.stringify({ nodeId, displayName, updatedAt }), 'utf8')
}

async function applyBatch(nodes, view, base) {
  for (const node of nodes) {
    const v = node.value
    if (!v || typeof v.op !== 'string') continue
    try {
      if (v.op === 'member') {
        if (!v.nodeId || typeof v.displayName !== 'string' || typeof v.updatedAt !== 'number' || !v.proof) continue
        const ok = Identity.verify(b4a.from(v.proof, 'hex'), canonicalMember(v), {
          expectedIdentity: b4a.from(v.nodeId, 'hex')
        })
        if (!ok) continue
        const cur = await view.get('members/' + v.nodeId)
        if (!cur || v.updatedAt > cur.value.updatedAt) {
          await view.put('members/' + v.nodeId, v)
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

  async appendMember(displayName) {
    const op = {
      op: 'member',
      nodeId: this.identity.identityPublicKey,
      displayName: String(displayName).slice(0, 64),
      updatedAt: Date.now()
    }
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

  async invites() {
    return this.list('invites/')
  }

  async destroy() {
    if (this.base) await this.base.close()
    if (this.store) await this.store.close()
    this.base = null
    this.store = null
  }
}
