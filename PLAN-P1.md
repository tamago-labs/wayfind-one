# PLAN-P1 — local-brain sessions on a new minimal image + local dashboard

Date: 2026-11-10 (revised). Status: P0 login shipped, deployed, E2E
verified through approval. Locked decisions: **Option A** (snapshot sync),
**D1** (local dashboard from v1 frontend).

## The flip (locked)

- **Inference runs LOCAL, not in the microVM.** The sandbox is a dumb
  exec box. The agent loop + multi-provider catalog live in the CLI,
  salvaged from `v1/src/inference.js` + `v1/src/agent.js` (providers.json,
  BYOK, transcript loop). NEAR AI primary (attested path), Meta for tests.
  Provider keys live in `~/.wayfind` / env and **never enter the sandbox** —
  the VM only ever sees prompts + file contents.
- **New computer, new image.** wayfind-cloud's current image is the wrong
  computer (full agent loop + injected keys inside the VM). Build a minimal
  one: small Linux + node/python runtimes + one tiny exec agent exposing 6
  tools (`exec/read/write/edit/glob/grep` over HTTP — same surface as
  near-red's bridge). No loop, no skills, no MCP, no keys. Reuse the
  computer pipeline mechanics via `packages/sandbox/scripts/image`
  (`01-package-upload → 02-create-image`, lives in this repo), different
  Dockerfile.
- **`npm start` runs the dashboard UI (D1).** Serve the v1 frontend locally,
  repointed at the CLI API: sandbox console shell (sessions, usage, export,
  attestation status) with the teammate UI as the "Teammates" sub-view.
  No UX split across local/remote.

## The product shape (locked): sandbox backend, not a harness

Wayfind does not compete with opencode/Claude Code — it plugs into them
through one lean CLI. No local agent loop is built, no MCP configuration
is required, no plugin to install:

- **`wayfind run` is the interface** — for humans and for Claude Code
  alike. One-shot provision → push → exec → pull → terminate, plus
  `export`/`status`/`stop`. A Claude Code user points the agent at the
  workspace and tells it to use the CLI. Zero harness setup.
- The in-sandbox tool surface (REST + `POST /mcp`, 8 tools, no loop, no
  keys) is the execution backend the CLI drives. The MCP endpoint stays
  available but nothing in P1 is built against it.

This kills the hidden costs on every side: no harness rebuild, no fat
image with a loop, no per-harness adapter matrix. One CLI, one image,
one relay.

This kills the hidden cost in the old workstream 1 (rebuilding a harness)
and the fat-image cost of putting the loop in the sandbox. The exec agent
+ provision/relay API already built IS the product surface; adapters are
the only new code. Inference location becomes the user's choice by
construction (`--infer` is whichever harness they plug in).

## Workstream 1 — exec sandbox backend (in progress)

New minimal image, built with the `packages/sandbox/scripts/image`
pipeline (lives in this repo; same mechanics as wayfind-cloud's computer
pipeline: `01-package-upload → 02-create-image`), different
Dockerfile, registered as a second ARN (teammate image untouched).

**Image contents (`wayfind-sandbox`):**
- Small Linux + node + python runtimes only. No agent loop, no skills,
  no MCP, no provider keys, no credentials of any kind.
- One tiny exec agent (plain `node:http`, port 8080): `GET /health`,
  `POST /exec {cmd, cwd, timeoutMs}` → `{stdout, stderr, exit}`,
  `POST /read|/write|/glob|/grep`, `POST /sync/in {tar}` (workspace in),
  `GET /sync/out` (diff tar out). Same 6-tool surface as near-red's
  bridge, transported over the existing relay instead of `mvmctl exec`.
- Auth: per-session bearer minted at provision (same `usageToken` shape),
  required on every exec-agent route.

**wayfind-api additions** (beside `/computer/*`, same handler patterns —
already implemented, uncommitted in wayfind-cloud):
- `POST /sandbox/provision {idleTtlSeconds?}` → RunMicrovm (new image ARN)
  → wait RUNNING → mint session bearer → `POST /hooks/run` → smoke
  `POST /exec {cmd:"true"}` → return `{sandboxId, endpoint, sessionToken}`.
  Disposable: no suspend/resume, short idle TTL, hard 8h cap.
- `POST /sandbox/terminate {sandboxId, sessionToken}` — proof-of-holdership
  kill (agent re-verifies the bearer before terminating).
- `ANY /sandbox/proxy/*` — relay with per-call VM token; user identity in
  `Authorization`, session capability in `X-Sandbox-Id/X-Sandbox-Token`.
- Sandbox wall-clock recorded (provision → terminate) → CreditLedger
  `sandbox usage` deltas (metering workstream, server-side only).

Exit: image builds, provision/proxy/terminate verified live against AWS.

## Workstream 2 — CLI as the interface (humans and Claude alike)

No plugin, no MCP configuration. The harness question is settled by
making the CLI so lean that Claude Code just runs it:
`wayfind run "..."` provisions (or reuses), pushes the snapshot, execs,
pulls the diff, terminates. A Claude Code user points the agent at the
workspace and tells it to use the CLI — zero MCP JSON, zero extra
config, nothing to learn. MCP requires per-harness setup that normal
users will not do; a CLI command is universal.

- **Thin CLI `run`.** One-shot provision → push snapshot → `exec` →
  pull diff → terminate, plus `export`/`status`/`stop` wrappers.
  No turn loop, no MCP client.
- The in-sandbox `POST /mcp` endpoint stays in the image as an available
  transport (built, verified, zero maintenance), but it is NOT the
  product path — no adapters are built against it in P1.

Exit: anyone (human or Claude Code) runs disposable-sandbox commands
through one CLI, no configuration beyond `wayfind login`.

**SandboxSession rows (required for session reuse).**
`{ownerId, sandboxId, sessionTokenHash?, provisionedAt}` — owner-scoped,
function + owner-read (CreditLedger shape). Lets `run` reuse a warm
session instead of booting per invocation, powers `status`, and gives
metering exact wall-clock. Provision creates it, terminate/proxy-heal
updates it, idle TTL sweeps it.

## Workstream 3 — dashboard D1 (parallel with 1)

Serve `v1/frontend` from the CLI (`npm start`). Same UI, new data source.

- **Bots stay visible, unchanged.** Roster sidebar, bot panels, DM panel,
  composer/thread — reused as-is as the "Teammates" view. API swap only:
  v1 daemon endpoints → CLI API (`/api/sessions`, `/api/export`,
  `/api/auth/me`). The teammate view talks to the user's harness through
  the sandbox backend — history alongside the workspace, not a P2P store.
- **Sandbox configuration lives in Settings → new "Sandbox" tab**
  (not scattered per-bot): image, cpu/mem, egress allowlist presets,
  workspace folder, idle TTL. Per-session overrides in flags
  (`--cpus`, `--memory`, `--allow`, `--ttl`).
- **Session surface in the console shell:** status (provisioning/running/
  terminated), wall-clock + cost so far (from CreditLedger), Export
  button, receipt view (`receipt.json`), kill switch.

## Workstream 4 — harden the boundary (do second)

- **Egress allowlist on provision.** Port near-red's `network.rs` policy
  core: default-deny, per-session allowlist, resolved-IP pinning, audit
  log. The new minimal image starts closed; presets open package
  registries only.
- **Hostile-tar validation on export.** Reject symlinks/`..`/devices/
  absolute paths, extract to `.partial` then rename, entry-count and size
  caps (near-red `untar.rs` pattern).
- **CliToken rotation.** New login rotates previous tokens for the same
  deviceName; 90d TTL already enforced server-side.

## Workstream 5 — billing gate (decide: now or enterprise)

- Minimum viable: **soft warning** — `run` prints CreditLedger balance
  before executing (read-only).
- Hard gate: `provision`/`run` refuse when balance ≤ 0 (plan-aware).
- Full charging (Stripe, credit packs) stays enterprise (PIVOT.md §11).

Recommendation: soft warning ships with workstream 1 (ledger reads
already exist); hard gate when abuse or a paying user forces it.

## Workstream 6 (optional pull-forward) — attestation receipts

`export` writes `receipt.json` beside files (session id, image digest,
inference endpoint identity, egress audit lines, tool transcript hash).
Unsigned in P1; TDX quotes + signed inference receipts land with the NEAR
attestation work later. Verifiable from day one, crypto added without
format churn.

## Build order

1. New `wayfind-sandbox` image via `packages/sandbox/scripts/image`;
   ARN registered as `EXEC_IMAGE_ARN` (teammate image untouched).
2. `/sandbox/provision` + `/sandbox/proxy/*` + `/sandbox/terminate` in
   wayfind-api (done, uncommitted); server-side wall-clock metering to
   CreditLedger.
3. In-sandbox MCP → opencode plugin → thin CLI `run`/`export`/
   `status`/`stop` (snapshot sync + hash skip).
4. Dashboard D1 repoint (Sandbox settings tab + session shell); soft
   balance warning; export receipt.
5. Egress allowlist → export validation → token rotation.
6. E2E: clean machine → login → MCP tool call in Claude Code → export →
   stop → logout.

## Deferred (not P1)

Local turn loop / inference of our own (no-harness decision — the user
brings opencode/Claude), interactive chat REPL, local microVM drivers
(`--local`, PIVOT.md P2), SSO/SAML, BYOC, DLP/retention, Stripe, live
mounts (rejected).

## Deferred option — Wayfind-hosted keyless runs

`--infer sandbox` (later): our keys, injected per-boot, inference metered
by us through the same CreditLedger (teammate/org model — the user runs
keyless, we bill tokens + sandbox together). wayfind-cloud's agent server
+ `spendUsd` reporter already implement this half; it becomes a second,
disposable image when keyless operation is needed. Inference location is
otherwise the harness's choice by construction.

## Known anomaly (carried from P0, resolve before E2E)

One anomaly to be honest about: the server-side revoke returned
`unknown CLI token`, even though `/auth/me` accepted that same token
minutes earlier. Local logout still worked (fail-safe clears creds), but
the server row may not be revoked. After re-login, trace a direct
`POST /auth/revoke` call to see whether it reproduces — possibly a
lookup bug in the revoke path (it uses `CliToken.get({id})` while
verification uses the `cliTokenByTokenHash` GSI; if the row write and
the GSI read diverge, or the id passed is stale, revoke fails while
auth keeps working).
