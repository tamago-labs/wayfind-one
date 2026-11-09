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
11. [Roadmap](#roadmap)
12. [Limitations](#limitations)

---

## Why Wayfind ONE

AI teammates are useful because they touch real data: invoices, bank exports, contracts, customer lists. Hosted agent platforms ask you to upload all of it to someone else's server. Many companies cannot do that.

Wayfind ONE keeps the data with the team. The core tension it resolves: coordinating shared work **without** turning every teammate's machine into an unrestricted reader of everyone else's data.

| | Wayfind Cloud | **Wayfind ONE** |
|---|---|---|
| Where bots run | Hosted cloud computer (MicroVMs on AWS) | **Your team's own machines** (Docker sandboxes) |
| How the team shares work | Through our servers | **Encrypted P2P, no central server** |
| Where inference runs | Open-weight models on our infrastructure | **NEAR AI Cloud, inside attested TEEs** |
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
- The only network call that leaves your machines for AI is **inference to NEAR AI Cloud**, where models run in Intel TDX confidential VMs with NVIDIA TEE GPUs. Wayfind ONE **verifies the attestation** and response signatures before trusting a reply.
- API keys and other secrets live in the host process. **Sandboxes never see them.**

**What is NOT protected**
- The sandbox runs on a teammate's laptop or server. It is **not** a TEE. Someone with root on that machine can read its memory.
- You still trust the hardware vendors (Intel, NVIDIA) and the attestation chain.
- A TEE does not stop prompt injection. That is what the [policy engine](#policy-file) and approvals are for.
- P2P availability: a task cannot run if no node that can run it is online.

## Architecture

> Target architecture. **Built today:** daemon, P2P swarm (discovery + invites), web UI shell + Team page. **Planned:** team store, claims, policy engine, sandbox runner, inference proxy.

```
 Teammate A (laptop)                              Teammate B (laptop / VPS)
┌──────────────────────────────┐                ┌──────────────────────────────┐
│ wayfind-one daemon           │                │ wayfind-one daemon           │
│  ├─ Web UI  (localhost)      │                │  ├─ Web UI  (localhost)      │
│  ├─ My bots (owner-private)  │                │  ├─ My bots (owner-private)  │
│  │    └─ bot sandbox ─┐      │                │  │    └─ bot sandbox ─┐      │
│  └─ Inference proxy ◄─┘      │                │  └─ Inference proxy ◄─┘      │
│  ├─ Team store (Hyperbee)    │◄── HyperDHT ──►│  ├─ Team store (Hyperbee)    │
│  ├─ Task coordinator + claims│  encrypted P2P │  ├─ Task coordinator + claims│
│  ├─ Policy engine + approvals│                │  ├─ Policy engine + approvals│
│  └─ Group chat + DMs ────────┼── roster ─────►│  └─ Group chat + DMs ────────│
└───────────────┬──────────────┘                └──────────────┬───────────────┘
                │  HTTPS + attestation verified                │
                ▼                                              ▼
        NEAR AI Cloud (TEE inference, signed responses)
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
| Sandbox | Docker (Firecracker optional) | Isolated bot execution |
| AI inference | NEAR AI Cloud | Confidential remote inference |
| Attestation | Official NEAR AI SDK | Verify model/runtime claims |

**Rules of the design:**
- Bots are **owned, not shared**: definitions, prompts and memory never leave the owner's machine. The team shares only the **roster** (bot IDs, names, owner, capabilities).
- A group-chat mention or DM **routes to the owner node**, which executes and replies. v1 executes on the owner machine only; delegation to trusted nodes is a later, per-bot grant.
- The sandbox can only talk to the inference proxy on the host. The proxy holds the key, checks attestation, applies policy, and logs every call. It is not a general tool gateway.

## Quick start

**Requirements:** Node.js 20+.

**For judges — one command, launcher walks you through the rest**

```bash
npx wayfind-one demo
```

The launcher asks a single question — **start a team** (you pick the team name) or **join a team** (you paste an invite code) — then runs the daemon and opens the web UI at `http://localhost:7777`. Everything else happens on the website: team status, peers, and (as they land) tasks, bots and approvals.

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
| **Bot** (planned) | An AI teammate: role prompt, memory, allowed tools, policy. **Owned, not shared** — lives only on the owner's machine |
| **Roster** (planned) | Shared directory of member and bot IDs, display names, owners, capabilities. Metadata only |
| **Group chat** (planned) | Team-visible channel; @-mentioning a bot routes the task to its owner |
| **DM** (planned) | Member-to-bot task; visible to sender + executing owner only |
| **Sandbox** (planned) | A Docker container where a bot's tools and code run, with no direct internet |
| **Task** (planned) | A unit of work for a bot: unique IDs, encrypted payload, execution requirements |
| **Claim** (planned) | A node's execution record: execution ID, lease, fencing generation (no exactly-once — duplicates possible, side effects must be idempotent, sensitive actions need approval) |
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

### 2. Sandbox runner

- **Default:** Docker, one container per bot (or per task), non-root, read-only root filesystem, CPU/memory/time limits, a scratch volume.
- **Network:** no default route to the internet. The only reachable endpoint is the inference proxy on the host (via a dedicated Docker network and a per-sandbox token). Any other outbound access must be listed in policy and goes through the proxy.
- **Optional (Linux with KVM):** Firecracker for stronger isolation. Not required for the hackathon.
- **Files:** team files are mounted into the sandbox only for the task that needs them.

### 3. Inference proxy (the core privacy piece)

Runs on the host. The sandbox talks to it; it talks to NEAR AI Cloud.

- Uses the OpenAI-compatible API: base URL `https://cloud-api.near.ai/v1`. Where possible, use the **direct completions** endpoint of a model (for example `https://<model>.completions.near.ai`), which goes straight to the model's TEE with no gateway in the path.
- Holds the API key. The sandbox never receives it.
- **Verifies before trusting** (see below), and caches the verified state with an expiry.
- Applies policy (model allow-list, token limits) and writes an audit record for every call.
- Refuses to forward traffic if attestation fails.

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

Served by the daemon on localhost. Built: **Team** (members, online status, peers). Planned:

- **Group chat + DMs:** team channel, @-mentions routed to bot owners, member-to-bot DMs
- **Bots:** list roster bots, create owner-local bots, role and tools
- **Tasks:** create, status, who is running it
- **Approvals:** pending, approve/reject, history
- **Privacy:** attestation status, last verification time, "verify now" button, per-reply proof
- **Audit:** append-only log of calls, approvals and policy changes

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

## Roadmap

### Phase 1 — Working foundation (built)
- CLI initialization and local daemon
- Team identity and invite/join flow
- P2P peer discovery and encrypted connections
- Team page with peers + presence

### Phase 2 — Distributed execution
- Hypercore event storage + Autobase team coordination (shared roster, task queue)
- Owner-local bots + sandbox runner (Docker)
- Group chat + DMs routed to owner nodes
- Task claiming: execution IDs, leases, fencing, idempotency, recovery after disconnect

### Phase 3 — Private AI
- NEAR AI inference proxy (official SDK), model/response verification, verified badge
- Scoped sandbox-to-inference communication
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

- Connectivity: DHT discovery can take ~10–60 s; strict NATs may need the planned relay.
- Execution trust: the owner machine sees task inputs; a compromised owner host breaks that bot's privacy.
- Revocation: removing a member rotates keys but cannot erase already-copied data.
- No exactly-once execution: partitions or crashes can duplicate attempts — idempotency keys + approvals mitigate, not eliminate.
- Sandboxes are containers, not TEEs: root on the host can read sandbox memory.

## License

Apache-2.0 (see `package.json`).

## Links

- NEAR HACKATHON: <https://nearhackathon.com/>
- NEAR AI Cloud docs: <https://docs.near.ai/cloud/introduction>
- Wayfind Cloud: <https://www.wayfind.click/>