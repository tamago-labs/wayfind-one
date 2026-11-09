import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import express from 'express'

const here = path.dirname(fileURLToPath(import.meta.url))
const publicDir = path.join(here, '..', '..', 'frontend', 'dist')

// Metadata only — never secrets, prompts, or team keys.
export function startServer({ port, swarm, team, identityPublicKey }) {
  const app = express()
  app.use(express.json())

  app.get('/api/status', (req, res) => {
    res.json({
      nodeId: identityPublicKey,
      teamName: team.teamName,
      ...swarm.status()
    })
  })

  app.post('/api/swarm/join', async (req, res) => {
    try {
      const topic = req.body?.topic ?? team.topic
      await swarm.join(topic)
      res.json({ ok: true, ...swarm.status() })
    } catch (err) {
      res.status(500).json({ ok: false, error: String(err?.message ?? err) })
    }
  })

  app.post('/api/swarm/leave', async (req, res) => {
    try {
      await swarm.leave()
      res.json({ ok: true, ...swarm.status() })
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
