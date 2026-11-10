import { joinTeam } from '../teams.js'

export async function joinCommand({ code, home }) {
  try {
    const { team: adopted, home: teamHome } = await joinTeam(home, code)
    console.log(`joined team '${adopted.teamName}' (invite spent)`)
    console.log(`node home: ${teamHome}`)
    console.log(`next: wayfind-one up --port 7778 (or run with no args)`)
  } catch (err) {
    console.error(`wayfind-one join: ${err.message}`)
    process.exitCode = err.message === 'invalid invite code' ? 2 : 1
  }
}
