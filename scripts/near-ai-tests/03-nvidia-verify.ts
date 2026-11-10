// Step 3: NVIDIA NRAS verification of every model TEE payload, timed.
// Run: npx tsx scripts/near-ai-tests/03-nvidia-verify.ts
// Pass = overall verdict true + eat_nonce matches our nonce, on EVERY node.
// The timing decides product behavior: ~1s means verify-per-request is
// affordable (no attestation cache needed for thin `wayfind ai`).
import {
  MODEL_NAME,
  decodeNvidiaAttestation,
  generateNonce,
  getAttestation,
  getGpuAttestation,
  report,
  summarizeGpuAttestation,
} from './config.js';

async function main(): Promise<void> {
  const nonce = generateNonce();
  const att = await getAttestation(MODEL_NAME, nonce);
  const nodes = (att.model_attestations ?? []).filter((a: any) => a.nvidia_payload);
  console.log(`Model: ${MODEL_NAME}, TEE nodes with NVIDIA payload: ${nodes.length}`);
  if (nodes.length === 0) {
    report([{ name: 'At least one NVIDIA payload present', pass: false }]);
    return;
  }
  const checks: Array<{ name: string; pass: boolean }> = [];
  const t0 = Date.now();
  for (const [i, a] of nodes.entries()) {
    const summary = summarizeGpuAttestation(decodeNvidiaAttestation(await getGpuAttestation(a.nvidia_payload)), nonce);
    console.log(`Node ${i + 1}: overall=${summary.overallResult} nonceMatch=${summary.nonceMatch} gpus=${summary.gpus.length}`);
    for (const g of summary.gpus) console.log(`  ${g.key}: ${g.hwmodel} secureBoot=${g.secureBoot} measres=${g.measres}`);
    checks.push({ name: `Node ${i + 1} NVIDIA verdict true + nonce match`, pass: summary.overallResult && summary.nonceMatch === true });
  }
  console.log(`NRAS round-trip: ${((Date.now() - t0) / 1000).toFixed(1)}s for ${nodes.length} payload(s)`);
  report(checks);
}

main().catch((err) => {
  console.error('03 failed:', err);
  process.exit(1);
});
