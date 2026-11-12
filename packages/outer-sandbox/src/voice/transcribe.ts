// Voice transcription proxy. The browser records the mic, encodes WAV
// (24 kHz mono 16-bit PCM — the ASR engine-native format) and POSTs raw
// bytes here; we forward to Meta's speech-to-text endpoint and return the
// transcript. Meta-direct key (PROVIDER_API_KEY via metaApiKey) — separate
// from the Modal chat-model key. Errors carry an HTTP status for the route.
import { metaApiKey } from '../providers/providers.js';

const ASR_URL = 'https://api.meta.ai/v1/asr/transcribe';
const ASR_MODEL = 'muse-voice-transcribe-1.0';
// 24 kHz mono 16-bit = 48 KB/s; cap ~2 min of audio.
const MAX_BYTES = 6 * 1024 * 1024;

export class VoiceError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export interface VoiceTranscript {
  transcript: string;
  audioDurationMs: number;
}

function isWav(b: Buffer): boolean {
  return (
    b.length >= 12 &&
    b.toString('ascii', 0, 4) === 'RIFF' &&
    b.toString('ascii', 8, 12) === 'WAVE'
  );
}

export async function transcribeWav(wav: Buffer): Promise<VoiceTranscript> {
  if (wav.length === 0) throw new VoiceError(400, 'Empty audio body');
  if (wav.length > MAX_BYTES) throw new VoiceError(413, 'Audio too long (max ~2 minutes)');
  if (!isWav(wav)) throw new VoiceError(400, 'Body must be a WAV file (audio/wav)');

  // Voice always goes to Meta's ASR — the Meta key, never the chat-model key.
  const key = metaApiKey();
  if (!key) {
    throw new VoiceError(503, 'Voice transcription needs a Meta API key — add one in Settings → Providers');
  }

  const form = new FormData();
  form.append(
    'request',
    new Blob([JSON.stringify({ mode: 'PUSH_TO_TALK', model: ASR_MODEL, audioEncoding: 'WAV' })], {
      type: 'application/json',
    }),
    'request.json',
  );
  form.append('audio', new Blob([new Uint8Array(wav)], { type: 'audio/wav' }), 'audio.wav');

  let res: Response;
  try {
    res = await fetch(ASR_URL, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}` },
      body: form,
    });
  } catch (err) {
    throw new VoiceError(502, `Speech service unreachable: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!res.ok) {
    const detail = (await res.text()).slice(0, 300);
    throw new VoiceError(
      res.status === 429 ? 429 : 502,
      res.status === 429 ? 'Speech service busy — try again in a moment' : `Speech service error (${res.status}): ${detail}`,
    );
  }
  const data = (await res.json()) as { transcript?: string; audioDurationMs?: number };
  return { transcript: data.transcript ?? '', audioDurationMs: data.audioDurationMs ?? 0 };
}
