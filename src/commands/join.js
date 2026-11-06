import fs from 'node:fs'
import path from 'node:path'
import { loadOrCreateIdentity } from '../p2p/identity.js'
import { decodeInvite, joinerMarkUsed, redeemInvite } from '../p2p/invite.js'

export async function joinCommand({ code, home }) {
  let inv
  try {
    inv = decodeInvite(code)
  } catch {
    console.error('wayfind-one join: invalid invite code')
    process.exitCode = 2
    return
  }

  const id = await loadOrCreateIdentity(home)
  let team
  try {
    team = await redeemInvite({ home, code, nodeId: id.identityPublicKey, keyPair: id.deviceKeyPair })
  } catch (err) {
    console.error(`wayfind-one join: ${err.message}`)
    process.exitCode = 1
    return
  }

  // Redeemed: adopt the issuer's team (keep a backup of any local team).
  const teamFile = path.join(home, 'team.json')
  if (fs.existsSync(teamFile)) fs.copyFileSync(teamFile, teamFile + '.bak')
  fs.writeFileSync(
    teamFile,
    JSON.stringify({ teamName: team.teamName, teamId: team.teamId, teamSecret: team.teamSecret, topic: team.topic }, null, 2)
  )
  joinerMarkUsed(home, inv.nonce)

  console.log(`joined team '${team.teamName}' (invite spent)`)
  console.log(`next: wayfind-one up --port 7778`)
}
