// Step 6: the Wayfind verification policy as code (fail-closed).
// Run: npx tsx scripts/near-ai-tests/06-policy-gate.ts
// Enforces, in order: fresh nonce per run → preflight attestation BEFORE
// the completion, candidates retained → chat → signature present (bounded
// retry) → signer matches EXACTLY ONE retained candidate of the declared
// kind → kind matches payload shape. Anything missing/mismatched = reject.
// This becomes the core of `wayfind verify` (Phase 2).
import {
  MODEL_NAME,
  NEARAI_BASE_URL,
  apiKey,
  extractSigningAddresses,
  generateNonce,
  getAttestation,
  httpError,
  report,
  sha256hex,
  verifySignature,
} from './config.js';

async function sendChat(model: string, content: string): Promise<{ requestBody: string; responseText: string; chatId: string }> {
  const requestBody = JSON.stringify({ messages: [{ content, role: 'user' }], stream: false, model });
  const res = await fetch(`${NEARAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: requestBody,
  });
  if (!res.ok) throw await httpError(res, 'Chat completion failed');
  const responseText = await res.text();
  const chatId = JSON.parse(responseText.trimStart()).id;
  if (!chatId) throw new Error('No chat id in response');
  return { requestBody, responseText, chatId };
}

async function getSignature(chatId: string, model: string, retries = 5): Promise<any> {
  const url = `${NEARAI_BASE_URL}/v1/signature/${encodeURIComponent(chatId)}?model=${encodeURIComponent(model)}&signing_algo=ecdsa`;
  let last: Error = new Error('no attempts');
  for (let i = 0; i < retries; i++) {
    const res = await fetch(url, { headers: { accept: 'application/json', Authorization: `Bearer ${apiKey()}` } });
    if (res.ok) return res.json();
    last = await httpError(res, 'Signature request failed');
    if (res.status !== 404) break; // non-404 = fail closed immediately
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw last;
}

async function main(): Promise<void> {
  // 1. Fresh nonce, preflight BEFORE completion — a later report can never
  //    justify this completion.
  const nonce = generateNonce();
  const preflightAt = new Date().toISOString();
  const att = await getAttestation(MODEL_NAME, nonce);
  const nodes = att.model_attestations ?? [];
  const nonceFresh = nodes.length > 0 && nodes.every((a: any) => a.request_nonce === nonce);
  const addrs = extractSigningAddresses(att);
  console.log(`Preflight @ ${preflightAt}: ${nodes.length} node(s), nonce fresh: ${nonceFresh}`);

  // 2. Completion strictly after preflight.
  const chat = await sendChat(MODEL_NAME, 'Respond with only two words');

  // 3. Signature required — absent after retries = unverified, no fallback.
  const sig = await getSignature(chat.chatId, MODEL_NAME);
  const hasSignature = !!sig?.signature && !!sig?.text;

  // 4. Kind must match payload shape (server-declared kind can't smuggle a
  //    model-less payload into the model check or vice versa).
  const parts: string[] = (sig.text ?? '').split(':');
  const kind: string = sig.signature_kind ?? (parts.length === 3 ? 'provider_tee' : 'gateway');
  const kindMatchesShape = parts.length === (kind === 'provider_tee' ? 3 : 2);

  // 5. Hashes + model binding.
  const reqOk = parts[parts.length - 2] === sha256hex(chat.requestBody);
  const resOk = parts[parts.length - 1] === sha256hex(chat.responseText);
  const modelOk = kind !== 'provider_tee' || parts[0] === MODEL_NAME;

  // 6. Signer must match EXACTLY ONE retained preflight candidate of the
  //    declared kind — never a fresh report, never the other kind's key.
  const candidates = kind === 'gateway' ? addrs.gateway : addrs.modelTee;
  const sigCheck = verifySignature(sig.text, sig.signature, candidates);
  console.log(`kind=${kind} shape=${kindMatchesShape} hashes=${reqOk && resOk} model=${modelOk} signer=${sigCheck.recoveredAddress}`);

  report([
    { name: 'Preflight attestation fresh (nonce echoed, pre-completion)', pass: nonceFresh },
    { name: 'Response signature present after bounded retry', pass: hasSignature },
    { name: 'Declared kind matches signed payload shape', pass: kindMatchesShape },
    { name: 'Hashes match; provider_tee commits to model id', pass: reqOk && resOk && modelOk },
    { name: 'Signer matches exactly one retained preflight candidate', pass: sigCheck.valid },
  ]);
}

main().catch((err) => {
  console.error('06 failed:', err);
  process.exit(1);
});
