import { appendMsgs } from './bots.js'
import { containerName, execCommand } from './computer.js'

// Agent loop skeleton (single bot, no model yet).
// Turn = append user msg, optionally run one tool, append bot reply.
// Conversation lives at the host (bots file); the computer only
// receives the raw command and returns output.

const MAX_TEXT = 2000
const EXEC_TIMEOUT_MS = 60_000
const OUTPUT_LIMIT = 4000

export async function runTurn({ teamDir, nodeId, botId, text }) {
  const v = String(text ?? '').slice(0, MAX_TEXT).trim()
  if (!v) throw new Error('text is required')

  const reply = []
  if (v.startsWith('$')) {
    const cmd = v.slice(1).trim()
    if (!cmd) {
      reply.push({ t: 'b', x: 'Nothing to run — put the command after `$`, e.g. `$ ls /work`.' })
    } else {
      const r = await execCommand(containerName(nodeId), cmd, { timeoutMs: EXEC_TIMEOUT_MS })
      const raw = (r.stdout || r.stderr || '').slice(0, OUTPUT_LIMIT)
      const out = raw.trim() ? raw : '(ran with exit 0 — no output)'
      reply.push({ t: 'b', x: r.exit === 0 ? out : `Exit ${r.exit}:\n${out}` })
    }
  } else {
    reply.push({
      t: 'b',
      x: 'Brain not wired yet — I can run commands on my computer though. Try `$ <command>`, e.g. `$ ls /work`.'
    })
  }

  const bot = appendMsgs(teamDir, nodeId, botId, [{ t: 'u', x: v }, ...reply])
  if (!bot) throw new Error('unknown bot')
  return bot
}
