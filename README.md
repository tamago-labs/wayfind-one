# Wayfind ONE

> Private AI execution you can verify.

Ephemeral environments for verifiable private AI.
Bring your data. Choose your AI. Verify where it runs.

---

## 1. Overview

### What Wayfind ONE is

Wayfind ONE is a managed website plus a CLI where customers run AI against
sensitive data in **disposable Firecracker microVMs** and receive the result
**together with independently verifiable security evidence**. Not a chatbot,
not a VM provider, not an inference API — a private execution environment
with receipts.

The backend lives in a separate repo, [`../wayfind-cloud`](../wayfind-cloud)
(Next.js 14 + Amplify Gen 2: auth, data, the `wayfind-api` function,
storage). This repo holds the website frontend, the CLI, the sandbox agent
image, the NEAR attestation proof kit, and the product docs. Nothing here
works without that backend; nothing there is duplicated here.

### Problem it solves

Regulated teams, IP-heavy companies, and consultancies all face the same
blocker: the useful AI lives behind someone else's API, and sending
proprietary source code, contracts, financials, or patient data to a chatbot
is a non-starter for legal, security, and compliance. The alternative —
self-hosting models and infrastructure — is a platform project most teams
cannot staff.

Wayfind ONE occupies the middle: upload or connect a workspace, pick a task
and model, run it in an isolated disposable machine with attested inference,
get the result **plus evidence**. Security reviews stop being meetings about
trust and become files a pipeline can check.

### Core principles

- **Disposable by default.** One conversation, one microVM. Termination
  destroys the machine; verified destruction is part of every receipt.
- **Keys never reach the endpoint.** Wayfind holds all long-lived keys
  server-side. Browsers, CLIs, and guests only ever see short-lived,
  session-scoped credentials that die with the session. No BYOK, no pasted
  API keys.
- **Evidence, not promises.** Every claim is labeled `observed`
  (Wayfind saw it), `signed` (Wayfind attests it), or
  `hardware-attested` (independent hardware proof, NEAR inference only).
  Labels never mix; absence of evidence is reported, never implied.
- **Fail closed, loudly.** Missing secrets, unverifiable signatures, stale
  nonces, weaker-than-policy levels: explicit errors, never silent
  downgrades.
- **No plaintext where ciphertext will do.** Contents are sealed;
  manifests carry hashes. Logs and debug output carry digests, never data.

### Who it's for

Developers running agentic work on private repos (CLI), teams analyzing
sensitive documents (website), and security/compliance reviewers who need
artifacts, not assurances (receipts, audit trail, evidence bundles).

---

## 2. How It Works

### Execution lifecycle

1. **Create.** The customer picks a bot (or ad-hoc), a curated model, a
   security level, and attaches files. The backend provisions a disposable
   microVM, mints a per-session bearer, wraps a per-conversation key for
   escrow, and records a session row.
2. **Initialize.** The workspace is sealed into the VM (bulk uploads are
   sealed server-side; the relay only ever sees ciphertext). The in-VM bot
   runs its attestation preflight: fresh nonce, per-node echo, NVIDIA
   verdict — retained for the session, or the session fails before any
   prompt is sent.
3. **Converse.** Each message appends to a hash-chained transcript, runs
   one non-streaming inference with the workspace in context, appends the
   reply, then verifies the response signature against the retained
   preflight. The reply carries its verification (`provider_tee` or
   `gateway`, signer, validity).
4. **Checkpoint.** Sealed transcript snapshots are recorded on demand and
   always at terminate. Blobs are opaque to the backend; manifests are
   hashes.
5. **Terminate.** Final snapshot, evidence pull, verified VM kill, session
   keys revoked. A receipt is built and signed. History renders later from
   checkpoints, decrypted client-side.

### Data flow

Browser/CLI ──TLS──▶ backend ──sealed envelopes──▶ relay ──▶ VM memory.
Plaintext exists in exactly two places: the customer's machine and the
disposable VM's memory. Checkpoints leave the VM only as AES-256-GCM
envelopes bound to (path, plaintext hash). The relay operator sees
metadata + ciphertext.

### Inference flow

The VM calls NEAR AI directly with its per-boot session credential over
TLS: `POST /v1/chat/completions` (non-streaming — streams can't carry
model-TEE signatures), then `GET /v1/signature/{chatId}` with bounded
retry across serving nodes. Request and response bytes are hashed exactly
as sent/received; those hashes are what the signature commits to.

### Verification flow

Preflight (once) → per-message signature checks (always) → evidence
retained in memory → bound into the receipt at terminate → verifiable
offline by CLI, in the website panel, and in the embedded NEAR
Verification Center widget. Three independent implementations must agree;
any disagreement is treated as failure.

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Website (this repo: frontend/)        Customer-facing product│
│   New · Bots · Conversations · Verify · Activity · Settings  │
├─────────────────────────────────────────────────────────────┤
│ CLI (this repo: bin/, src/)           Sync · chat · verify  │
├─────────────────────────────────────────────────────────────┤
│ Wayfind Backend (../wayfind-cloud)    Auth · orchestration  │
│   Cognito (same pool: web login + CLI device flow)          │
│   policy · audit trail · image trust · API proxy            │
│   NEAR AI credentials (Amplify secrets, server-side only)   │
├─────────────────────────────────────────────────────────────┤
│ Execution   Firecracker MicroVM · workspace · tools (this   │
│             repo: packages/sandbox — disposable, sealed)     │
│ Inference   NEAR AI TEE (Intel TDX + NVIDIA) · session key  │
├─────────────────────────────────────────────────────────────┤
│ Evidence    NEAR attestation + Wayfind receipts (signed)     │
└─────────────────────────────────────────────────────────────┘
```

### Trust boundaries

- **Browser/CLI** are views. They render evidence and decrypt with
  owner-fetched keys; they never mint credentials.
- **Backend** is the orchestrator. It holds all long-lived secrets, mints
  session credentials, resolves sessions, stores sealed blobs it cannot
  read, and signs receipts. It is trusted with metadata, never with a
  claim it didn't witness.
- **MicroVM** is the computer. It sees workspace plaintext and a
  session-scoped inference key, both dying with it. It is trusted for one
  session, verified per message.
- **NEAR AI** is the inference. Verified per request path, never on
  reputation.

### Technology stack

Frontend: Next.js 14 + Tailwind + Amplify (same Cognito pool as the CLI).
CLI: plain Node 20+, no framework. Agent: Node 24 on Alpine, REST + MCP
tool server. Backend: Amplify Gen 2 (AppSync data, Lambda function URLs,
S3). Crypto: AES-256-GCM workspaces, HKDF session keys, Ed25519 receipts,
EIP-191 signer recovery.

### Component responsibilities

- **Frontend** (`frontend/` → `one.wayfind.click`): auth gate, bot
  library, conversation lifecycle UI, sealed history decrypt, verify panel,
  audit/policy/image-trust views, widget host. No keys, no inference.
- **CLI** (`bin/`, `src/`): same product surface for developers and CI —
  sync, chat, verify, policy, audit, evidence, image trust.
- **Control plane** (`../wayfind-cloud/amplify/`): auth, `Conversation` /
  `Checkpoint` / `Policy` / `AuditEvent` / `ImageTrust` models, ~30 routes
  in `functions/wayfind-api/` (thin dispatcher over `lib/` + `routes/`).
- **Execution plane** (`packages/sandbox/`): the agent that runs inside
  every VM — bot loop, sealed sync, attestation checks, transcript chain.
- **Inference provider**: NEAR AI Cloud TEEs (see §5).
- **Evidence layer**: receipts, checkpoints, audit rows, widget reports —
  produced at runtime, verified offline.

---

## 4. Security & Privacy

### Isolation vs confidentiality

A Firecracker microVM gives **isolation**: the host and other workloads
are protected from the workload inside the VM. It does **not** give
**confidentiality**: the workload and its data are not protected from the
operator. Wayfind's execution guarantee is isolation plus disposability,
never implied confidentiality. Confidentiality for *inference* comes from
NEAR's TEEs; confidentiality for the *workspace* awaits the Phase 3 Nitro
backend — until then, `strict-confidential` fails closed by design and the
docs say so everywhere.

### Data protection

Workspaces travel as per-file AES-256-GCM envelopes (fresh nonce per
file, AAD binds path + plaintext hash). Keys derive per session via
HKDF-SHA256 over the session bearer — zero key transport, zero new
secrets, key lifetime equals session lifetime. Checkpoints are sealed
blobs in S3; manifests are hashes in DynamoDB. Transcripts live only in
VM memory plus sealed snapshots. Retention: rows and blobs persist per
policy; plaintext persists nowhere.

### Key management

| Key | Lives in | Dies with |
|---|---|---|
| NEAR + test provider keys | Amplify secrets | rotation |
| Conversation escrow (wrapped) | DynamoDB row (ciphertext) | explicit purge |
| Session bearer, workspace key, AI credential | VM memory only | VM terminate |
| Receipt signing key (Ed25519) | Amplify secret | rotation (`kid` tracks it) |
| Publish bearer (image trust) | release ceremony only | each publish |

### Threat model

| Threat | Protection | Limit |
|---|---|---|
| Network/storage observers | TLS + sealed payloads | filenames/sizes/hashes visible to relay |
| Other tenants | per-session keys, disposable VMs, owner-scoped rows | — |
| Tampered results | response signatures bound to exact request/response bytes | ~60 min signature lookup window |
| Tampered history | hash-chained transcripts, append-only audit, signed checkpoints | endpoint compromise excluded |
| Malicious inference infra | TDX + NVIDIA TEEs, verified per request | host-operator visibility into the *VM*, not the TEE |
| Key theft at rest | secrets manager, wrapped escrow, memory-only guests | live bearer equals that session |

### Security guarantees and limitations

Guaranteed today: disposable isolated execution, sealed transfers,
verified NEAR inference per request path, signed receipts, owner-scoped
data, fail-closed policies. Explicitly *not* claimed: hardware-backed
workspace confidentiality, TDX quote verification inside our pipeline
(`dcap-qvl` is upstream scope), image reproducibility proofs (SBOMs are
recorded, signing lands with cosign), and anything about data the customer
pastes outside Wayfind.

---

## 5. Verifiable Execution

### NEAR AI attestation

Before the first prompt of a session, the agent fetches an attestation
report with a fresh nonce, checks the echo on every node, extracts model
and gateway signing addresses, and verifies NVIDIA GPU evidence
(overall verdict + `eat_nonce` binding) via NRAS — about 2 seconds, then
the candidates are retained for the session. Details and live timings:
[`scripts/near-ai-tests/FINDINGS.md`](scripts/near-ai-tests/FINDINGS.md).

### Inference verification

After every non-streaming completion, the agent fetches
`/signature/{chatId}` (bounded retry — signatures live on the serving
node), resolves the kind (`provider_tee` = model TEE signed
`model:request:response`; `gateway` = gateway TEE signed the exact
delivered bytes), checks hash binding and model-id commitment, and
recovers the signer against exactly one retained candidate. This is the
`06-policy-gate` logic, ported 1:1 into
[`packages/sandbox/src/tools/attest.ts`](packages/sandbox/src/tools/attest.ts).
Standard-tier providers skip checks honestly (`checked: false`), never
claimed.

### Execution receipts

Terminating builds receipt v0: session metadata, checkpoint manifest,
inference evidence (preflight + per-message checks), metering, cleanup
proof — then signs the canonical JSON (sorted keys, recursive) with the
control-plane Ed25519 key. `class` is `observed` without a signature,
`signed` with one. Format frozen; signers upgrade (KMS later) without
format changes. Full shape with a real example: see
[Verification](#6-independent-verification).

### Independent verification

Three implementations must agree; any disagreement is failure:

1. **CLI offline** (`wayfind verify <receipt.json|id>`): shape, chain,
   timing, cleanup, inference block, then Ed25519 over canonical bytes
   (key cached in `~/.wayfind/verify-key.json`, rotation-aware). Fully
   offline except the one-time public-key fetch. Tampered copies fail
   here first.
2. **Website panel**: same hash/chain/evidence checks in the browser,
   plus a server signature re-check (`POST /verify-receipt`) for runtimes
   without WebCrypto Ed25519. True offline verification remains the CLI.
3. **NEAR Verification Center widget**: the official iframe fed by our
   `VerificationReport[]` (`GET /conversations/:id/verification-reports`).
   It validates *structure*, not evidence — its "Verified" means
   structurally valid with matching signers. Our checks remain the trust
   decision. Honest mapping: `tcbStatus: Unknown`, provenance
   `not_checked`, model scope `partial` (never `verified`), gateway scope
   with unattested TLS binding.

### Image trust

Reproducible pipeline: `tsc` → `npm ci --omit=dev` → CycloneDX SBOM →
zip → S3, with hashes recorded. `03-publish-trust.ts` publishes a
control-plane-signed manifest (`imageArn`, version, zip/sbom hashes,
built-at); `GET /image-trust` serves it; `wayfind image-trust` verifies
offline. Proves *which bytes* run in your VM. Cosign, SBOM pinning, and
measured-boot binding are roadmap, not claims.

---

## 6. Getting Started

### Prerequisites

- Node.js 20+ (22 recommended; the sandbox image is node:24-alpine).
- A deployed Wayfind Cloud backend with Amplify secrets set
  (`NEARAI_CLOUD_API_KEY`, `CONVERSATION_MASTER_KEY` (64 hex),
  `WAYFIND_RECEIPT_SIGNING_KEY` (Ed25519 PKCS#8 PEM),
  `IMAGE_TRUST_SECRET`, `TICK_SECRET`). Missing secrets fail closed by
  design — see [Troubleshooting](#11-troubleshooting).
- AWS credentials (only for building/publishing the sandbox image).
- A Wayfind account — same Cognito pool for website (direct login) and
  CLI (device flow).

### CLI installation

No install step: `node bin/wayfind.js <command>` from the repo root.

### Authentication

```sh
node bin/wayfind.js login     # approve the XXXX-XXXX code at wayfind.click/cli-login
```

Website login uses the same pool directly (email/Google). CLI tokens live
in `~/.wayfind/credentials.json` (0600). If a data migration wipes the
table, login again — tokens are disposable by design.

### First execution

```sh
node bin/wayfind.js run --dir ./demo -- 'echo hello from the VM'
node bin/wayfind.js run --dir ./demo --keep -- 'echo probe > output.txt'
node bin/wayfind.js status && node bin/wayfind.js export && node bin/wayfind.js stop
node bin/wayfind.js chat "Review for injection bugs" --new
node bin/wayfind.js verify <conversationId>
```

### Website

```sh
cd frontend && npm install && npm run dev   # http://localhost:3001
```

New conversation → live chat with per-reply verification labels → attach
files and ask about them → terminate → history decrypts client-side →
Verify tab + NEAR widget. Settings holds policy and image trust; Activity
holds the audit trail with evidence downloads.

---

## 7. Developer Guide

### Repository structure

```
wayfind-one/
├── bin/wayfind.js                 CLI entry
├── src/auth|commands|sandbox/     CLI (device flow, verbs, sealed sync)
├── frontend/app|components|lib/   website (shell, widget, api, crypto)
├── packages/sandbox/src/          agent (server, tools/*, lifecycle)
├── packages/sandbox/scripts/image/  01-package → 02-create → 03-publish-trust
├── scripts/near-ai-tests/         00–11 proof kit + FINDINGS.md
├── PIVOT.md / PLAN-P1.md          thesis + build plan (start here for why)
└── v1/                            archived predecessor (reference only)
```

### Core packages

- **CLI** (`src/`): auth store, sandbox client (provision/reuse/relay),
  HKDF + AES-256-GCM envelopes (must stay byte-identical with the agent
  mirror), hash-skipping sync, warm sessions, `chat` (new/follow-up),
  offline `verify` with Ed25519, policy/audit/evidence/image-trust verbs.
- **Agent** (`packages/sandbox/src/`): REST+MCP router over tool modules —
  bot loop with hash-chained transcript, in-VM NEAR calls, attestation
  checks, sealed sync/read, checkpoint emitter, evidence endpoint.
- **Frontend** (`frontend/`): auth-gated shell, live/error states,
  WebCrypto envelope opening, widget bridge, owner-scoped reads.

### Backend integration

One Function URL, ~30 routes (full contract in `PLAN-P1.md` and the
[route table](#the-backend-wayfind-cloud) above). Auth: Cognito JWT or
opaque CLI token, verified per request; sessions resolve server-side so
clients never hold VM credentials. Data: `Conversation` (metadata +
escrowed key + manifest + receipt — never history), `Checkpoint`
pointers, `Policy`, append-only `AuditEvent`, `ImageTrust`. Blobs: sealed
only, S3 `checkpoints/{owner}/{conversation}/{seq}.bin`.

### Configuration

CLI: `WAYFIND_API_URL` override, else the baked default. Frontend:
`frontend/amplify_outputs.json` is a reference copy of wayfind-cloud's —
re-copy after backend deploys that change outputs. Image pipeline:
`scripts/image/.env` (gitignored; see `.env.example`) for bucket/role/
base image plus `IMAGE_TRUST_SECRET`. Never commit secrets; the pre-flight
checklist in PIVOT.md still applies.

### Development workflow

- Numbered scripts (`scripts/<area>/NN-*.ts`), `npx tsx` from repo root,
  exit non-zero on failure, paste passing runs at the file bottom. Working
  calls transfer directly into product code.
- Typecheck backend with `amplify/tsconfig.json` (the two `$amplify/env`
  errors are expected locally), image with root `tsc`, frontend with
  `npm run build`.
- Image changes require `01` before `02 --replace` (the zip is built from
  `dist/`; stale builds fail silently as `CREATE_FAILED`).
- New models pass `scripts/near-ai-tests/` 00–11 before they ship. No
  exceptions; the curated list is a security boundary, not a menu.

---

## 8. CLI Reference

| Command | Does |
|---|---|
| `login` / `logout` | device flow, revoke |
| `run [--dir] [--keep] [--fresh] -- <cmd>` | push → exec → pull → terminate (one-shot; `--keep` leaves it live) |
| `status` / `stop` / `export` | live sandbox session lifecycle |
| `chat "…" [--conversation id \| --new] [--model id] [--system …] [--sub …]` | in-VM bot (default `bot/message`; `--sub exec` runs shell) |
| `verify <receipt.json \| conversationId>` | offline v0 + inference + Ed25519 checks |
| `policy [show]` / `policy set --level … [--models …] [--max-ttl …]` | view/enforce execution policy |
| `audit [--conversation id] [--limit N]` | append-only trail, newest first |
| `evidence <id> [--out file] [--decrypt]` | DPA bundle; decrypts transcripts locally |
| `image-trust` | offline check of the signed golden-image record |

Exit codes are meaningful: `0` all checks passed, non-zero otherwise —
gate CI pipelines on them.

---

## 9. Testing

- **Proof kit**: `scripts/near-ai-tests/` 00–11 (see
  [§5's table](#the-proof-kit-scriptsnear-ai-tests)), all green on
  `Qwen/Qwen3.8-27B`; embedding model kept as the negative control.
- **Image/agent**: `npx tsc --noEmit` in `packages/sandbox`; tamper and
  path-swap rejection unit-verified; round-trips verified both directions.
- **Live gates** (deployed backend + funded key): provision → init
  (preflight ~2s) → attach → chat (verified reply) → checkpoint →
  decrypt → terminate (auto-snapshot + signed receipt) → `verify` (9
  checks) → tamper a copy (must FAIL) → policy enforce → audit →
  evidence export → image-trust.
- **Widget gate**: closed conversation → model + gateway tabs (`partial`),
  response bound to chatId; our panel and the widget must agree on signers.
- **Worked example**: general chat → attach `my-name.txt` → ask about it
  → `verified provider_tee` reply → terminate → history decrypts, chain
  verified → receipt verifies → `verify` passes.

---

## 10. Project Status

- [x] Phase 0 — CLI auth (device flow, same Cognito user).
- [x] Phase 1 — disposable MicroVMs, sealed sync, warm sessions, receipts v0.
- [x] Phase 1.5 — website-first pivot: shell, bots, live chat, history.
- [x] Attestation: proof kit 00–07, in-VM 06 checks, per-message verification.
- [x] Signed receipts (Ed25519; KMS upgrade path open), widget embedding.
- [x] Policies (enforced), audit trail, evidence export, image trust records.
- [ ] Model switching mid-conversation (planned, unbuilt).
- [ ] Streaming replies with verify-after-consume (deferred; non-stream is the evidence-safe default).
- [ ] Receipt signing via KMS (format unchanged when it lands).
- [ ] Image signing (cosign), SBOM pinning, reproducible-build attestation.
- [ ] Per-customer egress controls (needs backend support).
- [ ] Phase 3 — Nitro confidential backend enabling `strict-confidential`
      (attestation-gated key release, approved measurements). Until it
      exists, that level fails closed by design.

---

## 11. Documentation

- Product thesis and build plan: [`PIVOT.md`](PIVOT.md),
  [`PLAN-P1.md`](PLAN-P1.md).
- Attestation evidence and rationale:
  [`scripts/near-ai-tests/FINDINGS.md`](scripts/near-ai-tests/FINDINGS.md).
- Related projects: [`../wayfind-cloud`](../wayfind-cloud) (backend),
  `../nearai-red-sandbox` (microVM agent sandbox that inspired the
  execution layer), `v1/` (archived predecessor — archaeology only).
- NEAR AI Cloud: [private inference](https://docs.near.ai/cloud/private-inference) ·
  [verification](https://docs.near.ai/cloud/verification/index) ·
  [verification policy](https://docs.near.ai/cloud/verification/reference/verification-policy) ·
  [JavaScript SDK](https://docs.near.ai/cloud/inference-sdk/javascript) ·
  [embedded widget](https://docs.near.ai/cloud/inference-sdk/widget/embedded) ·
  [Verification Center](https://docs.near.ai/cloud/verification/verification-center.md).
- NEAR examples: [verification example](https://github.com/near-examples/nearai-cloud-verification-example) ·
  [cloud verifier](https://github.com/nearai/nearai-cloud-verifier) (full `dcap-qvl` scope — upstream of us).
- NVIDIA: [confidential computing](https://www.nvidia.com/en-us/data-center/solutions/confidential-computing/) ·
  [attestation service](https://docs.api.nvidia.com/attestation/reference/attestationinfo).

*When in doubt, verify: `wayfind verify` is the source of truth, this file
is the map.*
