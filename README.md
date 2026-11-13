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

No account needed for the offline path. Clone + run from the repo root:

```
# 1. Verify an example inner-sandbox receipt (offline shape + chain checks)
node ./bin/wayfind.js verify scripts/near-ai-tests/inner-sandbox-receipt.example.json
# expect: ALL CHECKS PASSED (observed example — shape only, see note below)

# 2. Tamper with a copy and re-verify — the checks must fail
cp scripts/near-ai-tests/inner-sandbox-receipt.example.json /tmp/r.json
# (change any character in /tmp/r.json, e.g. the sha256)
node ./bin/wayfind.js verify /tmp/r.json
# expect: CHECKS FAILED on the tampered field
```

The example receipt is `class: observed` (unsigned): it proves the check
pipeline, not authenticity. Signed receipts (`class: signed` + Ed25519
signature) verify fully offline with `wayfind verify` once fetched, and
online with one HTTPS call for the current public key — no account.

Full path (needs a login, ~10 minutes): open the website, create a bot,
attach a file, chat — the reply carries attestation, the sandbox closes
with a signed receipt, and Sandboxes → Verify re-checks everything.

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
