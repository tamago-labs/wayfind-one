// Step 2: model attestation for the test model, nonce-fresh per TEE node.
// Run: npx tsx scripts/near-ai-tests/02-model-attestation.ts
//   MODEL_NAME=Qwen/Qwen3.5-122B-A10B npx tsx scripts/near-ai-tests/02-model-attestation.ts
// Pass = ≥1 model TEE signing address AND every node echoes our nonce.
// Saves { nonce, model, modelTee, gateway } to state for steps 03+.
// NOTE: if the model is NOT TEE-hosted (proxied third-party), the report
// carries no model_attestations and this step CORRECTLY fails — that tells
// us the model can't be used for attestation tasks.
import { writeFileSync } from 'node:fs';
import { DIR, MODEL_NAME, extractSigningAddresses, getAttestation, generateNonce, report, saveState } from './config.js';

async function main(): Promise<void> {
  const nonce = generateNonce();
  console.log(`Model: ${MODEL_NAME}`);
  console.log(`Request nonce: ${nonce}`);
  const att = await getAttestation(MODEL_NAME, nonce);
  const nodes = att.model_attestations ?? [];
  console.log(`TEE nodes: ${nodes.length}`);
  const addrs = extractSigningAddresses(att);
  console.log(`Model TEE addresses:  ${addrs.modelTee.join(', ') || '(none)'}`);
  console.log(`Gateway address:      ${addrs.gateway.join(', ') || '(none)'}`);
  const noncesOk = nodes.length > 0 && nodes.every((a: any) => a.request_nonce === nonce);
  console.log(`All nodes echo nonce: ${noncesOk}`);

  // Persist the raw report for inspection + downstream steps.
  const reportPath = `${DIR}/.attestation-report.json`;
  writeFileSync(reportPath, JSON.stringify(att, null, 2));
  saveState({ nonce, model: MODEL_NAME, modelTee: addrs.modelTee, gateway: addrs.gateway, reportPath });

  report([
    { name: 'Report returned ≥1 model TEE node', pass: addrs.modelTee.length > 0 },
    { name: 'Every node echoes our nonce', pass: noncesOk },
    { name: 'Gateway address present', pass: addrs.gateway.length > 0 },
  ]);
}

main().catch((err) => {
  console.error('02 failed:', err);
  process.exit(1);
});
