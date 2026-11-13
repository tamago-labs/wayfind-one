// Bot runner v1 (hybrid-C hot state). One conversation = one in-memory
// bot: config + append-only hash-chained transcript. Single-turn only —
// user message in, one /ai call, assistant message out. No tool-execution
// loop (exec stays a separate relay call). Dies with the VM; persistence
// is via /checkpoint sealed snapshots (client uploads the blob).
import { z } from 'zod';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { MAX_TRANSCRIPT_ENTRIES, WORKSPACE_DIR } from '../config.js';
import { HttpError } from '../http.js';
import { getAiCredentials, getRunPolicy, getSandboxProfile, getSessionToken } from '../session.js';
import { deriveWorkspaceKey, sealFile, sha256Hex } from './crypto.js';
import { clearParseLog, parseLog } from './files.js';
import { runAi } from './ai.js';
import {
  preflightAttestation,
  verifyMessage,
  type MessageVerification,
  type Preflight,
} from './attest.js';

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
// Retained attestation candidates (None on standard-tier providers where
// no preflight runs). Per-message records feed /bot/evidence → receipts.
let preflight: Preflight | null = null;
let verifications: MessageVerification[] = [];

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
  description: 'Initialize the in-VM bot (config + empty transcript). Runs attestation preflight for NEAR providers.',
  schema: z.object({
    system: z.string().optional().describe('Bot system prompt / role brief'),
    model: z.string().optional(),
    provider: z.string().optional(),
  }),
  run: async (args: { system?: string; model?: string; provider?: string }) => {    botConfig = {
      ...(typeof args.system === 'string' ? { system: args.system } : {}),
      ...(typeof args.model === 'string' ? { model: args.model } : {}),
      ...(typeof args.provider === 'string' ? { provider: args.provider } : {}),
    };
    transcript = [];
    checkpointSeq = 0;
    verifications = [];
    preflight = null;
    clearParseLog();
    // Attestation preflight once per session for NEAR providers (~2s).
    // Standard-tier providers skip it: nothing to check against.
    const creds = getAiCredentials();
    const provider = botConfig.provider ?? creds?.provider ?? null;
    const model = botConfig.model ?? creds?.model ?? 'Qwen/Qwen3.8-27B';
    // Model override outside the run allowlist is rejected at init, before
    // any transcript exists (runAi re-checks per call as the choke point).
    const runPolicy = getRunPolicy();
    const allowlist = runPolicy && runPolicy.allowedModels.length > 0
      ? runPolicy.allowedModels
      : [creds?.model ?? 'Qwen/Qwen3.8-27B'];
    if (!allowlist.includes(model)) {
      throw new HttpError(403, `model not permitted by run policy (allowed: ${allowlist.join(', ') || 'none'})`);
    }
    // Run-policy enforcement (fail closed, inside the image):
    // verified_inference demands attested NEAR inference. An explicit
    // non-attestable provider is refused outright; a missing credential
    // fails as 503 either way. No silent "skip" tier exists when the
    // policy is stated.
    const demandsAttested = runPolicy?.securityLevel === 'verified_inference';
    if (provider === 'near-ai') {
      if (!creds) throw new HttpError(503, 'no ai credential injected for attested inference');
      try {
        preflight = await preflightAttestation(creds.key, model);
      } catch (err) {
        throw new HttpError(502, `attestation preflight failed: ${err instanceof Error ? err.message : String(err)}`);
      }
      if (!preflight.nonceEchoed || preflight.modelTee.length === 0) {
        throw new HttpError(502, 'attestation preflight failed: no fresh model TEE evidence');
      }
      if (!preflight.nvidia || !preflight.nvidia.overall || preflight.nvidia.nonceMatch !== true) {
        throw new HttpError(502, 'attestation preflight failed: NVIDIA verdict not clean');
      }
    } else if (demandsAttested) {
      throw new HttpError(501, `run policy requires verified_inference: provider ${provider ?? 'none'} cannot attest`);
    }
    return {
      ok: true as const,
      model,
      provider,
      attested: preflight !== null,
      policy: runPolicy ? { securityLevel: runPolicy.securityLevel, enforced: true } : null,
      profile: getSandboxProfile(),
      preflight: preflight ? { nodes: preflight.nodes, modelTee: preflight.modelTee.length, nvidiaGpus: preflight.nvidia?.gpus ?? 0 } : null,
    };
  },
};

// Workspace context: the point of "ask about your files" is that the bot
// can actually see them. Text files under the workspace are prepended to
// every prompt (fresh each turn, binary skipped). PDFs (staged statements)
// are text-extracted in-VM via pdf-parse — fully offline, no key, no data
// leaves the sandbox (this is why the inner image doesn't use the Meta
// read path: that needs PROVIDER_API_KEY, which must never enter the
// inner VM). Caps keep prompts small.
const MAX_CTX_FILES = 50;
const MAX_CTX_FILE_CHARS = 8_000;
const MAX_CTX_TOTAL_CHARS = 16_000;
const MAX_CTX_PDF_CHARS = 12_000;

function isTextBuffer(buf: Buffer): boolean {
  const head = buf.subarray(0, Math.min(buf.length, 8000));
  for (let i = 0; i < head.length; i++) {
    if (head[i] === 0) return false;
  }
  return true;
}

async function mediaText(rel: string): Promise<string | null> {
  const { metaReadFile } = await import('./files.js');
  try {
    const out = await metaReadFile(rel);
    return out ? out.text.slice(0, MAX_CTX_PDF_CHARS) : null;
  } catch {
    return null;
  }
}

async function readWorkspaceContext(): Promise<string> {
  const collected: Array<{ rel: string; text: string }> = [];
  let total = 0;
  const walk = async (dir: string, relBase: string): Promise<void> => {
    if (collected.length >= MAX_CTX_FILES || total >= MAX_CTX_TOTAL_CHARS) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (collected.length >= MAX_CTX_FILES || total >= MAX_CTX_TOTAL_CHARS) break;
      if (e.name.startsWith('.')) continue;
      const abs = path.join(dir, e.name);
      const rel = relBase ? `${relBase}/${e.name}` : e.name;
      try {
        if (e.isDirectory()) {
          await walk(abs, rel);
        } else if (e.isFile()) {
          const st = statSync(abs);
          if (st.size > 1024 * 1024) continue;
          const buf = readFileSync(abs);
          if (/\.pdf$/i.test(e.name) || /\.(png|jpe?g|gif|webp)$/i.test(e.name)) {
            // Staged documents/images: Meta parsing utility (non-attested,
            // recorded in the parse log). Unreadable → skip silently.
            const text = await mediaText(rel);
            if (!text) continue;
            collected.push({ rel, text });
            total += text.length;
            continue;
          }
          if (!isTextBuffer(buf)) continue;
          const text = buf.toString('utf8').slice(0, MAX_CTX_FILE_CHARS);
          collected.push({ rel, text });
          total += text.length;
        }
      } catch {
        // Unreadable entry — skip, don't fail the turn.
      }
    }
  };
  await walk(WORKSPACE_DIR, '');
  if (collected.length === 0) return '';
  const parts = collected.map((f) => `--- ${f.rel} ---\n${f.text}`);
  return `\n\nWorkspace files (attached by the user, read live from the sandbox):\n${parts.join('\n')}`;
}

export const botMessageTool = {
  name: 'bot_message',
  description: 'Send one user message: appends to the chained transcript, runs one inference, appends the reply.',
  schema: z.object({ content: z.string() }),
  run: async (args: { content: string }) => {
    if (!botConfig) throw new HttpError(409, 'bot not initialized — call bot_init first');
    if (typeof args.content !== 'string' || !args.content) throw new HttpError(400, 'content is required');
    if (transcript.length >= MAX_TRANSCRIPT_ENTRIES) throw new HttpError(413, 'transcript full — terminate and start a new conversation');
    appendEntry('user', args.content);
    const workspaceCtx = await readWorkspaceContext();
    const rendered = [
      ...(botConfig.system ? [`system: ${botConfig.system}`] : []),
      ...transcript.map((e) => `${e.role}: ${e.content}`),
      workspaceCtx,
    ].join('\n');
    const ai = await runAi(rendered, { model: botConfig.model });
    appendEntry('assistant', ai.text);
    const head = transcript[transcript.length - 1];
    // Per-message 06-checks against the retained preflight. When the run
    // policy demands verified_inference, a missing preflight fails the
    // turn (it can only happen if init was bypassed — init enforces it).
    // Without a stated policy the old honest skip remains for standard tier.
    const creds = getAiCredentials();
    const policy = getRunPolicy();
    let verification: MessageVerification;
    if (preflight && creds) {
      verification = await verifyMessage(
        creds.key, head.seq, ai.chatId, ai.model, ai.requestHash, ai.responseHash, preflight,
      );
    } else if (policy?.securityLevel === 'verified_inference') {
      throw new HttpError(502, 'run policy requires verified_inference: no attestation preflight on record — re-init');
    } else {
      verification = {
        seq: head.seq, chatId: ai.chatId, checked: false, kind: 'unknown',
        kindMatch: false, requestHashMatch: false, responseHashMatch: false,
        modelMatch: null, signer: null, valid: false,
        signedText: null, signature: null,
      };
    }
    verifications.push(verification);
    return {
      text: ai.text,
      seq: head.seq,
      head: head.hash,
      chatId: ai.chatId,
      model: ai.model,
      provider: ai.provider,
      requestHash: ai.requestHash,
      responseHash: ai.responseHash,
      verification,
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

export const evidenceTool = {
  name: 'bot_evidence',
  description: 'Retained attestation preflight + per-message verification records (feeds receipts).',
  schema: z.object({}),
  run: async () => ({
    policy: getRunPolicy(),
    profile: getSandboxProfile(),
    parsing: [...parseLog],
    preflight: preflight
      ? {
          at: preflight.at,
          nonce: preflight.nonce,
          model: preflight.model,
          nodes: preflight.nodes,
          nonceEchoed: preflight.nonceEchoed,
          modelTee: preflight.modelTee,
          gateway: preflight.gateway,
          nvidia: preflight.nvidia,
        }
      : null,
    messages: verifications,
    verified: verifications.length > 0 && verifications.every((v) => !v.checked || v.valid),
  }),
};
