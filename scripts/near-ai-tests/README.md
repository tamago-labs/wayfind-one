# NEAR AI attestation test kit

Numbered scripts proving NEAR AI Cloud attestation + response verification
step by step, before `wayfind ai --provider near-ai` is built on top.
Working calls here transfer directly into the CLI verifier (Phase 2).
Default model: `Qwen/Qwen3-Embedding-0.6B` (override per-run with `MODEL_NAME=`).

## Setup

```powershell
Copy-Item scripts/near-ai-tests/.env.example scripts/near-ai-tests/.env
# edit .env: NEARAI_CLOUD_API_KEY from https://cloud.near.ai
```

## Run order

```powershell
npx tsx scripts/near-ai-tests/00-baseline.ts            # full flow, upstream parity check
npx tsx scripts/near-ai-tests/01-gateway-attestation.ts # gateway report + nonce echo
npx tsx scripts/near-ai-tests/02-model-attestation.ts   # per-node report + addresses -> state
npx tsx scripts/near-ai-tests/03-nvidia-verify.ts       # NRAS verdict + nonce, timed
npx tsx scripts/near-ai-tests/04-chat-provider-tee.ts  # non-stream chat -> provider_tee
npx tsx scripts/near-ai-tests/05-chat-gateway-sign.ts   # streamed chat -> gateway kind
npx tsx scripts/near-ai-tests/06-policy-gate.ts         # policy as code, fail-closed
npx tsx scripts/near-ai-tests/07-receipt-bind.ts        # receipt-shape prototype
```

Progress is kept in `scripts/near-ai-tests/.near-proof-state.json`
(gitignored) so later steps reuse the attestation evidence.

## Notes

- Embedding models serve `/v1/embeddings`, not chat — if 00/02 show the
  model isn't TEE-hosted or chat-capable, rerun chat steps with a TEE chat
  model, e.g. `MODEL_NAME=zai-org/GLM-5.1-FP8`.
- Every script exits 1 on any failed check. Nonce is fresh per run.
