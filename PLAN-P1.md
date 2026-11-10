# PLAN-P1 — verifiable, ephemeral AI execution (CLI only)

Rewritten 2026-11-10. Only two phases. No dashboard, no BYOK, no local
loop, no harness plugins. The product: issue an isolated, disposable
execution environment, transfer a workspace into it, run private AI
inference, return the results — with evidence, not trust.

## Locked decisions

- **CLI is the entire product surface.** `login/run/push/exec/ai/verify/
  pull/destroy`. No dashboard, no MCP config, no plugins.
- **Wayfind provides everything, including inference keys. No BYOK.**
  Keys live in Amplify secrets, never on user disk. Per task the user
  chooses: `muse-spark` (cheap test/dry-run) or `near-ai` (attested).
- **Session-scoped credentials only.** Long-lived provider keys never
  enter the sandbox. At provision the backend mints a short-lived,
  session-bound credential, injects it via `/hooks/run` (memory-only,
  never logged), revokes it at terminate.
- **Receipt signing: Amplify secret now, KMS later.** The receipt format
  is fixed; only the signer upgrades.
- **`wayfind ai` is thin (Phase 1):** single prompt in, text out, tools
  execute via the existing exec agent. No multi-turn loop in the
  product — harnesses stay outside by design.
- **Backend is replaceable:** `lambda-microvm` now; `nitro-sandbox`
  later (`--confidential` fails closed until then).

## Honesty rule (non-negotiable)

A Firecracker microVM gives **isolation** (host protected from workload),
not **confidentiality** (workload protected from operator). Receipts
distinguish three evidence classes and never mix them:

- **observed** — Wayfind saw it (image digest, timestamps, hashes).
- **signed** — Wayfind attests it (receipt signature).
- **hardware-attested** — independent hardware proof (NEAR inference
  attestation only; never claimed for the VM itself until Phase 3).

## Phase 1 — secure ephemeral execution

Goal: `login → run → push → exec/ai → pull → verify → destroy` fully
working, every session disposable, every transfer encrypted.

1. **Auth** — done, deployed (device flow, CliToken, same Cognito user).
2. **Provision disposable VM** — done, live-verified (sandbox image,
   session bearer, smoke test, orphan cleanup with verify-terminate).
3. **SandboxSession rows** — done, live-verified (warm reuse via `run
   --keep`, `status`/`stop`/`export`, wall-clock metering hook).
4. **Encrypted workspace transfer.** Per-session AES-256-GCM. No key
   transport: the workspace key is `HKDF-SHA256(session bearer)` — the
   bearer already reaches exactly CLI + agent and dies with the session.
   CLI seals chunks (unique nonce per file, path + plaintext sha in the
   cryptographic context), pushes ciphertext through the relay; agent
   decrypts in memory, executes, seals outputs, CLI verifies hashes and
   decrypts locally. S3 stays out of the path entirely
   (direct transfer; encrypted object storage only if resumable sessions
   are ever needed — not P1).
5. **Provider setup (Wayfind-held).** `MODAL/NEAR_API_KEY` + test key as
   Amplify secrets. `wayfind ai "prompt" [--provider near-ai|muse-spark]`:
   CLI sends prompt + provider choice; backend resolves a session-scoped
   credential; in-sandbox `/ai` endpoint calls the provider over TLS and
   returns text. Default `muse-spark` (cheap dry-run); `near-ai` for
   attestation tasks. Keys never touch disk, logs, or the workspace.
6. **Restricted egress.** Default-deny + NEAR endpoint + package-registry
   preset. Per-customer allowlists defer to Phase 2.
7. **Pull + destroy.** `pull` (encrypted, hash-verified), `destroy`
   (terminate + revoke session credential + mark row; no plaintext
   workspace persists anywhere).
8. **Receipt v0.** Unsigned JSON manifest per session: session id,
   workspace hash, image digest, runtime version, provider, endpoint
   identity, started/terminated at, output hash, cleanup status —
   labeled `observed`. `verify` checks hashes + session chain. Signing
   lands in Phase 2; the format does not change.

Exit: clean machine → login → run → push → exec/ai → pull → verify →
destroy, all encrypted, all disposable, no user-held keys anywhere.

## Phase 2 — verifiable execution

Goal: every Phase-1 claim becomes independently checkable.

1. **Signed images.** Cosign/Sigstore signing, SBOM, reproducible builds,
   pinned kernel + runtimes, versioned policy. `inspect` shows
   image digest + signature + SBOM before authorizing a run.
2. **Receipt signing.** Control-plane key (Amplify secret → KMS upgrade
   path) signs every receipt. `verify` checks the signature offline.
3. **NEAR attestation verification.** Port near-red's verifier (TDX
   quotes + GPU evidence + pinned TLS + signed receipts, nonce-fresh
   per request) into the CLI/verifier; bind the verified inference
   identity into each receipt (`inference_attestation_verified: true`
   only when actually verified — never otherwise).
4. **Session-bound keys, formalized.** Key release tied to provision
   lifecycle with explicit expiry; per-service scoping where the
   provider supports it (e.g. repo-scoped tokens, never personal keys).
5. **Audit trail.** Append-only per-tenant log: who ran what, where,
   with which policy/image/provider; retention controls.
6. **Policy enforcement.** Per-customer egress allowlists, `--require-
   attestation` (fails closed on providers/deployments without it).

Exit: an enterprise security review can independently verify image,
execution, inference, and cleanup from the receipt + public keys alone.

## Explicitly out

Dashboard UI (killed), BYOK (rejected — Wayfind holds all keys),
local agent loop, harness plugins, MCP-as-product, live mounts,
Nitro/confidential backend (future direction, fails closed until then),
S3 in the data path, suspend/resume (disposable only).

## CLI surface

```
wayfind login                    # device flow, same Cognito user
wayfind run [--dir] [--ttl] [--fresh] -- <cmd>   # provision→push→exec→pull→terminate
wayfind push [dir]               # snapshot up (encrypted)
wayfind exec -- <cmd>            # one command on the live session
wayfind ai "prompt" [--provider near-ai|muse-spark]
wayfind pull [dir]               # results back (verified, decrypted)
wayfind verify                   # check receipt (Phase 2: signature + attestation)
wayfind status | stop | destroy  # session lifecycle
# later: wayfind run --confidential | --require-attestation | inspect
```

## Build order

1. SandboxSession rows + relay resolution (in progress, wayfind-cloud).
2. Encrypted transfer (AES-GCM chunk protocol, CLI + exec agent).
3. Provider secrets + session credentials + `wayfind ai` (thin).
4. Egress default-deny + presets.
5. Receipt v0 + `verify` (hash checks).
6. E2E: login → run → ai (both providers) → pull → verify → destroy.
7. Phase 2: image signing/SBOM → receipt signing → NEAR verifier →
   audit trail → policies.
