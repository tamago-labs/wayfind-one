import { loadOrCreateIdentity } from '../p2p/identity.js'
import { checkRedemption, markRedeemed, createInvite, issuerLedger } from '../p2p/invite.js'
import { TeamSwarm } from '../p2p/swarm.js'
import { TeamStore } from '../p2p/store.js'
import {
  migrateLegacy, loadRegistry, listTeams, readTeam, updateTeamFile,
  setActive, readProfile, writeProfile, joinTeam
} from '../teams.js'
import { startServer } from '../daemon/server.js'

// Bootstrap: identity + team + swarm + shared store + daemon.
// The daemon is the sole store writer. Boots team-less too —
// the UI setup screen creates or picks a team, which activates everything.
export async function upCommand({ port, topic, home }) {
  migrateLegacy(home)

  const ctrl = {
    base: home,
    team: null,
    teamHome: null,
    nodeId: null,
    swarm: null,
    store: null,
    writerAck: null,

    async status() {
      const teams = listTeams(this.base)
      if (!this.team || !this.swarm) {
        return { team: null, joined: false, peers: [], teams }
      }
      const [members, invites] = await Promise.all([
        this.store ? this.store.members().catch(() => []) : [],
        this.store ? this.store.invites().catch(() => []) : []
      ])
      return {
        team: { name: this.team.teamName, id: this.team.teamId },
        nodeId: this.nodeId,
        ...this.swarm.status(),
        store: { writable: this.store?.writable ?? false },
        members,
        invites,
        teams
      }
    },

    async members() {
      return this.store ? this.store.members() : []
    },

    async activate(teamId, topicOverride) {
      await this.deactivate()
      const reg = loadRegistry(this.base)
      const teamHome = reg.teams[teamId]?.path
      let team = teamHome ? readTeam(teamHome) : null
      if (!team) throw new Error('unknown team')
      const id = await loadOrCreateIdentity(teamHome)
      const ledgerHome = teamHome
      const self = this

      const swarm = new TeamSwarm({
        nodeId: id.identityPublicKey,
        keyPair: id.deviceKeyPair,
        onRedeem: (nonce, remoteId, msg) => {
          const check = checkRedemption(ledgerHome, nonce)
          if (!check.ok) return check
          markRedeemed(ledgerHome, nonce)
          const usedBy = msg?.nodeId ?? remoteId
          if (self.store?.writable) {
            self.store.appendInviteUsed(nonce, usedBy).catch((e) => {
              console.error('invite-used append failed:', e.message)
            })
          }
          return { ok: true }
        },
        onPeerConn: (conn) => {
          // Replicate team-store cores over every control-swarm connection.
          if (self.store?.store) self.store.store.replicate(conn)
        },
        onHello: () => {
          // Retry writer onboarding on every hello while still read-only:
          // the one-shot request in activate() can race peer discovery.
          if (self.store && !self.store.writable) {
            sendWriterRequests()
            void waitForWritable()
          }
        },
        onMessage: (msg, remoteId, reply) => {
          if (msg.type === 'request-writer' && msg.topic === team.topic && self.store?.writable) {
            if (process.env.WAYFIND_DEBUG) console.error(`[debug] writer request from ${remoteId.slice(0, 8)}`)
            handleWriterRequest(msg, reply).catch(() => {})
          } else if (msg.type === 'writer-added' && msg.ok) {
            if (self.writerAck) self.writerAck(msg)
            void waitForWritable()
          } else if (process.env.WAYFIND_DEBUG && (msg.type === 'request-writer' || msg.type === 'writer-added')) {
            console.error(`[debug] dropped ${msg.type} topicOk=${msg.topic === team.topic} writable=${self.store?.writable}`)
          }
        }
      })
      await swarm.join(topicOverride ?? team.topic)

      const store = new TeamStore({ home: teamHome })
      const keyHex = await store.open({ key: team.baseKey ?? null, identity: id })
      // Conns established before the store opened missed the replicator
      // hook — attach replication to all current peers now.
      for (const [, p] of swarm.peers) {
        try {
          store.store.replicate(p.conn)
        } catch { /* peer going away */ }
      }
      if (team.baseKey !== keyHex) team = updateTeamFile(teamHome, { baseKey: keyHex })

      this.team = team
      this.teamHome = teamHome
      this.nodeId = id.identityPublicKey
      this.swarm = swarm
      this.store = store
      setActive(this.base, teamId)

      if (store.writable) {
        await syncLedgerToStore()
        await backfillSelf()
      } else {
        // Joiner path: become a writer via the issuer. Never fatal —
        // hello retries keep asking while the daemon serves.
        try {
          await requestWriter()
        } catch (e) {
          console.error('store unavailable for now:', e.message)
        }
      }
      return this.status()
    },

    async deactivate() {
      if (this.swarm) {
        await this.swarm.destroy()
        this.swarm = null
      }
      if (this.store) {
        await this.store.destroy()
        this.store = null
      }
      this.team = null
      this.teamHome = null
      this.nodeId = null
      this.writerAck = null
    },

    async invite() {
      if (!this.team || !this.teamHome || !this.store) throw new Error('no active team')
      if (!this.store.writable) throw new Error('not a writer yet — wait for sync')
      const { code, nonce } = createInvite(this.teamHome, this.team, this.nodeId, this.store.keyHex)
      await this.store.appendInvite(nonce)
      return code
    },

    async join(code) {
      const { team } = await joinTeam(this.base, (code ?? '').toString().trim())
      if (!team?.teamId) throw new Error('invalid invite code')
      return this.activate(team.teamId)
    },

    async setProfile(displayName) {
      if (!this.team || !this.teamHome || !this.store) throw new Error('no active team')
      if (!this.store.writable) throw new Error('not a writer yet — wait for sync')
      const name = String(displayName).slice(0, 64).trim()
      if (!name) throw new Error('name is required')
      writeProfile(this.teamHome, { displayName: name })
      await this.store.appendMember(name)
      return this.store.members()
    }
  }

  // Writer onboarding handshake (joiner asks, issuer adds).
  async function handleWriterRequest(msg, reply) {
    try {
      await ctrl.store.addWriter(msg.writerKey)
      reply({ type: 'writer-added', ok: true, topic: ctrl.team.topic })
    } catch (err) {
      reply({ type: 'writer-added', ok: false, reason: String(err?.message ?? err), topic: ctrl.team.topic })
    }
  }

  let lastWriterReqAt = 0
  function sendWriterRequests() {
    const store = ctrl.store
    if (!store || store.writable || !store.localWriterKeyHex) return false
    const now = Date.now()
    if (now - lastWriterReqAt < 5000) return true
    lastWriterReqAt = now
    let sent = false
    for (const [, p] of ctrl.swarm.peers) {
      try {
        p.conn.write(JSON.stringify({ type: 'request-writer', writerKey: store.localWriterKeyHex, topic: ctrl.team.topic }) + '\n')
        sent = true
      } catch { /* next hello */ }
    }
    return sent
  }

  async function requestWriter() {
    const store = ctrl.store
    const writerKey = await store.localWriterKeyHex
    let resend = null
    try {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          ctrl.writerAck = null
          reject(new Error('no writer online — keep the daemon running, it retries on new peers'))
        }, 20_000)
        ctrl.writerAck = (msg) => {
          if (msg.ok) {
            clearTimeout(timer)
            ctrl.writerAck = null
            resolve(msg)
          }
        }
        const send = () => {
          for (const [, p] of ctrl.swarm.peers) {
            try {
              p.conn.write(JSON.stringify({ type: 'request-writer', writerKey, topic: ctrl.team.topic }) + '\n')
            } catch { /* retry on next hello */ }
          }
        }
        send()
        resend = setInterval(send, 3000)
      })
    } finally {
      if (resend) clearInterval(resend)
      ctrl.writerAck = null
    }
    await waitForWritable()
  }

  let waiting = false
  async function waitForWritable() {
    if (waiting) return
    waiting = true
    try {
      const store = ctrl.store
      if (!store || store.writable) {
        if (store?.writable) await postWritable()
        return
      }
      const deadline = Date.now() + 30_000
      while (!store.writable && Date.now() < deadline) {
        await store.base.update()
        await new Promise((r) => setTimeout(r, 1000))
      }
      if (store.writable) {
        console.log('store: became a writer')
        await postWritable()
      }
    } finally {
      waiting = false
    }
  }

  async function postWritable() {
    await syncLedgerToStore()
    await backfillSelf()
  }

  async function syncLedgerToStore() {
    if (!ctrl.store?.writable) return
    const ledger = issuerLedger(ctrl.teamHome)
    const have = new Set((await ctrl.store.invites().catch(() => [])).map((r) => r.nonce))
    for (const nonce of Object.keys(ledger)) {
      if (!have.has(nonce)) {
        await ctrl.store.appendInvite(nonce).catch(() => {})
      }
    }
  }

  async function backfillSelf() {
    if (!ctrl.store?.writable) return
    const prof = readProfile(ctrl.teamHome)
    const name = prof?.displayName ?? ('node-' + ctrl.nodeId.slice(0, 6))
    const rows = await ctrl.store.members().catch(() => [])
    if (!rows.some((r) => r.nodeId === ctrl.nodeId)) {
      await ctrl.store.appendMember(name).catch((e) => {
        console.error('member backfill failed:', e.message)
      })
    }
  }

  // Retry writer onboarding on every hello while read-only.
  // (Hooked via announce cycle: peers send hello on connect.)
  const reg = loadRegistry(home)
  if (reg.active) {
    try {
      await ctrl.activate(reg.active, topic)
    } catch (err) {
      console.error(`team '${reg.active.slice(0, 8)}…' failed to start: ${err.message}`)
      console.error('create or pick a team in the UI')
    }
  }

  const server = await startServer({ port, ctrl })
  const s = await ctrl.status()
  console.log(`wayfind-one up: http://localhost:${port}`)
  console.log(s.team ? `team '${s.team.name}' joined topic ${(topic ?? ctrl.team.topic).slice(0, 16)}…` : 'no active team — create or pick one in the UI')

  const shutdown = async () => {
    console.log('\nshutting down…')
    await server.close()
    await ctrl.deactivate()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
