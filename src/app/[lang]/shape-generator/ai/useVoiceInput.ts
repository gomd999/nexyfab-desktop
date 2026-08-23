'use client';

/**
 * useVoiceInput.ts — Web Speech API voice-to-text hook.
 *
 * Wraps `webkitSpeechRecognition` / `SpeechRecognition` so the AI
 * prompt surfaces can accept voice input. Falls back to "not
 * supported" cleanly on Firefox / Safari iOS.
 *
 * Behaviour:
 *   - `start()` begins listening; interim results stream via
 *     `onInterim` callback, final result via `onFinal`.
 *   - `stop()` ends listening manually.
 *   - Auto-stops after `silenceMs` of no new speech (default 1500).
 *   - Localised: ko-KR or en-US auto-picked from `lang`. Override
 *     via `recognitionLang` prop.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { toIsoLang, type IsoLang } from '@/lib/i18n/normalize';

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((ev: { results: ArrayLike<ArrayLike<{ transcript: string; isFinal?: boolean }>> & { length: number } }) => void) | null;
  onerror: ((ev: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
};

interface SpeechRecognitionCtor {
  new(): SpeechRecognitionLike;
}

function getSpeechRecognition(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export interface VoiceInputOptions {
  lang: string;
  /** Override the recognition locale tag. Defaults to the selected UI locale. */
  recognitionLang?: string;
  /** Auto-stop after this much silence. Default: 1500ms. */
  silenceMs?: number;
  onInterim?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (msg: string) => void;
}

/**
 * Speech recognition uses regional BCP-47 tags rather than the route's short
 * locale id. Keep this map next to the hook so Arabic (and the other four
 * non-English locales) do not silently fall back to en-US.
 */
const VOICE_LOCALES: Record<IsoLang, string> = {
  ko: 'ko-KR',
  en: 'en-US',
  ja: 'ja-JP',
  zh: 'zh-CN',
  es: 'es-ES',
  ar: 'ar-SA',
};

export interface VoiceInputState {
  supported: boolean;
  listening: boolean;
  start: () => void;
  stop: () => void;
  /** Current interim transcript while listening. */
  interim: string;
}

export function useVoiceInput(opts: VoiceInputOptions): VoiceInputState {
  const [listening, setListening] = useState(false);
  const [interim, setInterim] = useState('');
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const silenceTimerRef = useRef<number | null>(null);

  const ctor = getSpeechRecognition();
  const supported = ctor !== null;

  const armSilenceTimer = useCallback(() => {
    if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
    silenceTimerRef.current = window.setTimeout(() => {
      recRef.current?.stop();
    }, opts.silenceMs ?? 1500);
  }, [opts.silenceMs]);

  const start = useCallback(() => {
    if (!ctor || recRef.current) return;
    const rec = new ctor();
    const locale = opts.recognitionLang ?? VOICE_LOCALES[toIsoLang(opts.lang)];
    rec.lang = locale;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (ev) => {
      let interimText = '';
      let finalText = '';
      for (let i = 0; i < ev.results.length; i++) {
        const r = ev.results[i]!;
        const alt = r[0];
        if (!alt) continue;
        if (alt.isFinal) finalText += alt.transcript;
        else interimText += alt.transcript;
      }
      if (interimText) {
        setInterim(interimText);
        opts.onInterim?.(interimText);
        armSilenceTimer();
      }
      if (finalText) {
        setInterim('');
        opts.onFinal?.(finalText.trim());
        armSilenceTimer();
      }
    };
    rec.onerror = (ev) => {
      opts.onError?.(ev.error);
      setListening(false);
      recRef.current = null;
    };
    rec.onend = () => {
      setListening(false);
      recRef.current = null;
      if (silenceTimerRef.current !== null) {
        window.clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
    };
    recRef.current = rec;
    try {
      rec.start();
      setListening(true);
      armSilenceTimer();
    } catch (err) {
      opts.onError?.((err as Error).message);
      recRef.current = null;
    }
  }, [ctor, opts, armSilenceTimer]);

  const stop = useCallback(() => {
    if (silenceTimerRef.current !== null) {
      window.clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    recRef.current?.stop();
  }, []);

  // Cleanup on unmount.
  useEffect(() => () => {
    if (silenceTimerRef.current !== null) window.clearTimeout(silenceTimerRef.current);
    recRef.current?.abort();
    recRef.current = null;
  }, []);

  return { supported, listening, start, stop, interim };
}
