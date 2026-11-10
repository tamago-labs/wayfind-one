import { loadOrCreateIdentity } from '../p2p/identity.js'
import { checkRedemption, markRedeemed, createInvite, issuerLedger } from '../p2p/invite.js'
import { TeamSwarm, deriveStoreTopic } from '../p2p/swarm.js'
import { TeamStore } from '../p2p/store.js'
import {
  migrateLegacy, loadRegistry, listTeams, readTeam, updateTeamFile,
  setActive, clearActive, readProfile, writeProfile, joinTeam
} from '../teams.js'
import { loadBots, createBot, updateBot, deleteBot, botSecret, botEncSecret, ensureBotKeys } from '../bots.js'
import { runTurn } from '../agent.js'
import { probeDocker, ensureComputer, removeAllComputers } from '../computer.js'
import { startServer } from '../daemon/server.js'
import {
  loadGroup, mergeGroupMsgs, queueOutbox, shiftOutbox,
  loadDms, appendDm, markDmRead, dmKey, nodeEncKeys
} from '../teamchat.js'
import {
  edSign, edVerify, sealDm, openDm, canonicalEnvelope, newId
} from '../msgcrypto.js'
import Identity from 'keet-identity-key'
import b4a from 'b4a'
import path from 'node:path'

// Group bot auto-replies: one mention response per bot per cooldown, and
// never two in a row from the same bot (ping-pong guard).
const GROUP_REPLY_COOLDOWN_MS = 45_000
const groupReplyAt = new Map()
// DM-to-bot agent replies: per-bot cooldown so a remote loop can't spin us.
const DM_REPLY_COOLDOWN_MS = 20_000
const dmReplyAt = new Map()
// Swarm device-key -> identity-key binding, learned from hellos. Used to
// route DMs to the right connection (auth itself is by signature).
const deviceToNode = new Map()
// Pending DM delivery receipts: envelope id -> { resolve, timer }.
const pendingDm = new Map()

function humanSign(identity, bytes) {
  const proof = Identity.attestData(bytes, identity.deviceKeyPair, identity.deviceProof)
  return b4a.toString(proof, 'hex')
}

function humanVerify(nodeIdHex, bytes, proofHex) {
  try {
    return Identity.verify(b4a.from(String(proofHex), 'hex'), bytes, {
      expectedIdentity: b4a.from(nodeIdHex, 'hex')
    })
  } catch {
    return false
  }
}

// Slim envelope for local disk: drop sig/topic, keep what the UI needs.
function slim(env) {
  return { id: env.id, from: env.from, text: env.text, ts: env.ts }
}

function mentionRe(name) {
  return new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i')
}

// Verify a group/DM sender against the roster. Returns the sender kind or
// null (unknown sender / bad signature / withdrawn ad).
async function verifySender(store, from, bytes, sig) {
  if (!from || !sig) return null
  if (from.kind === 'bot') {
    const ads = await store.sharedBots().catch(() => [])
    const ad = ads.find((a) => a.botId === from.id)
    if (!ad?.pubkey) return null
    return edVerify(ad.pubkey, bytes, sig) ? 'bot' : null
  }
  if (from.kind === 'human') {
    const members = await store.members().catch(() => [])
    if (!members.some((r) => r.nodeId === from.id)) return null
    return humanVerify(from.id, bytes, sig) ? 'human' : null
  }
  return null
}

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
    storeSwarm: null,
    store: null,
    writerAck: null,
    computer: { state: 'off' },
    _updateTimer: null,

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
      const sharedBots = this.store ? await this.store.sharedBots().catch(() => []) : []
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
        // Identity-key presence: which team members have a live connection
        // (swarm peers are device keys — map them back via hellos).
        online: [...new Set([...deviceToNode.values(), this.nodeId])],
        computer: this.computerStatus(),
        provider,
        store: { writable: this.store?.writable ?? false },
        members,
        invites,
        sharedBots,
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
        onPeerConn: null, // control swarm carries chat only — replication
        // has its own swarm (see below); sharing one conn corrupts both.
        onHello: (msg, remoteId) => {
          // Bind swarm device key -> identity key for DM routing.
          if (msg?.nodeId) deviceToNode.set(remoteId, msg.nodeId)
          // Retry writer onboarding on every hello while still read-only:
          // the one-shot request in activate() can race peer discovery.
          if (self.store && !self.store.writable) {
            sendWriterRequests()
            void waitForWritable()
          }
          // Late joiner: pull recent group history when ours is empty.
          if (self.team && loadGroup(self.teamHome).msgs.length === 0) {
            requestGroupCatchup(self, remoteId)
          }
          // Flush queued group sends now that someone is listening.
          flushOutbox(self)
        },
        onMessage: (msg, remoteId, reply) => {
          if (msg.type === 'request-writer' && msg.topic === team.topic && self.store?.writable) {
            if (process.env.WAYFIND_DEBUG) console.error(`[debug] writer request from ${remoteId.slice(0, 8)}`)
            handleWriterRequest(msg, reply).catch(() => {})
          } else if (msg.type === 'writer-added' && msg.ok) {
            if (self.writerAck) self.writerAck(msg)
            void waitForWritable()
          } else if (msg.topic === team.topic && self.team && self.teamHome && CHAT_TYPES.has(msg.type)) {
            // Team chat needs the team assigned — messages can arrive in the
            // window between swarm.join() and teamHome assignment (or after
            // deactivate). Drop them; catch-up re-syncs on hello.
            handleChatMessage(self, msg, remoteId, reply)
          } else if (process.env.WAYFIND_DEBUG && (msg.type === 'request-writer' || msg.type === 'writer-added')) {
            console.error(`[debug] dropped ${msg.type} topicOk=${msg.topic === team.topic} writable=${self.store?.writable}`)
          }
        }
      })
      await swarm.join(topicOverride ?? team.topic)

      const store = new TeamStore({ home: teamHome })
      const keyHex = await store.open({ key: team.baseKey ?? null, identity: id })
      if (team.baseKey !== keyHex) team = updateTeamFile(teamHome, { baseKey: keyHex })

      // Store replication on its own topic: corestore frames and our
      // JSON-lines chat must never share a Noise connection.
      const storeSwarm = new TeamSwarm({
        nodeId: id.identityPublicKey,
        keyPair: id.deviceKeyPair,
        onPeerConn: (conn) => {
          if (self.store?.store) {
            try {
              self.store.store.replicate(conn)
            } catch { /* peer going away */ }
          }
        }
      })
      await storeSwarm.join(deriveStoreTopic(team.topic))

      this.team = team
      this.teamHome = teamHome
      this.nodeId = id.identityPublicKey
      this.swarm = swarm
      this.storeSwarm = storeSwarm
      this.store = store
      setActive(this.base, teamId)
      // Keep the shared view advancing: autobase only applies replicated
      // blocks on update(). Without this poll, roster ads, removes, and
      // member edits stall after writer onboarding finishes.
      if (this._updateTimer) clearInterval(this._updateTimer)
      this._updateTimer = setInterval(() => {
        if (this.store && this.team) this.store.base.update().catch(() => {})
      }, 5000)
      if (this._updateTimer.unref) this._updateTimer.unref()

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
      // Late-join catch-up + outbox flush: peers may connect after the team
      // is assigned (their hellos arrived too early, or discovery lags).
      // Bounded retries; each is a no-op once we're in sync.
      for (const delay of [2000, 10000, 30000]) {
        setTimeout(() => {
          if (!this.team || !this.swarm) return
          flushOutbox(this)
          if (this.swarm.peers.size > 0 && loadGroup(this.teamHome).msgs.length === 0) {
            requestGroupCatchup(this)
          }
        }, delay)
      }
      return this.status()
    },
    async deactivate() {
      if (this._updateTimer) {
        clearInterval(this._updateTimer)
        this._updateTimer = null
      }
      if (this.swarm) {
        await this.swarm.destroy()
        this.swarm = null
      }
      if (this.storeSwarm) {
        await this.storeSwarm.destroy()
        this.storeSwarm = null
      }
      if (this.store) {
        await this.store.destroy()
        this.store = null
      }
      deviceToNode.clear()
      for (const [, p] of pendingDm) { clearTimeout(p.timer); p.reject(new Error('team deactivated')) }
      pendingDm.clear()
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
      await this.store.appendMember(name, nodeEncKeys(this.teamHome).pub)
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
      if (patch?.shared !== undefined) p.shared = patch.shared === true
      const before = loadBots(this.teamHome, this.nodeId).find((b) => b.id === String(id))
      const bot = updateBot(this.teamHome, this.nodeId, String(id), p)
      if (!bot) throw new Error('unknown bot')
      // Sharing flips the roster ad: publish on share, withdraw on unshare.
      // Toggling requires writer status — the ad lives in the shared store.
      if (p.shared !== undefined && (before?.shared === true) !== bot.shared) {
        if (!this.store?.writable) throw new Error('not a writer yet — wait for sync')
        if (bot.shared) await this.publishBotAd(bot)
        else await this.store.appendBotRemove(bot.id).catch((e) => { throw new Error(`unshare failed: ${e.message}`) })
      } else if (bot.shared && (p.name !== undefined || p.color !== undefined || p.shape !== undefined)) {
        // Keep a shared ad fresh on metadata edits (best effort).
        if (this.store?.writable) await this.publishBotAd(bot).catch(() => {})
      }
      return bot
    },

    async publishBotAd(bot) {
      ensureBotKeys(this.teamHome, this.nodeId, bot)
      const { createPublicKey } = await import('node:crypto')
      const encSec = botEncSecret(this.teamHome, this.nodeId, bot.id)
      const encPub = createPublicKey(encSec).export({ type: 'spki', format: 'pem' })
      await this.store.appendBotAd({
        botId: bot.id,
        pubkey: bot.pubkey,
        encPub,
        name: bot.name,
        color: bot.color,
        shape: bot.shape,
        isChiefOfStaff: bot.isChiefOfStaff
      })
    },

    async deleteBot(id) {
      if (!this.team || !this.teamHome || !this.nodeId) throw new Error('no active team')
      const ok = deleteBot(this.teamHome, this.nodeId, String(id))
      if (!ok) throw new Error('unknown bot')
      // Withdraw the roster ad so the team stops routing to a dead bot.
      if (this.store?.writable) await this.store.appendBotRemove(String(id)).catch(() => {})
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

    // Shared-bot roster (roster ads from every owner, incl. our own).
    async sharedBots() {
      if (!this.team || !this.store) throw new Error('no active team')
      return this.store.sharedBots().catch(() => [])
    },

    // Group thread: local copy + live fan-out. Fail-fast on offline, never
    // queued silently — the outbox only holds sends made while peers exist
    // check raced discovery; UI shows queued state via /api/group.
    async group() {
      if (!this.team || !this.teamHome) throw new Error('no active team')
      return loadGroup(this.teamHome)
    },

    async sendGroup(text) {
      if (!this.team || !this.teamHome || !this.nodeId || !this.swarm) throw new Error('no active team')
      const v = String(text ?? '').slice(0, 4000).trim()
      if (!v) throw new Error('text is required')
      const name = readProfile(this.teamHome)?.displayName ?? ('node-' + this.nodeId.slice(0, 6))
      const env = {
        v: 1, type: 'groupmsg', id: newId(), to: null,
        from: { kind: 'human', id: this.nodeId, name },
        text: v, ts: Date.now(), sealed: false, payload: null,
        topic: this.team.topic, sig: ''
      }
      env.sig = humanSign(this.store.identity, canonicalEnvelope(env))
      mergeGroupMsgs(this.teamHome, [slim(env)])
      const n = this.swarm.broadcast(env)
      if (n === 0) queueOutbox(this.teamHome, env)
      // Own sends can wake our shared bots too (@-mention from the owner).
      maybeGroupReply(this, slim(env)).catch(() => {})
      return loadGroup(this.teamHome)
    },

    async dms() {
      if (!this.team || !this.teamHome) throw new Error('no active team')
      return loadDms(this.teamHome)
    },

    async sendDm(to, text) {
      if (!this.team || !this.teamHome || !this.nodeId || !this.swarm || !this.store) throw new Error('no active team')
      const v = String(text ?? '').slice(0, 4000).trim()
      if (!v) throw new Error('text is required')
      const kind = to?.kind === 'bot' ? 'bot' : 'human'
      const id = String(to?.id ?? '')
      if (!id) throw new Error('recipient is required')
      return sendDmTo(this, { kind, id }, v)
    },

    async markDmRead(key) {
      if (!this.team || !this.teamHome) throw new Error('no active team')
      return markDmRead(this.teamHome, String(key ?? ''))
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
      ctrl.store.addWriter(msg.writerKey)
      reply({ type: 'writer-added', ok: true, topic: ctrl.team.topic })
    } catch (err) {
      reply({ type: 'writer-added', ok: false, reason: String(err?.message ?? err), topic: ctrl.team.topic })
    }
  }

  // ---- team chat engine (group + DMs, host-to-host) ----

  const CHAT_TYPES = new Set(['groupmsg', 'group-req', 'group-res', 'dm', 'dm-receipt'])

  // Swarm device-key id for a given identity-key node, via hello bindings.
  function routeDeviceFor(nodeId) {
    for (const [dev, node] of deviceToNode) if (node === nodeId) return dev
    return null
  }

  function handleChatMessage(self, msg, remoteId, reply) {
    if (msg.type === 'groupmsg') {
      handleGroupMsg(self, msg).catch((e) => console.error('groupmsg dropped:', e.message))
    } else if (msg.type === 'group-req') {
      const { msgs } = loadGroup(self.teamHome)
      // Echo the requester's id back so they accept it (not our own).
      reply({ type: 'group-res', to: msg.to, msgs: msgs.slice(-(msg.want ?? 50)).map(slim), topic: self.team.topic })
    } else if (msg.type === 'group-res' && msg.to === self.nodeId) {
      mergeGroupMsgs(self.teamHome, Array.isArray(msg.msgs) ? msg.msgs : [])
    } else if (msg.type === 'dm') {
      handleDm(self, msg, remoteId, reply).catch((e) => console.error('dm dropped:', e.message))
    } else if (msg.type === 'dm-receipt' && pendingDm.has(msg.id)) {
      const p = pendingDm.get(msg.id)
      pendingDm.delete(msg.id)
      clearTimeout(p.timer)
      p.resolve(msg)
    }
  }

  function requestGroupCatchup(self, targetDeviceId) {
    if (!self.swarm || !self.team) return
    const req = { type: 'group-req', want: 50, to: self.nodeId, topic: self.team.topic }
    if (targetDeviceId) {
      self.swarm.sendTo(targetDeviceId, req)
    } else {
      for (const [id] of self.swarm.peers) {
        self.swarm.sendTo(id, req)
        break
      }
    }
  }

  function flushOutbox(self) {
    if (!self.swarm || !self.team || self.swarm.peers.size === 0) return
    for (;;) {
      const env = shiftOutbox(self.teamHome)
      if (!env) return
      self.swarm.broadcast(env)
    }
  }

  async function handleGroupMsg(self, msg) {
    if (!msg?.id || !msg.from || typeof msg.text !== 'string' || typeof msg.ts !== 'number' || !msg.sig) return
    const kind = await verifySender(self.store, msg.from, canonicalEnvelope(msg), msg.sig)
    if (!kind) {
      console.error('groupmsg bad signature from', String(msg.from?.id ?? '?').slice(0, 8))
      return
    }
    mergeGroupMsgs(self.teamHome, [slim(msg)])
    maybeGroupReply(self, slim(msg)).catch(() => {})
  }

  async function maybeGroupReply(self, msg) {
    const ownBots = loadBots(self.teamHome, self.nodeId)
    // Never answer our own echoes.
    if (msg.from.kind === 'bot' && ownBots.some((b) => b.id === msg.from.id)) return
    const mentioned = ownBots.filter((b) => b.shared && mentionRe(b.name).test(msg.text ?? ''))
    if (mentioned.length === 0) return
    const recent = loadGroup(self.teamHome).msgs.slice(-15)
    for (const bot of mentioned) {
      if (busyBots.has(bot.id)) continue
      if (Date.now() - (groupReplyAt.get(bot.id) ?? 0) < GROUP_REPLY_COOLDOWN_MS) continue
      if (recent.slice(-2).every((m) => m.from.kind === 'bot' && m.from.id === bot.id)) continue
      groupReplyAt.set(bot.id, Date.now())
      busyBots.add(bot.id)
      try {
        const ctx = recent.map((m) => `${m.from.name}: ${m.text}`).join('\n')
        const updated = await runTurn({
          teamDir: self.teamHome, nodeId: self.nodeId, botId: bot.id,
          text: `[team group chat]\n${ctx}\n\n${msg.from.name} mentioned you (@${bot.name}). Reply as one short group message:`,
          store: self.store, home: self.base
        })
        const reply = [...updated.msgs].reverse().find((m) => m.t !== 'u' && m.t !== 'tool')
        if (reply?.x) await sendGroupAsBot(self, bot, String(reply.x).slice(0, 2000))
      } catch (e) {
        console.error(`group reply failed for ${bot.name}:`, e.message)
      } finally {
        busyBots.delete(bot.id)
      }
    }
  }

  async function sendGroupAsBot(self, bot, text) {
    const sec = botSecret(self.teamHome, self.nodeId, bot.id)
    if (!sec) return
    const env = {
      v: 1, type: 'groupmsg', id: newId(), to: null,
      from: { kind: 'bot', id: bot.id, name: bot.name },
      text, ts: Date.now(), sealed: false, payload: null,
      topic: self.team.topic, sig: ''
    }
    env.sig = edSign(sec, canonicalEnvelope(env))
    mergeGroupMsgs(self.teamHome, [slim(env)])
    self.swarm?.broadcast(env)
  }

  // Outbound DM: resolve recipient, seal when possible, await receipt.
  async function sendDmTo(self, to, text) {
    const profileName = readProfile(self.teamHome)?.displayName ?? ('node-' + self.nodeId.slice(0, 6))
    let ownerNodeId, encPub = null, peer
    if (to.kind === 'bot') {
      const ads = await self.store.sharedBots().catch(() => [])
      const ad = ads.find((a) => a.botId === to.id)
      if (!ad) throw new Error('bot is not shared (or was removed)')
      ownerNodeId = ad.ownerNodeId
      encPub = ad.encPub || null
      peer = { kind: 'bot', id: ad.botId, name: ad.name }
    } else {
      const members = await self.store.members().catch(() => [])
      const m = members.find((r) => r.nodeId === to.id)
      if (!m) throw new Error('unknown member')
      ownerNodeId = m.nodeId
      encPub = m.encPub || null
      peer = { kind: 'human', id: m.nodeId, name: m.displayName }
    }
    const from = { kind: 'human', id: self.nodeId, name: profileName }
    // Local loopback: our own bot — no swarm hop, reply inline.
    if (to.kind === 'bot' && ownerNodeId === self.nodeId) {
      const env = buildHumanDm(self, from, peer, text, encPub)
      appendDm(self.teamHome, peer, { ...slim(env), text, sealed: env.sealed, out: false }, {})
      await deliverDmToBot(self, peer.id, peer, text, env.senderEncPub)
      return loadDms(self.teamHome)
    }
    const deviceId = routeDeviceFor(ownerNodeId)
    if (!deviceId) throw new Error(to.kind === 'bot' ? 'bot owner is offline' : 'member is offline')
    const env = buildHumanDm(self, from, peer, text, encPub)
    const receipt = await sendDmAndWait(self, deviceId, env)
    if (!receipt?.ok) throw new Error(`delivery failed: ${receipt?.reason ?? 'no receipt'}`)
    appendDm(self.teamHome, peer, { ...slim(env), text, sealed: env.sealed, out: true }, {})
    return loadDms(self.teamHome)
  }

  function buildHumanDm(self, from, peer, text, peerEncPub) {
    const ownKeys = nodeEncKeys(self.teamHome)
    let sealed = false, payload = { text }, senderEncPub = null, wireText = text
    if (peerEncPub) {
      try {
        payload = sealDm(ownKeys.sec, peerEncPub, text)
        sealed = true
        senderEncPub = ownKeys.pub
        wireText = ''
      } catch { /* fall back to transport-only */ }
    }
    const env = {
      v: 1, type: 'dm', id: newId(),
      to: { kind: peer.kind, id: peer.id },
      from, text: wireText, ts: Date.now(),
      sealed, payload, senderEncPub,
      topic: self.team.topic, sig: ''
    }
    env.sig = humanSign(self.store.identity, canonicalEnvelope(env))
    return env
  }

  function sendDmAndWait(self, deviceId, env) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingDm.delete(env.id)
        reject(new Error('delivery timed out (recipient offline?)'))
      }, 8000)
      pendingDm.set(env.id, { resolve, timer })
      if (!self.swarm.sendTo(deviceId, env)) {
        pendingDm.delete(env.id)
        clearTimeout(timer)
        reject(new Error('recipient went offline'))
      }
    })
  }

  async function handleDm(self, msg, remoteId, reply) {
    const fail = (reason) => {
      try {
        reply({ type: 'dm-receipt', id: msg?.id ?? null, ok: false, reason, topic: self.team.topic })
      } catch { /* peer going away */ }
    }
    if (!msg?.id || !msg.to || !msg.from || typeof msg.ts !== 'number' || !msg.sig) return
    const bots = loadBots(self.teamHome, self.nodeId)
    const toMe =
      (msg.to.kind === 'human' && msg.to.id === self.nodeId) ||
      (msg.to.kind === 'bot' && bots.some((b) => b.id === msg.to.id))
    if (!toMe) return // precisely routed — not ours, stay silent
    const kind = await verifySender(self.store, msg.from, canonicalEnvelope(msg), msg.sig)
    if (!kind) return fail('bad signature or unknown sender')
    let text = msg.text
    if (msg.sealed) {
      try {
        const ownSec = msg.to.kind === 'bot'
          ? botEncSecret(self.teamHome, self.nodeId, msg.to.id)
          : nodeEncKeys(self.teamHome).sec
        if (!ownSec || !msg.senderEncPub) return fail('cannot decrypt')
        text = openDm(ownSec, msg.senderEncPub, msg.payload)
      } catch {
        return fail('decrypt failed')
      }
    }
    text = String(text ?? '').slice(0, 4000)
    if (!text) return fail('empty message')
    const peer = { kind: msg.from.kind, id: msg.from.id, name: msg.from.name ?? 'unknown' }
    appendDm(self.teamHome, peer,
      { id: msg.id, from: msg.from, text, ts: msg.ts, sealed: !!msg.sealed, out: false },
      { unread: true })
    try {
      reply({ type: 'dm-receipt', id: msg.id, ok: true, topic: self.team.topic })
    } catch { /* peer going away */ }
    if (msg.to.kind === 'bot') {
      deliverDmToBot(self, msg.to.id, peer, text, msg.senderEncPub ?? null).catch((e) => {
        console.error('dm bot reply failed:', e.message)
      })
    }
  }

  // A DM to one of our bots: record it, run the agent, route the reply back.
  // Only human senders trigger replies — bot-to-bot DMs are stored for the
  // owner to see, never auto-answered (loop guard by construction).
  async function deliverDmToBot(self, botId, peer, text, senderEncPub) {
    if (peer.kind !== 'human') return
    const bot = loadBots(self.teamHome, self.nodeId).find((b) => b.id === botId)
    if (!bot) return
    if (busyBots.has(botId)) return
    if (Date.now() - (dmReplyAt.get(botId) ?? 0) < DM_REPLY_COOLDOWN_MS) return
    dmReplyAt.set(botId, Date.now())
    busyBots.add(botId)
    try {
      const history = loadDms(self.teamHome).threads[dmKey(peer)]?.msgs ?? []
      const ctx = history.slice(-10).map((m) => `${m.out ? bot.name : m.from.name}: ${m.text}`).join('\n')
      const updated = await runTurn({
        teamDir: self.teamHome, nodeId: self.nodeId, botId,
        text: `[direct message from ${peer.name}]\n${ctx}\n\n${peer.name}: ${text}\nReply as one short direct message:`,
        store: self.store, home: self.base
      })
      const reply = [...updated.msgs].reverse().find((m) => m.t !== 'u' && m.t !== 'tool')
      if (!reply?.x) return
      const replyText = String(reply.x).slice(0, 2000)
      const sec = botSecret(self.teamHome, self.nodeId, botId)
      const encSec = botEncSecret(self.teamHome, self.nodeId, botId)
      const { createPublicKey } = await import('node:crypto')
      const ownEncPub = createPublicKey(encSec).export({ type: 'spki', format: 'pem' })
      let sealed = false, payload = { text: replyText }, outText = replyText, outEncPub = null
      if (senderEncPub) {
        try {
          payload = sealDm(encSec, senderEncPub, replyText)
          sealed = true
          outEncPub = ownEncPub
          outText = ''
        } catch { /* transport-only */ }
      }
      const env = {
        v: 1, type: 'dm', id: newId(),
        to: { kind: peer.kind, id: peer.id },
        from: { kind: 'bot', id: botId, name: bot.name },
        text: outText, ts: Date.now(),
        sealed, payload, senderEncPub: outEncPub,
        topic: self.team.topic, sig: ''
      }
      env.sig = edSign(sec, canonicalEnvelope(env))
      appendDm(self.teamHome, peer,
        { id: env.id, from: env.from, text: replyText, ts: env.ts, sealed, out: true }, {})
      await routeDm(self, env, peer)
    } finally {
      busyBots.delete(botId)
    }
  }

  // Best-effort reply routing (the delivery receipt already went out).
  async function routeDm(self, env, peer) {
    try {
      if (peer.kind === 'human') {
        if (peer.id === self.nodeId) return // local human — already has it
        const deviceId = routeDeviceFor(peer.id)
        if (deviceId) self.swarm.sendTo(deviceId, env)
        else console.error('dm reply dropped: member offline')
      } else {
        const ads = await self.store.sharedBots().catch(() => [])
        const ad = ads.find((a) => a.botId === peer.id)
        if (!ad) {
          console.error('dm reply dropped: bot unshared')
          return
        }
        if (ad.ownerNodeId === self.nodeId) {
          // Our own other bot: deliver locally, no auto-reply (bot sender).
          appendDm(self.teamHome, peer,
            { id: env.id, from: env.from, text: env.sealed ? '[sealed]' : env.text, ts: env.ts, sealed: env.sealed, out: false },
            { unread: true })
          return
        }
        const deviceId = routeDeviceFor(ad.ownerNodeId)
        if (deviceId) self.swarm.sendTo(deviceId, env)
        else console.error('dm reply dropped: bot owner offline')
      }
    } catch (e) {
      console.error('dm reply routing failed:', e.message)
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
    const encPub = nodeEncKeys(ctrl.teamHome).pub
    const rows = await ctrl.store.members().catch(() => [])
    const self = rows.find((r) => r.nodeId === ctrl.nodeId)
    // Re-announce when missing OR when the row predates enc keys (v1 rows
    // have no encPub — without it, teammates can only send transport-only
    // DMs). Same name, newer timestamp wins.
    if (!self || !self.encPub) {
      await ctrl.store.appendMember(name, encPub).catch((e) => {
        console.error('member backfill failed:', e.message)
      })
    }
    await republishBotAds(ctrl)
  }

  // Re-publish every shared bot's roster ad (restarts, re-activations).
  async function republishBotAds(c) {
    if (!c.store?.writable) return
    for (const bot of loadBots(c.teamHome, c.nodeId)) {
      if (!bot.shared) continue
      try {
        await c.publishBotAd(bot)
      } catch (e) {
        console.error(`bot ad republish failed for ${bot.name}:`, e.message)
      }
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
