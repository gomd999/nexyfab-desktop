'use client';

// M1 — In-app message thread for RFQ or Order.
//
// Mounts on RFQ detail page or Order detail page. Polls every 8s while
// open (cheap; no websocket infrastructure needed for the volumes we
// expect). Read-receipts: when this view is open and the user is the
// recipient, GET also marks new messages as read in one round-trip.
//
// Attachments are URLs (the buyer or partner uploads via the RFQ's
// existing CAD upload flow and pastes the URL — file upload widget is
// a follow-up).

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { toIsoLang } from '@/lib/i18n/normalize';

interface ThreadMessage {
  id: string;
  threadKind: string;
  threadId: string;
  senderUserId: string | null;
  senderPartnerEmail: string | null;
  senderType: 'buyer' | 'partner' | 'admin' | 'system';
  body: string;
  attachments: string[];
  readAt: number | null;
  createdAt: number;
}

const POLL_INTERVAL_MS = 8000;

const dict = {
  ko: {
    title: '💬 대화',
    placeholder: '메시지를 입력하세요…',
    send: '보내기',
    sending: '전송 중',
    empty: '아직 메시지가 없습니다. 첫 메시지를 보내보세요.',
    you: '나',
    them: '상대',
    attachLabel: '첨부 URL (쉼표 구분, 선택)',
    error: '전송 실패',
    loadError: '메시지를 불러오지 못했습니다.',
  },
  en: {
    title: '💬 Conversation',
    placeholder: 'Type a message…',
    send: 'Send',
    sending: 'Sending',
    empty: 'No messages yet. Start the conversation.',
    you: 'You',
    them: 'Them',
    attachLabel: 'Attachment URLs (comma-separated, optional)',
    error: 'Send failed',
    loadError: 'Failed to load messages.',
  },
  ja: {
    title: '💬 会話',
    placeholder: 'メッセージを入力…',
    send: '送信',
    sending: '送信中',
    empty: 'まだメッセージがありません。最初のメッセージを送ってみましょう。',
    you: '自分',
    them: '相手',
    attachLabel: '添付 URL (カンマ区切り・任意)',
    error: '送信に失敗しました',
    loadError: 'メッセージを読み込めませんでした。',
  },
  zh: {
    title: '💬 对话',
    placeholder: '输入消息…',
    send: '发送',
    sending: '发送中',
    empty: '还没有消息。发送第一条吧。',
    you: '我',
    them: '对方',
    attachLabel: '附件链接（逗号分隔，可选）',
    error: '发送失败',
    loadError: '无法加载消息。',
  },
  es: {
    title: '💬 Conversación',
    placeholder: 'Escriba un mensaje…',
    send: 'Enviar',
    sending: 'Enviando',
    empty: 'Todavía no hay mensajes. Inicie la conversación.',
    you: 'Usted',
    them: 'Interlocutor',
    attachLabel: 'URL de adjuntos (separadas por comas, opcional)',
    error: 'Error al enviar',
    loadError: 'No se han podido cargar los mensajes.',
  },
  ar: {
    title: '💬 المحادثة',
    placeholder: 'اكتب رسالة…',
    send: 'إرسال',
    sending: 'جارٍ الإرسال',
    empty: 'لا توجد رسائل بعد. ابدأ المحادثة.',
    you: 'أنت',
    them: 'الطرف الآخر',
    attachLabel: 'روابط المرفقات (مفصولة بفواصل، اختياري)',
    error: 'فشل الإرسال',
    loadError: 'تعذّر تحميل الرسائل.',
  },
};

export interface ThreadViewProps {
  /** ⚠ 260802: `'ko' | 'en'` 이라 부모가 다른 언어를 넘길 수조차 없었다. */
  lang: string;
  threadKind: 'rfq' | 'order';
  threadId: string;
  /** Whose perspective — 'buyer' or 'partner'. Used only for label hints;
   *  the server enforces real access control. */
  asRole: 'buyer' | 'partner';
}

export default function ThreadView({ lang, threadKind, threadId, asRole }: ThreadViewProps) {
  // ⚠ 260802: 2분기라 ja·zh·es·ar 이 영어로 떨어졌다.
  const t = dict[toIsoLang(lang)] ?? dict.en;
  const [messages, setMessages] = useState<ThreadMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [attach, setAttach] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const fetchMessages = useCallback(async (showLoadError: boolean) => {
    try {
      const res = await fetch(`/api/nexyfab/threads/${threadKind}/${encodeURIComponent(threadId)}/messages`, {
        credentials: 'include',
      });
      if (!res.ok) {
        if (showLoadError) setError(t.loadError);
        return;
      }
      const body = await res.json() as { messages: ThreadMessage[] };
      setMessages(body.messages);
      setLoaded(true);
    } catch {
      if (showLoadError) setError(t.loadError);
    }
  }, [threadKind, threadId, t.loadError]);

  useEffect(() => {
    void fetchMessages(true);
    const interval = setInterval(() => void fetchMessages(false), POLL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [fetchMessages]);

  // Auto-scroll to bottom when new messages arrive.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages.length]);

  const send = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true); setError(null);
    try {
      const attachments = attach
        .split(',')
        .map(s => s.trim())
        .filter(s => /^https?:\/\//.test(s))
        .slice(0, 10);
      const res = await fetch(`/api/nexyfab/threads/${threadKind}/${encodeURIComponent(threadId)}/messages`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body, attachments }),
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        throw new Error(errBody?.error ?? `HTTP ${res.status}`);
      }
      const data = await res.json() as { message: ThreadMessage };
      setMessages(prev => [...prev, data.message]);
      setDraft(''); setAttach('');
    } catch (e) {
      setError((e as Error).message || t.error);
    } finally {
      setSending(false);
    }
  }, [draft, attach, sending, threadKind, threadId, t.error]);

  const onKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void send();
    }
  }, [send]);

  return (
    <div style={containerStyle}>
      <div style={titleStyle}>{t.title}</div>

      <div ref={scrollRef} style={scrollStyle}>
        {!loaded && <div style={mutedStyle}>…</div>}
        {loaded && messages.length === 0 && <div style={mutedStyle}>{t.empty}</div>}
        {messages.map(m => {
          const isMine = (asRole === 'buyer' && m.senderType === 'buyer')
            || (asRole === 'partner' && m.senderType === 'partner');
          return (
            <div key={m.id} style={{
              alignSelf: isMine ? 'flex-end' : 'flex-start',
              maxWidth: '78%',
              marginBottom: 8,
            }}>
              <div style={{
                padding: '8px 12px',
                background: isMine ? '#1f6feb' : 'var(--nx-panel-2)',
                color: isMine ? '#fff' : 'var(--nx-text)',
                borderRadius: 12,
                fontSize: 13, lineHeight: 1.45,
                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
              }}>
                {m.body}
                {m.attachments.length > 0 && (
                  <div style={{ marginTop: 6, display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                    {m.attachments.map((url, i) => (
                      <a key={i} href={url} target="_blank" rel="noreferrer" style={{
                        fontSize: 11, color: isMine ? '#cfe1ff' : '#79c0ff',
                        textDecoration: 'underline',
                        wordBreak: 'break-all',
                      }}>📎 {url.split('/').pop()?.slice(0, 40) ?? 'file'}</a>
                    ))}
                  </div>
                )}
              </div>
              <div style={{
                fontSize: 9, color: 'var(--nx-text-2)',
                marginTop: 2,
                textAlign: isMine ? 'right' : 'left',
              }}>
                {isMine ? t.you : t.them} · {new Date(m.createdAt).toLocaleString()}
                {isMine && m.readAt && <span style={{ color: '#3fb950' }}> · ✓</span>}
              </div>
            </div>
          );
        })}
      </div>

      <div style={composerStyle}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value.slice(0, 5000))}
          onKeyDown={onKeyDown}
          placeholder={t.placeholder}
          rows={2}
          style={textareaStyle}
        />
        <input
          type="text"
          value={attach}
          onChange={e => setAttach(e.target.value)}
          placeholder={t.attachLabel}
          style={attachInputStyle}
        />
        {error && <div style={errStyle}>{error}</div>}
        <button onClick={() => void send()} disabled={!draft.trim() || sending} style={sendBtnStyle}>
          {sending ? t.sending : t.send}
        </button>
      </div>
    </div>
  );
}

const containerStyle: React.CSSProperties = {
  background: 'var(--nx-bg)', border: '1px solid var(--nx-border)', borderRadius: 10,
  padding: 12, display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12,
};
const titleStyle: React.CSSProperties = { fontSize: 13, fontWeight: 700, color: 'var(--nx-text)' };
const scrollStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column',
  maxHeight: 380, overflowY: 'auto',
  padding: '6px 4px',
};
const mutedStyle: React.CSSProperties = { fontSize: 11, color: 'var(--nx-text-2)', textAlign: 'center', padding: 16 };
const composerStyle: React.CSSProperties = {
  display: 'flex', flexDirection: 'column', gap: 6,
  borderTop: '1px solid var(--nx-panel-2)', paddingTop: 8,
};
const textareaStyle: React.CSSProperties = {
  padding: 8, background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
  borderRadius: 6, color: 'var(--nx-text)', fontSize: 12, fontFamily: 'inherit',
  resize: 'vertical', outline: 'none',
};
const attachInputStyle: React.CSSProperties = {
  padding: '4px 8px', fontSize: 11, fontFamily: 'monospace',
  background: 'var(--nx-panel)', border: '1px solid var(--nx-border)',
  borderRadius: 6, color: 'var(--nx-text)', outline: 'none',
};
const errStyle: React.CSSProperties = {
  fontSize: 11, color: '#ffa198', padding: '4px 8px',
  background: 'rgba(248,81,73,0.12)', borderRadius: 4,
};
const sendBtnStyle: React.CSSProperties = {
  padding: '6px 14px', fontSize: 12, fontWeight: 700,
  borderRadius: 6, border: 'none',
  background: '#1f6feb', color: '#fff',
  cursor: 'pointer', alignSelf: 'flex-end',
};
