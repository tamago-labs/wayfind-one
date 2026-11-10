# PIVOT.md — Wayfind v2: verifiable, ephemeral AI execution (CLI only)

Date: 2026-11-10 (revised). Status: v1 archived under `v1/` (commit `c585d60`).
PIVOT.md is the vision; PLAN-P0.md (done) and PLAN-P1.md (active) are the build specs.

## 1. What Wayfind v2 is

A CLI that issues an **isolated, disposable execution environment**,
transfers a workspace into it, runs private AI inference, and returns
the results — with **evidence, not trust**. No dashboard, no daemon, no
Docker, no P2P, no BYOK, no harness to install.

```
wayfind login → run → push → exec/ai → pull → verify → destroy
```

## 2. What stays (from v1 / wayfind-cloud)

- **v1 AI-teammate UI**: archived, not built. If a UI ever returns it is a
  thin console over the CLI — explicitly not in Phase 1 or 2.
- **Salvageable modules (copy, don't import):** `v1/src/msgcrypto.js`
  (envelope patterns), near-red's `attest/` + `forwarder/` (Phase 2
  verifier), near-red's `untar.rs` hostile-tar rules (export validation).
- **wayfind-cloud's managed fleet** (Lambda MicroVMs): the execution
  backend. v2 does not build fleet infrastructure — it exposes it with a
  better trust story.

## 3. Locked decisions

1. **CLI is the entire product surface.** Humans and Claude Code alike
   use `wayfind run` — no MCP config, no plugins, no dashboard.
2. **Wayfind provides everything, including inference keys. No BYOK.**
   Keys live in Amplify secrets. Per task: `muse-spark` (cheap
   test/dry-run) or `near-ai` (attested).
3. **Session-scoped credentials only.** Long-lived keys never enter the
   sandbox; per-boot, short-lived, revoked at terminate.
4. **Sandbox is dumb + self-contained.** Exec tools + MCP endpoint in
   the image (`packages/sandbox`), no agent loop, no inference, no keys
   at rest. Everything the harness needs lives in the image + relay.
5. **Disposable only.** No suspend/resume, no S3 in the data path, no
   plaintext workspace persists anywhere.
6. **Receipt signing: Amplify secret now, KMS later.** Format fixed;
   only the signer upgrades.
7. **Backend is replaceable** (`lambda-microvm` now, `nitro-sandbox`
   later; `--confidential` fails closed until then).

## 4. The two guarantees (never conflated)

- **Isolation** (Firecracker): host and other workloads protected from
  the workload inside the VM. We have this.
- **Confidentiality** (TEE/attestation): workload and data protected from
  the operator. We do NOT have this for the VM — only NEAR AI provides
  it for inference. Receipts label every claim as `observed`, `signed`,
  or `hardware-attested`, and never mix them.

## 5. Phases (only two)

- **Phase 1 — secure ephemeral execution** (PLAN-P1.md): disposable VMs,
  encrypted workspace transfer, Wayfind-held providers + thin `ai`,
  deny-by-default egress, pull/destroy, unsigned receipts.
- **Phase 2 — verifiable execution**: signed images + SBOM, signed
  receipts, NEAR attestation verification, formalized session keys,
  audit trail, policies.
- **Phase 3 (not planned)**: Nitro/confidential backend. One line, no work.

## 6. Explicit non-goals

Dashboard UI, BYOK, local agent loop, harness plugins, MCP-as-product,
live mounts (virtio-fs/9p/FUSE), S3 in the data path, suspend/resume,
SSO/SAML, BYOC, DLP/retention, Stripe (until enterprise forces it).

## 7. Pre-flight flags

- `.env.local` with real-looking keys was checked into wayfind-cloud —
  rotate before any CLI token can reach that backend. (Still open.)
- Every build that touches the sandbox image must re-run `01` before
  `02 --replace`: the zip is built from `dist/`, and a stale `dist`
  has already caused silent CREATE_FAILEDs.
