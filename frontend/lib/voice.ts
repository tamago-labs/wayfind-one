// Voice capture client. The mic stream is downsampled to 24 kHz mono
// and encoded as WAV in the browser, so the outer server can forward it
// straight to Meta speech-to-text with no audio tooling.
import { transcribeVoice as transcribeVoiceFn } from './team';

export type VoiceResult = { transcript: string; audioDurationMs: number };

/** Voice: post a WAV blob, get the transcript back (Meta STT server-side). */
export async function transcribeVoice(wav: Blob): Promise<VoiceResult> {
  return transcribeVoiceFn(wav);
}

export interface RecordOptions {
  /** Max capture length. Default 60s. */
  maxMs?: number;
  /** Stop after this much near-silence (after the grace period). Default 2.5s. */
  silenceMs?: number;
  /** Live mic level 0..1 for the animation. */
  onLevel?: (level: number) => void;
  /** Elapsed ms ticker for the timer. */
  onTick?: (elapsedMs: number) => void;
}

function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const n = samples.length;
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // mono
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  writeStr(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Blob([buf], { type: 'audio/wav' });
}

/**
 * Record from the mic until silence, maxMs, or abort. Resolves with a
 * 24 kHz mono 16-bit WAV blob ready for transcribeVoice.
 */
export async function recordWav24k(opts: RecordOptions = {}, abort?: AbortSignal): Promise<Blob> {
  const TARGET = 24000;
  const { maxMs = 60_000, silenceMs = 2500, onLevel, onTick } = opts;
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true },
  });
  const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const ctx = new Ctx();
  try {
    const src = ctx.createMediaStreamSource(stream);
    const proc = ctx.createScriptProcessor(4096, 1, 1);
    const chunks: Float32Array[] = [];
    const ratio = ctx.sampleRate / TARGET;
    let silentFor = 0;
    let elapsed = 0;
    const started = Date.now();
    const chunkMs = (4096 / ctx.sampleRate) * 1000;
    let stopped = false;

    const tick = window.setInterval(() => onTick?.(Date.now() - started), 250);
    const finish = () => {
      if (stopped) return;
      stopped = true;
      window.clearInterval(tick);
      try {
        src.disconnect();
        proc.disconnect();
      } catch {
        /* already torn down */
      }
      stream.getTracks().forEach((t) => t.stop());
      void ctx.close().catch(() => {});
    };

    const done = new Promise<Blob>((resolve, reject) => {
      const encodeAll = () => {
        const total = chunks.reduce((a, c) => a + c.length, 0);
        const all = new Float32Array(total);
        let off = 0;
        for (const c of chunks) {
          all.set(c, off);
          off += c.length;
        }
        return encodeWav(all, TARGET);
      };
      // Abort with reason 'stop' = user tapped stop: keep what was captured.
      const onAbort = () => {
        const early = abort?.reason === 'stop';
        finish();
        abort?.removeEventListener('abort', onAbort);
        if (early && chunks.length > 0) resolve(encodeAll());
        else reject(new DOMException('Voice recording cancelled', 'AbortError'));
      };
      if (abort?.aborted) return onAbort();
      abort?.addEventListener('abort', onAbort, { once: true });

      proc.onaudioprocess = (e) => {
        if (stopped) return;
        const input = e.inputBuffer.getChannelData(0);
        // Downsample by averaging to the 24 kHz engine-native rate.
        const outLen = Math.floor(input.length / ratio);
        const out = new Float32Array(outLen);
        let sum = 0;
        for (let i = 0; i < outLen; i++) {
          const start = Math.floor(i * ratio);
          const end = Math.min(input.length, Math.floor((i + 1) * ratio));
          let acc = 0;
          for (let j = start; j < end; j++) acc += input[j];
          const s = acc / Math.max(1, end - start);
          out[i] = s;
          sum += s * s;
        }
        const rms = Math.sqrt(sum / Math.max(1, outLen));
        onLevel?.(Math.min(1, rms * 4));
        chunks.push(out);
        elapsed += chunkMs;

        // Silence auto-stop (after a 1s grace so soft starts aren't cut).
        if (elapsed > 1000) {
          silentFor = rms < 0.02 ? silentFor + chunkMs : 0;
          if (silentFor >= silenceMs) {
            finish();
            abort?.removeEventListener('abort', onAbort);
            resolve(encodeAll());
            return;
          }
        }
        if (elapsed >= maxMs) {
          finish();
          abort?.removeEventListener('abort', onAbort);
          resolve(encodeAll());
        }
      };
      src.connect(proc);
      // ScriptProcessor only pulls audio while connected to a destination.
      const mute = ctx.createGain();
      mute.gain.value = 0;
      proc.connect(mute);
      mute.connect(ctx.destination);
    });
    return await done;
  } catch (err) {
    stream.getTracks().forEach((t) => t.stop());
    void ctx.close().catch(() => {});
    throw err;
  }
}
