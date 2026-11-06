# Wayfind ONE

**One team. One private computer. One AI workspace. No central server.**

Wayfind ONE is a CLI for enterprises and teams that handle sensitive data. It spins up isolated sandbox computers on your own machines, lets your whole team share them over encrypted peer-to-peer sync, and sends AI inference only to **NEAR AI Cloud**, where it runs inside verified Trusted Execution Environments (TEEs).

> Built for **NEAR HACKATHON 2026** · Tracks: **Privacy & Private AI** + **AI Security & Defense**
> Status: hackathon prototype. Commands marked *(planned)* are not built yet. See [Roadmap](#roadmap).

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
11. [Build plan (6 to 14 Nov)](#build-plan-6-to-14-nov)
12. [Demo script](#demo-script)
13. [Submission checklist](#submission-checklist)
14. [Roadmap](#roadmap)
15. [Relationship to Wayfind Cloud](#relationship-to-wayfind-cloud)

---

## Why Wayfind ONE

AI teammates are useful because they touch real data: invoices, bank exports, contracts, customer lists. Hosted agent platforms ask you to upload all of it to someone else's server. Many companies cannot do that.

Wayfind ONE keeps the data with the team:

| | Wayfind Cloud | **Wayfind ONE** |
|---|---|---|
| Where bots run | Hosted cloud computer (MicroVMs on AWS) | **Your team's own machines** (Docker sandboxes) |
| How the team shares work | Through our servers | **Encrypted P2P, no central server** |
| Where inference runs | Open-weight models on our infrastructure | **NEAR AI Cloud, inside attested TEEs** |
| Always on | Yes | Only while a node is online (run a headless node for 24/7) |
| Best for | Small businesses wanting convenience | **Teams with sensitive data** |

## Privacy model (read this first)

We make a precise claim, not a magical one.

**What stays private**
- Team data, tasks, chat history and bot memory are **encrypted with a team key** and only synced between team members' machines.
- The only network call that leaves your machines for AI is **inference to NEAR AI Cloud**, where models run in Intel TDX confidential VMs with NVIDIA TEE GPUs.
- Wayfind ONE **verifies the attestation** and the response signatures before trusting a reply, and shows the result in the UI.
- API keys and other secrets live in the host process. **Sandboxes never see them.**

**What is NOT protected**
- The sandbox runs on a teammate's laptop or server. It is **not** a TEE. Someone with root on that machine can read its memory.
- You still trust the hardware vendors (Intel, NVIDIA) and the attestation chain.
- A TEE does not stop prompt injection. That is what the [policy engine](#policy-file) and approvals are for.
- P2P availability: a task cannot run if no node that can run it is online.

## Architecture

```
 Teammate A (laptop)                              Teammate B (laptop / VPS)
┌──────────────────────────────┐                ┌──────────────────────────────┐
│ wayfind-one daemon           │                │ wayfind-one daemon           │
│  ├─ Web UI  (localhost)      │                │  ├─ Web UI  (localhost)      │
│  ├─ Team store (Hyperbee)    │◄── HyperDHT ──►│  ├─ Team store (Hyperbee)    │
│  ├─ Task scheduler + claims  │  encrypted P2P │  ├─ Task scheduler + claims  │
│  ├─ Policy engine + approvals│                │  ├─ Policy engine + approvals│
│  ├─ Sandbox runner (Docker)  │                │  ├─ Sandbox runner (Docker)  │
│  │    └─ bot sandbox ─┐      │                │  │    └─ bot sandbox ─┐      │
│  └─ Inference proxy ◄─┘      │                │  └─ Inference proxy ◄─┘      │
└───────────────┬──────────────┘                └──────────────┬───────────────┘
                │  HTTPS + attestation verified                │
                ▼                                              ▼
        NEAR AI Cloud (TEE inference, signed responses)
```

**Rule of the design:** the sandbox can only talk to the inference proxy on the host. The proxy holds the key, checks attestation, applies policy, and logs every call.

## Quick start

> Target experience (one command, Docker default). *(planned)*

**Requirements**
- Node.js 20+
- Docker (Docker Desktop on macOS/Windows)
- A NEAR AI Cloud API key from <https://cloud.near.ai>

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

**Try it without any setup (demo mode, for reviewers)**
```bash
npx wayfind-one demo
```
Runs two simulated nodes on your machine, a sample bot task, an attestation check and an approval prompt. Uses a recorded NEAR AI response if no API key is present, clearly labelled as such in the UI.

## CLI reference

*(planned surface, keep it small)*

| Command | What it does |
|---|---|
| `wayfind-one init --team <name>` | Create node identity, team key and local store |
| `wayfind-one up [--port 7777] [--headless]` | Start daemon, web UI and P2P. `--headless` skips the UI (for VPS nodes) |
| `wayfind-one invite` | Create a one-time invite code |
| `wayfind-one join <code>` | Join a team from an invite |
| `wayfind-one bot create <name> --role <role>` | Create a bot with a role prompt and policy |
| `wayfind-one verify` | Run a full NEAR AI attestation check and print the result |
| `wayfind-one doctor` | Check Docker, network, key and peer connectivity |
| `wayfind-one demo` | Run the self-contained demo |

## Core concepts

| Concept | Meaning |
|---|---|
| **Team** | A set of members sharing one encrypted store, identified by a team key |
| **Node** | One running daemon on one machine. Has its own identity key |
| **Bot** | An AI teammate: role prompt, memory, allowed tools, policy |
| **Sandbox** | A Docker container where a bot's tools and code run, with no direct internet |
| **Task** | A unit of work for a bot, stored in the shared log |
| **Claim** | A node's record that it is running a task (prevents duplicate runs) |
| **Policy** | Rules for spending, tools, egress and approvals |
| **Approval** | A teammate's sign-off required before a sensitive action |

## Components in detail

### 1. P2P layer and team store

Stack (Holepunch): **Hyperswarm / HyperDHT** for peer discovery and encrypted connections, **Hypercore + Autobase** for multi-writer append-only logs, **Hyperbee** for key-value views.

> Verify current APIs against the Holepunch docs before coding. This README describes intent, not exact calls.

Suggested key layout in the shared store:

```
team/meta                  team name, created-at, policy version
members/<nodeId>           public key, display name, role, status
bots/<botId>               role, tool list, policy ref
tasks/<taskId>             description, bot, status, created-by
claims/<taskId>            nodeId, lease-expires-at
approvals/<approvalId>     task, action, requested-by, decisions[]
audit/<seq>                append-only event log
policy                     team policy (versioned)
```

**Encryption.** Transport is already encrypted by HyperDHT. In addition, encrypt every stored value with the team key (for example XChaCha20-Poly1305 via libsodium) so a stray peer or backup never holds plaintext.

**Invites.** An invite contains the swarm topic and the team key wrapped for a one-time use. After a successful join, mark the invite as spent in the store.

**Task claiming (no double runs).**
1. A node appends `claims/<taskId>` with a lease (e.g. 60 s).
2. After Autobase orders writes, the first claim wins. Other nodes back off.
3. The owner renews the lease with a heartbeat. If it expires, another node may claim.

**Known gap:** removing a member means rotating the team key and re-encrypting. For the hackathon, document this as roadmap and say so plainly.

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

Served by the daemon on localhost. Minimum pages:

- **Team:** members, online status, invite button
- **Bots:** list, create, role and tools
- **Tasks:** create, status, who is running it
- **Approvals:** pending, approve/reject, history
- **Privacy:** attestation status, last verification time, "verify now" button, per-reply proof
- **Audit:** append-only log of calls, approvals and policy changes

## Policy file

`policy.yaml`, stored in the shared team store and versioned.

```yaml
version: 1

inference:
  provider: near-ai-cloud
  allowed_models: ["<model-id>"]
  require_attestation: true
  max_tokens_per_task: 20000

egress:
  allow: []            # sandboxes reach only the inference proxy by default

spend:                 # for bots that can prepare payments
  max_per_tx_usd: 50
  max_per_day_usd: 200

approvals:
  require_for: [payment, send_email, publish, delete_data]
  approvers_needed: 1
  expires_after_minutes: 60
```

## Threat model

| Threat | Mitigation | Remaining risk |
|---|---|---|
| Central server compromise | There is no central server | None for this layer |
| Network eavesdropping | HyperDHT encrypted channels, HTTPS to NEAR AI | Metadata (who connects to whom) |
| Inference provider sees prompts | TEE inference with verified attestation | Trust in Intel/NVIDIA hardware |
| Prompt injection makes a bot leak or spend | No secrets in sandbox, egress allow-list, approvals, spend limits | A bot can still be tricked inside its allowed scope |
| Malicious tool or code in sandbox | Container isolation, no direct internet, resource limits | Container escape (use Firecracker for more) |
| Stolen laptop of a teammate | Disk encryption, local store encrypted | Team key rotation is manual for now |
| Removed member keeps old key | Roadmap: key rotation | Real gap today |
| Two nodes run the same task | Claims with leases | Brief overlap on lease expiry |

## Development guide

**Suggested stack**
- TypeScript on Node.js 20+ (fits the Holepunch ecosystem)
- `hyperswarm`, `hypercore`, `autobase`, `hyperbee` for P2P
- `dockerode` for sandboxes
- `fastify` for the daemon API and a small Vite + React UI (or plain HTML to save time)
- `sodium-universal` for encryption
- `vitest` for tests

**Proposed repo layout**

```
wayfind-one/
├─ README.md
├─ package.json
├─ src/
│  ├─ cli/            # commands: init, up, invite, join, verify, doctor, demo
│  ├─ daemon/         # server, lifecycle, config
│  ├─ p2p/            # swarm, store, invites, claims, crypto
│  ├─ sandbox/        # docker runner, network, limits
│  ├─ inference/      # proxy, near-ai client, attestation verifier
│  ├─ policy/         # schema, evaluator, approvals
│  └─ bots/           # agent loop, tools
├─ ui/                # web UI
├─ demo/              # recorded responses, sample files, scripts
├─ docs/              # architecture, threat model, notes
└─ tests/
```

**Local development**

```bash
git clone <this-repo>
cd wayfind-one
npm install
cp .env.example .env          # add NEAR_AI_API_KEY
npm run dev                   # daemon + UI with reload
npm test
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

## Build plan (6 to 14 Nov)

Development ends **14 Nov 2026, 23:59 UTC**. Cut scope early.

- [ ] **6 to 7 Nov:** repo, CLI skeleton, daemon, local web UI shell, `init` and `up`
- [ ] **7 to 8 Nov:** P2P store between two nodes, `invite` / `join`, shared task list synced
- [ ] **9 to 10 Nov:** Docker sandbox runner, inference proxy calling NEAR AI, one bot answering a task
- [ ] **11 Nov:** attestation verification and the verified badge in the UI
- [ ] **12 Nov:** policy engine, approvals, spend limit
- [ ] **13 Nov:** demo mode, README polish, error handling, record demo video
- [ ] **14 Nov:** final checks, publish repo, post on X, submit form (before 23:59 UTC)

**Cut list if time runs short:** Firecracker, key rotation, headless mode, multiple bots per team, fancy UI.

## Demo script

**Scenario: private expense reconciliation between two teammates.**

1. Node A and Node B are on different machines, joined to one team.
2. A uploads a bank export and a folder of receipts (they never leave the team's machines).
3. A creates a task: "Match bank transactions with receipts and list what's missing."
4. Node B claims it and runs the bot in a Docker sandbox. UI shows who is running it.
5. The bot calls the model through the inference proxy. UI shows the **verified TEE badge** and the attestation details.
6. The bot proposes a payment for a missing invoice. Policy requires approval, and the request appears on A's screen.
7. A approves. The audit log shows the call, the attestation result and the approval.
8. Show the proof: network view with no connection except NEAR AI Cloud, and the sandbox with no direct internet.

Keep the video under two minutes.

## Submission checklist

- [ ] Public GitHub repo (judges cannot open private repos)
- [ ] README clearly says what was built during the hackathon and what is reused (see below)
- [ ] Runs from a fresh machine with `npx wayfind-one demo`
- [ ] Demo post on X: say you built it at NEAR HACKATHON, tag **@NEARProtocol** and **#NEARHackathon**, attach video or screenshots
- [ ] Submit the form with **both** the repo link and the demo post link
- [ ] Select both tracks: **Privacy & Private AI** and **AI Security & Defense**
- [ ] Wallet address for prizes entered correctly

Judging note: projects are first screened by automated agents that check the project runs and matches the README, then reviewed by human judges. Keep install simple and the README accurate.

## Roadmap

**Now (hackathon):** P2P team store, Docker sandboxes, NEAR AI proxy with attestation, policy and approvals, web UI.

**Next:**
- Member removal with team key rotation
- Headless nodes for 24/7 bots on a VPS
- Run a node inside a TEE for end-to-end confidential execution
- Firecracker sandboxes on Linux
- NEAR Intents / stablecoin payment tools with on-chain approval rules
- Desktop app wrapper and a download page on the Wayfind site
- SSO and audit export for enterprise use

## Relationship to Wayfind Cloud

Wayfind Cloud is the hosted product from Tamago Labs. **Wayfind ONE** is a separate, self-hosted, P2P product built for this hackathon.

- **New for this hackathon:** everything in this repository (CLI, P2P layer, sandbox runner, inference proxy, attestation verifier, policy engine, UI).
- **Reused ideas, not code:** the "AI teammates / Bots" concept and use cases from Wayfind Cloud.
- If any code is reused from other repos, list it here with its license: `[TODO]`

## License

`[TODO: choose a license, e.g. MIT or Apache-2.0]`

## Links

- NEAR HACKATHON: <https://nearhackathon.com/>
- NEAR AI Cloud docs: <https://docs.near.ai/cloud/introduction>
- Wayfind Cloud: <https://www.wayfind.click/>