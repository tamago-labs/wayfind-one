# Wayfind ONE

**One team. Your computers. One private AI workspace.**

Wayfind ONE is a peer-to-peer AI workspace for teams that need control over their data and AI workflows. Run isolated AI bot tasks across trusted team-owned computers, synchronize encrypted workspaces directly between teammates, and use NEAR AI Cloud for verifiable confidential inference.

- **Distributed execution:** any eligible online team machine can execute bot tasks (v1: the bot owner's machine).
- **Private conversations:** personal bot conversations stay private unless explicitly shared.
- **Encrypted P2P collaboration:** synchronize team workspaces with no central server storing plaintext team data.
- **Isolated execution:** bots run in Docker sandboxes, with optional Firecracker isolation on supported Linux machines.
- **Confidential AI:** connect to NEAR AI Cloud and verify supported inference environments.

Your team controls where work executes and who can access it.

---

## Contents

1. [Why Wayfind ONE](#why-wayfind-one)
2. [Privacy model (read this first)](#privacy-model-read-this-first)
3. [Architecture](#architecture)
4. [Quick start](#quick-start)
5. [CLI reference](#cli-reference)
6. [Core concepts](#core-concepts)
7. [Components in detail](#components-in-detail)
8. [Policy file](#policy-file)
9. [Threat model](#threat-model)
10. [Development guide](#development-guide)
11. [Wayfind ONE vs NEAR RED sandbox](#wayfind-one-vs-near-red-sandbox)
12. [Roadmap](#roadmap)
13. [Limitations](#limitations)

---

## Why Wayfind ONE

AI teammates are useful because they touch real data: invoices, bank exports, contracts, customer lists. Hosted agent platforms ask you to upload all of it to someone else's server. Many companies cannot do that.

Wayfind ONE keeps the data with the team. The core tension it resolves: coordinating shared work **without** turning every teammate's machine into an unrestricted reader of everyone else's data.

| | Wayfind Cloud | **Wayfind ONE** |
|---|---|---|
| Where bots run | Hosted cloud computer (MicroVMs on AWS) | **Your team's own machines** (Docker sandboxes) |
| How the team shares work | Through our servers | **Encrypted P2P, no central server** |
| Where inference runs | Open-weight models on our infrastructure | **Your choice of OpenAI-compatible provider** (Meta default; attestation verification planned) |
| Always on | Yes | Only while a node is online (run a headless node for 24/7) |
| Best for | Small businesses wanting convenience | **Teams with sensitive data** |

## Privacy model (read this first)

We make a precise claim, not a magical one. The workspace has four data domains:

| Data domain | Who sees it |
|---|---|
| Team workspace | Authorized team members (versioned team keys) |
| Roster + group chat | Authorized team members (metadata only — IDs, names, capabilities, never prompts or secrets) |
| Bot definitions + owner conversations | Conversation/bot owner only |
| Task inputs | Sender + executor only, scoped to that task, short-lived |

**Rules**

- Private by default: a member must explicitly share a conversation or grant a bot's execution policy before another node sees their data.
- No single permanent team key: keys are versioned and member-scoped from the start; removing a member rotates keys and revokes future access.
- Revocation cannot erase files or plaintext a member already copied. We state this honestly.
- An authorized executor necessarily processes the plaintext it needs, at least temporarily — private-by-default controls *who may become* an executor, not physics.
- Inference goes to your configured OpenAI-compatible provider (Meta default) over HTTPS. Attestation verification is planned, not built — today you trust the provider's transport the way any API client does.
- API keys and other secrets live in the host process. **Sandboxes never see them.**

**What is NOT protected**
- The sandbox runs on a teammate's laptop or server. It is **not** a TEE. Someone with root on that machine can read its memory.
- You still trust the hardware vendors (Intel, NVIDIA) and the attestation chain.
- A TEE does not stop prompt injection. That is what the [policy engine](#policy-file) and approvals are for.
- P2P availability: a task cannot run if no node that can run it is online.

## Architecture

> Target architecture. **Built today:** daemon, P2P swarm (discovery + invites), shared team store (members/invites/provider config+keys/bot roster ads), owner-private bots + chat UI with tool execution, Docker computer (auto-start, network on), inference via OpenAI-compatible providers (Meta default), team group chat + sealed DMs with shared bots (mention auto-replies). **Planned:** policy engine + approvals, attestation verification, task claims (only if needed).

```
 Teammate A (laptop)                              Teammate B (laptop / VPS)
┌──────────────────────────────┐                ┌──────────────────────────────┐
│ wayfind-one daemon           │                │ wayfind-one daemon           │
│  ├─ Web UI  (localhost)      │                │  ├─ Web UI  (localhost)      │
│  ├─ My bots (owner-private)  │                │  ├─ My bots (owner-private)  │
│  ├─ Inference (host-direct)  │                │  ├─ Inference (host-direct)  │
│  ├─ Docker computer (/work)  │                │  ├─ Docker computer (/work)  │
│  ├─ Team store (Hyperbee)    │◄── HyperDHT ──►│  ├─ Team store (Hyperbee)    │
│  ├─ Task coordinator + claims│  encrypted P2P │  ├─ Task coordinator + claims│
│  ├─ Policy engine + approvals│                │  ├─ Policy engine + approvals│
│  └─ Group chat + DMs ────────┼── roster ─────►│  └─ Group chat + DMs ────────│
└───────────────┬──────────────┘                └──────────────┬───────────────┘
                │  HTTPS                                       │
                ▼                                              ▼
         OpenAI-compatible provider (Meta default)
```

| Layer | Technology | Responsibility |
|---|---|---|
| CLI | Node.js | Initialization, joining, management |
| Local daemon | Express | Local API, lifecycle, orchestration |
| UI | React + Vite + Tailwind | Team and bot interface |
| P2P connections | Hyperswarm | Encrypted peer connections |
| Event storage | Hypercore | Append-only replicated events |
| Multiwriter coordination | Autobase | Shared task and team state |
| Structured views | Hyperbee | Queryable state |
| File replication | Hyperdrive / Hypercore | Workspace file synchronization |
| Sandbox | Docker, own Ubuntu image | Per-node bot computer, network on, keys never inside |
| AI inference | OpenAI-compatible providers (Meta default) | Host-direct via Agents SDK; attestation planned |
| Attestation | Official SDK verification | Planned (`verify` command) |

**Rules of the design:**
- Bots are **owned, not shared**: definitions, prompts and memory never leave the owner's machine. The team shares only the **roster** (bot IDs, names, owner, capabilities).
- A group-chat mention or DM **routes to the owner node**, which executes and replies. v1 executes on the owner machine only; delegation to trusted nodes is a later, per-bot grant.
- The sandbox receives raw shell strings only. Keys live in the host daemon (env > shared store) and never enter the container; inference is host-direct, so there is no proxy hop to build.

## Quick start

**Requirements:** Node.js 20+.

**For judges — one command, then the UI walks you through the rest**

```bash
node bin/wayfind-one.js
```

The daemon boots and serves the UI at `http://localhost:7777`. If no team exists yet, the setup screen creates one (or picks an existing team on the machine) — no terminal commands needed. Everything else happens on the website: team status, peers, and (as they land) tasks, bots and approvals.

**Manual path** (exactly what the launcher does under the hood)

```bash
# 1. Start your first node and create a team
npx wayfind-one init --team "Acme Finance"

# 2. Run the daemon and open the web UI
npx wayfind-one up
# -> http://localhost:7777

# 3. Invite a teammate (prints a one-time invite code)
npx wayfind-one invite

# 4. On the teammate's machine
npx wayfind-one join <invite-code>
npx wayfind-one up
```

## CLI reference

*(planned surface, keep it small)*

| Command | What it does |
|---|---|
| `wayfind-one [--port 7777]` | Start daemon + serve UI (active team, or the setup screen when none exists) |
| `wayfind-one init --team <name>` | Create node identity, team key and local store |
| `wayfind-one up [--port 7777]` | Start daemon, web UI and P2P |
| `wayfind-one invite` | Create a one-time invite code |
| `wayfind-one join <code>` | Join a team from an invite |
| `wayfind-one demo` | Interactive launcher: start or join a team, then open the web UI *(planned)* |
| `wayfind-one bot create <name> --role <role>` | Create a bot on this machine (owner-private) *(planned)* |
| `wayfind-one verify` | NEAR AI attestation check *(planned)* |
| `wayfind-one doctor` | Connectivity diagnostics *(planned)* |

## Core concepts

| Concept | Meaning |
|---|---|
| **Team** (built) | A set of members sharing one encrypted store, identified by a team key |
| **Node** (built) | One running daemon on one machine. Has its own identity key |
| **Invite** (built) | A one-time code carrying the team secrets; spent on first redeem |
| **Bot** (built) | An AI teammate: role prompt, thread, allowed tools. **Owned, not shared** — lives only on the owner's machine; UI: sidebar, chat, settings panel |
| **Provider** (built) | An OpenAI-compatible inference endpoint (Meta default). Selection + shared keys replicate; keys never enter Docker |
| **Roster** (built) | Shared directory of member IDs + display names. Bot roster entries planned with group chat |
| **Group chat** (planned) | Team-visible channel; @-mentioning a bot routes the task to its owner |
| **DM** (planned) | Member-to-bot task; visible to sender + executing owner only |
| **Sandbox** (built) | This node's Docker computer: Ubuntu + python3/curl/git, workspace at `/work`, network on, keys never inside |
| **Task** (deferred) | Only if a real double-work problem shows up |
| **Claim** (deferred) | Same — leases/fencing wait for multi-actor execution |
| **Policy** (planned) | Rules for spending, tools, egress and approvals |
| **Approval** (planned) | A teammate's sign-off required before a sensitive action |

## Components in detail

### 1. P2P layer and team store

Stack (Holepunch): **Hyperswarm / HyperDHT** for peer discovery and encrypted connections, **Hypercore + Autobase** for multi-writer append-only logs, **Hyperbee** for key-value views.

> Built: control swarm + single-use invite redeem. Next on this stack: shared team store, then task claims.

> Verify current APIs against the Holepunch docs before coding. This README describes intent, not exact calls.

Suggested key layout in the shared store:

```
team/meta                  team name, created-at, policy version
members/<nodeId>           public key, display name, role, status
roster/<botId>             display name, owner nodeId, capabilities (metadata only)
tasks/<taskId>             bot, status, created-by, encrypted payload ref
claims/<taskId>            executionId, fencing generation, lease-expires-at
approvals/<approvalId>     task, action, requested-by, decisions[]
audit/<seq>                append-only event log
policy                     team policy (versioned)
```

**Bot definitions are NOT in the shared store.** Prompts, memory and secrets stay on the owner's machine; only the roster entry replicates.

**Encryption.** Transport is already encrypted by HyperDHT. In addition, encrypt every stored value with the team key (for example XChaCha20-Poly1305 via libsodium) so a stray peer or backup never holds plaintext.

**Invites.** An invite is a one-time code carrying the team secrets. The joiner derives the swarm topic, finds the inviter over the DHT, and redeems the code — the inviter's local ledger marks the nonce spent on first use. The inviter must be online when redeemed.

**Task claiming (no double runs).**
1. A member mentions a roster bot (group chat) or DMs it: a task record with unique task ID, bot ID, owner, execution requirements and encrypted payload enters the shared queue.
2. The owner node checks eligibility (allowed to run that bot, has resources, can access the authorized data) and appends `claims/<taskId>` with an execution ID, fencing generation and lease (e.g. 60 s).
3. After Autobase orders writes, deterministic conflict resolution picks the winner; losers back off. Stale workers with old fencing generations cannot continue as valid owners.
4. The winner runs the bot in a sandbox with only the task-authorized data, calls NEAR AI through the local inference proxy, and replicates the encrypted result. External side effects use idempotency keys; sensitive actions require approval.
5. Leases renew on heartbeat; on expiry or disconnect another eligible node may claim (v1: the owner's other devices; delegation to trusted nodes later, per-bot grant).

**Known gap:** removing a member means rotating the team key and re-encrypting. Tracked in the [roadmap](#roadmap); stated plainly.

### 2. Sandbox runner (built)

- **Default:** Docker, one persistent container per node (`wayfind-<node12>`), CPU/memory limits, workspace mount at `/work`.
- **Image:** our own (`docker/Dockerfile`, built once on first activation): Ubuntu + python3 + curl + git. Minimal bases were rejected — agents need the tools they reach for.
- **Network: ON (bridge).** Unlike offline-analysis sandboxes, our tools legitimately need egress (package installs, API calls, git). Host isolation comes from namespaces + mounts (only the workspace is shared), not from blocking the network. `WAYFIND_NO_NETWORK=1` restores `--network none`. Containers created under the old default are auto-rebuilt on next boot.
- **Keys never enter the container.** The agent loop runs in the host daemon, which already holds credentials legitimately — there is no credential proxy because there is nothing to proxy across.
- **Not yet:** non-root user, read-only root filesystem, per-task containers (one persistent container per node for now).
- **Optional (Linux with KVM):** Firecracker for stronger isolation. Not required for the hackathon.
- **Files:** the team's workspace directory is mounted at `/work`; teammates each have their own.

### 3. Inference (built: host-direct, no proxy hop)

Runs in the host daemon via `@openai/agents` (cloud parity). There is no sandbox→proxy hop because the agent loop itself runs at the host, which already holds credentials legitimately — the sandbox only ever receives raw shell strings.

- OpenAI-compatible providers from `providers.json`: **Meta Model API** (`https://api.meta.ai/v1`, `MODEL_API_KEY`, default — Muse Spark standard + contributor models in a grouped dropdown), NEAR AI, OpenAI, Local (Ollama-compatible, just another entry). UI: Settings → AI tab (provider dropdown, model dropdown/custom name, key field, Test button).
- Keys resolve env > shared store > catalog default. Provider+model selection and team-shared keys replicate in the team store (write-only via API; rotation on membership change). Keys never enter Docker.
- Tool use: `shell` (Docker), `read`/`write`/`list` (host workspace, path-contained), doom-loop guard at 3 repeats.
- **Not yet:** attestation verification (`verify` command), response-signature checks, verified badge. The NEAR endpoint in the catalog (`https://api.near.ai/v1`) is unverified — override in `<home>/providers.json` if wrong.

**Verification flow**

1. Generate a random nonce.
2. Request the attestation report: `GET /v1/attestation/report?signing_algo=ecdsa&nonce=<nonce>`.
3. Verify the **GPU evidence** (`nvidia_payload`) with NVIDIA's Remote Attestation Service (NRAS).
4. Verify the **Intel TDX quote** (`intel_quote`) and check that the report data includes your nonce and the signing address.
5. Verify **response signatures** against the attested signing address.
6. For the strongest check, enable **TLS attestation** so the connection's certificate is bound to the attested TEE.
7. Show the result in the UI as a verified badge, with details on click.

Reference implementations to study and reuse (check their licenses):
- <https://github.com/near-examples/nearai-cloud-verification-example>
- <https://github.com/nearai/nearai-cloud-verifier>
- Docs: <https://docs.near.ai/cloud/verification>

**Hardening to consider:** pin the expected measurements (for example the approved compose hash or workload identity) so you accept only the legitimate model deployment, not just *a* genuine TEE.

### 4. Policy engine and approvals

Every tool call a bot makes passes the policy engine first. Sensitive actions create an **approval request** in the shared store. Teammates approve or reject in the UI. See the [policy file](#policy-file).

### 5. Web UI

Served by the daemon on localhost. Built: **Team** (members, online status, peers), **Team chat** (floating button: group thread with participant strip + DMs tab, sealed indicator, unread badges), **Bots** (owner-local rows, share-to-team toggle).

### 6. Team chat (built: group + DMs, host-to-host)

- **Sharing is opt-in per bot.** A "Share to team" toggle publishes a roster ad (`bots/<botId>`: pubkey + metadata, never secrets) to the shared store; unsharing withdraws it. Only the owner node can publish/withdraw its bots' ads (owner-signed, like members).
- **One swarm per daemon.** Bots never join the swarm — they are addressed (`botId → ownerNodeId` via the ad), and owner daemons multiplex envelopes over their own connection. Bot availability = owner availability; messaging an offline owner's bot fails fast.
- **Two topics, not one.** Control/chat messages (JSON lines) and corestore replication (binary frames) must never share a Noise connection — they corrupt each other. Chat runs on the team topic; store replication on a derived store topic (sha256 of the team topic). The daemon also polls `base.update()` every 5s while active so the view keeps advancing after writer onboarding.
- **Envelopes, signed.** Group messages fan out to all peers; DMs route to the recipient owner's connection with a delivery receipt (8s timeout). Human senders authenticate with keet device attestations, bots with per-bot ed25519 keys (generated at creation, secret never leaves the owner disk). Receivers verify against the members table / roster ads before delivery; bad signatures and unknown senders are dropped.
- **DMs are sealed when possible.** Each node and each bot holds an x25519 key (pubkey in the member row / bot ad). Senders seal the payload with static ECDH + AES-GCM and include their own pubkey; the envelope shows a lock in the UI. Without the recipient's pubkey the message still sends transport-only (Noise + topic-gated), flagged `sealed:false`. DM threads live only on the two endpoints' disks — never in the shared store — so no separate history sync is needed: both sides store at delivery.
- **Bots answer.** Shared bots auto-reply when @-mentioned in group (45s cooldown per bot, no two-in-a-row, never answers its own echoes) and when DM'd by a human (20s cooldown). Bot-to-bot DMs are stored, never auto-answered (loop guard by construction). Replies run the normal agent turn, so tool use works in chat.
- Late-join catch-up: empty group pulls the last 50 messages from the first peer that says hello (plus retries at 2s/10s/30s after boot for the discovery race).

## Policy file

`policy.yaml`, stored in the shared team store and versioned. Execution policy and conversation visibility are separate: a bot can be executable by trusted nodes without exposing its owner's history.

```yaml
version: 1

defaults:
  filesystem: deny
  network: deny
  unknown_tools: deny

bots:
  finance:
    execution:
      allowed_nodes: ["owner-devices"]   # later: + "trusted-team-nodes" per-bot grant
      delegation: []                      # planned extension point

    files:
      read:
        - "finance/invoices/**"
        - "finance/receipts/**"
      write:
        - "finance/reports/**"

    tools:
      allow:
        - read_file
        - write_file
        - search

    network:
      allow:
        - near-ai

    approvals:
      require_for:
        - send_email
        - delete_file
```

The runtime enforces permissions independently of model instructions. Illustrative format — enforcement implementation comes with the sandbox + policy engine.

## Threat model

| Threat | Mitigation | Remaining risk | Status |
|---|---|---|---|
| Central server compromise | There is no central server | None for this layer | ✅ built |
| Network eavesdropping | HyperDHT encrypted channels | Metadata (who connects to whom) | ✅ built |
| Inference provider sees prompts | TEE inference with verified attestation | Trust in Intel/NVIDIA hardware | 🔶 planned (no proxy yet) |
| Prompt injection makes a bot leak or spend | No secrets in sandbox, egress allow-list, approvals, spend limits | A bot can still be tricked inside its allowed scope | 🔶 planned |
| Malicious tool or code in sandbox | Container isolation, no direct internet, resource limits | Container escape (use Firecracker for more) | 🔶 planned |
| Stolen laptop of a teammate | Local store encryption, team key rotation | Neither built yet — plaintext store on disk today | 🔶 gap |
| Removed member keeps old key | Key rotation | Real gap today | 🔶 roadmap |
| Two nodes run the same task | Claims with leases, fencing, idempotency | Duplicates possible — no exactly-once; approvals gate sensitive actions | 🔶 planned |
| Bot impersonation in group chat | Bot IDs bound to owner identity keys | Spoofed roster entries rejected on signature | 🔶 planned |
| DM spam to someone's bot | Owner revokes a member's access to that bot | Per-bot block list, enforced by owner node | 🔶 planned |
| Roster leaks bot capabilities | Roster carries metadata only, never prompts/secrets | Capability names still visible to all members | 🔶 planned |

## Development guide

**Stack (what this repo actually uses)**
- JavaScript on Node.js 20+
- `hyperswarm`, `hypercore-crypto`, `keet-identity-key`, `z32` for P2P + identity
- `express` for the daemon API, Vite + React + Tailwind for the UI
- `oxlint` for linting (`npm run lint`)
- Next up on this stack: `hypercore` task logs, then `autobase` + `hyperbee` for claims and the team store

**Repo layout**

```
wayfind-one/
├─ package.json
├─ bin/wayfind-one.js
├─ src/
│  ├─ cli.js            # commands: init, up, invite, join (+ bot, verify, doctor, demo placeholders)
│  ├─ commands/         # one file per command
│  ├─ p2p/              # identity, swarm, invites
│  └─ daemon/           # express server, lifecycle
├─ frontend/            # Vite + React UI (landing, /app, /docs)
└─ docs/                # PLAN.md (this file)
```

**Local development**

```bash
git clone <this-repo>
cd wayfind-one
npm install
node bin/wayfind-one.js init --team "Acme Finance"
WAYFIND_HOME=.node-a node bin/wayfind-one.js up --port 7777
npm run lint
npm run build --prefix frontend
```

**Testing P2P on one machine:** run two nodes with different data directories and ports.

```bash
WAYFIND_HOME=.node-a npx wayfind-one up --port 7777
WAYFIND_HOME=.node-b npx wayfind-one up --port 7778
```

**Principles**
- Keep one working path end to end before adding features.
- Every feature that touches privacy gets a line in the threat model.
- Never log prompts, secrets or file contents by default. Log metadata only.
- Default to safe: attestation required, egress closed, approvals on.
- Keep the inference proxy a pure inference path — never a general tool gateway.

## Wayfind ONE vs NEAR RED sandbox

NEAR AI Red (`nearai-red-sandbox`) is the closest reference design: disposable microVMs, host-held credentials, offline-by-default guests. We borrow its shape but differ where our goals differ — RED is built for *analyzing* untrusted code; ONE is built for *working* with an agent.

| | NEAR RED sandbox | Wayfind ONE computer |
|---|---|---|
| Goal | Security research on untrusted code (inspect, reproduce, report) | Daily agentic work (files, shell, packages, APIs) |
| Guest tech | Linux microVM via Apple virtualization (`mvm`) | Docker container, own Ubuntu image |
| Platform | macOS on Apple Silicon only | Any OS with Docker (built on Windows) |
| Agent location | **Inside** the guest | **At the host** (daemon); guest gets shell strings only |
| Network default | Off; allowlisted hosts/ports per launch | **On** (bridge); tools need egress. `WAYFIND_NO_NETWORK=1` restores off |
| Credential handling | Host-side inference proxy; guest never sees keys | Same guarantee, no proxy needed: keys live in the daemon and the guest is unreachable to them |
| Inference path | Guest → host proxy (attested TLS, signed receipts) → NEAR AI Cloud | Daemon → provider HTTPS directly (`@openai/agents`) |
| Attestation | Verified before launch + per inference | Planned (`verify` command) |
| Persistence | Disposable: `/out` exported, VM destroyed | Persistent per node: workspace + thread survive restarts |
| Workspace sharing | Copied in per session, exported at end | Mounted live at `/work`; P2P sync is future work |
| Lifecycle | Per session (`rts`), records kept for review | Auto-start with daemon, recreated on image/network change |

Takeaway: RED's proxy exists because its agent runs *inside* the untrusted guest. Ours doesn't, so host-direct inference satisfies the same "keys never enter the sandbox" rule with one less hop. What we still owe RED: attestation verification and an egress allowlist if tools ever need constraining.

## Roadmap

### Phase 1 — Working foundation (built)
- CLI initialization and local daemon
- Team identity and invite/join flow
- P2P peer discovery and encrypted connections
- Team page with peers + presence

### Phase 2 — Distributed execution
- Hypercore event storage + Autobase team coordination (shared roster, task queue)
- Owner-local bots + sandbox runner (Docker)
- Inference v1 (built): OpenAI-compatible providers via @openai/agents, `providers.json` catalog, provider+model selection + shared keys replicated in the team store, keys never enter Docker. Local models are just another catalog entry.
- Group chat + DMs routed to owner nodes (built — see §6; needs the agent loop first was the blocker, now done)
- Task claiming: execution IDs, leases, fencing, idempotency, recovery after disconnect (deferred — only if a real double-work problem shows up)

### Phase 3 — Private AI
- Attestation verification (`verify` command), response-signature checks, verified badge
- Egress allowlist for the computer (scoped network policy per team)
- Private conversation encryption + task-specific context access

### Phase 4 — Team experience
- Bot creation and management UI
- Member and device management, permission + approval interface
- Workspace file synchronization (Hyperdrive/Hypercore)
- Optional relay connectivity, `doctor`

### Phase 5 — Hardening
- Member removal and key rotation, audit events
- Firecracker on Linux/KVM, security testing
- Per-bot delegation to trusted team nodes

**Acceptance test (two machines):** A creates a team + bot → B joins via invite → A submits a task → B DMs A's bot (or @-mentions it) → owner node executes in a sandbox → result syncs back → A's private history stays invisible to B → inference verified through NEAR AI.

## Limitations

- Connectivity: DHT discovery can take ~10–60 s; strict NATs may need the planned relay. Chat catch-up retries at 2s/10s/30s to cover the discovery race.
- Messaging an offline owner's bot (or offline member) fails fast — no store-and-forward yet.
- Unverified senders are dropped silently (bad signature, withdrawn ad, unknown member).
- Execution trust: the owner machine sees task inputs; a compromised owner host breaks that bot's privacy.
- Revocation: removing a member rotates keys but cannot erase already-copied data.
- No exactly-once execution: partitions or crashes can duplicate attempts — idempotency keys + approvals mitigate, not eliminate.
- Sandboxes are containers, not TEEs: root on the host can read sandbox memory.
- Shared provider keys replicate to every member device in plaintext inside the team log: anyone who ever joins keeps a copy. Rotate via `POST /api/providers/keys` on membership change; members can override with their own key via env.

## License

Apache-2.0 (see `package.json`).

## Links

- NEAR HACKATHON: <https://nearhackathon.com/>
- NEAR AI Cloud docs: <https://docs.near.ai/cloud/introduction>
- Wayfind Cloud: <https://www.wayfind.click/>