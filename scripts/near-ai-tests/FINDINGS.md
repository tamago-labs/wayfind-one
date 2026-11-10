# NEAR AI attestation — findings (2026-11-10)

Test kit: `scripts/near-ai-tests/` (00–07, all passing). Key: Wayfind-held
`NEARAI_CLOUD_API_KEY`. Models probed: `Qwen/Qwen3-Embedding-0.6B`,
`Qwen/Qwen3.8-27B`.

## Purpose for our project

Before building `wayfind ai --provider near-ai` (Phase 1 step 8/9) and
`wayfind verify` (Phase 2), we needed proof — not docs — that:

1. Attestation evidence is fetchable per request with replay protection.
2. GPU/TEE claims verify independently (NVIDIA, not NEAR's word).
3. A chat response can be cryptographically tied to the attested model
   (hashes + signer), in both streaming and non-streaming modes.
4. The checks compose into a fail-closed policy we can ship as code.
5. The receipt has a concrete schema to bind all of the above.

Each script maps 1:1 to a product part: 01/02 → provider setup +
preflight, 03 → per-request verify cost, 04/05 → `ai` calling convention,
06 → `verify` core, 07 → receipt schema.

## Results (integration-relevant only)

- **Attestation is per-request and nonce-fresh.** `GET
  /v1/attestation/report?model=…&nonce=…` echoes our nonce in
  `gateway_attestation.request_nonce` and every
  `model_attestations[].request_nonce`. One TEE node served both models
  tested. Full raw report saved per run (local only, gitignored):
  `scripts/near-ai-tests/.attestation-report.json`.
- **NVIDIA verifies independently, fast.** NRAS `overall=true`,
  `eat_nonce` matches, 8× GH100, `secureBoot=true`, `measres=success`.
  Round-trip 0.5–1.2s → **verify per request, no attestation cache**.
- **Non-stream chat = `provider_tee`.** Signed text is
  `{model_id}:{request_hash}:{response_hash}` where hashes are sha256 of
  the exact request/response bytes; signer recovers to a preflight model
  TEE address. This is the evidence shape `ai` demands for attestation
  tasks.
- **Streamed chat = `gateway` kind.** Signer = gateway TEE address, bound
  to the exact bytes received. Product rule: `ai` forces non-streaming
  for attestation tasks; if streaming is ever offered, the receipt must
  record `signature_kind: gateway`.
- **Signature lookup is multi-node flaky.** `GET /v1/signature/{id}`
  transiently 404s when it lands on a different TEE node than the one
  that served the completion. **Bounded retry (5×, 1s, fail closed on
  non-404) is mandatory in product code** — in 04/05/06/07.
- **Embedding model is TEE-hosted but not chat-capable.** Attestation +
  NVIDIA pass; `/chat/completions` 404s upstream. It stays as the
  negative control (proves the kit correctly rejects non-chat models).
  Standard test model: **`Qwen/Qwen3.8-27B`**.
- **Policy composes (06).** Fresh nonce → preflight retained →
  completion → signature present → kind/shape match → hashes + model
  binding → signer equals exactly one retained candidate. All green.
- **Receipt schema v0 works (07).** One verified inference → receipt
  JSON (`version`, `class: observed`, provider, model, evidence block,
  inference block). Example (local only, gitignored):
  `scripts/near-ai-tests/.receipt-example.json`.

## What we can build on this (mapping to plan)

| Product piece | Built on | Status |
|---|---|---|
| `wayfind ai --provider near-ai` (thin, non-stream) | 04 calls + session-scoped key injection | Next (Phase 1 step 8/9) |
| `--provider muse-spark` dry-run path | Same calls, test key, no attestation required | With above |
| Preflight-before-completion ordering | 06 | Rule for `ai` implementation |
| Signature retry + fail-closed | 04/05/06/07 retry loops | Copy into product, don't reinvent |
| `wayfind verify` core | 06 verbatim | Phase 2 |
| Receipt schema v0 → signed receipts | 07 output | Phase 2 (signer upgrade path only) |
| `--require-attestation` flag | 06 policy | Phase 2 |

## Why enterprises need this (real use cases)

"Trust us, your data is safe" fails every enterprise security review.
Attestation replaces the promise with checkable evidence — that is the
entire Wayfind enterprise pitch. Concrete buying situations:

- **Regulated data + AI (finance, healthcare, insurance).** A bank wants
  an LLM to summarize loan files; a hospital wants discharge-note
  drafting. Legal/compliance asks: *where did the plaintext go, and prove
  it.* With private inference + receipts, the answer is a file, not a
  meeting: prompts processed inside a measured TEE, response signed by
  the attested model, evidence retained per request. This unblocks AI on
  data that today is simply off-limits to SaaS AI tools.
- **Source code as the crown jewels.** Enterprises will not paste
  proprietary code into a chatbot. `wayfind run` + `ai` keeps code in a
  disposable VM, inference inside a TEE, and returns a receipt binding
  code-hash → model → output-hash. The CISO sees containment +
  per-task evidence instead of "developers pasted it into a website."
- **Audit and compliance artifacts (SOC 2, ISO 27001, DORA, HIPAA).**
  Auditors ask for *evidence of control operation*, sampled per event.
  A signed receipt per execution (who ran what, where, on which image,
  with which attested model, when it was destroyed) is that sample —
  machine-checkable instead of screenshot-collected.
- **Data-processing agreements with teeth.** DPAs require processors to
  demonstrate technical measures. "Ephemeral by design, attested per
  request, nothing persists" plus receipts turns a contractual claim
  into something the customer's own tooling (`wayfind verify`) can
  re-check — a differentiator in vendor security questionnaires.
- **AI output integrity (anti-tamper).** For automated decisions
  (screening, triage, code review gates), the enterprise must show the
  output it acted on is the output the model produced. Response
  signatures bound to request/response hashes give exactly that; 04/06
  prove the check runs in ~seconds.
- **Multi-tenant / client-data separation (consultancies, BPOs).**
  One team serves many clients' sensitive data. Per-session disposable
  VMs + Wayfind-held keys + per-task receipts give per-client isolation
  evidence — no cross-contamination story to tell, the architecture
  makes it structurally impossible and the receipts show it per run.
- **Board-level AI risk.** "What if the model provider trains on our
  data?" Private inference's answer is hardware-enforced, not
  policy-based — and attestation is how you *prove* the hardware claim
  held for *your* request, not just in a whitepaper.

The common thread: every one of these today is answered with trust
(documents, certifications, meetings). Attestation + receipts answer
with evidence the customer's own pipeline can verify. That shift —
trust → verify — is what makes Wayfind sellable to security teams
instead of just developers.

## Open (not yet probed)

- `/v1/embeddings` verifiability (signature endpoint is chat-id based —
  unknown if embeddings are signed at all).
- Streaming + `provider_tee` coexistence (docs suggest streams are
  always gateway-signed; 05 confirms for this model).
- Full TDX quote verification (`dcap-qvl`, `report_data`) — deferred to
  the upstream verifier repo, not our scope.
- Multi-node models (>1 `model_attestations` entry) — candidate-matching
  across nodes untested; 06 logic handles it, live data pending.
