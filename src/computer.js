import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const run = promisify(execFile)
const here = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(here, '..')

// Local "computer": one persistent container per node. Tool execution only —
// conversation, bot config, and keys stay at the host (daemon files) and
// never enter the container.
//
// Image is our own (docker/Dockerfile, built once on first boot): Ubuntu
// userland with python3 + curl + git, because offline-minimal bases leave
// agents without the tools they reach for. Network is ON (bridge): unlike
// offline-analysis sandboxes, our tools legitimately need egress (package
// installs, API calls, git). Host isolation comes from namespaces + mounts
// (only the workspace is shared), not from blocking the network.
// Set WAYFIND_NO_NETWORK=1 to restore --network none.
export const IMAGE = process.env.WAYFIND_IMAGE ?? 'wayfind-computer'
const NO_NETWORK = process.env.WAYFIND_NO_NETWORK === '1'

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

async function imageExists(image) {
  try {
    await run('docker', ['image', 'inspect', image])
    return true
  } catch {
    return false
  }
}

// Our image is built from docker/Dockerfile on first boot (cached after).
// WAYFIND_IMAGE overrides the tag — for a custom tag the operator builds it.
async function ensureImage({ log = () => {} }) {
  if (IMAGE !== 'wayfind-computer') {
    if (!(await imageExists(IMAGE))) throw new Error(`image ${IMAGE} not found locally — build or pull it first`)
    return
  }
  if (await imageExists(IMAGE)) return
  log('computer: building wayfind-computer image (first run only, a few minutes)…')
  await run('docker', ['build', '-t', IMAGE, path.join(REPO_ROOT, 'docker')], {
    timeout: 600_000,
    maxBuffer: 64 * 1024 * 1024
  })
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
    const { stdout } = await run('docker', ['inspect', '--format', '{{.State.Running}}|{{.Config.Image}}|{{.HostConfig.NetworkMode}}', name])
    const [running, image, networkMode] = stdout.trim().split('|')
    return { exists: true, running: running === 'true', image, networkMode }
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
  const wantNetwork = NO_NETWORK ? 'none' : 'default'
  if (!info.exists || info.image !== IMAGE || info.networkMode !== wantNetwork) {
    if (info.exists) await run('docker', ['rm', '-f', name]).catch(() => {})
    if (info.exists && info.networkMode !== wantNetwork) log(`computer: network mode changed (${info.networkMode} → ${wantNetwork}), recreating ${name}`)
    await ensureImage({ log })
    log(`computer: creating ${name}${NO_NETWORK ? ' (no network)' : ''}`)
    const createArgs = ['create', '--name', name]
    if (NO_NETWORK) createArgs.push('--network', 'none')
    createArgs.push(
      '--memory', '2g', '--cpus', '2',
      '-v', `${mountPath(workspaceDir)}:/work`,
      '-w', '/work',
      IMAGE, 'sleep', 'infinity'
    )
    await run('docker', createArgs)
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
