# PLAN-P1.md — website-first verifiable execution

Rewritten 2026-11-10. Website-first, CLI-narrowed. PIVOT.md is the vision;
this is the build order. (Old CLI-only P1 superseded; PLAN-P0 deleted.)

## Phase 1 — managed execution on the website

Goal: a logged-in customer chats with a bot running inside a disposable
MicroVM — bot data + conversation history live in the computer, the
website renders and backs up, the CLI syncs and verifies. Every execution
disposable, every transfer sealed, no user-held keys.

1. **Website auth (reuse).** Same Cognito pool, direct Amplify login
   (email/Google) on the website. CLI device flow untouched.
2. **Repurpose `/app`.** Replace the teammate `AppShell` with the ONE
   surface: bot library (authored in the existing bot builder, deployed
   as bundles) + workspace (upload/connect, file list + SHA-256) + new
   conversation (bot + task prompt + model select: Qwen3.8-27B / Muse
   Spark + security-level selector) + live view (streams through the
   relay) + results + verification panel (evidence shown inline) +
   history (rendered from checkpoints, VM off). No infra-dashboard
   chrome — verification visible, not in settings.
3. **Conversation sessions (backend, hybrid-C).** One conversation = one
   live execution session. New `Conversation` row per conversation: owner,
   bot bundle hash, workspace hash, model, provider, security level,
   status, checkpoint manifest, receipt. Hot state (transcript + bot data)
   lives ONLY in the MicroVM; the control plane stores sealed checkpoint
   blobs (opaque — backend cannot read them) + plaintext hash manifest for
   integrity. Conversation keys are Wayfind-escrowed per conversation
   (secret-wrapped server-side); website decrypts client-side for history
   rendering. VM needed only for new messages. Metering wall-clock
   provision → terminate; TTL refreshed per message with a max-lifetime
   cap.
4. **Sandbox image: bot runner + `/ai`.** Extend `wayfind-sandbox`: bot
   bundle intake at provision (definition + tools + model + policy,
   sealed with the workspace), in-VM bot loop (transcript → `/ai` →
   tools → append), append-only hash-chained transcript (JSONL, every
   entry commits to `prev_hash`), sealed checkpoint emitter (scheduled +
   every N messages + always at terminate), and `/ai` (in-VM NEAR call
   with the session-scoped credential, non-stream for attestation
   tasks). Attestation preflight at inference-session establishment
   (fresh nonce, retain candidates — the 06 policy) is required for
   `verified-inference` conversations from day one. Website never sees
   provider keys.
5. **Provider secrets + quotas.** `NEARAI_CLOUD_API_KEY` + test key as
   Amplify secrets; per-execution scoped credential injected via
   `/hooks/run`, revoked at terminate; per-user quotas, concurrency
   limits, rate limiting, usage metering + reconciliation against the
   billing proxy.
6. **Sealed workspace transfer (reuse).** The AES-256-GCM envelope
   protocol from the CLI (`HKDF-SHA256(session bearer)`, `read_enc`,
   hash-verified) moves to the website path: browser uploads over TLS,
   backend seals server-side (it holds the bearer), agent decrypts in
   memory; outputs sealed back. Relay still sees metadata + ciphertext
   only.
7. **Receipt v0 + verify panel + audit backbone.** Unsigned manifest per
   conversation (conversation id, bot bundle + workspace/image hashes,
   model switches recorded, provider, signature kind + signer,
   attestation summary, checkpoint manifest, timestamps, cleanup) — same
   shape as `scripts/near-ai-tests/.receipt-example.json`. Panel shows
   hashes + evidence class labels (`observed` only at this stage).
   Audit-ready from day one: hash-chained transcript (tamper-evident),
   signed checkpoints, per-conversation receipt, retention policy +
   encryption documented, tenant-isolated rows, exportable evidence
   bundle for DPA/audit requests.
8. **CLI: sync + participate + verify.** `push`/`pull` sealed workspace
   + checkpoint sync (large workspaces, git checkouts, scripted flows
   the browser can't do); `chat "…" [--conversation <id>]` sends a
   message into a website-created conversation (or starts a CLI-owned
   one) on the same live session; `status`/`stop`; `verify receipt.json`
   (offline, open-source — the independent check on website claims);
   `--ci` non-interactive mode for pipelines. `run --keep` stays as the
   automation path. Full-client CLI is out.
9. **E2E gate.** Login → pick bot → upload → converse on both providers
   (incl. model switch mid-conversation) → terminate → history renders
   from checkpoint → receipt → `verify` (panel + CLI) → CLI `pull`
   restores files. Clean machine, both providers, evidence green.

## Phase 2 — verifiable execution

Goal: every Phase-1 claim independently checkable; enterprise-ready.

1. **Port the verifier.** `06-policy-gate.ts` becomes the core of website
   + CLI `verify`: fresh nonce, preflight-before-completion, kind/shape
   match, exact-candidate signer, fail closed everywhere.
2. **Signed receipts.** Control-plane signature (Amplify secret → KMS);
   `verify` checks it offline. Format unchanged from v0.
3. **Image trust.** Cosign/Sigstore signing, SBOM, reproducible builds,
   pinned kernel/runtimes; execution shows image digest + signature.
4. **Audit trail.** Append-only per-tenant log (who ran what, where,
   policy/image/model, retention controls).
5. **Policies.** Per-customer egress allowlists, attestation-required
   toggle (fails closed), per-workspace mandatory levels, curated-model
   expansion — each new model passes 00–07 before it ships.
6. **Enterprise billing.** Quotas → plans, usage reconciliation reports,
   DPA-ready evidence exports.

## Explicitly out

BYOK, local agent loop, harness plugins, MCP-as-product, live mounts,
suspend/resume, S3 in data path, SSO/SAML, BYOC, browser-E2EE chat at
launch, full TDX quote verification (upstream scope).

## Build order

Website shell (2) → conversation sessions + provision loop (3) → image
bot-runner/`/ai` (4) → secrets + quotas (5) → sealed upload path (6) →
receipts + panel + audit (7) → CLI sync/participate/verify (8) → E2E (9)
→ Phase 2 in order.
