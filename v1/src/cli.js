import os from 'node:os'
import path from 'node:path'
import { initCommand } from './commands/init.js'
import { upCommand } from './commands/up.js'
import { inviteCommand } from './commands/invite.js'
import { joinCommand } from './commands/join.js'

function notYet(cmd) {
  console.error(`wayfind-one: '${cmd}' is not implemented yet`)
  process.exitCode = 2
}

function help() {
  console.log(`wayfind-one — one team, one private computer, one AI workspace

Usage:
  wayfind-one [--port 7777]        start daemon + serve UI (active team, if any)
  wayfind-one init --team <name> [--force]
  wayfind-one up [--port 7777] [--topic <hex>] [--no-docker-autostart]
  wayfind-one invite
  wayfind-one join <code>

 Planned (not yet): bot create, verify, doctor, demo

 Env:
   WAYFIND_HOME   node home dir (default ~/.wayfind-one)
   --home <dir>   same, as a flag (overrides WAYFIND_HOME)
   WAYFIND_NO_DOCKER_AUTOSTART=1   don't try to launch Docker Desktop
`)
}

export function homeDir() {
  return process.env.WAYFIND_HOME ?? path.join(os.homedir(), '.wayfind-one')
}

function flag(argv, name) {
  const i = argv.indexOf(name)
  return i !== -1 ? argv[i + 1] : null
}

const COMMANDS = new Set(['init', 'up', 'invite', 'join', 'bot', 'verify', 'doctor', 'demo'])

export async function main(argv) {
  // Global flags (--home, --port) may come before the command, so find the
  // first real command token instead of assuming position zero.
  const at = argv.findIndex((a) => COMMANDS.has(a))
  const [cmd, ...rest] = at === -1 ? argv : argv.slice(at)
  if (cmd === '--help' || cmd === '-h') return help()
  const home = flag(argv, '--home') ?? homeDir()
  const autostart =
    !argv.includes('--no-docker-autostart') && process.env.WAYFIND_NO_DOCKER_AUTOSTART !== '1'

  // Bare run (or flags only): boot the daemon and serve the UI.
  if (!cmd || cmd.startsWith('-')) {
    const port = parseInt(flag(argv, '--port') ?? '7777', 10)
    if (Number.isNaN(port)) {
      console.error('wayfind-one: invalid --port')
      process.exitCode = 2
      return
    }
    await upCommand({ port, topic: flag(argv, '--topic'), home, autostart })
    return
  }

  switch (cmd) {
    case 'init': {
      const team = flag(rest, '--team')
      if (!team) {
        console.error("wayfind-one init: missing required flag '--team <name>'")
        process.exitCode = 2
        return
      }
      await initCommand({ team, force: rest.includes('--force'), home })
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
      await upCommand({ port, topic, home, autostart })
      return
    }
    case 'invite':
      await inviteCommand({ home })
      return
    case 'join': {
      const code = rest[0]
      if (!code) {
        console.error('wayfind-one join: missing invite code')
        process.exitCode = 2
        return
      }
      await joinCommand({ code, home })
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
