import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { listTeams, createTeam } from '../teams.js'

function dirBytes(dir) {
  let total = 0
  try {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      try {
        if (entry.isDirectory()) total += dirBytes(full)
        else total += fs.statSync(full).size
      } catch { /* racing writes */ }
    }
  } catch { /* missing dir */ }
  return total
}

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', '..', 'frontend', 'dist')

// Metadata only — never secrets, prompts, or team keys.
export function startServer({ port, ctrl }) {
  const app = express()
  app.use(express.json())

  app.get('/api/status', async (req, res) => {
    res.json(await ctrl.status())
  })

  app.get('/api/teams', (req, res) => {
    res.json({ teams: listTeams(ctrl.base) })
  })

  app.post('/api/teams', async (req, res) => {
    try {
      const name = (req.body?.name ?? '').toString().trim()
      if (!name) return void res.status(400).json({ ok: false, error: 'name is required' })
      const { team } = await createTeam(ctrl.base, name)
      const status = await ctrl.activate(team.teamId)
      res.json({ ok: true, ...status })
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) })
    }
  })

  app.post('/api/teams/activate', async (req, res) => {    try {
      const id = (req.body?.id ?? '').toString().trim()
      if (!id) return void res.status(400).json({ ok: false, error: 'id is required' })
      const status = await ctrl.activate(id)
      res.json({ ok: true, ...status })
    } catch (err) {
      res.status(404).json({ ok: false, error: String(err?.message ?? err) })
    }
  })

  app.post('/api/join', async (req, res) => {
    try {
      const code = (req.body?.code ?? '').toString().trim()
      if (!code) return void res.status(400).json({ ok: false, error: 'code is required' })
      const status = await ctrl.join(code)
      res.json({ ok: true, ...status })
    } catch (err) {
      const msg = String(err?.message ?? err)
      const http = msg === 'invalid invite code' ? 400
        : /already used|rejected/.test(msg) ? 409
        : /not online/.test(msg) ? 504
        : 500
      res.status(http).json({ ok: false, error: msg })
    }
  })

  app.post('/api/invite', async (req, res) => {
    try {
      const code = await ctrl.invite()
      res.json({ ok: true, code })
    } catch (err) {
      const msg = String(err?.message ?? err)
      const http = /no active team/.test(msg) ? 409 : 500
      res.status(http).json({ ok: false, error: msg })
    }
  })

  app.post('/api/profile', async (req, res) => {
    try {
      const name = (req.body?.name ?? '').toString()
      const members = await ctrl.setProfile(name)
      res.json({ ok: true, members })
    } catch (err) {
      const msg = String(err?.message ?? err)
      const http = /no active team/.test(msg) ? 409 : /not a writer|name is required/.test(msg) ? 400 : 500
      res.status(http).json({ ok: false, error: msg })
    }
  })

  app.post('/api/teams/leave', async (req, res) => {
    try {
      const status = await ctrl.leave()
      res.json({ ok: true, ...status })
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) })
    }
  })

  app.get('/api/bots', async (req, res) => {
    try {
      res.json({ ok: true, bots: await ctrl.bots() })
    } catch (err) {
      const msg = String(err?.message ?? err)
      res.status(/no active team/.test(msg) ? 409 : 500).json({ ok: false, error: msg })
    }
  })

  app.post('/api/bots', async (req, res) => {
    try {
      const bot = await ctrl.createBot(req.body?.name, req.body?.isChiefOfStaff)
      res.json({ ok: true, bot })
    } catch (err) {
      const msg = String(err?.message ?? err)
      const http = /no active team/.test(msg) ? 409 : /name is required/.test(msg) ? 400 : 500
      res.status(http).json({ ok: false, error: msg })
    }
  })

  app.patch('/api/bots/:id', async (req, res) => {
    try {
      const bot = await ctrl.updateBot(req.params.id, req.body ?? {})
      res.json({ ok: true, bot })
    } catch (err) {
      const msg = String(err?.message ?? err)
      const http = /unknown bot/.test(msg) ? 404 : /no active team/.test(msg) ? 409 : 400
      res.status(http).json({ ok: false, error: msg })
    }
  })

  app.delete('/api/bots/:id', async (req, res) => {
    try {
      await ctrl.deleteBot(req.params.id)
      res.json({ ok: true })
    } catch (err) {
      const msg = String(err?.message ?? err)
      const http = /unknown bot/.test(msg) ? 404 : 409
      res.status(http).json({ ok: false, error: msg })
    }
  })

  app.post('/api/bots/:id/chat', async (req, res) => {
    try {
      const bot = await ctrl.chat(req.params.id, req.body?.text)
      res.json({ ok: true, bot })
    } catch (err) {
      const msg = String(err?.message ?? err)
      const http = /unknown bot/.test(msg) ? 404
        : /no active team|text is required/.test(msg) ? 400
        : /bot is busy/.test(msg) ? 409
        : 500
      res.status(http).json({ ok: false, error: msg })
    }
  })

  app.get('/api/storage', (req, res) => {
    res.json({ ok: true, home: ctrl.base, bytes: dirBytes(ctrl.base) })
  })

  app.post('/api/workspace/reset', async (req, res) => {
    // Wipe everything and stop: open cores cannot survive their files
    // disappearing, so the daemon exits and the user restarts it.
    res.json({ ok: true, stopped: true })
    setTimeout(async () => {
      try {
        await ctrl.deactivate()
      } catch { /* going away anyway */ }
      try {
        await ctrl.removeComputers()
      } catch { /* best effort */ }
      try {
        fs.rmSync(ctrl.base, { recursive: true, force: true })
      } catch { /* best effort */ }
      process.exit(0)
    }, 500)
  })

  app.post('/api/swarm/join', async (req, res) => {
    try {
      if (!ctrl.team) return void res.status(409).json({ ok: false, error: 'no active team' })
      const topic = req.body?.topic ?? ctrl.team.topic
      await ctrl.swarm.join(topic)
      res.json({ ok: true, ...(await ctrl.status()) })
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) })
    }
  })

  app.post('/api/swarm/leave', async (req, res) => {
    try {
      if (!ctrl.team) return void res.status(409).json({ ok: false, error: 'no active team' })
      await ctrl.swarm.leave()
      res.json({ ok: true, ...(await ctrl.status()) })
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) })
    }
  })

  if (fs.existsSync(publicDir)) {
    app.use(express.static(publicDir))
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api/')) return next()
      res.sendFile(path.join(publicDir, 'index.html'))
    })
  } else {
    app.get('/', (req, res) => res.json({ ok: true, ui: 'run `npm run build` in frontend/ to serve the UI' }))
  }

  return new Promise((resolve) => {
    const server = app.listen(port, () => resolve({
      async ready() {},
      async close() {
        await new Promise((r) => server.close(r))
      }
    }))
  })
}
