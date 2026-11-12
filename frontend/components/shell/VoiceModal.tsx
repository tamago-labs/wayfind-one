'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Mic, Square, X } from 'lucide-react';
import { recordWav24k, transcribeVoice } from '@/lib/voice';

type Phase = 'listening' | 'processing' | 'error';

interface VoiceModalProps {
  onVoiceSend: (text: string) => void;
  onClose: () => void;
}

function formatMs(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function VoiceModal({ onVoiceSend, onClose }: VoiceModalProps) {
  const [phase, setPhase] = useState<Phase>('listening');
  const [attempt, setAttempt] = useState(0);
  const [level, setLevel] = useState(0);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  // Callbacks in refs: the capture effect runs once, but auto-send needs fresh fns.
  const sendRef = useRef(onVoiceSend);
  sendRef.current = onVoiceSend;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  // (Re)start capture on mount and every retry; abort tears down on unmount.
  useEffect(() => {
    const abort = new AbortController();
    abortRef.current = abort;
    let alive = true;
    setPhase('listening');
    setError(null);
    setLevel(0);
    setElapsed(0);
    void (async () => {
      try {
        const wav = await recordWav24k(
          { onLevel: (l) => alive && setLevel(l), onTick: (ms) => alive && setElapsed(ms) },
          abort.signal,
        );
        if (!alive) return;
        setPhase('processing');
        const out = await transcribeVoice(wav);
        if (!alive) return;
        const text = out.transcript.trim();
        if (!text) {
          setError('Didn\u2019t catch that — try again a little louder.');
          setPhase('error');
          return;
        }
        // Transcript ready: send straight to the bot and close.
        const secs = Math.max(1, Math.round(out.audioDurationMs / 1000));
        sendRef.current(`[voice \u00b7 ${secs}s] ${text}`);
        closeRef.current();
      } catch (err) {
        if (!alive) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        const msg = err instanceof Error ? err.message : String(err);
        setError(
          /denied|permission|NotAllowed/i.test(msg)
            ? 'Mic access was blocked — allow the microphone and try again.'
            : msg,
        );
        setPhase('error');
      }
    })();
    return () => {
      alive = false;
      abort.abort('cancel');
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attempt]);

  useEffect(() => {
    if (phase !== 'listening') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [phase, onClose]);

  const stopEarly = () => abortRef.current?.abort('stop');

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-navy/40 p-6"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.94, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.94, opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="w-full max-w-sm overflow-hidden rounded-3xl bg-white p-6 text-center shadow-xl"
          onClick={(e) => e.stopPropagation()}
          role="dialog"
          aria-modal="true"
          aria-label="Voice message"
        >
          {/* Circular voice visual: single ring driven by live mic level. */}
          <div className="relative mx-auto grid h-44 w-44 place-items-center">
            {phase === 'listening' && (
              <span
                className="absolute inset-4 rounded-full border-2 border-cta/60 transition-transform duration-100"
                style={{ transform: `scale(${1 + level * 0.3})`, opacity: 0.4 + level * 0.6 }}
              />
            )}
            <button
              onClick={phase === 'listening' ? stopEarly : phase === 'error' ? () => setAttempt((a) => a + 1) : undefined}
              aria-label={phase === 'listening' ? 'Stop recording' : phase === 'error' ? 'Try again' : 'Voice'}
              className={`relative grid h-24 w-24 place-items-center rounded-full text-white shadow-lg ${
                phase === 'listening' ? 'bg-cta hover:bg-ctahover' : 'bg-navy'
              }`}
            >
              {phase === 'processing' ? (
                <span className="h-8 w-8 animate-spin rounded-full border-[3px] border-white/30 border-t-white" />
              ) : phase === 'listening' ? (
                <Square className="h-7 w-7" strokeWidth={2.2} />
              ) : (
                <Mic className="h-8 w-8" strokeWidth={2.2} />
              )}
            </button>
          </div>

          <p className="mt-4 font-brico text-lg font-bold text-navy">
            {phase === 'listening' && 'Listening…'}
            {phase === 'processing' && 'Transcribing…'}
            {phase === 'error' && 'Hmm'}
          </p>
          <p className="mt-1 text-sm tabular-nums text-navy/50">
            {phase === 'listening' && `${formatMs(elapsed)} — tap to stop`}
            {phase === 'processing' && 'Turning your voice into text'}
            {phase === 'error' && `${error} — tap mic to retry`}
          </p>

          <div className="mt-5 flex items-center justify-center">
            <button
              onClick={onClose}
              className="flex items-center gap-1.5 rounded-full px-5 py-2 text-sm font-semibold text-navy/50 hover:bg-ice"
            >
              <X className="h-4 w-4" strokeWidth={2.2} />
              Cancel
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
}
