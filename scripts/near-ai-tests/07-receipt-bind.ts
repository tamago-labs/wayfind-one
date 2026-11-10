// Step 7: receipt-bind prototype — one verified inference → receipt JSON.
// Run: npx tsx scripts/near-ai-tests/07-receipt-bind.ts
// Emits scripts/near-ai-tests/.receipt-example.json binding { model,
// request/response hashes, signature kind + signer, attestation summary }.
// Unsigned v0 (Phase 1); the signature field + offline `verify` land in
// Phase 2. Field names here are the proposal for the receipt schema.
import { writeFileSync } from 'node:fs';
import {
  DIR,
  MODEL_NAME,
  NEARAI_BASE_URL,
  apiKey,
  decodeNvidiaAttestation,
  extractSigningAddresses,
  generateNonce,
  getAttestation,
  getGpuAttestation,
  httpError,
  report,
  sha256hex,
  summarizeGpuAttestation,
  verifySignature,
} from './config.js';

async function main(): Promise<void> {
  const nonce = generateNonce();
  const att = await getAttestation(MODEL_NAME, nonce);
  const addrs = extractSigningAddresses(att);
  const nodes = att.model_attestations ?? [];

  // Spot-check NVIDIA on the first node (full per-node proof is step 03).
  const first = nodes.find((a: any) => a.nvidia_payload);
  const gpu = first
    ? summarizeGpuAttestation(decodeNvidiaAttestation(await getGpuAttestation(first.nvidia_payload)), nonce)
    : null;

  const requestBody = JSON.stringify({ messages: [{ content: 'Respond with only two words', role: 'user' }], stream: false, model: MODEL_NAME });
  const res = await fetch(`${NEARAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: requestBody,
  });
  if (!res.ok) throw await httpError(res, 'Chat completion failed');
  const responseText = await res.text();
  const chatId = JSON.parse(responseText.trimStart()).id;

  // Retry: the model may be served by several TEE nodes and the signature
  // is cached on the node that served the completion (transient 404s).
  let sig: any = null;
  let lastErr: unknown = null;
  for (let i = 0; i < 5; i++) {
    const sigRes = await fetch(
      `${NEARAI_BASE_URL}/v1/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(MODEL_NAME)}&signing_algo=ecdsa`,
      { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey()}` } },
    );
    if (sigRes.ok) {
      sig = await sigRes.json();
      break;
    }
    lastErr = await httpError(sigRes, 'Signature request failed');
    if (sigRes.status !== 404) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  if (!sig) throw lastErr;
  const parts: string[] = sig.text.split(':');
  const kind: string = sig.signature_kind ?? (parts.length === 3 ? 'provider_tee' : 'gateway');
  const sigCheck = verifySignature(sig.text, sig.signature, kind === 'gateway' ? addrs.gateway : addrs.modelTee);

  const receipt = {
    version: 'wayfind-receipt/v0',
    class: 'observed' as const, // v0 unsigned: observed only (signed/hardware-attested in Phase 2)
    provider: 'near-ai',
    model: MODEL_NAME,
    evidence: {
      attestation_nonce: nonce,
      model_tee_nodes: nodes.length,
      model_tee_addresses: addrs.modelTee,
      gateway_address: addrs.gateway,
      nvidia_overall_result: gpu?.overallResult ?? null,
      nvidia_nonce_match: gpu?.nonceMatch ?? null,
    },
    inference: {
      request_hash: sha256hex(requestBody),
      response_hash: sha256hex(responseText),
      signature_kind: kind,
      signer: sigCheck.recoveredAddress,
      signature_valid_against_preflight: sigCheck.valid,
    },
    created_at: new Date().toISOString(),
  };
  const outPath = `${DIR}/.receipt-example.json`;
  writeFileSync(outPath, JSON.stringify(receipt, null, 2));
  console.log(`Receipt written: ${outPath}`);

  report([
    { name: 'Attestation fresh, addresses extracted', pass: addrs.modelTee.length > 0 },
    { name: 'Signature verifies against preflight addresses', pass: sigCheck.valid },
    { name: 'Receipt file written', pass: true },
  ]);
}

main().catch((err) => {
  console.error('07 failed:', err);
  process.exit(1);
});
