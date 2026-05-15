'use client';

// Embedded AI chat panel — replaces the modal-trigger placeholder in the
// Nexy AI tab. Sends user prompts to the existing /api/nexyfab/scad-agent
// endpoint and renders responses with an "Apply" button that dispatches a
// tool intent for Inner to materialise.

import { useEffect, useRef, useState } from 'react';
import { I } from '../Icons';

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

const SUGGESTIONS_KO = [
  '두께 5mm 알루미늄 브라켓을 만들어줘',
  '필렛 반경 2mm 적용',
  '∅6.5 카운터보어 홀 4개를 모서리에 추가',
  'M5 나사 구멍으로 변경',
];
const SUGGESTIONS_EN = [
  'Make a 5 mm aluminum bracket',
  'Apply 2 mm fillet to all sharp edges',
  'Add 4× ∅6.5 counterbore holes in corners',
  'Change holes to tapped M5',
];

export function AiChatPanel({ isKo }: AiChatPanelProps) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: isKo
        ? '안녕하세요. 자연어로 모델 편집을 요청하거나 DFM 검토를 부탁할 수 있습니다.'
        : 'Ask in natural language to edit your model or get a DFM review.',
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
      // Hit the existing scad-agent endpoint. If it isn't reachable in the
      // current environment we degrade to an offline echo so the UI stays
      // responsive — production hits the real model.
      const res = await fetch('/api/nexyfab/scad-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt, mode: 'chat' }),
      });
      const data = await res.json().catch(() => null) as {
        text?: string;
        diagnostics?: Message['diagnostics'];
        intent?: Record<string, unknown>;
        pattern?: { id: string; title: string };
      } | null;
      setMessages(prev => prev.map(m => m.id === assistantId ? {
        ...m,
        loading: false,
        content: data?.text ?? (isKo ? '응답을 받을 수 없습니다 — 오프라인 모드' : 'No response — offline mode'),
        diagnostics: data?.diagnostics,
        intent: data?.intent,
        pattern: data?.pattern,
      } : m));
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantId ? {
        ...m,
        loading: false,
        content: isKo
          ? '연결 실패. 모달 어시스턴트로 폴백합니다.'
          : 'Connection failed. Falling back to modal assistant.',
      } : m));
    } finally {
      setBusy(false);
    }
  };

  const apply = (msg: Message) => {
    if (typeof window === 'undefined') return;
    if (msg.intent) {
      window.dispatchEvent(new CustomEvent('nexyfab:apply-ai-intent', { detail: msg.intent }));
    } else if (msg.pattern) {
      window.dispatchEvent(new CustomEvent('nexyfab:apply-ai-pattern', { detail: msg.pattern }));
    }
  };

  const suggestions = isKo ? SUGGESTIONS_KO : SUGGESTIONS_EN;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Messages */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
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
                    {isKo ? '추천 패턴' : 'Pattern'}: {m.pattern.title}
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
                    {isKo ? '✓ 적용' : '✓ Apply'}
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
          placeholder={isKo ? 'AI 에게 요청…' : 'Ask Nexy AI…'}
          disabled={busy}
          style={{
            flex: 1, height: 28, padding: '0 10px',
            borderRadius: 4, border: '1px solid var(--nx-border)',
            background: 'var(--nx-bg)', color: 'var(--nx-text)',
            fontSize: 12, outline: 'none',
          }}
        />
        <button
          type="submit"
          disabled={busy || !input.trim()}
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
