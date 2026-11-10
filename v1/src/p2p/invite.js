import fs from 'node:fs'
import path from 'node:path'
import b4a from 'b4a'
import z32 from 'z32'
import crypto from 'hypercore-crypto'
import { TeamSwarm } from './swarm.js'
import { deriveTopic } from './swarm.js'

// Invite = z32(JSON { v, teamId, teamSecret, teamName, nonce, issuer, baseKey }).
// Single-use is enforced by the ISSUER's ledger (home/invites.json):
// the first redemption marks the nonce spent; replays are rejected.
// The joiner also keeps home/used-invites.json as a replay guard.
// baseKey lets the joiner open the shared team store read-only immediately.

function ledgerPath(home, name) {
  return path.join(home, name)
}

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

export function createInvite(home, team, issuerNodeId, baseKey = null) {
  const payload = {
    v: 1,
    teamId: team.teamId,
    teamSecret: team.teamSecret,
    teamName: team.teamName,
    nonce: b4a.toString(crypto.randomBytes(16), 'hex'),
    issuer: issuerNodeId
  }
  if (baseKey) payload.baseKey = baseKey
  const code = z32.encode(b4a.from(JSON.stringify(payload), 'utf8'))

  const ledger = readJson(ledgerPath(home, 'invites.json'), {})
  ledger[payload.nonce] = { used: false, createdAt: new Date().toISOString() }
  fs.writeFileSync(ledgerPath(home, 'invites.json'), JSON.stringify(ledger, null, 2))

  return { code, nonce: payload.nonce }
}

export function decodeInvite(code) {
  let payload
  try {
    payload = JSON.parse(b4a.toString(z32.decode(code), 'utf8'))
  } catch {
    throw new Error('invalid invite code')
  }
  if (payload?.v !== 1 || !payload.teamId || !payload.teamSecret || !payload.nonce || !payload.issuer || !payload.baseKey) {
    throw new Error('invalid invite code')
  }
  return payload
}

export function issuerLedger(home) {
  return readJson(ledgerPath(home, 'invites.json'), {})
}

// Returns { ok, reason? } — caller marks spent on ok.
export function checkRedemption(home, nonce) {
  const ledger = issuerLedger(home)
  const entry = ledger[nonce]
  if (!entry) return { ok: false, reason: 'unknown invite (not issued here)' }
  if (entry.used) return { ok: false, reason: 'invite already used' }
  return { ok: true }
}

export function markRedeemed(home, nonce) {
  const file = ledgerPath(home, 'invites.json')
  const ledger = readJson(file, {})
  if (!ledger[nonce]) return false
  ledger[nonce].used = true
  ledger[nonce].usedAt = new Date().toISOString()
  fs.writeFileSync(file, JSON.stringify(ledger, null, 2))
  return true
}

export function joinerUsed(home, nonce) {
  const used = readJson(ledgerPath(home, 'used-invites.json'), {})
  return Boolean(used[nonce])
}

export function joinerMarkUsed(home, nonce) {
  const file = ledgerPath(home, 'used-invites.json')
  const used = readJson(file, {})
  used[nonce] = { usedAt: new Date().toISOString() }
  fs.writeFileSync(file, JSON.stringify(used, null, 2))
}

// Ephemeral redemption: join the team's topic, ask the issuer to mark the
// nonce spent, wait for the ack. Resolves { teamId, teamSecret, teamName }.
// Rejects on timeout (issuer offline), explicit rejection (spent/unknown),
// or local replay (this node already used the code).
export async function redeemInvite({ home, code, nodeId, keyPair, timeoutMs = 20_000 }) {
  const inv = decodeInvite(code)
  if (joinerUsed(home, inv.nonce)) throw new Error('invite already used on this node')
  const topic = deriveTopic(inv.teamId, inv.teamSecret)

  const swarm = new TeamSwarm({ nodeId, keyPair })
  let resend = null
  try {
    await swarm.join(topic)
    const send = () => {
      for (const [, p] of swarm.peers) {
        try {
          p.conn.write(JSON.stringify({ type: 'redeem', nonce: inv.nonce, for: inv.issuer, nodeId, topic }) + '\n')
        } catch { /* retry on next pass */ }
      }
    }
    const ack = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('issuer not online — ask the inviter to run `up`, then retry')),
        timeoutMs
      )
      swarm.onMessage = (msg) => {
        if (msg.type !== 'redeemed') return
        if (msg.ok) {
          clearTimeout(timer)
          resolve(msg)
        } else if (msg.reason) {
          // Only the issuer ever sends ok:false; treat it as final.
          clearTimeout(timer)
          reject(new Error(`invite rejected: ${msg.reason}`))
        }
      }
      send()
      resend = setInterval(send, 3000)
    })
    return { teamId: inv.teamId, teamSecret: inv.teamSecret, teamName: inv.teamName, topic, ack }
  } finally {
    if (resend) clearInterval(resend)
    await swarm.destroy()
  }
}
