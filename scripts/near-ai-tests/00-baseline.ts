// Step 0 (baseline): thin port of the upstream verification example —
// attestation (nonce-fresh) → NVIDIA NRAS → non-stream chat → signature.
// Run: npx tsx scripts/near-ai-tests/00-baseline.ts
// This proves key + model + network before the stepwise scripts. If this
// fails, nothing downstream is our bug. Uses shared config helpers; the
// per-step scripts (01+) decompose the same flow with more checks.
import {
  MODEL_NAME,
  decodeNvidiaAttestation,
  extractSigningAddresses,
  generateNonce,
  getAttestation,
  getGpuAttestation,
  httpError,
  apiKey,
  NEARAI_BASE_URL,
  report,
  sha256hex,
  summarizeGpuAttestation,
  verifySignature,
} from './config.js';

const CHAT_CONTENT = 'Respond with only two words';

async function sendChat(model: string, content: string): Promise<{ requestBody: string; responseText: string; chatId: string | null }> {
  const requestBody = JSON.stringify({ messages: [{ content, role: 'user' }], stream: false, model });
  const res = await fetch(`${NEARAI_BASE_URL}/v1/chat/completions`, {
    method: 'POST',
    headers: { accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey()}` },
    body: requestBody,
  });
  if (!res.ok) throw await httpError(res, 'Chat completion failed');
  const responseText = await res.text();
  let chatId: string | null = null;
  try {
    chatId = JSON.parse(responseText.trimStart()).id ?? null;
  } catch { /* leave null */ }
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
  console.log(`Model: ${MODEL_NAME}`);
  const nonce = generateNonce();
  const att = await getAttestation(MODEL_NAME, nonce);
  const addrs = extractSigningAddresses(att);
  const nodes = att.model_attestations ?? [];
  const nonceOk = nodes.length > 0 && nodes.every((a: any) => a.request_nonce === nonce);
  console.log(`Attestation: ${nodes.length} node(s), nonce echoed: ${nonceOk}`);

  let nvidiaOk = false;
  const payloads = nodes.filter((a: any) => a.nvidia_payload);
  const t0 = Date.now();
  for (const [i, a] of payloads.entries()) {
    const summary = summarizeGpuAttestation(decodeNvidiaAttestation(await getGpuAttestation(a.nvidia_payload)), nonce);
    const pass = summary.overallResult && summary.nonceMatch === true;
    console.log(`GPU payload ${i + 1}/${payloads.length}: overall=${summary.overallResult} nonceMatch=${summary.nonceMatch}`);
    nvidiaOk ||= pass;
    if (!pass) nvidiaOk = false;
  }
  console.log(`NRAS round-trip: ${((Date.now() - t0) / 1000).toFixed(1)}s for ${payloads.length} payload(s)`);

  const chat = await sendChat(MODEL_NAME, CHAT_CONTENT);
  if (!chat.chatId) throw new Error('No chat id in response');
  const sig = await getSignature(chat.chatId, MODEL_NAME);
  const kind: string = sig.signature_kind ?? (sig.text.split(':').length === 3 ? 'provider_tee' : 'gateway');
  const parts = sig.text.split(':');
  const hasModel = parts.length === 3;
  const reqOk = parts[hasModel ? 1 : 0] === sha256hex(chat.requestBody);
  const resOk = parts[hasModel ? 2 : 1] === sha256hex(chat.responseText);
  const modelOk = !hasModel || parts[0] === MODEL_NAME;
  const expected = kind === 'gateway' ? addrs.gateway : addrs.modelTee;
  const sigCheck = verifySignature(sig.text, sig.signature, expected);
  console.log(`Chat: kind=${kind} reqHash=${reqOk} resHash=${resOk} model=${modelOk} signer=${sigCheck.recoveredAddress} valid=${sigCheck.valid}`);

  report([
    { name: 'Attestation nodes echo nonce', pass: nonceOk },
    { name: 'NVIDIA GPU verdict true + nonce match', pass: nvidiaOk },
    { name: 'Request/response hashes match signed text', pass: reqOk && resOk && modelOk },
    { name: `Signature recovers to attested ${kind} address`, pass: sigCheck.valid },
  ]);
}

main().catch((err) => {
  console.error('00 failed:', err);
  process.exit(1);
});
