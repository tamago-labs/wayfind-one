# Wayfind ONE — verifiable private AI execution

> Private AI execution you can verify: disposable Firecracker microVMs,
> attested NEAR AI inference, signed receipts, independent verification.

## What this is

Wayfind ONE runs AI tasks inside disposable Firecracker microVMs. Each task
gets attested inference from NEAR AI (TEE + NVIDIA verdict checked before
the first prompt, every response signature verified against the retained
attestation), and closes with a signed execution receipt binding who ran
what, where, on which image and model, with what evidence. The same evidence
is checkable three ways: CLI, website panel, and the official NEAR
Verification Center widget.

## The problem

Useful AI lives behind someone else's API, and sending proprietary source
code, contracts, financials, or patient data to a chatbot is a non-starter
for legal, security, and compliance. Self-hosting models and infrastructure
is a platform project most teams cannot staff. Wayfind ONE occupies the
middle: upload a workspace, pick a task and model, run it in an isolated
machine with attested inference, and get the result **plus evidence**.
Security reviews stop being meetings about trust and become files a pipeline
can check.

## How NEAR fits (concrete)

- **Inference**: `Qwen/Qwen3.8-27B` served by NEAR AI Cloud. Non-streaming
  calls only — streams can't carry model-TEE signatures.
- **Attestation**: per-session preflight (`GET /v1/attestation/report` with
  fresh nonce, `signing_algo=ecdsa`), NVIDIA verdict via NRAS, then
  per-message `GET /v1/signature/{chatId}` verification with hash, model,
  and signer binding. Full proof kit: `scripts/near-ai-tests/` (tests
  00–11 + `FINDINGS.md`).
- **Evidence surface**: the NEAR Verification Center widget renders our
  retained attestation as verification reports (structure display; our own
  CLI/panel checks remain the trust anchor).

## Try it (judge path)

Either use the website at https://one.wayfind.click (login), or run the judge demo below — no account needed, clone and go:

```
# 1. Live end-to-end: HR bot, sealed sheet, sandbox review, signed receipt (~2 min)
npm run demo
# expect: a leave-balance review flagging 2 employees, then
#   demo: ALL CHECKS PASSED
# (10 receipt checks incl. Ed25519, 1/1 attested response, 8 NVIDIA GPUs;
# exit 0. The demo authenticates with an embedded throwaway credential and
# cleans up after itself — bot deleted, computer left running.)
#
# Real output looks like this:
#   [demo:auth] using embedded demo bundle credential
#   [demo:computer] 5409dc04… already running
#   [demo:config] escalation mode → auto-logged (restored after demo)
#   [demo:bot] Judge-11131317 (0b66ad96…)
#   [demo:stage] leave-balances.csv sealed [6035b835…]
#   [demo:run] 2c41be5f… — streaming:
#   [… per-employee breakdown flags E002 (22 days, −2 balance) and E003 (31 sick days) …]
#   [demo:receipt] signed · Qwen/Qwen3.8-27B · microvm-4adfc1f…
#     PASS  version is wayfind-receipt/v0 — wayfind-receipt/v0
#     PASS  class is observed or signed — signed
#     PASS  required fields present — 6/6
#     PASS  final snapshot sealed at close — sha256 f552666cdac7…
#     PASS  terminated after provisioned — 2026-11-13T13:11:36 → 2026-11-13T13:12:24
#     PASS  VM cleanup verified at terminate — true
#     PASS  inference responses verified vs retained attestation — 1/1 checked valid
#     PASS  preflight nonce fresh, model TEEs present — 1 node(s)
#     PASS  NVIDIA verdict clean at preflight — 8 GPUs
#     PASS  Ed25519 receipt signature verifies (offline) — kid 218ecd601d93b709
#   demo: ALL CHECKS PASSED
#   [demo:cleanup] escalation mode restored
#   [demo:cleanup] demo bot deleted
#   demo done in 1.1m — computer left running for the next run

# 2. Inspect what the demo closed 
node ./bin/wayfind.js sandboxes --closed
# expect: "Review these leave balances…" · Closed x ago · 1 of 1 steps verified · receipt: signed

# 3. Re-verify any run by id (fetched, then checked fully offline)
node ./bin/wayfind.js verify microvm-…
# expect: ALL CHECKS PASSED — e.g.
#   Receipt: inner sandbox microvm-4a48e30d… (fetched, then checked locally)
#     PASS  version is wayfind-receipt/v0 — wayfind-receipt/v0
#     PASS  class is observed or signed — signed
#     PASS  required fields present — 6/6
#     PASS  final snapshot sealed at close — sha256 eac8112e0569…
#     PASS  terminated after provisioned — 2026-11-13T13:18:05 → 2026-11-13T13:19:29
#     PASS  VM cleanup verified at terminate — true
#     PASS  inference responses verified vs retained attestation — 1/1 checked valid
#     PASS  preflight nonce fresh, model TEEs present — 1 node(s)
#     PASS  NVIDIA verdict clean at preflight — 8 GPUs
#     PASS  Ed25519 receipt signature verifies (offline) — kid 218ecd601d93b709
#   verify: ALL CHECKS PASSED

# 4. Offline pipeline check (no network at all)
node ./bin/wayfind.js verify scripts/near-ai-tests/inner-sandbox-receipt.example.json
# expect: ALL CHECKS PASSED (observed example — shape only, see note below)

# 5. Tamper with a copy and re-verify — the checks must fail
cp scripts/near-ai-tests/inner-sandbox-receipt.example.json /tmp/r.json
# (change any character in /tmp/r.json, e.g. the sha256)
node ./bin/wayfind.js verify /tmp/r.json
# expect: CHECKS FAILED on the tampered field
```

The `npm run demo` run ends with a real signed receipt (`class: signed` +
Ed25519 signature) — that is the authenticity proof, verified locally with
no account beyond the embedded throwaway. The bundled example file stays as
the offline shape check: it proves the pipeline, not a live attestation.

Prefer the website? Same receipts, same guarantees (needs a login,
~10 minutes): open the website, create a bot, attach a file, chat — the
reply carries attestation, the sandbox closes with a signed receipt, and
Sessions → Verify re-checks everything.

## System overview

One persistent outer computer per user (team agent, Meta open-weight via
Modal) + one disposable inner microVM per sensitive task (NEAR-only,
attested, killed after each task). The outer never sees file bytes: uploads
are staged control-plane-side, sealed with the inner session key, and pushed
direct-to-inner. Full architecture with mermaid diagrams:
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Tracks

- **`privacy`** — private AI: sealed workspaces, TEE-attested NEAR inference, encrypted checkpoints, no file bytes outside the attested VM.
- **`security`** — agent sandboxing with fail-closed policy enforcement, signed golden images with SBOM + trust records, per-response signature verification, append-only audit trail.

## Baseline disclosure (hackathon rules Q-002–Q-005)

- [`wayfind-cloud`](https://github.com/tamago-labs/wayfind-cloud) (Amplify backend, classic computer image, dashboard app) predates the hackathon window and is baseline infrastructure, not the submission.
- Everything NEAR-specific was built in-window in **this repo**: nested-sandbox architecture, attested-inference path with per-message verification, signed execution receipts, outer-blind sealed file flow, evidence bundle + three-way verification, the NEAR attestation proof kit.
- Pre-existing libraries, the Amplify scaffold, and AI-assisted code are baseline/tooling per Q-005.
- Hackathon diff: `https://github.com/tamago-labs/wayfind-one/compare/<pre-hackathon-tag>...<hackathon-submission-tag>` (tags cut at submission; replaces this placeholder).

## Quick links

- Website: https://one.wayfind.click
- Backend repo (baseline, not submitted): https://github.com/tamago-labs/wayfind-cloud
- NEAR attestation proof kit: [scripts/near-ai-tests/](scripts/near-ai-tests/)
- Product plan: [PIVOT.md](PIVOT.md) · Build phases: [PLAN-P1.md](PLAN-P1.md), [PLAN-P2.md](PLAN-P2.md)

## License

MIT — see [LICENSE](LICENSE).
