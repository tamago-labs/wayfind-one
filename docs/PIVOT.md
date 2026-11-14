# PIVOT.md — Wayfind ONE: verifiable private AI execution as a service

Date: 2026-11-10 (final rewrite). Status: v1 archived under `v1/`.
PLAN-P0.md (CLI device-flow login) is deleted — shipped history, not the plan.
Active spec: docs/PLAN-P1.md.

## 1. What Wayfind v2 is

A managed website where customers run AI against sensitive data in
disposable, isolated machines and receive the result **together with
independently verifiable security evidence**. Not a chatbot, not a VM
provider, not an inference API:

**Wayfind ONE — private AI execution you can verify.**

> Ephemeral environments for verifiable private AI.
> Bring your data. Choose your AI. Verify where it runs.

Customers never manage Firecracker, NEAR credentials, encryption keys, or
VM provisioning. They submit a task on the website and get back the result
+ evidence. Verification is shown in the interface, not buried in settings
— it is the differentiator.

## 2. Why website-first (not CLI-first)

The CLI as the product narrows the audience to developers, adds friction,
and sells infrastructure provisioning — which developers can stitch
together themselves. The website sells a managed service: upload/connect a
workspace → pick a task and model → run isolated → review results → verify
evidence. Same backend either way; the website is what enterprises buy.

The CLI survives with a narrowed job: **workspace sync, CI/CD + API
automation, and independent verification** (`wayfind verify receipt.json`
— the open-source check that keeps the website honest). It is never a
mandatory dependency.

## 3. Architecture (three layers)

```
Website (repurposed /app)     Customer-facing product
  Workspace · AI tasks · verification · execution history

Wayfind Backend               Auth · billing · orchestration · policy · API proxy
  NEAR AI credentials (server-side, Amplify secrets)
  Per-user quotas · concurrency limits · rate limiting · usage metering

Execution                     Firecracker MicroVM · workspace · tools (disposable)
Inference                     NEAR AI TEE · session-scoped credential · attestation
Evidence                      NEAR attestation + Wayfind execution evidence + signed receipts
```

Where inference originates: **in the MicroVM for code/file tasks** (the
VM calls NEAR with a narrowly scoped session credential under the same
verification policy — never pretending the VM is confidential because the
inference provider is). Browser-side E2EE via NEAR's JS SDK is the
documented future for pure-chat tasks, not launch scope.

## 4. Locked decisions

1. **Surface:** repurpose the existing `/app` dashboard (Next.js 14 +
   Amplify + Tailwind, same Cognito user pool, direct login) — no new
   app, no new auth system. CLI device flow stays for CLI only.
2. **CLI role:** sync + automation + independent `verify`. Full-client
   CLI is out.
3. **Models (curated):** `Qwen/Qwen3.8-27B` via NEAR AI (fully verified
   by `scripts/near-ai-tests/` 00–07). Single model until a second one
   passes the same gate. New models only after passing 00–07 each.
4. **Tasks:** VM-backed only at launch — every execution runs in a
   disposable MicroVM; chat is a task type, not a separate path.
5. **Keys:** Wayfind-held, no BYOK. Long-lived NEAR/test keys in Amplify
   secrets; per-execution scoped credentials, revoked at terminate.
6. **Receipt signing:** Amplify secret now, KMS later. Format fixed.
7. **Backend replaceable:** `lambda-microvm` now, `nitro-sandbox` later;
   `--require-attestation` (website policy toggle) fails closed.
8. **Honesty rule:** every claim labeled `observed` / `signed` /
   `hardware-attested`, never mixed. NEAR attestation covers NEAR's
   inference environment only — Wayfind reports its own execution
   guarantees separately. Two attestations, never conflated: inference
   attestation (is NEAR's environment genuine?) and execution
   attestation (is the workspace environment genuine?).
9. **Task model:** predefined task templates AND general-purpose AI
   conversations over the same ephemeral execution engine. Templates are
   entry points (code review, code modification, document/financial
   analysis, data processing, research); the product is the private
   execution environment itself.
10. **Conversation lifecycle:** one conversation = one ephemeral execution
    session. Messages reuse the same MicroVM until termination or max
    lifetime. Hot state (transcript + bot data) lives only in the VM;
    sealed checkpoints sync out, conversation keys Wayfind-escrowed, and
    history/receipts render from checkpoints — never from the runtime.
11. **Model selection:** per conversation, switchable between messages.
    Availability subject to security policy; switching providers or
    deployments rechecks verification; customers are told when the new
    model has weaker guarantees. History stays in the workspace; sending
    it to another provider is explicit and policy-controlled.
12. **Security levels:** three execution policies —
    `standard` (isolated ephemeral execution, sealed transfer, integrity
    checks, signed Wayfind receipts), `verified_inference` (+ verified
    NEAR inference attestation, model identity, inference integrity),
    `strict-confidential` (+ hardware-attested execution, approved
    measurements, attestation-gated key release). Sensible task defaults,
    customer policies may require stricter.
13. **Attestation policy:** set by security level + customer policy, not
    task type. Strict-confidential requires a backend with
    hardware-backed execution evidence (Phase 3 Nitro) — unsupported
    policies fail closed, never silently downgrade.
14. **Model security metadata:** every supported deployment carries
    explicit metadata (provider, model identity, attestation support,
    verification status, permitted levels). Open-weight ≠ confidential;
    NEAR-sourced ≠ automatically verified.
15. **Conversation verification:** attest at inference-session
    establishment, refresh per provider freshness/expiry/revocation,
    reverify on model/deployment/identity change, record per-request
    evidence. Cached attestation is never fresh evidence indefinitely.

## 5. Value split (know what we resell)

| NEAR AI provides | Wayfind adds |
|---|---|
| Confidential inference | Disposable execution |
| Hardware attestation | Workspace integrity |
| Encrypted inference | Isolated workspace processing |
| Model verification | Combined execution evidence |
| Token billing | Unified usage + execution billing + managed UX |

We are not cheaper AI. We are the verifiable-execution layer above it.
Since we hold the upstream key: per-user quotas, concurrency limits, rate
limiting, usage reconciliation — never expose it, never let customers
bypass the billing proxy.

## 6. Phases (three)

- **Phase 1 — managed execution (PLAN-P1.md):** repurposed website runs
  VM-backed tasks on both providers, sealed workspace transfer, receipts
  v0, narrowed CLI (sync + verify).
- **Phase 2 — verifiable execution:** ported NEAR verifier (06 as core),
  signed receipts, image signing/SBOM, audit trail, policies, curated
  model expansion.
- **Phase 3 — confidential execution (AWS Nitro):** hardware-attested
  execution backend enabling `strict-confidential`: Nitro-based
  sandbox images, attestation-gated workspace key release, approved
  runtime measurements, strict network/credential policies. Only then
  can hardware-backed execution be honestly offered — until that
  backend exists, strict-confidential fails closed.

## 7. Explicit non-goals

BYOK, local agent loop, harness plugins, live mounts, S3 in the data
path, suspend/resume, SSO/SAML, BYOC, full TDX quote verification (defer
to upstream verifier), browser-E2EE chat at launch. Strict-confidential
before the Phase 3 backend exists.

## 8. Standing practices

- **NEAR watch (weekly):** track NEAR's JS SDK / E2EE / attestation
  changes; stay aligned with their verification protocol instead of
  forking our own.
- **New-model gate:** no model ships without passing 00–07.
- **Pre-flight flags:** `.env.local` with real-looking keys was checked
  into wayfind-cloud — rotate before any customer token reaches that
  backend. (Still open.)

## 9. Initial task catalog and product behavior

One workspace, three entry points (chat / code / documents / data are
templates over the same engine, not separate products) plus custom-task
descriptions. Security levels are defaults; customer policies can require
stricter.

| Task | Example | Suggested security |
|---|---|---|
| General chat | Ask questions about private project files | Standard / Verified inference |
| Code review | Find vulnerabilities in a private repository | Verified inference |
| Code modification | Fix bugs and write tests | Verified inference |
| Document analysis | Review contracts and internal PDFs | Verified inference |
| Financial analysis | Reconcile confidential spreadsheets | Verified inference |
| Data processing | Clean and transform customer datasets | Verified inference |
| Private research | Analyze unpublished company research | Verified inference |
| Enterprise confidential analysis | Highly sensitive records under hardware-backed policy | Strict confidential |
