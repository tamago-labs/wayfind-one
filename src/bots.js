import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { genBotKeys, genEncKeys } from './msgcrypto.js'

// Owner-private bots. Stored in a LOCAL file only — never in the autobase
// shared store, except for SHARED bots whose roster ad (pubkey + metadata,
// never secrets) is published so the team can message them:
//   teams/<teamId>/bots-<nodeIdHex>.json    (bot rows, incl. secrets? no —
//     secrets live in botkeys-<nodeIdHex>.json below)
// One file per node: teammates on the same team each keep their own bots.

const KEYS_MODE = 0o600

const COLORS = ['amber', 'moss', 'lagoon', 'ash', 'blue', 'coral', 'grape']
const SHAPES = ['blob', 'circle', 'squircle', 'pebble']

export function botsPath(teamDir, nodeIdHex) {
  return path.join(teamDir, `bots-${nodeIdHex}.json`)
}

function keysPath(teamDir, nodeIdHex) {
  return path.join(teamDir, `botkeys-${nodeIdHex}.json`)
}

function loadKeys(teamDir, nodeIdHex) {
  try {
    return JSON.parse(fs.readFileSync(keysPath(teamDir, nodeIdHex), 'utf8'))
  } catch { /* none yet */ }
  return {}
}

function saveKeys(teamDir, nodeIdHex, keys) {
  fs.mkdirSync(teamDir, { recursive: true })
  fs.writeFileSync(keysPath(teamDir, nodeIdHex), JSON.stringify(keys), { mode: KEYS_MODE })
}

// Bot secrets — never leave this machine, never in the store.
// Entry shape: { sign: ed25519 pem, enc: x25519 pem }.
export function botSecret(teamDir, nodeIdHex, botId) {
  const entry = loadKeys(teamDir, nodeIdHex)[botId]
  if (!entry) return null
  return typeof entry === 'string' ? entry : (entry.sign ?? null)
}

export function botEncSecret(teamDir, nodeIdHex, botId) {
  const entry = loadKeys(teamDir, nodeIdHex)[botId]
  if (!entry || typeof entry === 'string') return null
  return entry.enc ?? null
}

export function loadBots(teamDir, nodeIdHex) {
  try {
    const b = JSON.parse(fs.readFileSync(botsPath(teamDir, nodeIdHex), 'utf8'))
    if (Array.isArray(b)) return b
  } catch { /* none yet */ }
  return []
}

function saveBots(teamDir, nodeIdHex, bots) {
  fs.mkdirSync(teamDir, { recursive: true })
  fs.writeFileSync(botsPath(teamDir, nodeIdHex), JSON.stringify(bots, null, 2))
}

function randomLook(bots) {
  const used = new Set(bots.map((b) => `${b.color}/${b.shape}`))
  const combos = COLORS.flatMap((color) => SHAPES.map((shape) => ({ color, shape })))
  const free = combos.filter((c) => !used.has(`${c.color}/${c.shape}`))
  const pool = free.length > 0 ? free : combos
  return pool[Math.floor(Math.random() * pool.length)]
}

export function createBot(teamDir, nodeIdHex, name, isChief = false) {
  const bots = loadBots(teamDir, nodeIdHex)
  const { color, shape } = randomLook(bots)
  if (isChief) {
    for (const b of bots) b.isChiefOfStaff = false
  }
  const keys = genBotKeys()
  const bot = {
    id: randomBytes(8).toString('hex'),
    name,
    role: '',
    isChiefOfStaff: isChief,
    shared: false,
    pubkey: keys.pub,
    color,
    shape,
    msgs: [],
    createdAt: Date.now()
  }
  bots.unshift(bot)
  saveBots(teamDir, nodeIdHex, bots)
  const secrets = loadKeys(teamDir, nodeIdHex)
  secrets[bot.id] = { sign: keys.sec, enc: genEncKeys().sec }
  saveKeys(teamDir, nodeIdHex, secrets)
  return bot
}

export function updateBot(teamDir, nodeIdHex, id, { name, role, color, shape, isChiefOfStaff, shared }) {
  const bots = loadBots(teamDir, nodeIdHex)
  const bot = bots.find((b) => b.id === id)
  if (!bot) return null
  if (name !== undefined) bot.name = name
  if (role !== undefined) bot.role = role
  if (color !== undefined && COLORS.includes(color)) bot.color = color
  if (shape !== undefined && SHAPES.includes(shape)) bot.shape = shape
  if (isChiefOfStaff !== undefined) {
    if (isChiefOfStaff) {
      for (const b of bots) b.isChiefOfStaff = false
    }
    bot.isChiefOfStaff = isChiefOfStaff
  }
  if (shared !== undefined) bot.shared = shared === true
  ensureBotKeys(teamDir, nodeIdHex, bot)
  saveBots(teamDir, nodeIdHex, bots)
  return bot
}

export function renameBot(teamDir, nodeIdHex, id, name) {
  return updateBot(teamDir, nodeIdHex, id, { name })
}

// Backfill: bots created before keypairs existed get a pair now, and every
// bot gets an x25519 DM-sealing key alongside its ed25519 signing key.
export function ensureBotKeys(teamDir, nodeIdHex, bot) {
  const secrets = loadKeys(teamDir, nodeIdHex)
  const prev = secrets[bot.id]
  const prevSign = typeof prev === 'string' ? prev : prev?.sign
  const prevEnc = typeof prev === 'object' && prev ? prev.enc : null
  let changed = false
  if (!bot.pubkey || !prevSign) {
    const keys = genBotKeys()
    bot.pubkey = keys.pub
    secrets[bot.id] = { sign: keys.sec, enc: prevEnc ?? genEncKeys().sec }
    changed = true
  } else if (!prevEnc) {
    secrets[bot.id] = { sign: prevSign, enc: genEncKeys().sec }
    changed = true
  }
  if (changed) saveKeys(teamDir, nodeIdHex, secrets)
  return bot.pubkey
}

export function deleteBot(teamDir, nodeIdHex, id) {
  const bots = loadBots(teamDir, nodeIdHex)
  const next = bots.filter((b) => b.id !== id)
  if (next.length === bots.length) return false
  saveBots(teamDir, nodeIdHex, next)
  // Wipe the signing secret with the row — the roster ad dies separately
  // via bot-remove in the shared store.
  const secrets = loadKeys(teamDir, nodeIdHex)
  if (secrets[id]) {
    delete secrets[id]
    saveKeys(teamDir, nodeIdHex, secrets)
  }
  return true
}

// Append thread messages (conversation lives at the host, in this file).
export function appendMsgs(teamDir, nodeIdHex, id, msgs, cap = 200) {
  const bots = loadBots(teamDir, nodeIdHex)
  const bot = bots.find((b) => b.id === id)
  if (!bot) return null
  bot.msgs.push(...msgs)
  if (bot.msgs.length > cap) bot.msgs = bot.msgs.slice(bot.msgs.length - cap)
  saveBots(teamDir, nodeIdHex, bots)
  return bot
}
