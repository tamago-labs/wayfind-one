// Step 5: streaming chat → gateway signature verification.
// Run: npx tsx scripts/near-ai-tests/05-chat-gateway-sign.ts
// Pass = signature_kind is gateway, signed text commits to the EXACT bytes
// received, signer recovers to the preflight gateway address. Product rule
// under test: `wayfind ai` either forces non-stream (provider_tee only) or
// accepts gateway-kind and records the kind in the receipt.
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

async function sendChatStream(model: string, content: string): Promise<{ requestBody: string; responseText: string; chatId: string }> {
  const requestBody = JSON.stringify({ messages: [{ content, role: 'user' }], stream: true, model });
  const res = await fetch(`${NEARAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: requestBody,
  });
  if (!res.ok) throw await httpError(res, 'Chat completion failed');
  const responseText = await res.text();
  const firstData = responseText.split('\n').find((l) => l.startsWith('data: {'));
  const chatId = firstData ? JSON.parse(firstData.substring(6)).id : null;
  if (!chatId) throw new Error('No chat id in stream');
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

  const chat = await sendChatStream(MODEL_NAME, 'Respond with only two words');
  const sig = await getSignature(chat.chatId, MODEL_NAME);
  const parts: string[] = sig.text.split(':');
  const kind: string = sig.signature_kind ?? (parts.length === 3 ? 'provider_tee' : 'gateway');
  const reqOk = parts[parts.length - 2] === sha256hex(chat.requestBody);
  const resOk = parts[parts.length - 1] === sha256hex(chat.responseText);
  const sigCheck = verifySignature(sig.text, sig.signature, addrs.gateway);
  console.log(`kind=${kind} reqHash=${reqOk} resHash=${resOk} signer=${sigCheck.recoveredAddress}`);

  report([
    { name: 'Signature kind is gateway (streamed bytes signed)', pass: kind === 'gateway' },
    { name: 'Request/response bytes match signed text', pass: reqOk && resOk },
    { name: 'Signer recovers to the preflight gateway address', pass: sigCheck.valid },
  ]);
}

main().catch((err) => {
  console.error('05 failed:', err);
  process.exit(1);
});
