import { createHash } from 'node:crypto'
import b4a from 'b4a'
import Hyperswarm from 'hyperswarm'

export function deriveTopic(teamIdHex, teamSecretHex) {
  return createHash('sha256')
    .update('wayfind-one/v1')
    .update(b4a.from(teamIdHex, 'hex'))
    .update(b4a.from(teamSecretHex, 'hex'))
    .digest('hex')
}

// One swarm per daemon. Topic-as-capability: only holders of the team
// secrets can derive (and therefore discover) the topic. Connections are
// Noise-encrypted + key-authenticated by Hyperswarm itself.
export class TeamSwarm {
  constructor({ nodeId, keyPair, onRedeem, onMessage, onHello }) {
    this.nodeId = nodeId
    this.keyPair = keyPair
    this.onRedeem = onRedeem ?? null
    this.onMessage = onMessage ?? null
    this.onHello = onHello ?? null
    this.localInfo = {}
    this.swarm = null
    this.discovery = null
    this.topic = null
    this.peers = new Map() // remoteIdHex -> { conn, rttMs, lastSeen }
    this._pingTimer = null
  }

  // Extra fields merged into our hello (e.g. task-core key for replication).
  setLocalInfo(info) {
    Object.assign(this.localInfo, info)
  }

  // Re-broadcast hello to current peers (picks up localInfo set after connect).
  announceLocal() {
    for (const [, peer] of this.peers) {
      this._send(peer.conn, { type: 'hello', nodeId: this.nodeId, topic: this.topic, ...this.localInfo })
    }
  }

  get joined() {
    return this.discovery !== null
  }

  async join(topicHex) {
    if (this.joined) await this.leave()
    this.swarm ??= new Hyperswarm({ keyPair: this.keyPair })
    this.topic = topicHex
    this.swarm.on('connection', (conn) => this._onConnection(conn))
    this.discovery = this.swarm.join(b4a.from(topicHex, 'hex'), { client: true, server: true })
    await this.discovery.flushed()
    this._pingTimer = setInterval(() => this._pingAll(), 15_000)
    return topicHex
  }

  async leave() {
    clearInterval(this._pingTimer)
    this._pingTimer = null
    for (const [, p] of this.peers) p.conn.destroy()
    this.peers.clear()
    if (this.discovery) {
      await this.discovery.destroy()
      this.discovery = null
    }
    this.topic = null
  }

  async destroy() {
    await this.leave()
    if (this.swarm) {
      await this.swarm.destroy()
      this.swarm = null
    }
  }

  status() {
    return {
      nodeId: this.nodeId,
      topic: this.topic,
      joined: this.joined,
      peers: [...this.peers.entries()].map(([id, p]) => ({ id, rttMs: p.rttMs }))
    }
  }

  _onConnection(conn) {
    // Swarm-level redials arrive even for topics we left: only accept while joined.
    if (!this.joined) {
      conn.destroy()
      return
    }
    const remoteId = b4a.toString(conn.remotePublicKey, 'hex')
    const existing = this.peers.get(remoteId)
    if (existing) {
      // Double-dial: both sides must agree on which conn survives.
      // Keep the conn where isInitiator matches the nodeId ordering.
      const keepNew = conn.isInitiator === (this.nodeId < remoteId)
      if (!keepNew) {
        conn.destroy()
        return
      }
      existing.conn.destroy() // replaced by the agreed winner below
    }
    const peer = { conn, rttMs: null, lastSeen: Date.now(), pingAt: 0 }
    this.peers.set(remoteId, peer)
    this._send(conn, { type: 'hello', nodeId: this.nodeId, topic: this.topic, ...this.localInfo })

    let buf = Buffer.alloc(0)
    conn.on('data', (data) => {
      buf = Buffer.concat([buf, data])
      let idx
      while ((idx = buf.indexOf('\n')) !== -1) {
        const line = buf.subarray(0, idx).toString()
        buf = buf.subarray(idx + 1)
        this._onMessage(remoteId, line, conn)
      }
    })
    const drop = () => {
      if (this.peers.get(remoteId)?.conn === conn) this.peers.delete(remoteId)
    }
    conn.once('close', drop)
    conn.once('error', drop)
  }

  _onMessage(remoteId, line, conn) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      return
    }
    const peer = this.peers.get(remoteId)
    if (!peer) {
      if (process.env.WAYFIND_DEBUG) console.error(`[debug] no-peer for ${msg.type}`)
      return
    }
    // Scope connections to the current topic: dials from ex-members arrive
    // at the swarm server even after topics change — drop them on mismatch.
    if (msg.topic !== undefined && msg.topic !== this.topic) {
      peer.conn.destroy()
      this.peers.delete(remoteId)
      return
    }
    peer.lastSeen = Date.now()
    if (msg.type === 'hello' || msg.type === 'hi') {
      if (this.onHello) this.onHello(msg, remoteId)
    }
    if (msg.type === 'hello') this._send(peer.conn, { type: 'hi', nodeId: this.nodeId, topic: this.topic, ...this.localInfo })
    else if (msg.type === 'ping') this._send(peer.conn, { type: 'pong', id: peer.pingAt })
    else if (msg.type === 'pong' && msg.id === peer.pingAt) peer.rttMs = Date.now() - msg.id
    else if (msg.type === 'redeem') this._onRedeem(remoteId, msg, (obj) => this._send(conn, obj))
    else if (this.onMessage) this.onMessage(msg, remoteId, (obj) => this._send(peer.conn, obj))
  }

  _onRedeem(remoteId, msg, reply) {
    // Only the issuing node answers; other members stay silent so the
    // joiner never mistakes their "unknown invite" for the verdict.
    // The reply goes back on the arrival conn (not the tracked one) so
    // crossed double-dials can never misroute it.
    if (msg.for !== this.nodeId || !this.onRedeem) return
    const res = this.onRedeem(msg.nonce, remoteId)
    reply({ type: 'redeemed', ok: res.ok, reason: res.reason, topic: this.topic })
  }

  _pingAll() {
    const now = Date.now()
    for (const [id, peer] of this.peers) {
      if (now - peer.lastSeen > 45_000) {
        peer.conn.destroy() // silence sweep: close handler drops the entry
        this.peers.delete(id)
        continue
      }
      peer.pingAt = now
      this._send(peer.conn, { type: 'ping', id: peer.pingAt })
    }
  }

  _send(conn, obj) {
    try {
      if (process.env.WAYFIND_DEBUG) console.error(`[debug] send ${obj.type}`)
      conn.write(JSON.stringify(obj) + '\n')
    } catch {
      /* peer going away */
    }
  }
}
