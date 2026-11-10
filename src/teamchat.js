import fs from 'node:fs'
import path from 'node:path'
import { genEncKeys } from './msgcrypto.js'

// Team chat local state. Everything here is per-node disk state:
// the shared store only carries roster ads — message bodies cross the swarm
// live (and stay on the two endpoints' disks for DMs).
//
//   group.json  { msgs: [...], outbox: [...] }   — local copy of team thread
//   dms.json    { threads: { key: { peer, msgs, unread } } }
//   nodeenc.json { pub, sec }                    — this node's x25519 DM keys

const GROUP_CAP = 200
const DM_THREAD_CAP = 100
const DM_THREAD_MAX = 20

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch { /* none yet */ }
  return fallback
}

function writeJson(file, value, mode) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, JSON.stringify(value), mode ? { mode } : undefined)
}

// ---- group ----

export function loadGroup(teamDir) {
  if (!teamDir) return { msgs: [], outbox: [] }
  const g = readJson(path.join(teamDir, 'group.json'), null)
  if (g && Array.isArray(g.msgs)) return { msgs: g.msgs, outbox: Array.isArray(g.outbox) ? g.outbox : [] }
  return { msgs: [], outbox: [] }
}

function saveGroup(teamDir, group) {
  writeJson(path.join(teamDir, 'group.json'), group)
}

// Merge by id (catch-up from peers can overlap), sort by ts, cap.
export function mergeGroupMsgs(teamDir, incoming) {
  if (!teamDir) return []
  const group = loadGroup(teamDir)
  const seen = new Set(group.msgs.map((m) => m.id))
  for (const m of incoming) {
    if (m?.id && !seen.has(m.id)) {
      seen.add(m.id)
      group.msgs.push(m)
    }
  }
  group.msgs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
  if (group.msgs.length > GROUP_CAP) group.msgs = group.msgs.slice(group.msgs.length - GROUP_CAP)
  saveGroup(teamDir, group)
  return group.msgs
}

export function queueOutbox(teamDir, envelope) {
  const group = loadGroup(teamDir)
  if (!group.outbox.some((e) => e.id === envelope.id)) group.outbox.push(envelope)
  saveGroup(teamDir, group)
}

export function shiftOutbox(teamDir) {
  const group = loadGroup(teamDir)
  const next = group.outbox.shift()
  saveGroup(teamDir, group)
  return next ?? null
}

// ---- DMs: one thread per counterparty ----

export function dmKey(peer) {
  return `${peer.kind}:${peer.id}`
}

export function loadDms(teamDir) {
  if (!teamDir) return { threads: {} }
  const d = readJson(path.join(teamDir, 'dms.json'), null)
  if (d && d.threads && typeof d.threads === 'object') return d
  return { threads: {} }
}

function saveDms(teamDir, dms) {
  const keys = Object.keys(dms.threads)
  if (keys.length > DM_THREAD_MAX) {
    for (const k of keys.slice(0, keys.length - DM_THREAD_MAX)) delete dms.threads[k]
  }
  writeJson(path.join(teamDir, 'dms.json'), dms)
}

export function appendDm(teamDir, peer, msg, { unread = false } = {}) {
  const dms = loadDms(teamDir)
  const key = dmKey(peer)
  const thread = dms.threads[key] ?? { peer, msgs: [], unread: 0 }
  thread.peer = peer
  if (!thread.msgs.some((m) => m.id === msg.id)) thread.msgs.push(msg)
  thread.msgs.sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
  if (thread.msgs.length > DM_THREAD_CAP) thread.msgs = thread.msgs.slice(thread.msgs.length - DM_THREAD_CAP)
  if (unread) thread.unread = (thread.unread ?? 0) + 1
  dms.threads[key] = thread
  saveDms(teamDir, dms)
  return thread
}

export function markDmRead(teamDir, key) {
  const dms = loadDms(teamDir)
  const thread = dms.threads[key]
  if (!thread) return null
  thread.unread = 0
  saveDms(teamDir, dms)
  return thread
}

// ---- node x25519 DM keys ----

export function nodeEncKeys(teamDir) {
  const file = path.join(teamDir, 'nodeenc.json')
  const existing = readJson(file, null)
  if (existing?.pub && existing?.sec) return existing
  const keys = genEncKeys()
  writeJson(file, keys, 0o600)
  return keys
}
