import { appendMsgs, loadBots } from './bots.js'
import { containerName } from './computer.js'
import { resolveProvider, chatReply, buildTools } from './inference.js'
import path from 'node:path'

// Agent loop: plain replies + model-driven shell tool on the computer.
// Turn = append user msg, run model (which may call shell), append
// tool records + bot reply. Conversation lives at the host (bots file);
// the computer only receives raw commands and returns output.

const MAX_TEXT = 2000

export async function runTurn({ teamDir, nodeId, botId, text, store, home }) {
  const v = String(text ?? '').slice(0, MAX_TEXT).trim()
  if (!v) throw new Error('text is required')

  // Every message goes through the model now — it has shell/read/write/
  // list tools when it needs the computer. No manual `$` path.
  const { text: replyText, toolCalls } = await modelReply({ teamDir, nodeId, botId, text: v, store, home })
  const reply = [...toolCalls, { t: 'b', x: replyText }]

  const bot = appendMsgs(teamDir, nodeId, botId, [{ t: 'u', x: v }, ...reply])
  if (!bot) throw new Error('unknown bot')
  return bot
}

async function modelReply({ teamDir, nodeId, botId, text, store, home }) {
  const bots = loadBots(teamDir, nodeId)
  const bot = bots.find((b) => b.id === botId)
  if (!bot) throw new Error('unknown bot')
  let prov
  try {
    prov = await resolveProvider({ home, store })
  } catch (err) {
    return { text: `Provider lookup failed: ${err?.message ?? err}`, toolCalls: [] }
  }
  if (!prov.model) {
    return { text: `No model selected yet — pick a provider + model first (POST /api/providers/select), then talk to me.`, toolCalls: [] }
  }
  if (!prov.apiKey) {
    const hint = prov.keyEnv ? `set ${prov.keyEnv} where the daemon runs, or share one (POST /api/providers/keys)` : 'configure a key, then talk to me'
    return { text: `No API key for ${prov.label} — ${hint}.`, toolCalls: [] }
  }
  const system = bot.role
    ? `You are "${bot.name}". Role: ${bot.role}. Reply concisely. You have tools: shell (run commands on your computer, /work, internet available), read, write, and list (workspace files). Use them when the user asks about files or wants something run; otherwise answer directly.`
    : `You are "${bot.name}", a helpful assistant. Your role is not defined yet. Reply concisely. You have tools: shell (run commands on your computer, /work, internet available), read, write, and list (workspace files). Use them when the user asks about files or wants something run; otherwise answer directly.`
  const history = bot.msgs.slice(-20).map((m) => ({
    role: m.t === 'b' ? 'assistant' : 'user',
    text: String(m.x ?? '')
  }))
  // The current message isn't on disk yet (appended after the reply) —
  // include it explicitly, like cloud sends the task text with history.
  history.push({ role: 'user', text })
  try {
    const toolset = buildTools({
      container: containerName(nodeId),
      workspaceDir: path.join(teamDir, 'workspace')
    })
    const { text: replyText, toolCalls } = await chatReply({
      baseURL: prov.baseURL,
      apiKey: prov.apiKey,
      model: prov.model,
      system,
      messages: history,
      toolset
    })
    return { text: replyText, toolCalls }
  } catch (err) {
    return { text: `That run failed: ${String(err?.message ?? err).slice(0, 300)}`, toolCalls: [] }
  }
}
