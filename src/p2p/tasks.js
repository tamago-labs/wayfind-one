import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import Corestore from 'corestore'
import Hyperswarm from 'hyperswarm'
import Identity from 'keet-identity-key'

// Minimal shared task log (Phase 3): one append-only Hypercore per node,
// replicated over a dedicated swarm topic. Entries fold by id, last write
// wins. Ordering beyond createdAt, membership and views arrive with
// Autobase/Hyperbee (Phase 4).

export function replTopic(teamIdHex, teamSecretHex) {
  return createHash('sha256')
    .update('wayfind-one/v1/cores')
    .update(b4a.from(teamIdHex, 'hex'))
    .update(b4a.from(teamSecretHex, 'hex'))
    .digest('hex')
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export class TaskStore {
  constructor({ home, identity, deviceKeyPair, deviceProof }) {
    this.home = home
    this.identity = identity
    this.deviceKeyPair = deviceKeyPair
    this.deviceProof = deviceProof
    this.store = null
    this.local = null
    this.knownKeys = new Set()
    this.replSwarm = null
    this.replDiscovery = null
  }

  get localKeyHex() {
    return this.local ? b4a.toString(this.local.key, 'hex') : null
  }

  async open({ teamId, teamSecret }) {
    fs.mkdirSync(this.home, { recursive: true })
    this.store = new Corestore(path.join(this.home, 'cores'))
    this.local = this.store.get({ name: 'tasks' })
    await this.local.ready()

    for (const k of readJson(path.join(this.home, 'task-cores.json'), [])) this._ensureCore(k)

    // NOTE: the replication swarm deliberately uses an ephemeral transport key.
    // Sharing the device keypair across two Hyperswarm instances in one process
    // breaks peer delivery. Replication is still gated by the unguessable topic,
    // and cores are authenticated by their keys, not by the transport identity.
    this.replSwarm = new Hyperswarm()
    this.replSwarm.on('connection', (conn) => this.store.replicate(conn))
    this.replDiscovery = this.replSwarm.join(b4a.from(replTopic(teamId, teamSecret), 'hex'), { client: true, server: true })
    await this.replDiscovery.flushed()
    return this.localKeyHex
  }

  _ensureCore(keyHex) {
    if (!keyHex || this.knownKeys.has(keyHex)) return
    this.knownKeys.add(keyHex)
    this.store.get(b4a.from(keyHex, 'hex'))
    fs.writeFileSync(path.join(this.home, 'task-cores.json'), JSON.stringify([...this.knownKeys]))
  }

  // Called with every hello/hi on the control swarm.
  onPeerHello(msg) {
    if (msg.coreKey) this._ensureCore(msg.coreKey)
  }

  async _readCore(core) {
    await core.update()
    const out = []
    for (let i = 0; i < core.length; i++) {
      try {
        out.push(JSON.parse((await core.get(i)).toString()))
      } catch { /* skip corrupt entries */ }
    }
    return out
  }

  async list() {
    const cores = [this.local]
    for (const keyHex of this.knownKeys) {
      if (keyHex === this.localKeyHex) continue
      try {
        cores.push(this.store.get(b4a.from(keyHex, 'hex')))
      } catch { /* ignore */ }
    }
    const byId = new Map()
    for (const core of cores) {
      for (const e of await this._readCore(core)) {
        if (!e || !e.id) continue
        const prev = byId.get(e.id)
        if (!prev || (e.createdAt ?? 0) >= (prev.createdAt ?? 0)) byId.set(e.id, e)
      }
    }
    return [...byId.values()].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))
  }

  async _append(entry) {
    const payload = b4a.from(JSON.stringify({ ...entry, proof: undefined }))
    let proof = null
    try {
      proof = Identity.attestData(payload, this.deviceKeyPair, this.deviceProof)
    } catch { /* proof deferred — entry still recorded */ }
    await this.local.append(JSON.stringify({ ...entry, proof }))
    return entry
  }

  async add(text) {
    return this._append({
      id: b4a.toString(crypto.randomBytes(16), 'hex'),
      text,
      done: false,
      createdBy: b4a.toString(this.identity.identityPublicKey, 'hex'),
      createdAt: Date.now()
    })
  }

  async toggle(taskId) {
    const tasks = await this.list()
    const t = tasks.find((x) => x.id === taskId)
    if (!t) throw new Error('task not found')
    return this._append({ ...t, done: !t.done, createdAt: Date.now() })
  }

  async destroy() {
    if (this.replDiscovery) await this.replDiscovery.destroy()
    if (this.replSwarm) await this.replSwarm.destroy()
    if (this.store) await this.store.close()
  }
}
