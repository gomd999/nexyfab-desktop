'use client';

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import type { CollabChatMessage } from './useCollab';
import type { CollabUser } from './CollabTypes';

const dict = {
  ko: {
    title: '세션 채팅', online: '명 참여중', empty: '채팅을 시작하세요.',
    you: '나', typing: '입력 중', placeholder: '메시지 입력... (@멘션 지원)', send: '전송',
    locale: 'ko-KR',
  },
  en: {
    title: 'Session Chat', online: 'online', empty: 'Start chatting with your collaborators.',
    you: 'You', typing: 'typing', placeholder: 'Message... (@mention supported)', send: 'Send',
    locale: 'en-US',
  },
  ja: {
    title: 'セッションチャット', online: 'オンライン', empty: 'コラボレーターとチャットを始めましょう。',
    you: '自分', typing: '入力中', placeholder: 'メッセージ... (@メンション対応)', send: '送信',
    locale: 'ja-JP',
  },
  zh: {
    title: '会话聊天', online: '在线', empty: '开始与协作者聊天吧。',
    you: '我', typing: '正在输入', placeholder: '消息... (支持 @提及)', send: '发送',
    locale: 'zh-CN',
  },
  es: {
    title: 'Chat de Sesión', online: 'en línea', empty: 'Empieza a chatear con tus colaboradores.',
    you: 'Tú', typing: 'escribiendo', placeholder: 'Mensaje... (@mención soportado)', send: 'Enviar',
    locale: 'es-ES',
  },
  ar: {
    title: 'محادثة الجلسة', online: 'متصل', empty: 'ابدأ الدردشة مع المتعاونين معك.',
    you: 'أنت', typing: 'يكتب', placeholder: 'رسالة... (يدعم @الإشارة)', send: 'إرسال',
    locale: 'ar',
  },
};

interface CollabChatProps {
  messages: CollabChatMessage[];
  currentUserId: string;
  users: CollabUser[];
  typingUsers?: Record<string, string>; // userId → name
  onSend: (text: string) => void;
  onTyping?: () => void;
  lang?: string;
}

export default function CollabChat({ messages, currentUserId, users, typingUsers = {}, onSend, onTyping, lang }: CollabChatProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? 'en'];
  const [draft, setDraft] = useState('');
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setDraft(v);
    if (v) onTyping?.();
    const cursor = e.target.selectionStart ?? 0;
    const textBefore = v.slice(0, cursor);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch && users.length > 0) {
      setMentionQuery(atMatch[1].toLowerCase());
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (name: string) => {
    const cursor = inputRef.current?.selectionStart ?? draft.length;
    const textBefore = draft.slice(0, cursor);
    const atIdx = textBefore.lastIndexOf('@');
    const newDraft = draft.slice(0, atIdx) + `@${name} ` + draft.slice(cursor);
    setDraft(newDraft);
    setMentionOpen(false);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const send = useCallback(() => {
    const text = draft.trim();
    if (!text) return;
    onSend(text);
    setDraft('');
    setMentionOpen(false);
  }, [draft, onSend]);

  const filteredUsers = users.filter(u =>
    u.name.toLowerCase().includes(mentionQuery) && u.id !== currentUserId,
  );

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0d1117', fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '10px 14px', borderBottom: '1px solid #21262d',
        display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0,
      }}>
        <span style={{ fontSize: 14 }}>💬</span>
        <span style={{ fontWeight: 700, fontSize: 13, color: '#c9d1d9', flex: 1 }}>
          {t.title}
        </span>
        <span style={{ fontSize: 10, color: '#6e7681' }}>
          {users.length} {t.online}
        </span>
      </div>

      {/* Online users */}
      {users.length > 0 && (
        <div style={{
          padding: '6px 14px', borderBottom: '1px solid #21262d',
          display: 'flex', gap: 6, flexWrap: 'wrap', flexShrink: 0,
        }}>
          {users.map(u => (
            <span key={u.id} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, color: '#8b949e' }}>
              <span style={{ width: 6, height: 6, borderRadius: '50%', background: u.color, display: 'inline-block' }} />
              {u.name}
            </span>
          ))}
        </div>
      )}

      {/* Message list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0' }}>
        {messages.length === 0 ? (
          <div style={{ padding: '30px 20px', textAlign: 'center', color: '#6e7681' }}>
            <div style={{ fontSize: 28, opacity: 0.4, marginBottom: 8 }}>💬</div>
            <p style={{ margin: 0, fontSize: 12 }}>
              {t.empty}
            </p>
          </div>
        ) : (
          messages.map((msg, idx) => {
            const isOwn = msg.userId === currentUserId;
            const prevMsg = messages[idx - 1];
            const isSameSender = prevMsg?.userId === msg.userId;
            return (
              <div
                key={msg.id}
                style={{
                  padding: isSameSender ? '1px 14px 1px' : '8px 14px 1px',
                  display: 'flex', flexDirection: isOwn ? 'row-reverse' : 'row',
                  gap: 8, alignItems: 'flex-start',
                }}
              >
                {!isSameSender && !isOwn && (
                  <div style={{
                    width: 24, height: 24, borderRadius: '50%',
                    background: msg.color, flexShrink: 0,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 10, fontWeight: 700, color: '#fff', marginTop: 2,
                  }}>
                    {msg.name[0]?.toUpperCase()}
                  </div>
                )}
                {isSameSender && !isOwn && <div style={{ width: 24, flexShrink: 0 }} />}
                <div style={{ maxWidth: '75%' }}>
                  {!isSameSender && (
                    <div style={{
                      fontSize: 10, color: isOwn ? '#388bfd' : msg.color,
                      fontWeight: 600, marginBottom: 2,
                      textAlign: isOwn ? 'right' : 'left',
                    }}>
                      {isOwn ? t.you : msg.name}
                    </div>
                  )}
                  <div style={{
                    background: isOwn ? '#388bfd22' : '#21262d',
                    border: `1px solid ${isOwn ? '#388bfd44' : '#30363d'}`,
                    borderRadius: isOwn ? '12px 4px 12px 12px' : '4px 12px 12px 12px',
                    padding: '6px 10px', fontSize: 12, color: '#c9d1d9',
                    lineHeight: 1.5, wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                  }}>
                    {renderMentions(msg.text, users)}
                  </div>
                  <div style={{ fontSize: 9, color: '#6e7681', marginTop: 2, textAlign: isOwn ? 'right' : 'left' }}>
                    {new Date(msg.ts).toLocaleTimeString(t.locale, { hour: '2-digit', minute: '2-digit' })}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={bottomRef} />
      </div>

      {/* Typing indicator */}
      {Object.keys(typingUsers).filter(uid => uid !== currentUserId).length > 0 && (
        <div style={{ padding: '4px 14px 0', flexShrink: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 10, color: '#8b949e', fontStyle: 'italic' }}>
            {Object.values(typingUsers).filter((_, i) => Object.keys(typingUsers)[i] !== currentUserId).join(', ')}
            {' '}{t.typing}
          </span>
          <span style={{ display: 'flex', gap: 2 }}>
            {[0, 1, 2].map(i => (
              <span key={i} style={{
                width: 4, height: 4, borderRadius: '50%', background: '#8b949e',
                animation: `bounce 1s ease-in-out ${i * 0.2}s infinite`,
                display: 'inline-block',
              }} />
            ))}
          </span>
          <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-4px)} }`}</style>
        </div>
      )}

      {/* Input area */}
      <div style={{
        padding: '10px 14px', borderTop: '1px solid #21262d', flexShrink: 0, position: 'relative',
      }}>
        {/* @mention dropdown */}
        {mentionOpen && filteredUsers.length > 0 && (
          <div style={{
            position: 'absolute', bottom: '100%', left: 14, right: 14, zIndex: 999,
            background: '#1c2128', border: '1px solid #388bfd66', borderRadius: 6,
            boxShadow: '0 -4px 12px rgba(0,0,0,0.5)', overflow: 'hidden',
          }}>
            {filteredUsers.map(u => (
              <div
                key={u.id}
                onMouseDown={(e) => { e.preventDefault(); insertMention(u.name); }}
                style={{ padding: '6px 12px', cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8 }}
                onMouseEnter={e => (e.currentTarget.style.background = '#388bfd22')}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: u.color, flexShrink: 0, display: 'inline-block' }} />
                <span style={{ color: '#c9d1d9' }}>{u.name}</span>
              </div>
            ))}
          </div>
        )}
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={inputRef}
            value={draft}
            onChange={handleChange}
            placeholder={t.placeholder}
            rows={1}
            style={{
              flex: 1, background: '#161b22', border: '1px solid #30363d',
              borderRadius: 8, color: '#c9d1d9', fontSize: 12, padding: '7px 10px',
              resize: 'none', outline: 'none', fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.5, maxHeight: 100, overflow: 'auto',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
              if (e.key === 'Escape') setMentionOpen(false);
            }}
          />
          <button
            onClick={send}
            disabled={!draft.trim()}
            style={{
              padding: '7px 14px', borderRadius: 8, border: 'none', fontSize: 12, fontWeight: 700,
              cursor: draft.trim() ? 'pointer' : 'default',
              background: draft.trim() ? '#388bfd' : '#21262d',
              color: draft.trim() ? '#fff' : '#6e7681',
              transition: 'all 0.15s', flexShrink: 0,
            }}
          >
            {t.send}
          </button>
        </div>
      </div>
    </div>
  );
}

function renderMentions(text: string, users: CollabUser[]) {
  const parts = text.split(/(@\w+)/g);
  return parts.map((part, i) => {
    if (part.startsWith('@')) {
      const name = part.slice(1);
      const user = users.find(u => u.name.toLowerCase() === name.toLowerCase());
      return (
        <span key={i} style={{ color: user ? user.color : '#388bfd', fontWeight: 600 }}>
          {part}
        </span>
      );
    }
    return part;
  });
}
