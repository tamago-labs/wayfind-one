import os from 'node:os'
import path from 'node:path'
import { initCommand } from './commands/init.js'
import { upCommand } from './commands/up.js'
import { inviteCommand } from './commands/invite.js'
import { joinCommand } from './commands/join.js'

function notYet(cmd) {
  console.error(`wayfind-one: '${cmd}' is not implemented yet (Phase 1: init/up only)`)
  process.exitCode = 2
}

function help() {
  console.log(`wayfind-one — one team, one private computer, one AI workspace

Usage:
  wayfind-one init --team <name> [--force]
  wayfind-one up [--port 7777] [--topic <hex>]
  wayfind-one invite
  wayfind-one join <code>

Planned (not yet): bot create, verify, doctor, demo

Env:
  WAYFIND_HOME   node home dir (default ~/.wayfind-one)
`)
}

export function homeDir() {
  return process.env.WAYFIND_HOME ?? path.join(os.homedir(), '.wayfind-one')
}

function flag(argv, name) {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : null
}

export async function main(argv) {
  const [cmd, ...rest] = argv
  if (!cmd || cmd === '--help' || cmd === '-h') return help()

  switch (cmd) {
    case 'init': {
      const team = flag(rest, '--team')
      if (!team) {
        console.error("wayfind-one init: missing required flag '--team <name>'")
        process.exitCode = 2
        return
      }
      await initCommand({ team, force: rest.includes('--force'), home: homeDir() })
      return
    }
    case 'up': {
      const port = parseInt(flag(rest, '--port') ?? '7777', 10)
      const topic = flag(rest, '--topic')
      if (Number.isNaN(port)) {
        console.error('wayfind-one up: invalid --port')
        process.exitCode = 2
        return
      }
      await upCommand({ port, topic, home: homeDir() })
      return
    }
    case 'invite':
      await inviteCommand({ home: homeDir() })
      return
    case 'join': {
      const code = rest[0]
      if (!code) {
        console.error('wayfind-one join: missing invite code')
        process.exitCode = 2
        return
      }
      await joinCommand({ code, home: homeDir() })
      return
    }
    case 'bot':
    case 'verify':
    case 'doctor':
    case 'demo':
      return notYet(cmd)
    default:
      console.error(`wayfind-one: unknown command '${cmd}'`)
      help()
      process.exitCode = 2
  }
}
