import { loadOrCreateIdentity } from '../p2p/identity.js'
import { createInvite } from '../p2p/invite.js'
import { migrateLegacy, readTeam } from '../teams.js'

export async function inviteCommand({ home }) {
  const reg = migrateLegacy(home)
  const teamId = reg.active
  const teamHome = teamId ? reg.teams[teamId]?.path : null
  const team = teamHome ? readTeam(teamHome) : null
  if (!team) {
    console.error(`wayfind-one invite: no active team — run 'init' first or create one in the UI`)
    process.exitCode = 2
    return
  }
  const id = await loadOrCreateIdentity(teamHome)

  if (!team.baseKey) {
    console.error(`wayfind-one invite: team store not created yet — run 'up' once first, then invite`)
    process.exitCode = 2
    return
  }

  const { code } = createInvite(teamHome, team, id.identityPublicKey, team.baseKey)

  console.log(code)
  console.error(`\none-time invite for team '${team.teamName}'. Share it privately.`)
  console.error(`It is spent on first use; the inviter must be online (up) when redeemed.`)
}
