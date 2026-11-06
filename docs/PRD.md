# Wayfind ONE — Product Requirements Document

> Base of development. Status: hackathon prototype.
> Source of truth for scope: this file. Design detail lives in `PLAN.md`.
> Built for **NEAR HACKATHON 2026** · Tracks: **Privacy & Private AI** + **AI Security & Defense**
> Development ends **14 Nov 2026, 23:59 UTC**.

---

## 1. Overview

Wayfind ONE is a CLI for enterprises and teams that handle sensitive data. It spins up
isolated sandbox computers on the team's own machines, lets the whole team share them over
encrypted peer-to-peer sync, and sends AI inference only to **NEAR AI Cloud**, where it runs
inside verified Trusted Execution Environments (TEEs).

**Positioning.** Wayfind Cloud is the hosted product from Tamago Labs. **Wayfind ONE** is a
separate, self-hosted, P2P product built for this hackathon:

| | Wayfind Cloud | **Wayfind ONE** |
|---|---|---|
| Where bots run | Hosted cloud computer (MicroVMs on AWS) | **Team's own machines** (Docker sandboxes) |
| How the team shares work | Through our servers | **Encrypted P2P, no central server** |
| Where inference runs | Open-weight models on our infrastructure | **NEAR AI Cloud, inside attested TEEs** |

Refs: PLAN.md §§ Why Wayfind ONE, Relationship to Wayfind Cloud.

---

## 2. Goals / Non-goals

**Goals (ship for the hackathon)**

1. Two machines form one team over encrypted P2P (`init`, `invite`, `join`, `up`).
2. A bot answers a task in a Docker sandbox with no direct internet.
3. All inference flows through a host proxy that verifies NEAR AI attestation and shows a verified badge.
4. Policy gates sensitive actions; teammates approve/reject in the UI.
5. `npx wayfind-one demo` runs the full story on one machine with no setup.

**Non-goals (explicit cut list — do not build during the hackathon)**

- Firecracker isolation, member removal with key rotation, headless 24/7 nodes.
- Multiple bots per team, fancy UI, desktop wrapper, SSO/audit export.

Refs: PLAN.md §§ Build plan, Roadmap.

---

## 3. Users

| User | Needs |
|---|---|
| **Team admin** | Create team, invite members, set policy, approve sensitive actions |
| **Teammate** | Join with invite, run tasks, see what is running where |
| **Reviewer / judge** | Run `demo` on a fresh machine, see attestation proof, match README |

---

## 4. Functional requirements

### 4.1 CLI

| ID | Command | Requirement |
|---|---|---|
| CLI-1 | `init --team <name>` | Creates node identity key, team key, local store under `WAYFIND_HOME` (default `~/.wayfind-one`). Exit 0 on success, non-zero with a message on existing store unless `--force`. |
| CLI-2 | `up [--port 7777] [--headless]` | Starts daemon, web UI on `localhost:<port>`, P2P swarm. `--headless` skips UI (VPS nodes). |
| CLI-3 | `invite` | Prints a one-time invite code. Code is marked spent in the store after a successful join. |
| CLI-4 | `join <code>` | Joins a team from an invite; invalid/used codes fail with a clear error. |
| CLI-5 | `bot create <name> --role <role>` | Creates a bot with role prompt and default policy (stub data acceptable pre-sandbox). |
| CLI-6 | `verify` | Runs a full NEAR AI attestation check and prints pass/fail with details. |
| CLI-7 | `doctor` | Checks Docker, network, key, and peer connectivity; reports each line OK/FAIL. |
| CLI-8 | `demo` | Self-contained demo: two simulated nodes, sample task, attestation check, approval prompt. Uses a recorded NEAR AI reply if no API key, clearly labelled. |

Stubs must fail honestly: print `not yet implemented` + exit code 2, never fake success.
Refs: PLAN.md §§ Quick start, CLI reference.

### 4.2 Daemon + API

| ID | Requirement |
|---|---|
| API-1 | Serves the web UI on `localhost:<port>` (default 7777) and `GET /api/status` returning `{ nodeId, teamName, peers: [{ id, rtt }], topic }` — metadata only, never secrets. |
| API-2 | Serves the built frontend (`frontend/dist`) in production, Vite dev proxy (`/api → localhost:7777`) in development. |
| API-3 | Node.js 20+, one command to start (`up`), clean shutdown on SIGINT. |

### 4.3 P2P layer and team store

| ID | Requirement |
|---|---|
| P2P-1 | Stack: Hyperswarm/HyperDHT discovery + encrypted transport, Hypercore + Autobase log, Hyperbee views. |
| P2P-2 | One team = one unguessable swarm topic derived from team secrets; knowing the topic is the membership capability. Wrong-topic peers are dropped before any data flows. |
| P2P-3 | Node identity: ed25519 keypair persisted per `WAYFIND_HOME` (keet portable identity deferred to post-hackathon). |
| P2P-4 | Key layout in store: `team/meta`, `members/<nodeId>`, `bots/<botId>`, `tasks/<taskId>`, `claims/<taskId>`, `approvals/<approvalId>`, `audit/<seq>`, `policy`. |
| P2P-5 | All stored values encrypted with the team key (XChaCha20-Poly1305) on top of transport encryption. |
| P2P-6 | Task claims carry leases (~60 s) with heartbeats; first claim wins, expiry allows re-claim. |

Refs: PLAN.md §§ Components (P2P), Threat model.

### 4.4 Sandbox runner

| ID | Requirement |
|---|---|
| SB-1 | Default: Docker, one container per bot/task, non-root, read-only rootfs, CPU/memory/time limits, scratch volume. |
| SB-2 | No direct internet. Only reachable endpoint is the host inference proxy (dedicated network + per-sandbox token). Extra egress only via policy through the proxy. |
| SB-3 | Team files mounted into the sandbox only for the task that needs them. |

### 4.5 Inference proxy (core privacy piece)

| ID | Requirement |
|---|---|
| INF-1 | Holds the NEAR AI key; the sandbox never receives it. OpenAI-compatible base `https://cloud-api.near.ai/v1`; prefer direct completions `https://<model>.completions.near.ai`. |
| INF-2 | Verifies before trusting: nonce → attestation report → NVIDIA NRAS GPU check → Intel TDX quote + nonce/address binding → response signatures → (strongest) TLS attestation. Refuses to forward on failure. |
| INF-3 | Applies model allow-list + per-task token caps; writes one audit record per call (metadata only, never prompts). |
| INF-4 | Caches verified state with expiry; UI shows badge + last-verified time + "verify now". |

Refs: PLAN.md § Inference proxy.

### 4.6 Policy engine and approvals

| ID | Requirement |
|---|---|
| POL-1 | `policy.yaml` schema as in PLAN.md (inference, egress, spend, approvals); versioned in the shared store. |
| POL-2 | Every bot tool call passes the policy engine. `payment, send_email, publish, delete_data` require approval by default (`approvers_needed: 1`, 60-min expiry). |
| POL-3 | Approval requests live in the shared store; UI supports approve/reject + history. |

### 4.7 Web UI

| ID | Route | Requirement |
|---|---|---|
| UI-1 | `/` | Local login: team name / invite code, stubbed to docs until daemon exists. |
| UI-2 | `/docs/*` | 9 docs pages mirroring Cloud structure (Intro, Quickstart, CLI, P2P, Sandbox, Inference, Policy, Bots & tasks, Privacy, Changelog). |
| UI-3 | `/app` (future) | Team, Bots, Tasks, Approvals, Privacy (badge + verify-now), Audit. Minimal pages first; shared daemon data via API. |

### 4.8 Demo mode

| ID | Requirement |
|---|---|
| DEMO-1 | Expense-reconciliation scenario: bank export + receipts stay local → task → claim → TEE-verified call → payment proposal → approval → audit entry. |
| DEMO-2 | Runs under two minutes, from a fresh machine, no Docker/API key required (recorded reply labelled). |

Refs: PLAN.md §§ Demo script, Submission checklist.

---

## 5. Privacy & security requirements

**SHALL (stays private)**

- Team data encrypted with the team key, synced machine-to-machine only.
- Inference only to NEAR AI Cloud TEEs; attestation + signatures verified before trusting.
- Secrets live in the host process; sandboxes never see them.
- No prompts, file contents, or secrets in logs — metadata only.

**SHALL-NOT (honest limits, shown in UI/docs)**

- Sandbox hosts are not TEEs; root on that machine can read sandbox memory.
- Hardware trust (Intel/NVIDIA) is assumed, not removed.
- TEEs don't stop prompt injection — policy + approvals are the control.
- Removed-member key rotation is a known gap (roadmap, stated plainly).

Refs: PLAN.md §§ Privacy model, Threat model.

---

## 6. Milestones (6–14 Nov)

| Dates | Exit criteria |
|---|---|
| 6–7 Nov | Repo, CLI skeleton, daemon + `/api/status`, `init` + `up`, login/docs UI shell |
| 7–8 Nov | P2P store between two nodes, `invite`/`join`, shared task list synced |
| 9–10 Nov | Docker sandbox runner, inference proxy, one bot answering a task |
| 11 Nov | Attestation verification + verified badge in UI |
| 12 Nov | Policy engine, approvals, spend limits |
| 13 Nov | Demo mode, README polish, recorded demo video |
| 14 Nov | Public repo, X post, submission form before 23:59 UTC |

---

## 7. Acceptance criteria (judge test)

1. Public GitHub repo; README states what was built vs reused.
2. Fresh machine: `npx wayfind-one demo` completes without manual setup.
3. UI shows attestation proof (or honestly-labelled recorded reply) and an approval flow.
4. Demo post on X tagging **@NEARProtocol** + **#NEARHackathon**; form submitted with repo + post links and wallet.

---

## 8. Open questions

1. ~~Portable member identity: adopt `keet-identity-key` now or after the hackathon?~~ → **Decided: now.** Member mnemonic + per-device attested keys; proofs attach to task entries (verified live, Phase 3).
2. ~~Daemon framework: fastify (PLAN) vs express (goji precedent)?~~ → **Decided: express**, goji-style.
3. ~~Invite transport: single-use codes in-store (v1) vs blind-pairing (goji-style)?~~ → **Decided: single-use `z32` codes with P2P redemption.** Issuer ledger marks spent on first redeem; replays rejected; issuer must be online.
4. `/app` scope: ~~read-only status pages~~ → **Tasks page first** (list/add/toggle + peer header). Team/Bots/Approvals/Privacy/Audit later.
5. License choice (TODO in PLAN.md): MIT vs Apache-2.0. (Root `package.json` currently says Apache-2.0; confirm.)

---

## 9. Implementation findings (Phases 1–3, verified live)

Two daemons on one machine (`WAYFIND_HOME=.u1/.u2`, ports 7777/7778) cover every path below.

### What works
- `init` → keet identity + team secrets + topic; `up` → swarm + daemon + tasks.
- `invite` / `join`: code redeems against the issuer over the swarm; joiner adopts the team. Replay rejected on both sides; offline issuer fails cleanly.
- Leave/rejoin propagates to peers; different topics never cross-talk.
- Tasks sync both directions, survive daemon restarts (disk replay + catch-up), toggle folds last-write-wins, keet proofs attach and replicate.
- `/app/tasks` polls `/api/status` + `/api/tasks`; Connect/Disconnect on the login card drives the swarm.

### Bugs found testing (all fixed)
1. **Dropped `await` on server start** — daemon crashed on boot. Fix: `await startServer(...)`.
2. **Newline framing off-by-one** (`buf.subarray(idx)` vs `(0, idx)`) — every lone protocol message parsed as `"\n"` and died silently; only coalesced bursts parsed (the last message, first skipped). This single bug explained all "connected but silent" symptoms.
3. **TDZ crash** — hello can arrive during `join()`, before `TaskStore` exists. Fix: `let tasks = null` + guarded `onHello`.
4. **Duplicate-connection reply misrouting** — crossed double-dials meant replies went out on a dead conn. Fix: deterministic winner (keep conn where `isInitiator === (nodeId < remoteId)`, agreed on both sides) + reply on the arrival conn + guarded close-drop.
5. **Swarm events without topic scope** — redials from ex-members re-registered. Fix: ignore conns while unjoined; drop on hello-topic mismatch; 45 s silence sweep.
6. **Core-key race** — hellos go out before `tasks.open()` finishes. Fix: `announceLocal()` re-broadcast after open.
7. **JSON Buffer round-trip** — `identity.json` deserialised the device proof as a plain object, breaking `attestData`. Fix: revive `{type:'Buffer',data}` on load.

### Design notes
- **Transport encryption is free**: Hyperswarm runs on secretstream (Noise) with key-authenticated peers — no direct secretstream work needed.
- **Repl swarm uses an ephemeral key**, not the device key: two Hyperswarm instances sharing one keypair in a process broke delivery. Capability gating comes from the unguessable repl topic; cores are authenticated by key.
- **Keet is load-bearing from day one**: identity keys name nodes/peers, device proofs stamp task entries.
- Poll-based UI (`setState` in effect) triggers an oxlint warning in `Tasks.tsx`; accepted as legitimate polling.
