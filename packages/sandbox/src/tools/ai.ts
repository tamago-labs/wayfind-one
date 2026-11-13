// In-VM inference (thin, Phase 1 step 8/9 shape). Non-streaming chat only:
// attestation tasks demand provider_tee signatures, which streams don't get.
// Credential comes from /hooks/run injection (memory-only); absent → 503.
// Only near-ai is wired — anything else fails closed (501).
import { z } from 'zod';
import { AI_TIMEOUT_MS, MAX_AI_PROMPT_CHARS, NEARAI_BASE_URL } from '../config.js';
import { sha256Hex } from './crypto.js';
import { HttpError } from '../http.js';
import { getAiCredentials, getRunPolicy } from '../session.js';

const DEFAULT_MODEL = 'Qwen/Qwen3.8-27B';

export async function runAi(
  prompt: string,
  opts: { model?: string } = {},
): Promise<{
  text: string;
  chatId: string | null;
  model: string;
  provider: string;
  requestHash: string;
  responseHash: string;
}> {
  if (typeof prompt !== 'string' || !prompt) throw new HttpError(400, 'prompt is required');
  if (prompt.length > MAX_AI_PROMPT_CHARS) throw new HttpError(413, 'prompt too long');
  const creds = getAiCredentials();
  if (!creds) throw new HttpError(503, 'no ai credential injected for this session');
  if (creds.provider !== 'near-ai') {
    throw new HttpError(501, `provider ${creds.provider} not wired for in-VM inference yet`);
  }
  const model = opts.model || creds.model || DEFAULT_MODEL;
  // In-image policy enforcement (choke point for every inference path):
  // the model must be in the run allowlist — injected credential's model
  // when the policy names none. A smuggled opts.model fails closed here,
  // regardless of what the provision path allowed.
  const policy = getRunPolicy();
  const allowlist = policy && policy.allowedModels.length > 0 ? policy.allowedModels : [creds.model || DEFAULT_MODEL];
  if (!allowlist.includes(model)) {
    throw new HttpError(403, `model not permitted by run policy (allowed: ${allowlist.join(', ') || 'none'})`);
  }
  const requestBody = JSON.stringify({
    messages: [{ role: 'user', content: prompt }],
    stream: false,
    model,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), AI_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${NEARAI_BASE_URL}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'Content-Type': 'application/json',
        Authorization: `Bearer ${creds.key}`,
      },
      body: requestBody,
      signal: ctrl.signal,
    });
  } catch (err) {
    throw new HttpError(502, `inference unreachable: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    clearTimeout(timer);
  }
  const responseText = await res.text();
  if (!res.ok) {
    throw new HttpError(502, `inference failed (${res.status}): ${responseText.slice(0, 300)}`);
  }
  let parsed: { id?: string; choices?: Array<{ message?: { content?: string } }> };
  try {
    parsed = JSON.parse(responseText);
  } catch {
    throw new HttpError(502, 'inference returned non-JSON');
  }
  const text = parsed.choices?.[0]?.message?.content;
  if (typeof text !== 'string') throw new HttpError(502, 'inference returned no text');
  return {
    text,
    chatId: typeof parsed.id === 'string' ? parsed.id : null,
    model,
    provider: creds.provider,
    requestHash: sha256Hex(Buffer.from(requestBody, 'utf8')),
    responseHash: sha256Hex(Buffer.from(responseText, 'utf8')),
  };
}

export const aiTool = {
  name: 'ai',
  description: 'Run one non-streaming inference inside the sandbox (attestation-task shape).',
  schema: z.object({
    prompt: z.string(),
    model: z.string().optional(),
  }),
  run: async (args: { prompt: string; model?: string }) => runAi(args.prompt, { model: args.model }),
};
