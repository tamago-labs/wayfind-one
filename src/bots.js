import fs from 'node:fs'
import path from 'node:path'
import { randomBytes } from 'node:crypto'

// Owner-private bots. Stored in a LOCAL file only — never in the autobase
// shared store, never synced:
//   teams/<teamId>/bots-<nodeIdHex>.json
// One file per node: teammates on the same team each keep their own bots.

const COLORS = ['amber', 'moss', 'lagoon', 'ash', 'blue', 'coral', 'grape']
const SHAPES = ['blob', 'circle', 'squircle', 'pebble']

export function botsPath(teamDir, nodeIdHex) {
  return path.join(teamDir, `bots-${nodeIdHex}.json`)
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
  const bot = {
    id: randomBytes(8).toString('hex'),
    name,
    role: '',
    isChiefOfStaff: isChief,
    color,
    shape,
    msgs: [],
    createdAt: Date.now()
  }
  bots.unshift(bot)
  saveBots(teamDir, nodeIdHex, bots)
  return bot
}

export function updateBot(teamDir, nodeIdHex, id, { name, role, color, shape, isChiefOfStaff }) {
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
  saveBots(teamDir, nodeIdHex, bots)
  return bot
}

export function renameBot(teamDir, nodeIdHex, id, name) {
  return updateBot(teamDir, nodeIdHex, id, { name })
}

export function deleteBot(teamDir, nodeIdHex, id) {
  const bots = loadBots(teamDir, nodeIdHex)
  const next = bots.filter((b) => b.id !== id)
  if (next.length === bots.length) return false
  saveBots(teamDir, nodeIdHex, next)
  return true
}
