import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'

const run = promisify(execFile)

// Local "computer": one persistent container per node. Tool execution only —
// conversation, bot config, and keys stay at the host (daemon files) and
// never enter the container. Network is off by default.
export const IMAGE = process.env.WAYFIND_IMAGE ?? 'ubuntu:24.04'

const PREFIX = 'wayfind-'
let currentKey = null

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

// Docker Desktop on Windows needs posix-style mounts: C:\x\y -> /c/x/y.
function mountPath(p) {
  const m = /^([A-Za-z]):[\\/]?(.*)$/.exec(p)
  if (!m) return p.replace(/\\/g, '/')
  return `/${m[1].toLowerCase()}/${m[2].replace(/\\/g, '/')}`
}

export function containerName(nodeId) {
  return `${PREFIX}${String(nodeId).slice(0, 12)}`
}

export async function probeDocker() {
  try {
    await run('docker', ['info', '--format', '{{.ServerVersion}}'], { timeout: 15_000 })
    return true
  } catch {
    return false
  }
}

async function inspect(name) {
  try {
    const { stdout } = await run('docker', ['inspect', '--format', '{{.State.Running}}|{{.Config.Image}}', name])
    const [running, image] = stdout.trim().split('|')
    return { exists: true, running: running === 'true', image }
  } catch {
    return { exists: false }
  }
}

export async function ensureComputer({ nodeId, workspaceDir, key, log = () => {} }) {
  const name = containerName(nodeId)
  fs.mkdirSync(workspaceDir, { recursive: true })
  // First run: leave a marker so an empty `ls` isn't a mystery.
  try {
    if (fs.readdirSync(workspaceDir).length === 0) {
      fs.writeFileSync(path.join(workspaceDir, 'README.md'), `# Workspace\n\nThis directory is this computer's /work — commands run here.\nFiles you create land here too. Teammates have their own.\n`)
    }
  } catch { /* best effort */ }
  // Team switch = different workspace = recreate so the mount follows.
  if (currentKey !== null && currentKey !== key) {
    log(`computer: workspace changed, recreating ${name}`)
    await run('docker', ['rm', '-f', name]).catch(() => {})
  }
  currentKey = key
  const info = await inspect(name)
  if (!info.exists || info.image !== IMAGE) {
    if (info.exists) await run('docker', ['rm', '-f', name]).catch(() => {})
    log(`computer: pulling ${IMAGE} (first run only)…`)
    await run('docker', ['pull', IMAGE], { timeout: 600_000, maxBuffer: 64 * 1024 * 1024 })
    log(`computer: creating ${name}`)
    await run('docker', [
      'create', '--name', name,
      '--network', 'none',
      '--memory', '2g', '--cpus', '2',
      '-v', `${mountPath(workspaceDir)}:/work`,
      '-w', '/work',
      IMAGE, 'sleep', 'infinity'
    ])
  }
  const st = await inspect(name)
  if (!st.running) {
    await run('docker', ['start', name])
  }
  const deadline = Date.now() + 30_000
  for (;;) {
    try {
      await run('docker', ['exec', name, 'true'], { timeout: 5_000 })
      break
    } catch {
      if (Date.now() > deadline) throw new Error('computer did not become ready')
      await sleep(1000)
    }
  }
  return { name, image: IMAGE, workspace: workspaceDir }
}

export async function execCommand(name, cmd, { timeoutMs = 60_000 } = {}) {
  try {
    const { stdout, stderr } = await run('docker', ['exec', name, 'sh', '-c', cmd], {
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024
    })
    return { stdout, stderr, exit: 0 }
  } catch (err) {
    return {
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' && err.stderr ? err.stderr : String(err?.message ?? err),
      exit: typeof err.code === 'number' ? err.code : 1
    }
  }
}

export async function removeAllComputers() {
  try {
    const { stdout } = await run('docker', ['ps', '-aq', '--filter', `name=${PREFIX}`])
    const ids = stdout.trim().split(/\s+/).filter(Boolean)
    for (const id of ids) {
      await run('docker', ['rm', '-f', id]).catch(() => {})
    }
  } catch { /* docker gone: nothing to clean */ }
  currentKey = null
}
