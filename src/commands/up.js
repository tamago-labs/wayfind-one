import { loadOrCreateIdentity } from '../p2p/identity.js'
import { checkRedemption, markRedeemed, createInvite, issuerLedger } from '../p2p/invite.js'
import { TeamSwarm } from '../p2p/swarm.js'
import { TeamStore } from '../p2p/store.js'
import {
  migrateLegacy, loadRegistry, listTeams, readTeam, updateTeamFile,
  setActive, clearActive, readProfile, writeProfile, joinTeam
} from '../teams.js'
import { loadBots, createBot, updateBot, deleteBot } from '../bots.js'
import { runTurn } from '../agent.js'
import { probeDocker, ensureComputer, removeAllComputers } from '../computer.js'
import { startServer } from '../daemon/server.js'
import path from 'node:path'

// Bootstrap: identity + team + swarm + shared store + daemon.
// Docker is mandatory: without the engine the daemon refuses to start.
// Boots team-less too — the UI setup screen creates or picks a team,
// and activating a team auto-starts the local computer.
export async function upCommand({ port, topic, home }) {
  if (!(await probeDocker())) {
    console.error('wayfind-one: Docker Desktop is not running — start it, then run again.')
    process.exit(1)
  }
  migrateLegacy(home)

  const ctrl = {
    base: home,
    team: null,
    teamHome: null,
    nodeId: null,
    swarm: null,
    store: null,
    writerAck: null,
    computer: { state: 'off' },

    computerStatus() {
      return { ...this.computer }
    },

    async status() {
      const teams = listTeams(this.base)
      if (!this.team || !this.swarm) {
        return { team: null, joined: false, peers: [], teams, computer: this.computerStatus() }
      }
      const [members, invites] = await Promise.all([
        this.store ? this.store.members().catch(() => []) : [],
        this.store ? this.store.invites().catch(() => []) : []
      ])
      let provider = null
      try {
        const { resolveProvider } = await import('../inference.js')
        const prov = await resolveProvider({ home: this.base, store: this.store })
        provider = { provider: prov.id, model: prov.model, hasKey: !!prov.apiKey }
      } catch { /* unconfigured */ }
      return {
        team: { name: this.team.teamName, id: this.team.teamId },
        nodeId: this.nodeId,
        ...this.swarm.status(),
        computer: this.computerStatus(),
        provider,
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

      // Auto-start the local computer: tool execution only, conversation
      // stays at the host. Activation fails if the computer won't start.
      this.computer = { state: 'starting' }
      try {
        const c = await ensureComputer({
          nodeId: this.nodeId,
          workspaceDir: path.join(teamHome, 'workspace'),
          key: teamId,
          log: (m) => console.log(m)
        })
        this.computer = { state: 'running', container: c.name, image: c.image, workspace: c.workspace }
      } catch (err) {
        this.computer = { state: 'unavailable', error: String(err?.message ?? err) }
        throw new Error(`local computer failed to start: ${err?.message ?? err}`)
      }

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

    async leave() {
      await this.deactivate()
      clearActive(this.base)
      return this.status()
    },

    async removeComputers() {
      await removeAllComputers()
      this.computer = { state: 'off' }
    },

    async setProfile(displayName) {
      if (!this.team || !this.teamHome || !this.store) throw new Error('no active team')
      if (!this.store.writable) throw new Error('not a writer yet — wait for sync')
      const name = String(displayName).slice(0, 64).trim()
      if (!name) throw new Error('name is required')
      writeProfile(this.teamHome, { displayName: name })
      await this.store.appendMember(name)
      return this.store.members()
    },

    // Owner-private bots: local file only, never in the shared store.
    async bots() {
      if (!this.team || !this.teamHome || !this.nodeId) throw new Error('no active team')
      return loadBots(this.teamHome, this.nodeId)
    },

    async createBot(name, isChief = false) {
      if (!this.team || !this.teamHome || !this.nodeId) throw new Error('no active team')
      const v = String(name ?? '').slice(0, 40).trim()
      if (!v) throw new Error('name is required')
      return createBot(this.teamHome, this.nodeId, v, isChief === true)
    },

    async updateBot(id, patch) {
      if (!this.team || !this.teamHome || !this.nodeId) throw new Error('no active team')
      const p = {}
      if (patch?.name !== undefined) {
        const v = String(patch.name).slice(0, 40).trim()
        if (!v) throw new Error('name is required')
        p.name = v
      }
      if (patch?.role !== undefined) p.role = String(patch.role).slice(0, 500)
      if (patch?.color !== undefined) p.color = String(patch.color)
      if (patch?.shape !== undefined) p.shape = String(patch.shape)
      if (patch?.isChiefOfStaff !== undefined) p.isChiefOfStaff = patch.isChiefOfStaff === true
      const bot = updateBot(this.teamHome, this.nodeId, String(id), p)
      if (!bot) throw new Error('unknown bot')
      return bot
    },

    async deleteBot(id) {
      if (!this.team || !this.teamHome || !this.nodeId) throw new Error('no active team')
      const ok = deleteBot(this.teamHome, this.nodeId, String(id))
      if (!ok) throw new Error('unknown bot')
      return { ok: true }
    },

    // One in-flight turn per bot; the single daemon owns the thread file.
    async chat(botId, text) {
      if (!this.team || !this.teamHome || !this.nodeId) throw new Error('no active team')
      const id = String(botId)
      if (busyBots.has(id)) throw new Error('bot is busy')
      busyBots.add(id)
      try {
        return await runTurn({ teamDir: this.teamHome, nodeId: this.nodeId, botId: id, text, store: this.store, home: this.base })
      } finally {
        busyBots.delete(id)
      }
    },

    // Provider selection + shared keys. GET never returns key values.
    async providers() {
      if (!this.store) throw new Error('no active team')
      const { resolveProvider } = await import('../inference.js')
      const prov = await resolveProvider({ home: this.base, store: this.store })
      const keys = await this.store.providerKeys().catch(() => [])
      return {
        ok: true,
        selected: { provider: prov.id, model: prov.model, label: prov.label, baseURL: prov.baseURL, keyEnv: prov.keyEnv },
        catalog: prov.catalog,
        keysPresent: keys.map((k) => k.id),
        keySource: prov.keySource,
        sources: prov.sources
      }
    },
    async selectProvider(provider, model) {
      if (!this.team || !this.teamHome || !this.store) throw new Error('no active team')
      if (!this.store.writable) throw new Error('not a writer yet — wait for sync')
      await this.store.appendProviderConfig(provider, model)
      return this.providers()
    },

    async shareProviderKey(id, key) {
      if (!this.team || !this.teamHome || !this.store) throw new Error('no active team')
      if (!this.store.writable) throw new Error('not a writer yet — wait for sync')
      const v = String(key ?? '')
      if (!v) throw new Error('key is required')
      await this.store.appendProviderKey(String(id), v)
      return this.providers()
    },

    async testProvider(override) {
      if (!this.team || !this.teamHome || !this.nodeId || !this.store) throw new Error('no active team')
      const { resolveProvider, chatReply } = await import('../inference.js')
      const base = await resolveProvider({ home: this.base, store: this.store })
      // Test-before-save: explicit fields preview without touching the
      // shared selection. Key still resolves env > local > shared.
      const model = override?.model || base.model
      const entry = override?.provider && override.provider !== base.id
        ? (base.catalog.providers?.[override.provider] ?? null)
        : null
      const id = entry ? String(override.provider) : base.id
      const baseURL = entry?.baseURL ?? base.baseURL
      const apiKey = base.apiKey
      if (!model) throw new Error('no model selected')
      if (!apiKey) throw new Error(`no API key for ${entry?.label ?? base.label}`)
      const { text } = await chatReply({
        baseURL,
        apiKey,
        model,
        system: 'You are a connection test. Follow the instruction exactly.',
        messages: [{ role: 'user', text: 'Reply with exactly: ok' }]
      })
      return { ok: true, text, provider: id, model }
    }
  }

  const busyBots = new Set()

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
