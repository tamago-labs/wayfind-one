# Wayfind ONE — private AI execution you can verify

> Ephemeral environments for verifiable private AI.
> Bring your data. Choose your AI. Verify where it runs.

Wayfind ONE is a managed website plus a CLI where customers run AI against
sensitive data in **disposable Firecracker microVMs** and receive the result
**together with independently verifiable security evidence**. No chatbot, no
VM provider, no inference API — a private execution environment with receipts.

The backend lives in a separate repo: **[wayfind-cloud](../wayfind-cloud)**
(Next.js 14 + Amplify Gen 2: auth, data, `wayfind-api` function, storage).
This repo holds the website frontend, the CLI, the sandbox agent image, the
NEAR attestation proof kit, and the product docs. The backend is referenced
throughout; nothing here works without it.

---

## Table of contents

1. [Why Wayfind ONE](#why-wayfind-one)
2. [Architecture](#architecture)
3. [Repository map](#repository-map)
4. [Prerequisites](#prerequisites)
5. [Quick start — CLI](#quick-start--cli)
6. [Quick start — website](#quick-start--website)
7. [The backend (wayfind-cloud)](#the-backend-wayfind-cloud)
8. [NEAR attestation end to end](#near-attestation-end-to-end)
9. [Core files reference](#core-files-reference)
10. [Security model](#security-model)
11. [Receipts](#receipts)
12. [Verification](#verification)
13. [Image trust](#image-trust)
14. [Policies, audit, evidence](#policies-audit-evidence)
15. [Configuration reference](#configuration-reference)
16. [Testing](#testing)
17. [Roadmap and status](#roadmap-and-status)
18. [Explicit non-goals](#explicit-non-goals)

---

## Why Wayfind ONE

- **Run AI where the data is too sensitive for chatbots.** Source code,
  contracts, financials, patient data — work happens inside a disposable
  microVM that is destroyed afterwards, not in a browser tab that trains
  someone's model.
- **Replace trust with evidence.** Every execution ends with a receipt
  binding who ran what, where, on which image, with which attested model,
  and when it was destroyed. The receipt is checkable offline
  (`wayfind verify`) and viewable in the NEAR Verification Center widget.
- **Keep every key off the endpoint.** Wayfind holds all provider keys
  server-side (Amplify secrets). The CLI, browser, and guest VM only ever
  see short-lived, session-scoped credentials that die with the session.
  No BYOK, no pasted API keys, no key files to leak.
- **Verify the inference, not just the VM.** NEAR AI runs inference inside
  Intel TDX + NVIDIA TEEs and signs responses. Wayfind checks the
  attestation *before* the first prompt and verifies every response
  signature against the retained evidence. Failed checks stop the session.
- **Keep the work after the VM is gone.** Sealed checkpoints, hash-chained
  transcripts, receipts, and evidence bundles persist under retention
  policy. History decrypts client-side; the control plane only ever sees
  ciphertext and hashes.
- **Start from a bot, or from nothing.** Bots are authored once (in
  Wayfind Cloud) and deployed as sealed bundles into disposable sessions.
  Ad-hoc conversations work the same way minus the bundle.

Use it for private code review, contract analysis, financial reconciliation,
research on unpublished work, and any agentic task over data that must never
leave a measured environment. The product is in active development; the
attested-inference path is live and the verification story grows monthly.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ Website (this repo: frontend/)        Customer-facing product│
│   Bots · Conversations · Verify · Activity · Settings        │
├─────────────────────────────────────────────────────────────┤
│ CLI (this repo: bin/, src/)           Sync · chat · verify  │
├─────────────────────────────────────────────────────────────┤
│ Wayfind Backend (../wayfind-cloud)    Auth · billing ready  │
│   Cognito (same pool, web + device flow) · orchestration    │
│   policy · audit trail · image trust · API proxy            │
│   NEAR AI credentials (Amplify secrets, server-side only)   │
├─────────────────────────────────────────────────────────────┤
│ Execution   Firecracker MicroVM · workspace · tools (this   │
│             repo: packages/sandbox — disposable, sealed)     │
│ Inference   NEAR AI TEE · session-scoped key · attestation  │
├─────────────────────────────────────────────────────────────┤
│ Evidence    NEAR attestation + Wayfind receipts (signed)     │
└─────────────────────────────────────────────────────────────┘
```

Direction of trust: the browser and CLI are *views*; the backend is the
*orchestrator*; the microVM is the *computer*; NEAR AI is the *inference*.
Nothing except the backend ever holds a long-lived key. Nothing except the
VM that owns a session ever sees workspace plaintext.

Where inference originates: **in the microVM for code/file tasks**. The VM
calls NEAR with a narrowly scoped session credential under the same
verification policy — never pretending the VM is confidential because the
inference provider is. Browser-side E2EE via NEAR's JS SDK is a documented
future for pure-chat tasks, not the current path.

---

## Repository map

```
wayfind-one/
├── bin/wayfind.js                  # CLI entry (login/run/chat/verify/…)
├── src/
│   ├── auth/                       # Cognito device flow, credential store
│   ├── commands/                   # CLI verbs (run/status/stop/chat/…)
│   └── sandbox/                    # sealed sync (AES-256-GCM envelopes)
├── frontend/                       # one.wayfind.click (Next.js 14 + Amplify)
│   ├── app/                        # landing + app shell routes
│   ├── components/                 # Landing, OneShell, VerificationWidget…
│   └── lib/                        # API client, receipt checks, envelopes
├── packages/sandbox/               # exec agent → golden microVM image
│   ├── src/server.ts               # REST + MCP router over tool modules
│   ├── src/tools/bot.ts            # in-VM bot loop + hash-chained transcript
│   ├── src/tools/ai.ts             # in-VM NEAR calls (non-stream, attested)
│   ├── src/tools/attest.ts         # preflight + per-message 06 checks
│   ├── src/tools/crypto.ts         # HKDF workspace key, sealed envelopes
│   ├── src/tools/sync.ts           # sealed push/pull, read_enc
│   └── scripts/image/              # 01-package → 02-create → 03-publish-trust
├── scripts/near-ai-tests/          # 00–11: attestation proof kit (see §8)
├── PIVOT.md                        # product thesis (vision, locks, phases)
├── PLAN-P1.md                      # build plan (active spec)
└── v1/                             # archived predecessor (reference only)
```

Backend (separate repo, linked): [`../wayfind-cloud`](../wayfind-cloud) —
`amplify/` (auth, data models, `functions/wayfind-api/` routes + lib,
storage), `app/` (old dashboard, untouched), `scripts/` (numbered test
kits this repo's conventions mirror).

---

## Prerequisites

- **Node.js 20+** (22 recommended; the sandbox image itself is node:24-alpine).
- **A Wayfind Cloud backend deployment** with these Amplify secrets set:
  `NEARAI_CLOUD_API_KEY`, `CONVERSATION_MASTER_KEY` (64 hex chars),
  `WAYFIND_RECEIPT_SIGNING_KEY` (Ed25519 PKCS#8 PEM),
  `IMAGE_TRUST_SECRET` (publish bearer), plus `TICK_SECRET`.
  Without them the API runs degraded on purpose: conversations fail closed
  instead of running unverifiable.
- **AWS credentials** (only for building/publishing the sandbox image).
- **A Wayfind account** — same Cognito user pool for website (direct login)
  and CLI (device flow via `wayfind.click/cli-login`).

---

## Quick start — CLI

```sh
cd wayfind-one
node bin/wayfind.js login        # device flow — approve at wayfind.click/cli-login
node bin/wayfind.js run --dir ./demo -- 'echo hello from the VM'
```

Warm reuse, keep-alive sessions, and export:

```sh
node bin/wayfind.js run --dir ./demo --keep -- 'echo probe > output.txt'
node bin/wayfind.js status       # live session, endpoint, timestamps
node bin/wayfind.js export       # pull the diff back (hash-verified, decrypted)
node bin/wayfind.js stop         # terminate + verified destroy
```

Talk to a bot living in a disposable computer:

```sh
node bin/wayfind.js chat "Review my repo for injection bugs" --new --system "You are a terse security reviewer."
node bin/wayfind.js chat "And the auth module?" --conversation <id>   # same VM, chained transcript
```

Verify anything, offline:

```sh
node bin/wayfind.js verify <receipt.json | conversationId>
```

Sync, policy, audit, evidence, image trust:

```sh
node bin/wayfind.js run --dir ./repo -- 'make test'     # push → exec → pull → terminate
node bin/wayfind.js policy show
node bin/wayfind.js policy set --level verified_inference
node bin/wayfind.js audit --limit 20
node bin/wayfind.js evidence <conversationId> --decrypt evidence.json
node bin/wayfind.js image-trust   # offline Ed25519 check of the golden image
```

---

## Quick start — website

```sh
cd frontend
npm install
npm run dev     # http://localhost:3001 (Google login needs :3000 or the prod callback)
```

Sign in with the same account as the CLI. The shell has six areas:

- **New** — bot + model + security level + system prompt + first message,
  with staged progress (provisioning → attestation → inference).
- **Conversations** — live view (messages with per-reply verification
  labels, attach files, terminate) and closed history (decrypts
  client-side, chain re-verified in the browser).
- **Bots** — one click starts a private conversation with that bot.
- **Verify** — paste a receipt or conversation id; runs the same checks as
  the CLI plus the server signature re-check.
- **Activity** — append-only audit trail with per-row evidence download.
- **Settings** — execution policy (enforced server-side, fail-closed) and
  the sandbox image trust record.

Attach a file mid-conversation and ask about it — the bot reads the live
workspace on every turn (text files, capped, binaries skipped).

---

## The backend (wayfind-cloud)

The backend is [`../wayfind-cloud`](../wayfind-cloud) and this repo treats
it as a service boundary: same Cognito user pool, one `wayfind-api`
Function URL, no shared code. What lives there:

- **`amplify/auth/resource.ts`** — Cognito pool (email + Google). The
  website logs in directly; the CLI uses the device flow
  (`app/cli-login/page.tsx` approves `XXXX-XXXX` codes).
- **`amplify/data/resource.ts`** — `Conversation` (session metadata,
  escrowed key, checkpoint manifest, receipt — never history content),
  `Checkpoint` (seq/sha/blob pointers), `Policy`, `AuditEvent`
  (function-written, owner-readable), `ImageTrust`, plus the older
  `SandboxSession`, `Bot`, `Computer`, `Routine`, `DeviceCode`,
  `CliToken` models.
- **`amplify/functions/wayfind-api/`** — thin dispatcher (`handler.ts`)
  over `lib/` (auth, microvm, escrow, policy, audit, reports, receipts,
  respond, clients) and `routes/` (auth, sandbox, conversations, computer,
  sync, routines, usage, verify, policy, evidence).
- **`amplify/storage/` + S3** — sealed checkpoint blobs
  (`checkpoints/{owner}/{conversation}/{seq}.bin`, opaque to the backend).

Key backend contracts the frontend and CLI rely on:

| Route | Purpose |
|---|---|
| `POST /conversations` | provision disposable VM + escrow key + session row (policy-gated) |
| `POST /conversations/:id/message` | generic relay (`bot/message`, `bot/init`, `exec`, `read_enc`, `checkpoint`, `bot/evidence`…) |
| `POST /conversations/:id/terminate` | final sealed snapshot → verified kill → signed receipt |
| `GET /conversations/:id/key` | release escrowed + workspace keys to the owner over TLS |
| `GET /conversations/:id/checkpoint-url?seq=` | presigned blob GET (scripts/CI use) |
| `GET /conversations/:id/checkpoint-blob?seq=` | same blob relayed as JSON (browsers; no CORS issue) |
| `POST /conversations/:id/workspace` | browser/CLI uploads sealed server-side, relayed into the VM |
| `GET /conversations/:id/verification-reports` | widget-format evidence (see §8) |
| `POST /conversations/:id/export-evidence` | DPA bundle: receipt + checkpoints + reports |
| `GET|PUT /policy`, `GET /audit` | policy + append-only audit trail |
| `GET /verify-key`, `POST /verify-receipt` | Ed25519 public key + server re-check |
| `GET|POST /image-trust[/publish]` | signed golden-image record (bearer-gated publish) |

---

## NEAR attestation end to end

This is the core intellectual property of the repo: every hop from raw
NEAR evidence to UI badge is scripted, tested, and portable into product
code. The full chain:

```
scripts/near-ai-tests/ 00–11   →   agent attest.ts (preflight + per-message)
                               →   backend receipts (inference block + signature)
                               →   CLI verify / website panel / NEAR widget
```

### The proof kit (`scripts/near-ai-tests/`)

Run from the repo root, e.g. `npx tsx scripts/near-ai-tests/01-gateway-attestation.ts`.
Shared helpers live in [`scripts/near-ai-tests/config.ts`](scripts/near-ai-tests/config.ts)
(nonce, sha256, API calls, NVIDIA decode/summarize, EIP-191 recovery,
state file, pass/fail reporter). Every script exits non-zero on any failed
check. Results and enterprise rationale:
[`scripts/near-ai-tests/FINDINGS.md`](scripts/near-ai-tests/FINDINGS.md).

| Script | What it proves | Product decision it unlocked |
|---|---|---|
| `00-baseline.ts` | upstream-example parity: attestation → NVIDIA → chat → signature | go/no-go for everything below |
| `01-gateway-attestation.ts` | gateway-only report + fresh-nonce echo | baseline trust anchor |
| `02-model-attestation.ts` | per-node nonce echo, signing addresses → state | which models/keys `ai` pins |
| `03-nvidia-verify.ts` | NRAS overall verdict + `eat_nonce` match, timed | verify-per-request affordable (~1s), no cache |
| `04-chat-provider-tee.ts` | non-stream chat → `provider_tee`, hashes + signer vs preflight | `ai` demands provider_tee for attested tasks |
| `05-chat-gateway-sign.ts` | streamed chat → `gateway` signer = gateway address | stream implies gateway-kind; record the kind |
| `06-policy-gate.ts` | policy as code, fail-closed end to end | became `verify` core + in-VM checks |
| `07-receipt-bind.ts` | receipt-shape JSON prototype | receipt schema v0 |
| `08–11` *(planned)* | SDK `verifyResponse`, streaming-keeps-evidence, E2EE round-trip, widget-report rendering | Phase 2 verifier + widget |

Default model: `Qwen/Qwen3.8-27B` (full chain verifies). `Qwen/Qwen3-Embedding-0.6B`
is the negative control: TEE-hosted and NVIDIA-verifiable, but not
chat-capable (gateway 404s it) — the kit correctly rejects it.

API surface used (all documented at https://docs.near.ai/cloud):

- `GET {cloud-api}/v1/attestation/report?model=…&signing_algo=ecdsa&nonce=…`
- `POST {cloud-api}/v1/chat/completions` (exact request/response bytes hashed)
- `GET {cloud-api}/v1/signature/{chatId}?model=…&signing_algo=ecdsa` (bounded retry: signatures live on the serving node)
- `POST https://nras.attestation.nvidia.com/v3/attest/gpu` (verdict + `eat_nonce`)

### In-VM verification (`packages/sandbox/src/tools/attest.ts`)

The agent ports 00–06 into the guest:

1. **`bot/init`** runs the preflight: fresh nonce → attestation report →
   nonce echo on every node → NVIDIA overall + `eat_nonce` check → retain
   candidates (`modelTee[]`, `gateway`). Fails closed (502) for NEAR
   providers when anything is missing. Standard-tier providers skip it
   honestly (`checked: false`, never claimed).
2. **`bot/message`** runs the chat, then the 06 checks: fetch signature
   (bounded retry for multi-node 404s), kind/shape match, request/response
   hash match, model-id binding for `provider_tee`, signer recovery
   (`ethers.verifyMessage`) against exactly one retained candidate.
3. **`bot/evidence`** exposes preflight + per-message records for receipts
   and the widget.

No `dcap-qvl` TDX quote verification in the guest — that is upstream scope
(the full NEAR verifier repo). Our claims stop where our evidence stops;
see [Security model](#security-model).

### Receipts and the widget

Terminating a conversation pulls `/bot/evidence`, binds it into the
receipt as `inference`, signs the whole receipt (Ed25519, control-plane
key), and stores it. [`lib/reports.ts`](../wayfind-cloud/amplify/functions/wayfind-api/lib/reports.ts)
converts it to the NEAR Verification Center format
(`VerificationReport[]`), served at
`GET /conversations/:id/verification-reports`. The website embeds the
official iframe ([`components/VerificationWidget.tsx`](frontend/components/VerificationWidget.tsx))
and serves our reports through it — the viewer renders structure only;
our 06 checks remain the trust anchor. Honest mapping: `tcbStatus:
Unknown`, provenance `not_checked`, model scope `partial` (never
`verified`), gateway scope with unattested TLS binding.

---

## Core files reference

CLI (`bin/wayfind.js` dispatches to `src/commands/`):

- [`src/auth/client.js`](src/auth/client.js) + [`src/auth/store.js`](src/auth/store.js) — device flow, `~/.wayfind/credentials.json` (0600).
- [`src/sandbox/api.js`](src/sandbox/api.js) — provision/reuse/status/stop/relay client.
- [`src/sandbox/crypto.js`](src/sandbox/crypto.js) — HKDF workspace key, AES-256-GCM seal/open. **Must stay byte-identical in behavior** to the agent mirror.
- [`src/sandbox/sync.js`](src/sandbox/sync.js) — hash-skipping push/pull over sealed envelopes.
- [`src/commands/run.js`](src/commands/run.js) — one-shot disposable runs (+ `--keep` for live sessions).
- [`src/commands/chat.js`](src/commands/chat.js) — `--new` / `--conversation` bot sessions.
- [`src/commands/verify.js`](src/commands/verify.js) — offline receipt checks + Ed25519 (cached key, rotation-aware).
- [`src/commands/policy.js`](src/commands/policy.js), [`audit.js`](src/commands/audit.js), [`evidence.js`](src/commands/evidence.js), [`image-trust.js`](src/commands/image-trust.js) — policy/audit/DPA/image CLIs.

Sandbox agent (`packages/sandbox/` → golden image `wayfind-sandbox`):

- [`packages/sandbox/src/server.ts`](packages/sandbox/src/server.ts) — REST + MCP router. Tool logic lives in `src/tools/*`.
- [`packages/sandbox/src/tools/bot.ts`](packages/sandbox/src/tools/bot.ts) — bot loop: `bot_init`, `bot_message` (transcript render + workspace files + `/ai` + verify), `bot_transcript`, `checkpoint`, `bot_evidence`.
- [`packages/sandbox/src/tools/ai.ts`](packages/sandbox/src/tools/ai.ts) — non-streaming NEAR calls; 503 without injected credential, 501 for non-NEAR providers.
- [`packages/sandbox/src/tools/attest.ts`](packages/sandbox/src/tools/attest.ts) — the in-guest verifier (see §8).
- [`packages/sandbox/src/tools/crypto.ts`](packages/sandbox/src/tools/crypto.ts) — agent-side mirror of `src/sandbox/crypto.js`.
- [`packages/sandbox/src/tools/sync.ts`](packages/sandbox/src/tools/sync.ts) + [`files.ts`](packages/sandbox/src/tools/files.ts) — sealed `sync_in`, `read_enc`, legacy-plaintext fallback for old CLIs.
- [`packages/sandbox/src/lifecycle.ts`](packages/sandbox/src/lifecycle.ts) + [`session.ts`](packages/sandbox/src/session.ts) — boot contract (`/hooks/run` injects bearer + AI credentials, memory-only).
- [`packages/sandbox/scripts/image/`](packages/sandbox/scripts/image/) — `01-package-upload.ts` (tsc → SBOM → zip → S3 + hashes), `02-create-image.ts` (`--replace`), `03-publish-trust.ts` (signed image record).

Frontend (`frontend/` → `one.wayfind.click`):

- [`frontend/app/page.tsx`](frontend/app/page.tsx) — landing (hero + login) ↔ `OneShell` switch on Amplify auth state.
- [`frontend/components/OneShell.tsx`](frontend/components/OneShell.tsx) — New / Bots / Conversations / Verify / Activity / Settings.
- [`frontend/components/VerificationWidget.tsx`](frontend/components/VerificationWidget.tsx) — NEAR iframe + `postMessage` bridge.
- [`frontend/lib/wayfind.ts`](frontend/lib/wayfind.ts) — authed API client (Cognito id token).
- [`frontend/lib/receipt.ts`](frontend/lib/receipt.ts) — browser receipt checks (port of the CLI's).
- [`frontend/lib/envelope.ts`](frontend/lib/envelope.ts) — WebCrypto AES-GCM open + transcript chain verify.
- [`frontend/lib/data.ts`](frontend/lib/data.ts) + [`frontend/components/Catalog.tsx`](frontend/components/Catalog.tsx) — owner-scoped reads, curated model catalog.

Backend (in [`../wayfind-cloud`](../wayfind-cloud), linked for orientation):

- `amplify/data/resource.ts` — `Conversation`, `Checkpoint`, `Policy`, `AuditEvent`, `ImageTrust` (+ older `SandboxSession`, `Bot`, `Computer`, `DeviceCode`, `CliToken`).
- `amplify/functions/wayfind-api/routes/conversations.ts` — create/message/terminate/checkpoint/key/workspace/verification-reports/export-evidence.
- `amplify/functions/wayfind-api/routes/{policy.ts,verify.ts,evidence.ts,auth.ts,sandbox.ts,computer.ts}` — policy/audit, verify-key/verify-receipt, evidence+image-trust, device flow, sandbox relay, legacy computer.
- `amplify/functions/wayfind-api/lib/{escrow,policy,audit,reports,receipts,respond}.ts` — key wrap/unwrap, policy gate, audit emit, widget reports, Ed25519 sign/verify.

---

## Security model

### The honesty rule (non-negotiable)

Every claim is labeled, never mixed:

- **`observed`** — Wayfind saw it (image digest, timestamps, hashes).
- **`signed`** — Wayfind attests it (Ed25519 receipt signature).
- **`hardware-attested`** — independent hardware proof (NEAR inference only).

Two attestations are never conflated:

1. **Inference attestation** — is NEAR's environment genuine and running the approved model? Verified per request path (preflight + signatures).
2. **Execution attestation** — is the workspace environment genuine and running approved software? Established by disposable Firecracker isolation + immutable signed images today; hardware-backed execution attestation waits for the Phase 3 Nitro backend.

A Firecracker microVM gives **isolation** (host protected from workload),
not **confidentiality** (workload protected from operator). We say so in
the product, in receipts, and in this file.

### What's protected, from whom

| Threat | Protection | Limit |
|---|---|---|
| Network/storage observers | TLS + per-file AES-256-GCM workspaces; sealed checkpoints | manifest metadata (names/sizes/hashes) visible to relay |
| Other tenants | per-session keys, disposable VMs, owner-scoped rows | — |
| Tampered results | response signatures bound to request/response hashes | requires the signature lookup window (~60 min) |
| Tampered history | hash-chained transcripts, append-only audit, signed checkpoints | endpoint compromise excluded (standard assumption) |
| Malicious infrastructure (inference) | TDX + NVIDIA TEEs, verified per request | host-operator visibility into the *VM* (not the TEE) |
| Key theft at rest | Amplify secrets; escrowed keys wrapped; memory-only in guests | possession of a live session bearer equals that session |

### Fail-closed roster

Missing `CONVERSATION_MASTER_KEY` → provision 500s. Missing
`NEARAI_CLOUD_API_KEY` → near-ai conversations fail at first inference.
Missing `WAYFIND_RECEIPT_SIGNING_KEY` → receipts stay `observed`
(unsigned), loudly. Unsupported policy (`strict-confidential` before the
Nitro backend) → 400, never silent downgrade. Unverifiable signature or
stale nonce → response rejected, never accepted on trust.

---

## Receipts

Unsigned v0 (`class: "observed"`) binds what the backend saw. Signed v0
(`class: "signed"`) adds an Ed25519 signature over the canonical JSON
(sorted keys, recursive — see `canonicalize` in both
[`src/commands/verify.js`](src/commands/verify.js) and backend
`lib/receipts.ts`; the two implementations must stay identical).

```jsonc
{
  "version": "wayfind-receipt/v0",
  "class": "signed",
  "conversationId": "…",
  "botId": null, "botBundleHash": "…", "workspaceHash": "…",
  "model": "Qwen/Qwen3.8-27B",
  "provider": "near-ai",
  "securityLevel": "standard",
  "checkpointManifest": ["0:<sha256>", "1:<sha256>"],
  "provisionedAt": "…", "terminatedAt": "…",
  "cleanup": { "vmTerminated": true },
  "finalSnapshot": { "recorded": true, "seq": 2 },
  "inference": {
    "preflight": { "nonceEchoed": true, "modelTee": ["0x835A…"], "gateway": ["0xb98A…"], "nvidia": { "overall": true, "nonceMatch": true, "gpus": 8 } },
    "messages": [{ "seq": 1, "chatId": "…", "kind": "provider_tee", "signer": "0x835A…", "valid": true, "signedText": "…", "signature": "0x…" }],
    "verified": true
  },
  "signature": { "kid": "218ecd601d93b709", "algo": "ed25519", "sig": "…" }
}
```

Key management: signing key in `WAYFIND_RECEIPT_SIGNING_KEY` (Ed25519
PKCS#8 PEM). Public key at `GET /verify-key` (`{kid, algo, publicKey}`).
The CLI caches it in `~/.wayfind/verify-key.json` and refetches on `kid`
rotation. KMS upgrade later changes only the signer, never the format.

---

## Verification

Three independent ways to check the same evidence (they must agree; if
they don't, believe the failure):

1. **CLI offline** — `wayfind verify <receipt.json|conversationId>`:
   shape, chain order, time order, cleanup, inference block, then Ed25519
   over the canonical bytes. Fully offline except the one-time public-key
   fetch. Tampered receipts fail here first.
2. **Website panel** — same hash/chain/evidence checks in
   [`frontend/lib/receipt.ts`](frontend/lib/receipt.ts), plus the
   server-side signature re-check (`POST /verify-receipt`) for browsers
   without WebCrypto Ed25519. True offline verification remains the CLI.
3. **NEAR Verification Center widget** — the official iframe fed by our
   `VerificationReport[]` (`GET /conversations/:id/verification-reports`,
   `?chatId=` selects the completion). It validates *structure*, not
   evidence — treat its "Verified" as "structurally valid + evidence
   present", and our checks as the trust decision.

---

## Image trust

The golden image is built reproducibly: `tsc` → `npm ci --omit=dev` →
CycloneDX SBOM → zip → S3, with `zipSha256`/`sbomSha256` recorded in
state. `03-publish-trust.ts` publishes a control-plane-signed manifest
(`imageArn`, `imageVersion`, hashes, `builtAt`) via a bearer-gated route;
`GET /image-trust` serves the current record; `wayfind image-trust`
verifies it offline against the receipt keyring and shows SBOM status.

What this proves: *which bytes* run in your VM and that Wayfind signed
that statement. What it does not (yet): reproducible-build attestation
and measured-boot binding — those arrive with cosign/SBOM pinning and the
Nitro backend.

---

## Policies, audit, evidence

- **Policies** (`GET|PUT /policy`, `wayfind policy`, Settings tab):
  `mandatoryLevel` (`none|standard|verified_inference`), `allowedModels`
  (empty = curated list), `maxIdleTtlSeconds`. Enforced at provision:
  weaker levels 400/403, unknown models rejected, TTL clamped.
- **Audit** (`GET /audit`, `wayfind audit`, Activity tab): append-only
  `conversation.created|terminated`, `policy.updated`,
  `evidence.exported`, `image.published` with actor + detail. No update or
  delete path exists on purpose.
- **Evidence export** (`POST /:id/export-evidence`, `wayfind evidence`,
  download buttons): receipt + sealed checkpoint blobs + NEAR reports in
  one JSON bundle. `--decrypt` (CLI) or the history viewer (web) opens
  transcripts client-side with the escrowed workspace key.

---

## Configuration reference

CLI (`~/.wayfind/credentials.json`, 0600) holds the CliToken; override the
backend with `WAYFIND_API_URL`. Frontend reads the same Amplify outputs
reference-copy (`frontend/amplify_outputs.json` — re-copy after backend
deploys that change outputs).

Backend Amplify secrets (console → Secrets; baked at deploy time, so set
*before* deploying):

| Secret | Purpose | Missing behavior |
|---|---|---|
| `NEARAI_CLOUD_API_KEY` | in-VM + relay NEAR calls | near-ai conversations fail at first inference (fail-closed) |
| `CONVERSATION_MASTER_KEY` | 64-hex master for escrow wrapping | provision 500s (fail-closed) |
| `WAYFIND_RECEIPT_SIGNING_KEY` | Ed25519 PKCS#8 PEM, signs receipts + image manifests | receipts stay `observed` (loud) |
| `IMAGE_TRUST_SECRET` | bearer for the publish ceremony | publish 403s |
| `TICK_SECRET` | routine ticker auth | ticker 401s |
| `MODAL_API_KEY`, `PROVIDER_API_KEY` | legacy computer paths | legacy features fail |

Image pipeline (`packages/sandbox/scripts/image/.env`, gitignored):

| Var | Purpose |
|---|---|
| `MICROVM_BUCKET`, `MICROVM_BUILD_ROLE_ARN`, `MICROVM_BASE_IMAGE_ARN` | where/how images build |
| `IMAGE_TRUST_SECRET` | same value as the console secret (publish auth) |
| `WAYFIND_API_URL` | backend target for publish (defaults to prod) |

---

## Testing

- **Backend unit shape**: `npx tsc --noEmit -p amplify/tsconfig.json`
  (the two `$amplify/env` errors are expected locally — generated at deploy).
- **Image**: `npx tsc --noEmit` in `packages/sandbox`.
- **Live gates** (need deployed backend + funded NEAR key): provision →
  init (preflight ~2s) → attach → chat (verified reply) → checkpoint →
  decrypt → terminate (auto-snapshot + signed receipt) → `verify`
  (9 checks) → tamper a copy (must FAIL) → policy enforce → audit →
  evidence export → image-trust. The repo's `scripts/` convention is
  numbered, exit-nonzero-on-failure, sample-output-pasted-at-the-bottom.
- **Widget gate**: closed conversation → iframe shows model + gateway tabs
  (`partial`), response bound to chatId; our panel and the widget must
  agree on signers.

## Worked example — private code review, end to end

```sh
# 1. CLI: provision a conversation and attach the repo slice
node bin/wayfind.js chat "Review for injection bugs" --new --system "You are a terse security reviewer, Qwen/Qwen3.8-27B."
# → Conversation 4f19ea87… live (Qwen/Qwen3.8-27B, standard).

# 2. Website: open it, attach auth.py + db.py, ask "where is user input trusted?"
# → assistant: verified provider_tee, signer 0x835A… (matches preflight)

# 3. Terminate from either surface. The backend:
#    - pulls a final sealed transcript snapshot (seq N),
#    - pulls /bot/evidence (preflight + per-message checks),
#    - terminates the VM and verifies destruction,
#    - writes receipt v0 + signs it with the control-plane key.

# 4. Verify three ways (must agree):
node bin/wayfind.js verify 4f19ea87…          # 9 PASS offline
# website Verify tab → same 9 checks + server signature re-check
# NEAR widget → model + gateway tabs, response bound to chatId

# 5. Audit + export:
node bin/wayfind.js audit --conversation 4f19ea87…
node bin/wayfind.js evidence 4f19ea87… --decrypt evidence.json
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `PUT /policy` 200 but nothing enforced | old bundle live (no gate code) | check `/health` rev, redeploy |
| `403 policy requires security level …` | mandatory level set higher | `wayfind policy show`; relax or upgrade the request |
| `503 no ai credential` on `bot/message` | session booted without key injection | re-provision (transient hook miss) or check `NEARAI_CLOUD_API_KEY` |
| `502 attestation preflight failed` | NVIDIA/NRAS or nonce mismatch | retry once (transient), then check model TEE status |
| `404 conversation not found` (old id) | row orphaned by a data-table replacement | rows are disposable by design; receipts saved at terminate time survive |
| `verify` FAIL on signature only | receipt signed pre-fix (label flip bug era) or tampered copy | expected for old test rows; fresh conversations verify |
| Image `--replace` refuses: running microVMs | a live session holds the image | terminate sessions first (or wait out idle TTL) |
| `npm sbom` ESBOMPROBLEMS | ran outside the staged lockfile | use `--package-lock-only` (as in `01-package-upload.ts`) |
| Widget blank / no reports | adblock/CSP, or no evidence retained | allow `https://cloud.near.ai` in `frame-src`; check `/verification-reports` directly |
| `401 unauthorized: unknown CLI token` | table replaced, token row gone | `wayfind login` again |

## CLI reference

| Command | Does |
|---|---|
| `login` / `logout` | device flow (approve at `wayfind.click/cli-login`), revoke |
| `run [--dir] [--keep] [--fresh] -- <cmd>` | push → exec → pull → terminate (one-shot; `--keep` leaves it live) |
| `status` / `stop` / `export` | live sandbox session lifecycle |
| `chat "…" [--conversation id \| --new] [--model id] [--system …] [--sub …]` | talk to the in-VM bot (default `bot/message`; `--sub exec` runs shell) |
| `verify <receipt.json \| conversationId>` | offline v0 + inference + Ed25519 checks |
| `policy [show]` / `policy set --level … [--models …] [--max-ttl …]` | view/enforce execution policy |
| `audit [--conversation id] [--limit N]` | append-only trail, newest first |
| `evidence <id> [--out file] [--decrypt]` | DPA bundle; decrypts transcripts locally |
| `image-trust` | offline check of the signed golden-image record |

Exit codes are meaningful: `0` all checks passed, non-zero otherwise —
CI pipelines should gate on them.

## Glossary- **Preflight** — fresh-nonce attestation + NVIDIA check at session start; candidates retained for the session.
- **06 checks** — kind/shape match, hash binding, model binding, exact-candidate signer recovery, fail-closed.
- **`provider_tee` / `gateway`** — which TEE signed a response: the model TEE (request/response + model id) or the gateway TEE (exact bytes delivered, e.g. streams).
- **Checkpoint** — sealed transcript snapshot (`seq:sha` manifest entries, blobs in S3).
- **Receipt v0** — unsigned (`observed`) or Ed25519-signed (`signed`) execution manifest. Format frozen; only the signer upgrades.
- **Hybrid-C** — hot state in the VM, sealed snapshots out, escrowed keys server-side.
- **Curated model** — passed `scripts/near-ai-tests/` 00–11; the only kind the backend will provision.

---

## Roadmap and status
- [x] Phase 1 — disposable MicroVMs, sealed sync, warm sessions, receipts v0.
- [x] Phase 1.5 — website-first pivot: `/app` replacement shell, bots, live chat.
- [x] Attestation kit 00–07 + in-VM 06 checks + signed receipts + widget.
- [x] Policies, audit trail, evidence export, image trust (records + CLI).
- [ ] Model switching mid-conversation (planned, unbuilt).
- [ ] Streaming replies with verify-after-consume (deferred; non-stream is the evidence-safe default).
- [ ] Receipt signing via KMS (format unchanged when it lands).
- [ ] Image signing (cosign), SBOM pinning, reproducible-build attestation.
- [ ] Per-customer egress controls (needs backend support).
- [ ] Phase 3 — Nitro confidential backend enabling `strict-confidential`
      (attestation-gated key release, approved measurements). Until it
      exists, that level fails closed by design.

---

## Conventions (read before changing things)

- **Numbered scripts, exit codes, sample output.** Test kits live in
  `scripts/<area>/NN-name.ts`, run with `npx tsx` from the repo root,
  exit non-zero on any failed check, and paste a passing run at the
  bottom of the file. Working calls transfer directly into product code.
- **Fail closed, loudly.** Missing secrets, unverifiable signatures,
  stale nonces, wrong security levels: 4xx/5xx with the reason, never a
  silent downgrade. The one deliberate exception (unsigned receipts when
  the signing key is absent) logs every time.
- **No plaintext where ciphertext will do.** Contents are sealed;
  manifests carry hashes. Debug output must never include keys, tokens,
  prompts, or decrypted bytes — only digests, ids, and timings.
- **Backend is the source of truth for identity.** The CLI and website
  never mint credentials; they trade short-lived tokens. Owner checks
  happen row-side (`getOwnedConversation` pattern), never client-side.
- **Wire format is the contract.** `src/sandbox/crypto.js` (CLI) and
  `packages/sandbox/src/tools/crypto.ts` (agent) must stay
  behavior-identical; the canonical JSON in `verify.js` and backend
  `lib/receipts.ts` likewise. Change one, change both, test the
  round-trip.
- **Docs stay honest.** If a check isn't implemented, the doc says
  `not_checked` / `Unknown` / deferred — never implied. Receipt classes
  exist so marketing can't outrun evidence.

---

## Explicit non-goals
BYOK, local agent loops, harness plugins, MCP-as-product, live mounts
(virtio-fs/9p/FUSE), S3 in the live transfer path, suspend/resume,
SSO/SAML, BYOC, full TDX quote verification (`dcap-qvl` — upstream scope),
browser-E2EE chat at launch, streaming before verify-after-consume lands,
enterprise billing (deferred), and any security promise the evidence
doesn't support.

---

*Wayfind ONE is built on [NEAR AI Cloud](https://docs.near.ai/cloud)
attested inference and AWS Lambda MicroVMs. The verification protocol
follows [NEAR's verification docs](https://docs.near.ai/cloud/verification);
the website embeds the official Verification Center. When in doubt, verify:
`wayfind verify` is the source of truth, this file is the map.*

---

## Related reading

- NEAR AI Cloud: [private inference](https://docs.near.ai/cloud/private-inference)
  · [verification index](https://docs.near.ai/cloud/verification/index)
  · [verification policy](https://docs.near.ai/cloud/verification/reference/verification-policy)
  · [JavaScript inference SDK](https://docs.near.ai/cloud/inference-sdk/javascript)
  · [embedded widget](https://docs.near.ai/cloud/inference-sdk/widget/embedded)
  · [Verification Center](https://docs.near.ai/cloud/verification/verification-center.md)
- NEAR examples: [verification example](https://github.com/near-examples/nearai-cloud-verification-example)
  (ported as `scripts/near-ai-tests/00` baseline) · [cloud verifier](https://github.com/nearai/nearai-cloud-verifier)
  (full `dcap-qvl` scope — upstream of us)
- NVIDIA: [confidential computing](https://www.nvidia.com/en-us/data-center/solutions/confidential-computing/)
  · [attestation service](https://docs.api.nvidia.com/attestation/reference/attestationinfo)
- Sibling work: `../nearai-red-sandbox` (disposable-microVM agent sandbox that
  inspired the execution layer) · `../wayfind-cloud` (the backend this repo
  drives) · `v1/` (archived predecessor — read for archaeology, not direction).
