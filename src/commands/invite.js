import fs from 'node:fs'
import path from 'node:path'
import { loadOrCreateIdentity } from '../p2p/identity.js'
import { createInvite } from '../p2p/invite.js'

export async function inviteCommand({ home }) {
  const teamFile = path.join(home, 'team.json')
  if (!fs.existsSync(teamFile)) {
    console.error(`wayfind-one invite: no team in ${home} — run 'init' first`)
    process.exitCode = 2
    return
  }
  const team = JSON.parse(fs.readFileSync(teamFile, 'utf8'))
  const id = await loadOrCreateIdentity(home)

  const { code } = createInvite(home, team, id.identityPublicKey)

  console.log(code)
  console.error(`\none-time invite for team '${team.teamName}'. Share it privately.`)
  console.error(`It is spent on first use; the inviter must be online (up) when redeemed.`)
}
