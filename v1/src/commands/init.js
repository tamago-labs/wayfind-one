import { migrateLegacy, createTeam, setActive } from '../teams.js'

export async function initCommand({ team, force, home }) {
  const reg = migrateLegacy(home)
  if (reg.active && !force) {
    const name = reg.teams[reg.active]?.name ?? reg.active.slice(0, 8)
    console.error(`wayfind-one init: team '${name}' already active (use --force to add another)`)
    process.exitCode = 2
    return
  }
  const { team: created } = await createTeam(home, team)
  setActive(home, created.teamId)

  console.log(`team '${team}' created`)
  console.log(`node home: ${home}`)
  console.log(`topic: ${created.topic}`)
  console.log(`\nnext: wayfind-one up --port 7777 (or run with no args)`)
  console.log(`then share access: wayfind-one invite (inviter must stay online for redeem)`)
}
