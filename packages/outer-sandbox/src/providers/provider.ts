// OpenAI-compatible provider client (chat-further provider.ts pattern,
// pointed at env instead of Amplify secrets).
import OpenAI from 'openai';
import { setDefaultOpenAIClient, setTracingDisabled } from '@openai/agents';
import { PROVIDER_BASE_URL } from '../core/config.js';
import { drawKey } from './keystore.js';

let ready = false;

/** Live key resolution (env first, then keystore) — never the import-time snapshot. */
function liveChatKey(): string {
  return process.env.MODAL_API_KEY ?? drawKey('MODAL_API_KEY') ?? '';
}

export function initProvider(): void {
  if (ready) return;
  // 'missing-key' keeps the keyless cloud boot alive: /task and
  // /summarize-role gate on keysReady(), and /run re-inits after injection.
  const client = new OpenAI({ apiKey: liveChatKey() || 'missing-key', baseURL: PROVIDER_BASE_URL });
  setDefaultOpenAIClient(client);
  setTracingDisabled(true);
  ready = true;
}

/** Rebuild the default client with current env/keystore keys (after /run injection). */
export function reinitProvider(): void {
  ready = false;
  initProvider();
}
