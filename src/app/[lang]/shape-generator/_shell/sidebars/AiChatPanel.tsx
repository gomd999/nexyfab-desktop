'use client';

// Embedded AI chat panel — replaces the modal-trigger placeholder in the
// Nexy AI tab. Sends user prompts to the existing /api/nexyfab/scad-agent
// endpoint and renders responses with an "Apply" button that dispatches a
// tool intent for Inner to materialise.

import { useEffect, useRef, useState } from 'react';
import { I } from '../Icons';
import { useLang } from '../../hooks/useLang';
import { loc } from '../../lib/loc';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  /** Optional Stage 2 diagnostics surfaced from intentToScad result. */
  diagnostics?: { severity: 'info' | 'warn' | 'error'; message: string }[];
  /** Optional suggested intent payload — drives the Apply button. */
  intent?: Record<string, unknown>;
  /** Pattern suggestion from Stage 2 — Apply uses the pattern's seed. */
  pattern?: { id: string; title: string };
  loading?: boolean;
}

export interface AiChatPanelProps {
  isKo: boolean;
}

// Example prompt chips, keyed by route lang (matches useLang()). (2026-06-13 i18n)
const SUGGESTIONS: Record<string, string[]> = {
  ko: ['두께 5mm 알루미늄 브라켓을 만들어줘', '필렛 반경 2mm 적용', '∅6.5 카운터보어 홀 4개를 모서리에 추가', 'M5 나사 구멍으로 변경'],
  en: ['Make a 5 mm aluminum bracket', 'Apply 2 mm fillet to all sharp edges', 'Add 4× ∅6.5 counterbore holes in corners', 'Change holes to tapped M5'],
  ja: ['厚さ5mmのアルミブラケットを作って', 'すべての鋭いエッジに2mmのフィレットを適用', '∅6.5のザグり穴を四隅に4つ追加', '穴をM5タップ穴に変更'],
  cn: ['制作一个5mm厚的铝支架', '对所有尖锐边缘应用2mm圆角', '在四角添加4个∅6.5沉头孔', '将孔改为M5攻丝孔'],
  es: ['Crea un soporte de aluminio de 5 mm', 'Aplica un redondeo de 2 mm a todas las aristas vivas', 'Añade 4 agujeros avellanados ∅6.5 en las esquinas', 'Cambia los agujeros a roscados M5'],
  ar: ['أنشئ حاملاً من الألومنيوم بسماكة 5 مم', 'طبّق تدويرًا 2 مم على كل الحواف الحادة', 'أضف 4 ثقوب غاطسة ∅6.5 في الزوايا', 'غيّر الثقوب إلى ملولبة M5'],
};

export function AiChatPanel({ isKo }: AiChatPanelProps) {
  const lang = useLang();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: loc(lang, {
        ko: '안녕하세요. 자연어로 모델 편집을 요청하거나 DFM 검토를 부탁할 수 있습니다.',
        en: 'Ask in natural language to edit your model or get a DFM review.',
        ja: '自然言語でモデルの編集を依頼したり、DFM レビューを頼んだりできます。',
        zh: '用自然语言请求编辑模型或进行 DFM 审查。',
        es: 'Pide en lenguaje natural editar tu modelo u obtener una revisión DFM.',
        ar: 'اطلب بلغة طبيعية تعديل نموذجك أو الحصول على مراجعة DFM.',
      }),
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async (prompt: string) => {
    if (!prompt.trim() || busy) return;
    setInput('');
    setBusy(true);
    const userMsg: Message = { id: `u-${Date.now()}`, role: 'user', content: prompt };
    const assistantId = `a-${Date.now()}`;
    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', loading: true }]);
    try {
      // Streaming-first: ask the endpoint for an SSE/NDJSON stream. Falls
      // back to full-JSON mode if the server doesn't advertise text/event-
      // stream. Token-level rendering means the panel feels native-AI even
      // when the underlying model is slow.
      const res = await fetch('/api/nexyfab/scad-agent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream, application/json',
        },
        body: JSON.stringify({ prompt, mode: 'chat', stream: true }),
      });

      const contentType = res.headers.get('content-type') ?? '';
      const isStream = contentType.includes('event-stream') || contentType.includes('ndjson') || contentType.includes('text/plain');

      if (isStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let acc = '';
        const final: { diagnostics?: Message['diagnostics']; intent?: Record<string, unknown>; pattern?: { id: string; title: string } } = {};
        // Mark first chunk arrival → stop the typing-indicator.
        let firstChunk = true;

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });

          // Parse event-stream frames (event:/data:) OR newline-delimited JSON.
          let frame: string | undefined;
          while ((frame = consumeFrame(buffer)) !== undefined) {
            buffer = buffer.slice(frame.length);
            const payload = parseFrame(frame);
            if (!payload) continue;
            if (typeof payload.delta === 'string') {
              acc += payload.delta;
              if (firstChunk) firstChunk = false;
              setMessages(prev => prev.map(m => m.id === assistantId
                ? { ...m, loading: false, content: acc }
                : m));
            }
            if (payload.diagnostics) final.diagnostics = payload.diagnostics as Message['diagnostics'];
            if (payload.intent) final.intent = payload.intent as Record<string, unknown>;
            if (payload.pattern) final.pattern = payload.pattern as { id: string; title: string };
          }
        }
        // Flush any partially-buffered frame.
        if (buffer.trim()) {
          const payload = parseFrame(buffer);
          if (payload?.delta) acc += payload.delta;
        }
        setMessages(prev => prev.map(m => m.id === assistantId ? {
          ...m,
          loading: false,
          content: acc || loc(lang, { ko: '응답 없음', en: 'Empty response', ja: '応答なし', zh: '无响应', es: 'Sin respuesta', ar: 'لا توجد استجابة' }),
          diagnostics: final.diagnostics,
          intent: final.intent,
          pattern: final.pattern,
        } : m));
      } else {
        // Non-stream fallback — full JSON.
        const data = await res.json().catch(() => null) as {
          text?: string;
          diagnostics?: Message['diagnostics'];
          intent?: Record<string, unknown>;
          pattern?: { id: string; title: string };
        } | null;
        setMessages(prev => prev.map(m => m.id === assistantId ? {
          ...m,
          loading: false,
          content: data?.text ?? loc(lang, { ko: '응답을 받을 수 없습니다 — 오프라인 모드', en: 'No response — offline mode', ja: '応答を取得できません — オフラインモード', zh: '无法获取响应 — 离线模式', es: 'Sin respuesta — modo sin conexión', ar: 'لا توجد استجابة — وضع عدم الاتصال' }),
          diagnostics: data?.diagnostics,
          intent: data?.intent,
          pattern: data?.pattern,
        } : m));
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantId ? {
        ...m,
        loading: false,
        content: loc(lang, {
          ko: '연결 실패. 모달 어시스턴트로 폴백합니다.',
          en: 'Connection failed. Falling back to modal assistant.',
          ja: '接続に失敗しました。モーダルアシスタントにフォールバックします。',
          zh: '连接失败。回退到模态助手。',
          es: 'Conexión fallida. Recurriendo al asistente modal.',
          ar: 'فشل الاتصال. يتم الرجوع إلى المساعد المنبثق.',
        }),
      } : m));
    } finally {
      setBusy(false);
    }
  };

  // Parse one frame from the stream buffer — supports SSE "data: {...}\n\n",
  // raw NDJSON "{...}\n", and plain text deltas. Returns the consumed prefix.
  function consumeFrame(buf: string): string | undefined {
    // SSE: terminated by blank line.
    const sseEnd = buf.indexOf('\n\n');
    if (sseEnd !== -1) return buf.slice(0, sseEnd + 2);
    // NDJSON / plain: terminated by single newline.
    const nlEnd = buf.indexOf('\n');
    if (nlEnd !== -1) return buf.slice(0, nlEnd + 1);
    return undefined;
  }

  function parseFrame(frame: string): { delta?: string; diagnostics?: unknown; intent?: unknown; pattern?: unknown } | null {
    const trimmed = frame.trim();
    if (!trimmed) return null;
    // SSE "data: ..." prefix.
    const dataLine = trimmed.startsWith('data:') ? trimmed.slice(5).trim() : trimmed;
    if (dataLine === '[DONE]') return null;
    if (dataLine.startsWith('{')) {
      try {
        const obj = JSON.parse(dataLine);
        return obj;
      } catch {
        return { delta: dataLine };
      }
    }
    // Plain text — treat as delta.
    return { delta: dataLine + ' ' };
  }

  const apply = (msg: Message) => {
    if (typeof window === 'undefined') return;
    if (msg.intent) {
      window.dispatchEvent(new CustomEvent('nexyfab:apply-ai-intent', { detail: msg.intent }));
    } else if (msg.pattern) {
      window.dispatchEvent(new CustomEvent('nexyfab:apply-ai-pattern', { detail: msg.pattern }));
    }
  };

  const suggestions = SUGGESTIONS[lang] ?? SUGGESTIONS.en;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages */}
      <div
        ref={scrollRef}
        role="log"
        aria-live="polite"
        aria-atomic="false"
        aria-label={loc(lang, { ko: 'AI 대화 내역', en: 'AI conversation history', ja: 'AI 会話履歴', zh: 'AI 对话记录', es: 'Historial de conversación de IA', ar: 'سجل محادثة الذكاء الاصطناعي' })}
        style={{ flex: 1, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}
      >
        {messages.map(m => (
          <div
            key={m.id}
            style={{
              alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
              maxWidth: '90%',
              padding: '8px 10px',
              borderRadius: 8,
              background: m.role === 'user' ? 'var(--nx-accent)' : 'var(--nx-panel-2)',
              color: m.role === 'user' ? '#fff' : 'var(--nx-text)',
              fontSize: 11,
              lineHeight: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            {m.loading ? (
              <span style={{ display: 'inline-flex', gap: 4 }}>
                <Dot delay={0} /><Dot delay={150} /><Dot delay={300} />
              </span>
            ) : (
              <>
                <div>{m.content}</div>
                {m.diagnostics && m.diagnostics.length > 0 && (
                  <div style={{ marginTop: 6, paddingTop: 6, borderTop: '1px solid var(--nx-border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                    {m.diagnostics.map((d, i) => (
                      <div key={i} style={{
                        fontSize: 10,
                        color: d.severity === 'error' ? 'var(--nx-error, #f85149)'
                          : d.severity === 'warn' ? 'var(--nx-warn, #ffa800)'
                          : 'var(--nx-text-3)',
                      }}>
                        {d.severity === 'error' ? '⚠' : d.severity === 'warn' ? '⚠' : 'ℹ'} {d.message}
                      </div>
                    ))}
                  </div>
                )}
                {m.pattern && (
                  <div style={{ marginTop: 6, fontSize: 10, color: 'var(--nx-accent-2)' }}>
                    {loc(lang, { ko: '추천 패턴', en: 'Pattern', ja: '推奨パターン', zh: '推荐模式', es: 'Patrón', ar: 'النمط' })}: {m.pattern.title}
                  </div>
                )}
                {(m.intent || m.pattern) && (
                  <button
                    onClick={() => apply(m)}
                    style={{
                      marginTop: 8, padding: '4px 10px',
                      border: '1px solid var(--nx-accent)', borderRadius: 4,
                      background: 'var(--nx-accent-soft)', color: 'var(--nx-accent-2)',
                      fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {'✓ ' + loc(lang, { ko: '적용', en: 'Apply', ja: '適用', zh: '应用', es: 'Aplicar', ar: 'تطبيق' })}
                  </button>
                )}
              </>
            )}
          </div>
        ))}
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div style={{ padding: '0 10px 6px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {suggestions.map(s => (
            <button
              key={s}
              onClick={() => send(s)}
              style={{
                textAlign: 'left', padding: '6px 8px',
                border: '1px dashed var(--nx-border)', borderRadius: 4,
                background: 'transparent', color: 'var(--nx-text-2)',
                fontSize: 10, cursor: 'pointer', lineHeight: 1.4,
              }}
            >
              {s}
            </button>
          ))}
        </div>
      )}

      {/* Input */}
      <form
        onSubmit={e => { e.preventDefault(); send(input); }}
        style={{ display: 'flex', gap: 4, padding: 8, borderTop: '1px solid var(--nx-border)', background: 'var(--nx-panel)' }}
      >
        <input
          type="text"
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={loc(lang, { ko: 'AI 에게 요청…', en: 'Ask Nexy AI…', ja: 'Nexy AI に質問…', zh: '向 Nexy AI 提问…', es: 'Pregunta a Nexy AI…', ar: 'اسأل Nexy AI…' })}
          disabled={busy}
          aria-label={loc(lang, { ko: 'AI 메시지 입력', en: 'AI message input', ja: 'AI メッセージ入力', zh: 'AI 消息输入', es: 'Entrada de mensaje de IA', ar: 'إدخال رسالة الذكاء الاصطناعي' })}
          style={{
            flex: 1, height: 28, padding: '0 10px',
            borderRadius: 4, border: '1px solid var(--nx-border)',
            background: 'var(--nx-bg)', color: 'var(--nx-text)',
            fontSize: 12, outline: 'none',
          }}
        />
        <VoiceButton isKo={isKo} onTranscript={(text) => setInput(prev => prev ? `${prev} ${text}` : text)} disabled={busy} />
        <button
          type="submit"
          disabled={busy || !input.trim()}
          aria-label={loc(lang, { ko: '보내기', en: 'Send', ja: '送信', zh: '发送', es: 'Enviar', ar: 'إرسال' })}
          style={{
            padding: '0 12px', height: 28, border: 0, borderRadius: 4,
            background: busy ? 'var(--nx-text-3)' : 'var(--nx-accent)',
            color: '#fff', fontSize: 11, fontWeight: 600,
            cursor: busy ? 'wait' : 'pointer',
          }}
        >
          <I.ai size={12} />
        </button>
      </form>
    </div>
  );
}

// ─── Voice input ─────────────────────────────────────────────────────────
// Web Speech API microphone capture → transcript → injected into the input.
// Locale follows the i18n setting so Korean speech is recognized as Korean.
// Silently hides on browsers without SpeechRecognition support.

interface SpeechRecognitionEvent extends Event {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: SpeechRecognitionEvent) => void) | null;
  onerror: ((e: Event) => void) | null;
  onend: (() => void) | null;
}

function VoiceButton({ isKo, onTranscript, disabled }: {
  isKo: boolean;
  onTranscript: (text: string) => void;
  disabled: boolean;
}) {
  const lang = useLang();
  const [listening, setListening] = useState(false);
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const supported = typeof window !== 'undefined' && (
    'SpeechRecognition' in window || 'webkitSpeechRecognition' in window
  );

  if (!supported) return null;

  const start = () => {
    if (listening || disabled) return;
    const W = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Ctor = W.SpeechRecognition ?? W.webkitSpeechRecognition;
    if (!Ctor) return;
    const r = new Ctor();
    r.lang = ({ ko: 'ko-KR', en: 'en-US', ja: 'ja-JP', cn: 'zh-CN', es: 'es-ES', ar: 'ar-SA' } as const)[lang] ?? 'en-US';
    r.continuous = false;
    r.interimResults = false;
    r.onresult = (e) => {
      const transcript = Array.from(e.results)
        .filter(x => x.isFinal)
        .map(x => x[0].transcript)
        .join(' ')
        .trim();
      if (transcript) onTranscript(transcript);
    };
    r.onerror = () => setListening(false);
    r.onend = () => setListening(false);
    recRef.current = r;
    setListening(true);
    try { r.start(); } catch { setListening(false); }
  };
  const stop = () => {
    try { recRef.current?.stop(); } catch { /* ignore */ }
    setListening(false);
  };

  return (
    <button
      type="button"
      onClick={listening ? stop : start}
      disabled={disabled}
      aria-label={loc(lang, { ko: '음성 입력', en: 'Voice input', ja: '音声入力', zh: '语音输入', es: 'Entrada de voz', ar: 'الإدخال الصوتي' })}
      title={loc(lang, { ko: '음성 입력', en: 'Voice input', ja: '音声入力', zh: '语音输入', es: 'Entrada de voz', ar: 'الإدخال الصوتي' })}
      style={{
        padding: '0 10px', height: 28, border: 0, borderRadius: 4,
        background: listening ? 'var(--nx-error, #f85149)' : 'var(--nx-panel-2)',
        color: listening ? '#fff' : 'var(--nx-text-2)',
        fontSize: 12, cursor: disabled ? 'not-allowed' : 'pointer',
      }}
    >
      {listening ? '⏺' : '🎤'}
    </button>
  );
}

function Dot({ delay }: { delay: number }) {
  return (
    <span
      style={{
        width: 6, height: 6, borderRadius: '50%',
        background: 'var(--nx-text-2)',
        animation: 'nx-blink 1.2s infinite',
        animationDelay: `${delay}ms`,
        display: 'inline-block',
      }}
    />
  );
}
