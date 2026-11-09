import fs from 'node:fs'
import path from 'node:path'
import { loadOrCreateIdentity } from '../p2p/identity.js'
import { checkRedemption, markRedeemed } from '../p2p/invite.js'
import { TeamSwarm } from '../p2p/swarm.js'
import { startServer } from '../daemon/server.js'

// Bootstrap only: identity + team + swarm + daemon. Invite/join is the
// single feature — everything else (tasks, claims, bots) comes later.
export async function upCommand({ port, topic, home }) {
  const teamFile = path.join(home, 'team.json')
  if (!fs.existsSync(teamFile)) {
    console.error(`wayfind-one up: no team in ${home} — run 'wayfind-one init --team <name>' first`)
    process.exitCode = 2
    return
  }
  const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'))
  const id = await loadOrCreateIdentity(home)

  const swarm = new TeamSwarm({
    nodeId: id.identityPublicKey,
    keyPair: id.deviceKeyPair,
    onRedeem: (nonce) => {
      const check = checkRedemption(home, nonce)
      if (!check.ok) return check
      markRedeemed(home, nonce)
      return { ok: true }
    },
  })

  const useTopic = topic ?? team.topic
  await swarm.join(useTopic)

  const server = await startServer({ port, swarm, team, identityPublicKey: id.identityPublicKey })
  console.log(`wayfind-one up: team '${team.teamName}' on http://localhost:${port}`)
  console.log(`node ${id.identityPublicKey.slice(0, 16)}… joined topic ${useTopic.slice(0, 16)}…`)

  const shutdown = async () => {
    console.log('\nshutting down…')
    await server.close()
    await swarm.destroy()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
