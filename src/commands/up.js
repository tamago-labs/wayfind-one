import fs from 'node:fs'
import path from 'node:path'
import { loadOrCreateIdentity } from '../p2p/identity.js'
import { checkRedemption, markRedeemed } from '../p2p/invite.js'
import { TeamSwarm } from '../p2p/swarm.js'
import { TaskStore } from '../p2p/tasks.js'
import { startServer } from '../daemon/server.js'

export async function upCommand({ port, topic, home }) {
  const teamFile = path.join(home, 'team.json')
  if (!fs.existsSync(teamFile)) {
    console.error(`wayfind-one up: no team in ${home} — run 'wayfind-one init --team <name>' first`)
    process.exitCode = 2
    return
  }
  const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'))
  const id = await loadOrCreateIdentity(home)

  let tasks = null
  const swarm = new TeamSwarm({
    nodeId: id.identityPublicKey,
    keyPair: id.deviceKeyPair,
    onRedeem: (nonce) => {
      const check = checkRedemption(home, nonce)
      if (!check.ok) return check
      markRedeemed(home, nonce)
      return { ok: true }
    },
    onHello: (msg) => tasks?.onPeerHello(msg)
  })
  const useTopic = topic ?? team.topic
  await swarm.join(useTopic)

  tasks = new TaskStore({ home, identity: id.identity, deviceKeyPair: id.deviceKeyPair, deviceProof: id.deviceProof })
  const coreKey = await tasks.open({ teamId: team.teamId, teamSecret: team.teamSecret })
  swarm.setLocalInfo({ coreKey })
  swarm.announceLocal() // peers connected before open() get the core key now

  const server = await startServer({ port, swarm, team, identityPublicKey: id.identityPublicKey, tasks })
  console.log(`tasks core: ${coreKey.slice(0, 16)}…`)

  console.log(`wayfind-one up: team '${team.teamName}' on http://localhost:${port}`)
  console.log(`node ${id.identityPublicKey.slice(0, 16)}… joined topic ${useTopic.slice(0, 16)}…`)

  const shutdown = async () => {
    console.log('\nshutting down…')
    await server.close()
    await swarm.destroy()
    await tasks.destroy()
    process.exit(0)
  }
  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
}
