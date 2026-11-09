import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'
import { listTeams, createTeam } from '../teams.js'

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
