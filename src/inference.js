import fs from 'node:fs'
import path from 'node:path'
import { Agent, run, setTracingDisabled, tool } from '@openai/agents'
import { OpenAIProvider } from '@openai/agents-openai'
import { z } from 'zod'
import { execCommand } from './computer.js'
import { inside } from './paths.js'

// No hosted tracing: runs stay local, telemetry export stays off
// (otherwise the SDK logs "No API key provided for OpenAI tracing
// exporter" on every turn — unrelated to the provider key).
setTracingDisabled(true)

// Inference via OpenAI-compatible providers (cloud parity: @openai/agents
// Runner, per-provider OpenAIProvider). Local models are just another
// catalog entry with a custom baseURL — no special-casing.
// Keys resolve env > shared-store; the raw key never enters Docker.

const CATALOG_FILE = 'providers.json'

function defaultCatalog() {
  return {
    defaults: { provider: 'meta', model: '' },
    providers: {
      meta: {
        label: 'Meta (Muse Spark)',
        baseURL: 'https://api.meta.ai/v1',
        keyEnv: 'MODEL_API_KEY',
        models: [
          { id: 'muse-spark-1.3', group: 'Standard' },
          { id: 'muse-spark-1.2', group: 'Standard' },
          { id: 'muse-spark-1.1', group: 'Standard' },
          { id: 'muse-spark-1.3-contributor', group: 'Contributor' },
          { id: 'muse-spark-1.2-contributor', group: 'Contributor' }
        ]
      },
      nearai: { label: 'NEAR AI', baseURL: 'https://api.near.ai/v1', keyEnv: 'NEARAI_API_KEY' },
      openai: { label: 'OpenAI', baseURL: 'https://api.openai.com/v1', keyEnv: 'OPENAI_API_KEY' },
      local: { label: 'Local (Ollama-compatible)', baseURL: 'http://localhost:11434/v1', keyEnv: 'LOCALAI_API_KEY', keyDefault: 'ollama' }
    }
  }
}

export function loadCatalog(home) {
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(home, CATALOG_FILE), 'utf8'))
    const base = defaultCatalog()
    return {
      defaults: { ...base.defaults, ...(raw.defaults ?? {}) },
      providers: { ...base.providers, ...(raw.providers ?? {}) }
    }
  } catch {
    return defaultCatalog()
  }
}

export async function resolveProvider({ home, store }) {
  const catalog = loadCatalog(home)
  const shared = await store?.providerConfig().catch(() => null)
  const id = shared?.provider || catalog.defaults?.provider || 'meta'
  const model = shared?.model || catalog.defaults?.model || ''
  const entry = catalog.providers?.[id] ?? null
  const keys = await store?.providerKeys().catch(() => [])
  const sharedKey = keys?.find((k) => k.id === id)?.key
  const envKey = entry?.keyEnv ? process.env[entry.keyEnv] : ''
  const apiKey = envKey || sharedKey || entry?.keyDefault || ''
  const keySource = envKey ? 'env' : sharedKey ? 'shared' : entry?.keyDefault ? 'default' : null
  const sources = { env: !!envKey, shared: !!sharedKey }
  return { id, model, baseURL: entry?.baseURL ?? null, label: entry?.label ?? id, keyEnv: entry?.keyEnv ?? null, apiKey, keySource, sources, catalog }
}

export async function chatReply({ baseURL, apiKey, model, system, messages, toolset }) {
  const provider = new OpenAIProvider({ baseURL, apiKey })
  const agent = new Agent({
    name: 'bot',
    instructions: system,
    model: await provider.getModel(model),
    tools: toolset?.tools ?? []
  })
  // Plain-text transcript, not item lists: strict OpenAI-compatible
  // providers (e.g. Meta) validate Responses input items per role and
  // reject mis-typed history parts. A string works on every transport.
  const lines = messages.map((m) => `${m.role === 'assistant' ? 'Assistant' : 'User'}: ${m.text}`)
  let transcript = lines.join('\n')
  if (transcript.length > 12000) transcript = transcript.slice(transcript.length - 12000)
  const timeout = new Promise((_, reject) =>
    setTimeout(() => reject(new Error('inference timed out')), 180_000)
  )
  let result
  try {
    result = await Promise.race([run(agent, transcript, { maxTurns: 8 }), timeout])
  } catch (err) {
    console.error('[inference] provider call failed:', err?.message ?? err)
    throw err
  }
  const text = result.finalOutput
  if (typeof text !== 'string' || !text.trim()) throw new Error('empty model reply')
  return { text: text.trim(), toolCalls: toolset ? [...toolset.threadRows] : [] }
}

// Shell runner behind the agent's `shell` tool. Records one thread row
// per call so its work is visible; the budget caps cost and loops.
export function createShellRunner({ container, maxCalls = 6, execTimeoutMs = 60_000, onCall } = {}) {
  const calls = []
  const emit = (row) => {
    calls.push(row)
    if (onCall) onCall(row)
  }
  async function runShell(command) {
    const cmd = String(command ?? '').slice(0, 2000).trim()
    if (!cmd) return '(no command given)'
    if (calls.length >= maxCalls) return 'tool budget exhausted for this turn — answer from what you have.'
    let r
    try {
      r = await execCommand(container, cmd, { timeoutMs: execTimeoutMs })
    } catch (err) {
      const msg = `Exit 1:\n${String(err?.message ?? err).slice(0, 1000)}`
      emit({ t: 'tool', x: `$ ${cmd}\n→ error` })
      return msg
    }
    const raw = (r.stdout || r.stderr || '').slice(0, 4000)
    emit({ t: 'tool', x: `$ ${cmd}\n→ exit ${r.exit}` })
    return r.exit === 0 ? (raw.trim() ? raw : '(no output — exit 0)') : `Exit ${r.exit}:\n${raw}`
  }
  return { calls, runShell }
}

const MAX_FILE = 100_000

async function readFile(workspaceDir, { path: rel }) {
  const full = inside(workspaceDir, rel)
  const s = fs.readFileSync(full, 'utf8')
  return s.length > MAX_FILE ? s.slice(0, MAX_FILE) + `\n…(truncated, ${s.length} chars)` : (s || '(empty file)')
}

async function writeFile(workspaceDir, { path: rel, content }) {
  const full = inside(workspaceDir, rel)
  fs.mkdirSync(path.dirname(full), { recursive: true })
  fs.writeFileSync(full, String(content ?? ''))
  return `Wrote ${String(content ?? '').length} chars to ${rel}`
}

async function listDir(workspaceDir, { path: rel }) {
  const full = inside(workspaceDir, rel ?? '.')
  const entries = fs.readdirSync(full).map((e) =>
    fs.statSync(path.join(full, e)).isDirectory() ? e + '/' : e
  )
  return entries.join('\n') || '(empty)'
}

// Doom-loop guard: >3 identical tool+args calls in one turn → stop.
// Cloud parity (their guard trips at 3x) — models do get stuck.
export function createLoopGuard(limit = 3) {
  const seen = new Map()
  return function check(name, argsJson) {
    const k = `${name}::${argsJson}`
    const n = (seen.get(k) ?? 0) + 1
    seen.set(k, n)
    return n > limit
  }
}

function brief(args) {
  const s = JSON.stringify(args ?? {})
  return s.length > 120 ? s.slice(0, 120) + '…' : s
}

// P0 toolset (cloud parity): shell in Docker, read/write/list on the
// host workspace (same bytes as the /work mount) with inside()
// containment on every path.
export function buildTools({ container, workspaceDir }) {
  const rows = []
  const shell = createShellRunner({ container, onCall: (row) => rows.push(row) })
  const loop = createLoopGuard()
  const defs = [
    {
      name: 'shell',
      description: 'Run a shell command on your computer. Working directory is /work (your workspace) with internet access. Use for running scripts — never for anything outside /work.',
      parameters: z.object({
        command: z.string().describe('The shell command to run, e.g. "ls /work"')
      }),
      run: (a) => shell.runShell(a.command)
    },
    {
      name: 'read',
      description: 'Read a text file from the workspace. Prefer over shell cat.',
      parameters: z.object({
        path: z.string().describe('Workspace-relative file path')
      }),
      run: (a) => readFile(workspaceDir, a)
    },
    {
      name: 'write',
      description: 'Write (create or overwrite) a text file in the workspace.',
      parameters: z.object({
        path: z.string().describe('Workspace-relative file path'),
        content: z.string().describe('Full file content')
      }),
      run: (a) => writeFile(workspaceDir, a)
    },
    {
      name: 'list',
      description: 'List files and directories under a workspace path.',
      parameters: z.object({
        path: z.string().optional().describe('Workspace-relative dir (default .)')
      }),
      run: (a) => listDir(workspaceDir, a)
    }
  ]
  const tools = defs.map((d) => tool({
    name: d.name,
    description: d.description,
    parameters: d.parameters,
    execute: async (args) => {
      const argsJson = JSON.stringify(args ?? {})
      if (loop(d.name, argsJson)) {
        const msg = `Stopped: '${d.name}' called more than 3 times with the same arguments — answer from what you have.`
        rows.push({ t: 'tool', x: msg })
        return msg
      }
      let out
      try {
        out = await d.run(args)
      } catch (err) {
        out = `Error: ${String(err?.message ?? err).slice(0, 500)}`
      }
      if (d.name !== 'shell') rows.push({ t: 'tool', x: `${d.name} ${brief(args)}\n→ done` })
      return out
    }
  }))
  return { calls: shell.calls, threadRows: rows, tools }
}
