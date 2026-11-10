// Step 1: gateway-only attestation with a fresh nonce.
// Run: npx tsx scripts/near-ai-tests/01-gateway-attestation.ts
// Pass = report returns a gateway signing address AND echoes our nonce
// (replay protection). No model involved — the baseline trust anchor.
import { getAttestation, generateNonce, report } from './config.js';

async function main(): Promise<void> {
  const nonce = generateNonce();
  console.log(`Request nonce: ${nonce}`);
  const att = await getAttestation(null, nonce);
  const gw = att.gateway_attestation ?? {};
  console.log(`Gateway signing address: ${gw.signing_address ?? '(none)'}`);
  console.log(`Nonce echoed:            ${gw.request_nonce ?? '(none)'}`);
  report([
    { name: 'Gateway attestation returned a signing address', pass: !!gw.signing_address },
    { name: 'Gateway attestation echoes our nonce', pass: gw.request_nonce === nonce },
  ]);
}

main().catch((err) => {
  console.error('01 failed:', err);
  process.exit(1);
});
