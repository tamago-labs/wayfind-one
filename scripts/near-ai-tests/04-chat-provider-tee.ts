// Step 4: non-streaming chat → provider_tee signature verification.
// Run: npx tsx scripts/near-ai-tests/04-chat-provider-tee.ts
// Pass = signature_kind is provider_tee, signed text commits to our model id +
// exact request/response hashes, signer recovers to a preflight model TEE
// address. This is the evidence shape thin `wayfind ai` will demand for
// attestation tasks (non-streaming only).
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
    if (res.status !== 404) break;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw last;
}

async function main(): Promise<void> {
  const nonce = generateNonce();
  const att = await getAttestation(MODEL_NAME, nonce);
  const addrs = extractSigningAddresses(att);
  console.log(`Preflight: ${addrs.modelTee.length} model TEE address(es)`);

  const chat = await sendChat(MODEL_NAME, 'Respond with only two words');
  const sig = await getSignature(chat.chatId, MODEL_NAME);
  console.log(`signature_kind: ${sig.signature_kind ?? '(absent — inferring)'}`);

  const parts: string[] = sig.text.split(':');
  const kind: string = sig.signature_kind ?? (parts.length === 3 ? 'provider_tee' : 'gateway');
  const reqOk = parts[parts.length - 2] === sha256hex(chat.requestBody);
  const resOk = parts[parts.length - 1] === sha256hex(chat.responseText);
  const modelOk = parts.length === 3 ? parts[0] === MODEL_NAME : true;
  const sigCheck = verifySignature(sig.text, sig.signature, addrs.modelTee);
  console.log(`kind=${kind} reqHash=${reqOk} resHash=${resOk} model=${modelOk} signer=${sigCheck.recoveredAddress}`);

  report([
    { name: 'Signature kind is provider_tee (model TEE signed)', pass: kind === 'provider_tee' },
    { name: 'Signed text commits to requested model id', pass: modelOk },
    { name: 'Request/response hashes match signed text', pass: reqOk && resOk },
    { name: 'Signer recovers to a preflight model TEE address', pass: sigCheck.valid },
  ]);
}

main().catch((err) => {
  console.error('04 failed:', err);
  process.exit(1);
});
