import fs from 'node:fs'
import path from 'node:path'
import crypto from 'hypercore-crypto'
import b4a from 'b4a'
import { loadOrCreateIdentity } from '../p2p/identity.js'
import { deriveTopic } from '../p2p/swarm.js'

export async function initCommand({ team, force, home }) {
  fs.mkdirSync(home, { recursive: true })
  const teamFile = path.join(home, 'team.json')
  if (fs.existsSync(teamFile) && !force) {
    console.error(`wayfind-one init: store already exists at ${home} (use --force to reset)`)
    process.exitCode = 2
    return
  }
  const id = await loadOrCreateIdentity(home)
  const teamId = b4a.toString(crypto.randomBytes(32), 'hex')
  const teamSecret = b4a.toString(crypto.randomBytes(32), 'hex')
  const topic = deriveTopic(teamId, teamSecret)
  fs.writeFileSync(teamFile, JSON.stringify({ teamName: team, teamId, teamSecret, topic }, null, 2))

  console.log(`team '${team}' created in ${home}`)
  console.log(`node identity: ${id.identityPublicKey.slice(0, 16)}…`)
  console.log(`topic: ${topic}`)
  console.log(`\nnext: wayfind-one up --port 7777`)
  console.log(`peer with the same team: copy this WAYFIND_HOME, or use --topic ${topic} (invites land in Phase 2)`)
}
