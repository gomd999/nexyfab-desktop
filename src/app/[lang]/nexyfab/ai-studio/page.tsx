'use client';

// Nexy AI Studio — chat-first surface for natural-language CAD.
// The user describes a part; the AI generates an OpenSCAD intent + 3D
// preview; clicking "CAD 에서 편집" hands off to the full modeler with
// the resolved intent serialised in the URL so the modeler boots with
// the part already loaded.
//
// Existing modeler AI sidebar (Nexy AI tab in ModelerRightPane) stays
// for in-flight CAD work. This route is the *entry point* for new ideas.

import { use, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isKorean } from '@/lib/i18n/normalize';

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  intent?: Record<string, unknown>;
  diagnostics?: { severity: 'info' | 'warn' | 'error'; message: string }[];
  loading?: boolean;
}

const SUGGESTIONS_KO = [
  '구멍 4개 알루미늄 브라켓 (80×50×5mm)',
  '24T 모듈 1 스퍼 기어',
  'M5 SHCS × 20mm',
  '5052 알루미늄 L 브라켓',
  'NEMA17 모터 마운트',
  '6202 베어링 하우징',
];
const SUGGESTIONS_EN = [
  '4-hole aluminum bracket 80×50×5mm',
  'Spur gear 24 teeth module 1',
  'M5 SHCS × 20mm',
  '5052 aluminum L-bracket',
  'NEMA17 motor mount',
  '6202 bearing housing',
];

export default function AIStudioPage({ params }: { params: Promise<{ lang: string }> }) {
  const { lang } = use(params);
  const isKo = isKorean(lang);
  const router = useRouter();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = async (prompt: string) => {
    if (!prompt.trim() || busy) return;
    setInput('');
    setBusy(true);
    const userMsg: ChatMessage = { id: `u-${Date.now()}`, role: 'user', content: prompt };
    const assistantId = `a-${Date.now()}`;
    setMessages(prev => [...prev, userMsg, { id: assistantId, role: 'assistant', content: '', loading: true }]);
    try {
      const res = await fetch('/api/nexyfab/scad-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream, application/json' },
        body: JSON.stringify({ prompt, mode: 'chat', stream: true }),
      });
      const contentType = res.headers.get('content-type') ?? '';
      const isStream = contentType.includes('event-stream') || contentType.includes('ndjson');

      if (isStream && res.body) {
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';
        let acc = '';
        let intent: Record<string, unknown> | undefined;
        let diagnostics: ChatMessage['diagnostics'];
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split('\n\n');
          buffer = frames.pop() ?? '';
          for (const f of frames) {
            const data = f.startsWith('data:') ? f.slice(5).trim() : f.trim();
            if (!data || data === '[DONE]') continue;
            try {
              const obj = JSON.parse(data);
              if (typeof obj.delta === 'string') acc += obj.delta;
              if (obj.intent) intent = obj.intent;
              if (obj.diagnostics) diagnostics = obj.diagnostics;
            } catch {
              acc += data + ' ';
            }
            setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, loading: false, content: acc } : m));
          }
        }
        setMessages(prev => prev.map(m => m.id === assistantId ? { ...m, loading: false, content: acc, intent, diagnostics } : m));
      } else {
        const data = await res.json().catch(() => null) as { text?: string; intent?: Record<string, unknown>; diagnostics?: ChatMessage['diagnostics'] } | null;
        setMessages(prev => prev.map(m => m.id === assistantId ? {
          ...m,
          loading: false,
          content: data?.text ?? (isKo ? '응답 없음 — 잠시 후 다시 시도' : 'No response — try again later'),
          intent: data?.intent,
          diagnostics: data?.diagnostics,
        } : m));
      }
    } catch {
      setMessages(prev => prev.map(m => m.id === assistantId ? {
        ...m,
        loading: false,
        content: isKo ? '연결 실패 — 다시 시도하세요.' : 'Connection failed — please retry.',
      } : m));
    } finally {
      setBusy(false);
    }
  };

  const openInCad = (msg: ChatMessage) => {
    if (!msg.intent) {
      router.push(`/${lang}/shape-generator`);
      return;
    }
    const encoded = encodeURIComponent(JSON.stringify(msg.intent));
    router.push(`/${lang}/shape-generator?from=ai&intent=${encoded}`);
  };

  const showHero = messages.length === 0;
  const suggestions = isKo ? SUGGESTIONS_KO : SUGGESTIONS_EN;

  return (
    <div
      style={{
        flex: 1,
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--nx-bg)',
        color: 'var(--nx-text)',
        minWidth: 0,
        minHeight: 0,
      }}
    >
      {/* Header */}
      <header
        style={{
          padding: '20px 32px 12px',
          borderBottom: '1px solid var(--nx-border)',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div style={{ fontSize: 22, fontWeight: 800, letterSpacing: '-0.01em' }}>
          <span style={{ color: 'var(--nx-accent)' }}>Nexy</span>{' '}
          {isKo ? 'AI 스튜디오' : 'AI Studio'}
        </div>
        <span
          style={{
            padding: '3px 8px', fontSize: 10, fontWeight: 700, borderRadius: 3,
            background: 'var(--nx-accent-soft)', color: 'var(--nx-accent-2)',
            letterSpacing: '0.04em',
          }}
        >
          BETA
        </span>
        <span style={{ flex: 1 }} />
        <button
          onClick={() => router.push(`/${lang}/shape-generator`)}
          style={{
            height: 32, padding: '0 14px',
            border: '1px solid var(--nx-border)', borderRadius: 6,
            background: 'transparent', color: 'var(--nx-text)',
            fontSize: 12, fontWeight: 600, cursor: 'pointer',
          }}
        >
          {isKo ? 'CAD 에디터 열기 →' : 'Open CAD editor →'}
        </button>
      </header>

      {/* Body */}
      {showHero ? (
        // ── Hero state — empty chat, suggestion chips, big input
        <div
          style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '32px 24px', gap: 24, overflow: 'auto',
          }}
        >
          <div style={{ textAlign: 'center', maxWidth: 720 }}>
            <h1 style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.2, margin: '0 0 12px', letterSpacing: '-0.01em' }}>
              {isKo
                ? '어떤 부품을 만들어 드릴까요?'
                : 'What part should I make for you?'}
            </h1>
            <p style={{ fontSize: 15, color: 'var(--nx-text-2)', margin: 0, lineHeight: 1.6 }}>
              {isKo
                ? '자연어로 설명하면 즉시 3D 모델 + STL/STEP 파일까지 만들어 드립니다. CAD UI 학습 필요 없음.'
                : 'Describe in natural language — I’ll generate a 3D model + STL/STEP. No CAD experience required.'}
            </p>
          </div>

          <div style={{ width: 'min(720px, 92%)', display: 'flex', flexDirection: 'column', gap: 10 }}>
            <form
              onSubmit={e => { e.preventDefault(); send(input); }}
              style={{
                display: 'flex', gap: 8,
                padding: 8, borderRadius: 12,
                border: '1px solid var(--nx-border-strong)',
                background: 'var(--nx-panel)',
                boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
              }}
            >
              <input
                type="text"
                value={input}
                onChange={e => setInput(e.target.value)}
                placeholder={isKo ? '예: 두께 5mm 알루미늄 브라켓 + ∅6.5 홀 4개' : 'e.g. 5mm aluminum bracket with 4× ∅6.5 holes'}
                autoFocus
                style={{
                  flex: 1, height: 44, padding: '0 14px',
                  border: 0, borderRadius: 8,
                  background: 'transparent', color: 'var(--nx-text)',
                  fontSize: 15, outline: 'none',
                }}
              />
              <button
                type="submit"
                disabled={busy || !input.trim()}
                style={{
                  padding: '0 18px', height: 44, border: 0, borderRadius: 8,
                  background: busy || !input.trim() ? 'var(--nx-text-3)' : 'var(--nx-accent)',
                  color: '#fff', fontSize: 14, fontWeight: 700,
                  cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {busy ? (isKo ? '생성 중…' : 'Generating…') : (isKo ? '생성 →' : 'Generate →')}
              </button>
            </form>

            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'center' }}>
              {suggestions.map(s => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  disabled={busy}
                  style={{
                    padding: '8px 14px', borderRadius: 20,
                    border: '1px solid var(--nx-border)',
                    background: 'var(--nx-panel-2)',
                    color: 'var(--nx-text-2)',
                    fontSize: 12, cursor: busy ? 'not-allowed' : 'pointer',
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : (
        // ── Conversation state — chat scroll + composer pinned bottom
        <>
          <div
            ref={scrollRef}
            style={{
              flex: 1, overflow: 'auto', padding: '24px 32px',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}
          >
            {messages.map(m => (
              <div
                key={m.id}
                style={{
                  alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start',
                  maxWidth: 720,
                  padding: '12px 16px',
                  borderRadius: 12,
                  background: m.role === 'user' ? 'var(--nx-accent)' : 'var(--nx-panel)',
                  color: m.role === 'user' ? '#fff' : 'var(--nx-text)',
                  border: m.role === 'assistant' ? '1px solid var(--nx-border)' : 'none',
                  fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap',
                }}
              >
                {m.loading ? (
                  <span style={{ opacity: 0.6 }}>{isKo ? '생각 중…' : 'Thinking…'}</span>
                ) : (
                  <>
                    <div>{m.content}</div>
                    {m.diagnostics && m.diagnostics.length > 0 && (
                      <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--nx-border)', display: 'flex', flexDirection: 'column', gap: 3 }}>
                        {m.diagnostics.map((d, i) => (
                          <div
                            key={i}
                            style={{
                              fontSize: 11,
                              color: d.severity === 'error' ? 'var(--nx-error, #f85149)'
                                : d.severity === 'warn' ? 'var(--nx-warn, #ffa800)'
                                : 'var(--nx-text-3)',
                            }}
                          >
                            {d.severity === 'error' ? '⚠' : d.severity === 'warn' ? '⚠' : 'ℹ'} {d.message}
                          </div>
                        ))}
                      </div>
                    )}
                    {m.intent && (
                      <button
                        onClick={() => openInCad(m)}
                        style={{
                          marginTop: 10, padding: '6px 14px',
                          border: '1px solid var(--nx-accent)', borderRadius: 6,
                          background: 'var(--nx-accent-soft)', color: 'var(--nx-accent-2)',
                          fontSize: 12, fontWeight: 700, cursor: 'pointer',
                        }}
                      >
                        {isKo ? '✓ CAD 에서 편집 →' : '✓ Edit in CAD →'}
                      </button>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>

          <form
            onSubmit={e => { e.preventDefault(); send(input); }}
            style={{
              display: 'flex', gap: 8,
              padding: '12px 24px',
              borderTop: '1px solid var(--nx-border)',
              background: 'var(--nx-panel)',
            }}
          >
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              placeholder={isKo ? '추가 요청 또는 수정 사항…' : 'Refine or ask for changes…'}
              style={{
                flex: 1, height: 38, padding: '0 14px',
                border: '1px solid var(--nx-border)', borderRadius: 8,
                background: 'var(--nx-bg)', color: 'var(--nx-text)',
                fontSize: 14, outline: 'none',
              }}
            />
            <button
              type="submit"
              disabled={busy || !input.trim()}
              style={{
                padding: '0 16px', height: 38, border: 0, borderRadius: 8,
                background: busy || !input.trim() ? 'var(--nx-text-3)' : 'var(--nx-accent)',
                color: '#fff', fontSize: 13, fontWeight: 700,
                cursor: busy || !input.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {busy ? '…' : (isKo ? '전송' : 'Send')}
            </button>
          </form>
        </>
      )}
    </div>
  );
}
