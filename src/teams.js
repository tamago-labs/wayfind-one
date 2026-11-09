import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import b4a from 'b4a'
import crypto from 'hypercore-crypto'
import { loadOrCreateIdentity, ephemeralIdentity } from './p2p/identity.js'
import { deriveTopic } from './p2p/swarm.js'
import { decodeInvite, redeemInvite, joinerMarkUsed } from './p2p/invite.js'

// Multi-team layout under one base dir (WAYFIND_HOME):
//   registry.json            { active: <teamId|null>, teams: { <id>: { name, path } } }
//   teams/<teamId>/          team home: team.json, identity.json, invites.json
// Pre-registry dirs (team.json + identity.json at the base root) are adopted
// in place on first boot.

export function baseDir() {
  return process.env.WAYFIND_HOME ?? path.join(os.homedir(), '.wayfind-one')
}

function registryPath(base) {
  return path.join(base, 'registry.json')
}

export function loadRegistry(base) {
  try {
    const r = JSON.parse(fs.readFileSync(registryPath(base), 'utf8'))
    if (r && typeof r === 'object' && r.teams && typeof r.teams === 'object') {
      return { active: null, ...r }
    }
  } catch { /* fresh base */ }
  return { active: null, teams: {} }
}

export function saveRegistry(base, reg) {
  fs.mkdirSync(base, { recursive: true })
  fs.writeFileSync(registryPath(base), JSON.stringify(reg, null, 2))
}

export function migrateLegacy(base) {
  const reg = loadRegistry(base)
  if (!reg.migrated && fs.existsSync(path.join(base, 'team.json'))) {
    try {
      const team = JSON.parse(fs.readFileSync(path.join(base, 'team.json'), 'utf8'))
      if (team?.teamId) {
        reg.teams[team.teamId] = {
          name: team.teamName ?? team.teamId.slice(0, 8),
          path: base
        }
        reg.active ??= team.teamId
      }
    } catch { /* corrupt legacy file: start fresh */ }
  }
  reg.migrated = true
  saveRegistry(base, reg)
  return reg
}

export function listTeams(base) {
  const reg = loadRegistry(base)
  return Object.entries(reg.teams).map(([id, t]) => ({
    id,
    name: t?.name ?? id.slice(0, 8),
    active: id === reg.active
  }))
}

export function readTeam(home) {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, 'team.json'), 'utf8'))
  } catch {
    return null
  }
}

export function updateTeamFile(home, patch) {
  const team = readTeam(home)
  if (!team) return null
  const next = { ...team, ...patch }
  fs.writeFileSync(path.join(home, 'team.json'), JSON.stringify(next, null, 2))
  return next
}

export function readProfile(home) {
  try {
    return JSON.parse(fs.readFileSync(path.join(home, 'profile.json'), 'utf8'))
  } catch {
    return null
  }
}

export function writeProfile(home, profile) {
  fs.writeFileSync(path.join(home, 'profile.json'), JSON.stringify(profile, null, 2))
  return profile
}

export async function adoptTeam(base, { teamName, teamId, teamSecret, topic, baseKey = null }) {
  const home = path.join(base, 'teams', teamId)
  fs.mkdirSync(home, { recursive: true })
  fs.writeFileSync(
    path.join(home, 'team.json'),
    JSON.stringify({ teamName, teamId, teamSecret, topic, ...(baseKey ? { baseKey } : {}) }, null, 2)
  )
  await loadOrCreateIdentity(home)
  const reg = loadRegistry(base)
  reg.teams[teamId] = { name: teamName, path: home }
  reg.active ??= teamId
  saveRegistry(base, reg)
  return { team: { teamName, teamId, teamSecret, topic }, home }
}

export async function createTeam(base, name) {
  const teamId = b4a.toString(crypto.randomBytes(32), 'hex')
  const teamSecret = b4a.toString(crypto.randomBytes(32), 'hex')
  return adoptTeam(base, {
    teamName: name,
    teamId,
    teamSecret,
    topic: deriveTopic(teamId, teamSecret)
  })
}

export function setActive(base, teamId) {
  const reg = loadRegistry(base)
  if (!reg.teams[teamId]) return false
  reg.active = teamId
  saveRegistry(base, reg)
  return true
}

export function clearActive(base) {
  const reg = loadRegistry(base)
  reg.active = null
  saveRegistry(base, reg)
}

// Full join flow shared by the CLI and the daemon: decode → redeem against
// the issuer over the swarm (issuer must be online) → adopt → activate.
// Throws 'invalid invite code' on bad codes; redeem errors otherwise.
export async function joinTeam(base, code) {
  const inv = decodeInvite(code)
  migrateLegacy(base)
  // Redeem with an ephemeral identity: no team home exists yet.
  const eph = await ephemeralIdentity()
  const team = await redeemInvite({
    home: base,
    code,
    nodeId: eph.identityPublicKey,
    keyPair: eph.deviceKeyPair
  })
  const { team: adopted, home } = await adoptTeam(base, {
    teamName: team.teamName,
    teamId: team.teamId,
    teamSecret: team.teamSecret,
    topic: team.topic,
    baseKey: inv.baseKey
  })
  setActive(base, adopted.teamId)
  joinerMarkUsed(base, inv.nonce)
  return { team: adopted, home }
}
