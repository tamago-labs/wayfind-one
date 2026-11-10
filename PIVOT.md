# PIVOT.md — Wayfind ONE v2: same AI-teammate UI, Docker → microVM

Date: 2026-11-10. Status: v1 archived under `v1/` (commit `c585d60`). This doc is the build spec for v2 at repo root.

## 1. What stays

- **The v1 AI-teammate UI survives as a sub-feature.** The primary UI becomes **sandbox management** (sessions list, create/destroy, resource usage, export, attestation status per session). The v1 teammate surface (roster, bot panels, DM panel, composer/thread in `v1/frontend`) lives inside it as the "Teammates" view — same components, repointed from the v1 daemon to the CLI/sandbox API. Users manage sandboxes first; teammates run inside them.
- **Local inference with BYOK.** The agent loop and provider catalog (`v1/src/inference.js`, `v1/src/agent.js` — reference only) stay on the host. Provider keys never enter the sandbox.
- **Salvageable modules (copy, don't import):** `v1/src/msgcrypto.js` (ed25519/x25519 envelopes for CLI↔cloud channel), `v1/src/computer.js` (containment policy: memory/CPU caps, workspace jail, network modes — re-targeted at microVMs).

## 2. What changes

| v1 (archived) | v2 |
|---|---|
| Docker Desktop container per team (`wayfind-computer` image, bridge network) | **Disposable microVM sandbox per session**, managed by Wayfind (no Docker dependency anywhere) |
| P2P team store (Autobase/Hyperbee), registry, invites, swarm | Deleted. Single-user sessions; sharing/teams deferred to wayfind-cloud account level |
| Daemon + swarm + update-poll replication | Deleted. CLI talks to sandbox API directly |
| Group chat | Deleted (already removed in v1). DMs only |
| `npm start` host daemon on :7777 | `npx wayfind` CLI; `npx wayfind login` device-flow auth against wayfind-cloud |
| Maximal privacy, hard to use (P2P, own daemon, own Docker) | **Practical first: attested + easy to use.** Privacy where it counts (keys, isolation), convenience everywhere else |

## 2a. Why this pivot (the lesson from v1)

v1 optimized for "everything private" — own daemon, own P2P network, own Docker — and ended up impractical: too many moving parts, nobody will run all that. Users want two things: **attestation** (proof of what ran where) and **easy to use** (`npx wayfind`, done). v2 keeps privacy where it counts (hardware isolation per session, keys never in the guest) and drops it where it only adds friction (P2P, self-hosted daemons, Docker Desktop).

## 3. Why microVM over Docker

- **Isolation boundary:** hardware virtualization (own kernel per session) vs. shared-kernel containers. Agent runs untrusted generated code — microVM is the correct boundary. Precedent: E2B Cloud (Firecracker per session), NEAR red-sandbox (mvm/HVF, Mac-only).
- **No host dependency:** Docker Desktop install, daemon autostart, image builds, and per-OS mount quirks disappear. The CLI ships zero virtualization prerequisites for the cloud path.
- **On-demand lifecycle:** boot → run → snapshot/export → destroy per session, instead of a long-lived container. Cost and blast radius scale with use.

## 4. Sandbox reality check (researched 2026-11-10)

- **Firecracker is Linux/KVM-only** (VMM built on KVM; all tested platforms are Linux metal). It never runs natively on macOS/Windows.
- **wayfind-cloud already runs a managed Firecracker fleet**: AWS Lambda MicroVMs, one VM per account, `provision/suspend/resume/terminate` in `amplify/functions/wayfind-api/handler.ts`, agent server in `packages/computer/src/server.ts`, presigned-S3 workspace sync, Cognito+Google auth, relay endpoint `ANY /computer/proxy/*`. v2 does **not** build fleet infrastructure — it exposes this.
- **near-red (`nearai-red-sandbox`) is the security blueprint, not the runtime**: `mvm`/HVF is Apple-silicon-locked, but these modules are host-agnostic and portable: `sandbox.rs` (Sandbox/Exec trait seam), `protocol.rs` (nonce-trailer exec wrapper), `copy.rs`/`untar.rs` (tar copy-in/out + hostile-tar validator), `network.rs` (deny-by-default egress policy core), `tools.rs`+`bridge.rs` (6-tool semantics + stdin/stdout bridge), `attest/` (TDX/NRAS verify). Its rules we adopt verbatim: **copy, don't mount; deny-by-default egress; credentials never enter the guest; inference outside the sandbox.**

## 5. Target architecture (v2)

```
npx wayfind login        → device flow (RFC 8628) → token in ~/.wayfind/
npx wayfind "do X"       → local agent loop (providers, transcript, tools schema)
                           → shell/file tools execute INSIDE microVM via guest agent
                           → workspace synced up/down, results stream back
UI (same teammate UI)    → talks to local CLI API (localhost) instead of v1 daemon
```

Components (only four):

1. **Auth — OAuth 2.0 device flow.** `npx wayfind login` prints code + URL; user approves on wayfind-cloud login page (new `/device` page, Cognito session already exists there); CLI polls, stores `CliToken` in `~/.wayfind/credentials.json` (0600). No loopback-port callbacks (breaks headless/SSH). Token model mirrors the proven per-computer `usageToken` pattern: random, stored hashed, revocable in `/app` settings.
2. **Control plane — wayfind-cloud (exists, needs 3 additions):** `/device` approval page, `POST /auth/device` + `POST /auth/device/poll` endpoints, `CliToken` accepted in `verifyToken`. Fleet, relay, sync, and agent server already shipped.
3. **Execution transport — guest agent protocol.** Same 6-tool surface as near-red (`shell/read/write/edit/glob/grep`); transport is the existing `/computer/proxy/*` relay (HTTP), not `mvmctl exec`. Local agent loop keeps tool schema; only the `shell` implementation changes from "docker exec" to "sandbox exec".
4. **Files — one-way mount in, manual export out.** The sandbox is **disposable**: no S3-backed persistent workspace (unlike wayfind-cloud's `computers/*` sync). The user's local folder IS the workspace — mounted into the microVM **one-way (local → microVM)** so the guest can read/build, but the guest can never write back silently. Downloading files back is an **explicit manual trigger** (`wayfind export`), because we don't know when the microVM will shut down — there is no reliable hook for auto-sync on teardown. Export path gets near-red's hostile-tar validation (no symlinks/`..`/devices, `.partial`-then-rename, size caps).

## 5a. Inference + attestation (the key to this project)

- **NEAR AI is the primary provider, and its attestation is the point.** TDX quotes + GPU attestation + pinned TLS + signed receipts (the near-red `attest/` + `forwarder/` design) prove *where and what* ran inference. This is the feature users actually want — verifiable execution, not DIY privacy plumbing.
- **Multi-provider, one attested.** The provider catalog supports many backends, but only the NEAR AI path is attested. **Meta is the test/dev provider** (fast, cheap, unattested — same role it played in v1). Unattested providers are clearly labeled as such in the UI; the `attested` vs `unattested` footer distinction from near-red carries over.
- Inference keys live on the host (Keychain/credential store, never in the guest, never in files) — same as near-red's `auth/` + embedded IronWire pattern.

## 6. Security invariants (from near-red, non-negotiable)

1. Credentials (provider keys, tokens) never enter the guest. Egress via allowlist proxy; secrets injected at the proxy, never in the sandbox. (Matches E2B's vault pattern.)
2. Egress default-deny. wayfind-cloud VMs currently get `INTERNET_EGRESS` (full internet) — P1 closes this with an allowlist ported from near-red's `network.rs`.
3. Guest filesystem fully disposable; only explicit export (`/out` equivalent) survives teardown.
4. Inference deployment attested where it matters (NEAR TDX path already scoped in v1 PLAN Phase 3); receipts prove signing, not correctness — scope claims honestly.

## 7. Phases

- **P0 — cloud sandbox behind login.** Device-code table + 2 endpoints + CliToken auth in wayfind-cloud; `login` + `--remote` transport in CLI (extend `wayfind-cloud/packages/computer/src/cli.ts`, don't start a new package); publish `wayfind` to npm. Exit: `npx wayfind login && npx wayfind run "..."` on Mac/Windows/Linux, zero local installs. UI repoints from v1 daemon to CLI API.
- **P1 — harden the boundary.** Egress allowlist, hostile-tar validation on manual export, CliToken expiry/rotation. Decide per-account long-lived computer vs. per-session disposable VM (teammate vs. worker — UI says teammate; keep suspend/resume, add session-scoped sandbox option).
- **P2 — local microVM drivers (only if P1 proves demand).** Reuse near-red's `Sandbox`-trait + bridge + copy/untar modules verbatim; Firecracker on Linux first, VZ (macOS) second, Hyper-V last. Same CLI, `--local` flag. Local folder mounted one-way into the guest; export-back stays a manual trigger — never auto-sync, never two-way mounts.
- **P3 — snapshots/templates/attestation.** Sub-second snapshot boot, preinstalled-dep templates, per-session egress policies, NEAR TDX attestation of the inference path.

## 8. Explicit non-goals (from v1, do not rebuild)

P2P teams, Autobase/Hyperbee replication, multi-swarm discovery, registry, single-use invites, Docker Desktop support, group chat, exactly-once delivery. If teams return, they return as wayfind-cloud account features, not protocol features.

## 9. Pre-flight flags

- `.env.local` with real-looking keys is checked into wayfind-cloud — **rotate before any CLI token can reach that backend.**
- Local CLI (`packages/computer/src/cli.ts`) is localhost-only today; `--remote` transport is P0 work, not a config change.

## 10. v1 vs v2 comparison

| Dimension | v1 (archived) | v2 (this plan) |
|---|---|---|
| Install | `git clone` + `npm install` + Docker Desktop + daemon | `npx wayfind login` → `npx wayfind run` |
| Isolation | Docker container, shared kernel, bridge network | Firecracker microVM, own kernel, per-session disposable |
| Trust story | "Runs on your machine, P2P, no cloud" (unverifiable) | **NEAR TDX attestation**: proof of what ran where, per session |
| Auth | None (local) / single-use P2P invites | Device flow → wayfind-cloud account (Cognito+Google today) |
| Networking | P2P swarm, DHT discovery (brittle — stalled in testing) | HTTPS to control plane; API learns nothing P2P |
| Files | Host bind-mounts, two-way, always-on daemon | Local folder = workspace, one-way mount in, manual `export` out |
| Inference | Local, Meta default, no attestation | NEAR AI primary (attested), multi-provider, Meta for tests |
| State | Registry + Autobase team store + poll loops | Stateless CLI; sessions disposable; export is explicit |
| UI | Teammate-only (roster/chat/DMs) | **Sandbox management console**; teammate UI as "Teammates" sub-view |
| Ops burden | User runs daemon + Docker + P2P 24/7 | Zero always-on local processes; cloud owns the fleet |
| Cross-platform | Docker Desktop required everywhere | Cloud path works on Mac/Windows/Linux day one; local drivers later |

v1's failure mode was structural: every feature (privacy, teams, attestation) added a local subsystem the user had to operate. v2's rule: **the user operates nothing** — they authenticate, they get a sandbox, they get a receipt.

## 11. Enterprise path (options)

Goal: a CISO can say yes. Ranked by effort-to-credibility:

**Option A — Attestation as compliance evidence (Recommended, builds on what we have).**
Enterprises don't buy "sandbox"; they buy auditability. Ship per-session **attestation bundles**: TDX quote + GPU evidence + signed inference receipts + egress audit log + tool-call transcript, exportable as one signed artifact (`wayfind export --receipt`). This turns every agent run into something legal can file. No competitor at this price point does per-session verifiable execution; E2B sells isolation, not proof. Effort: mostly packaging near-red's `attest/` + `forwarder/` + `network.jsonl` pipeline.

**Option B — SSO + audit + policy (table stakes for enterprise seats).**
Cognito already supports Google; add SAML/OIDC (Okta/Entra) via Cognito external IdPs, enforce SSO at the `CliToken` mint step. Add: immutable per-tenant audit log (who ran what, where, with which policy), RBAC (admin/member/viewer over sandboxes), session recording for approvals. Effort: medium; all in wayfind-cloud, no sandbox changes.

**Option C — BYOC / data-residency (unlocks regulated industries).**
Run the Firecracker data plane in the customer's AWS account/region (E2B sells exactly this as BYOC). Control plane stays at wayfind-cloud; execution + files never leave customer boundary. Effort: high (Terraform modules, cross-account IAM like the existing `backend.ts` IAM block generalized). Do this only with a design partner paying for it.

**Option D — DLP + retention controls (checkbox features, do last).**
PII redaction on export, retention policies (auto-purge sessions/exports after N days), legal-hold export, region pinning. Effort: low-medium, but only matters once A/B close a deal.

Recommended sequence: **A → B → (C with a design partner) → D.** A differentiates, B unblocks procurement, C unlocks regulated verticals, D closes checklists. Do not build C or D speculatively.
