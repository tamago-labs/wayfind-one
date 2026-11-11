// Bot runner v1 (hybrid-C hot state). One conversation = one in-memory
// bot: config + append-only hash-chained transcript. Single-turn only —
// user message in, one /ai call, assistant message out. No tool-execution
// loop (exec stays a separate relay call). Dies with the VM; persistence
// is via /checkpoint sealed snapshots (client uploads the blob).
import { z } from 'zod';
import { MAX_TRANSCRIPT_ENTRIES } from '../config.js';
import { HttpError } from '../http.js';
import { getSessionToken } from '../session.js';
import { deriveWorkspaceKey, sealFile, sha256Hex } from './crypto.js';
import { runAi } from './ai.js';

export interface BotConfig {
  system?: string;
  model?: string;
  provider?: string;
}

export interface TranscriptEntry {
  seq: number;
  role: 'user' | 'assistant';
  content: string;
  prev: string; // hash of previous entry, 'GENESIS' for seq 0
  hash: string; // sha256(`${seq}\n${role}\n${content}\n${prev}`)
}

let botConfig: BotConfig | null = null;
let transcript: TranscriptEntry[] = [];
let checkpointSeq = 0;

function entryHash(seq: number, role: string, content: string, prev: string): string {
  return sha256Hex(Buffer.from(`${seq}\n${role}\n${content}\n${prev}`, 'utf8'));
}

function appendEntry(role: 'user' | 'assistant', content: string): TranscriptEntry {
  const seq = transcript.length;
  const prev = seq === 0 ? 'GENESIS' : transcript[seq - 1].hash;
  const entry: TranscriptEntry = { seq, role, content, prev, hash: entryHash(seq, role, content, prev) };
  transcript.push(entry);
  return entry;
}

export function verifyTranscript(entries: TranscriptEntry[]): boolean {
  for (const [i, e] of entries.entries()) {
    if (e.seq !== i) return false;
    const wantPrev = i === 0 ? 'GENESIS' : entries[i - 1].hash;
    if (e.prev !== wantPrev) return false;
    if (e.hash !== entryHash(e.seq, e.role, e.content, e.prev)) return false;
  }
  return true;
}

export const botInitTool = {
  name: 'bot_init',
  description: 'Initialize the in-VM bot (config + empty transcript). Resets any prior state.',
  schema: z.object({
    system: z.string().optional().describe('Bot system prompt / role brief'),
    model: z.string().optional(),
    provider: z.string().optional(),
  }),
  run: async (args: { system?: string; model?: string; provider?: string }) => {
    botConfig = {
      ...(typeof args.system === 'string' ? { system: args.system } : {}),
      ...(typeof args.model === 'string' ? { model: args.model } : {}),
      ...(typeof args.provider === 'string' ? { provider: args.provider } : {}),
    };
    transcript = [];
    checkpointSeq = 0;
    return { ok: true as const, model: botConfig.model ?? null, provider: botConfig.provider ?? null };
  },
};

export const botMessageTool = {
  name: 'bot_message',
  description: 'Send one user message: appends to the chained transcript, runs one inference, appends the reply.',
  schema: z.object({ content: z.string() }),
  run: async (args: { content: string }) => {
    if (!botConfig) throw new HttpError(409, 'bot not initialized — call bot_init first');
    if (typeof args.content !== 'string' || !args.content) throw new HttpError(400, 'content is required');
    if (transcript.length >= MAX_TRANSCRIPT_ENTRIES) throw new HttpError(413, 'transcript full — terminate and start a new conversation');
    appendEntry('user', args.content);
    const rendered = [
      ...(botConfig.system ? [`system: ${botConfig.system}`] : []),
      ...transcript.map((e) => `${e.role}: ${e.content}`),
    ].join('\n');
    const ai = await runAi(rendered, { model: botConfig.model });
    appendEntry('assistant', ai.text);
    const head = transcript[transcript.length - 1];
    return {
      text: ai.text,
      seq: head.seq,
      head: head.hash,
      chatId: ai.chatId,
      model: ai.model,
      provider: ai.provider,
      requestHash: ai.requestHash,
      responseHash: ai.responseHash,
    };
  },
};

export const botTranscriptTool = {
  name: 'bot_transcript',
  description: 'Read the chained transcript with server-side chain verification.',
  schema: z.object({}),
  run: async () => ({ entries: transcript, verified: verifyTranscript(transcript), head: transcript.length ? transcript[transcript.length - 1].hash : null }),
};

export const checkpointTool = {
  name: 'checkpoint',
  description: 'Emit a sealed snapshot of the transcript (AES-256-GCM envelope). Client uploads the blob.',
  schema: z.object({}),
  run: async () => {
    const token = getSessionToken();
    if (!token) throw new HttpError(409, 'no session — checkpoint needs a booted session');
    const plaintext = Buffer.from(JSON.stringify(transcript), 'utf8');
    const env = sealFile(deriveWorkspaceKey(token), 'transcript.jsonl', plaintext);
    const seq = checkpointSeq++;
    return { seq, ...env };
  },
};
