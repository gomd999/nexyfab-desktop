'use client';

// Inline comments panel — pinned-to-viewport thread editor. Replaces the
// modal-trigger placeholder in the Nexy AI tab's Comments slot.
// Persists to localStorage for v1; production hits /api/nexyfab/comments
// once the collab presence backend is wired.

import { useEffect, useRef, useState } from 'react';

interface CommentNode {
  id: string;
  author: string;
  body: string;
  createdAt: number;
  resolved?: boolean;
  replies?: CommentNode[];
  /** Optional 3D pin position. Set by clicking on the viewport. */
  pin?: { x: number; y: number; z: number };
}

export interface CommentsPanelProps {
  isKo: boolean;
  /** Cloud project id — used as the storage namespace. */
  projectId?: string;
  /** Current user display name; falls back to "You". */
  authorName?: string;
}

const STORAGE_PREFIX = 'nexyfab.comments.v1.';

export function CommentsPanel({ isKo, projectId, authorName }: CommentsPanelProps) {
  const key = STORAGE_PREFIX + (projectId ?? 'local');
  const [comments, setComments] = useState<CommentNode[]>([]);
  const [draft, setDraft] = useState('');
  const [activeReply, setActiveReply] = useState<string | null>(null);
  const [replyDraft, setReplyDraft] = useState('');
  const [filter, setFilter] = useState<'open' | 'all'>('open');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setComments(JSON.parse(raw));
    } catch { /* corrupt — ignore */ }
  }, [key]);

  // Persist
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try { window.localStorage.setItem(key, JSON.stringify(comments)); } catch { /* quota — ignore */ }
  }, [key, comments]);

  const me = authorName ?? (isKo ? '나' : 'You');

  const addThread = () => {
    if (!draft.trim()) return;
    setComments(prev => [...prev, {
      id: `c-${Date.now().toString(36)}`,
      author: me,
      body: draft.trim(),
      createdAt: Date.now(),
      replies: [],
    }]);
    setDraft('');
    // Scroll to bottom on next paint.
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 0);
  };

  const addReply = (threadId: string) => {
    if (!replyDraft.trim()) return;
    setComments(prev => prev.map(c => c.id === threadId
      ? { ...c, replies: [...(c.replies ?? []), { id: `r-${Date.now().toString(36)}`, author: me, body: replyDraft.trim(), createdAt: Date.now() }] }
      : c));
    setReplyDraft('');
    setActiveReply(null);
  };

  const toggleResolved = (threadId: string) => {
    setComments(prev => prev.map(c => c.id === threadId ? { ...c, resolved: !c.resolved } : c));
  };

  const remove = (threadId: string) => {
    setComments(prev => prev.filter(c => c.id !== threadId));
  };

  const visible = filter === 'open' ? comments.filter(c => !c.resolved) : comments;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      {/* Header filter */}
      <div style={{ display: 'flex', gap: 4, padding: '6px 10px', borderBottom: '1px solid var(--nx-border)' }}>
        {(['open', 'all'] as const).map(f => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            style={{
              padding: '3px 10px', fontSize: 10, fontWeight: 600,
              borderRadius: 3, cursor: 'pointer',
              background: filter === f ? 'var(--nx-accent-soft)' : 'transparent',
              color: filter === f ? 'var(--nx-accent-2)' : 'var(--nx-text-2)',
              border: `1px solid ${filter === f ? 'var(--nx-accent)' : 'var(--nx-border)'}`,
            }}
          >
            {f === 'open' ? (isKo ? '미해결' : 'Open') : (isKo ? '전체' : 'All')}
            <span style={{ marginLeft: 4, color: 'var(--nx-text-3)' }}>
              {f === 'open' ? comments.filter(c => !c.resolved).length : comments.length}
            </span>
          </button>
        ))}
      </div>

      {/* Threads */}
      <div ref={scrollRef} style={{ flex: 1, overflow: 'auto', padding: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {visible.length === 0 ? (
          <div style={{ padding: '20px 16px', fontSize: 11, color: 'var(--nx-text-3)', textAlign: 'center', lineHeight: 1.5 }}>
            {isKo ? '아직 코멘트가 없습니다.' : 'No comments yet.'}
          </div>
        ) : (
          visible.map(c => (
            <div key={c.id} style={{
              padding: 8, borderRadius: 6,
              border: '1px solid var(--nx-border)',
              background: c.resolved ? 'transparent' : 'var(--nx-panel-2)',
              opacity: c.resolved ? 0.6 : 1,
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--nx-text)' }}>{c.author}</span>
                <span style={{ fontSize: 9, color: 'var(--nx-text-3)' }}>{relativeTime(c.createdAt, isKo)}</span>
                <span style={{ flex: 1 }} />
                <button
                  onClick={() => toggleResolved(c.id)}
                  title={c.resolved ? (isKo ? '재오픈' : 'Reopen') : (isKo ? '해결' : 'Resolve')}
                  style={iconBtnStyle}
                >
                  {c.resolved ? '↺' : '✓'}
                </button>
                <button onClick={() => remove(c.id)} title={isKo ? '삭제' : 'Delete'} style={iconBtnStyle}>×</button>
              </div>
              <div style={{ fontSize: 11, color: 'var(--nx-text)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
                {c.body}
              </div>
              {/* Replies */}
              {c.replies && c.replies.length > 0 && (
                <div style={{ marginTop: 6, paddingLeft: 10, borderLeft: '2px solid var(--nx-border)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {c.replies.map(r => (
                    <div key={r.id} style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>
                      <span style={{ fontWeight: 700, color: 'var(--nx-text)' }}>{r.author}</span>
                      <span style={{ color: 'var(--nx-text-3)', marginLeft: 4 }}>{relativeTime(r.createdAt, isKo)}</span>
                      <div style={{ marginTop: 2, lineHeight: 1.4 }}>{r.body}</div>
                    </div>
                  ))}
                </div>
              )}
              {/* Reply composer */}
              {activeReply === c.id ? (
                <div style={{ display: 'flex', gap: 4, marginTop: 6 }}>
                  <input
                    type="text"
                    value={replyDraft}
                    autoFocus
                    onChange={e => setReplyDraft(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addReply(c.id); if (e.key === 'Escape') setActiveReply(null); }}
                    placeholder={isKo ? '답글…' : 'Reply…'}
                    style={{ flex: 1, height: 22, padding: '0 6px', borderRadius: 3, border: '1px solid var(--nx-border)', background: 'var(--nx-bg)', color: 'var(--nx-text)', fontSize: 11 }}
                  />
                  <button
                    onClick={() => addReply(c.id)}
                    style={{ padding: '0 8px', height: 22, border: 0, borderRadius: 3, background: 'var(--nx-accent)', color: '#fff', fontSize: 10, cursor: 'pointer' }}
                  >
                    {isKo ? '게시' : 'Post'}
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setActiveReply(c.id)}
                  style={{ marginTop: 4, padding: 0, fontSize: 10, color: 'var(--nx-accent-2)', background: 'transparent', border: 0, cursor: 'pointer' }}
                >
                  {isKo ? '+ 답글' : '+ Reply'}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* New thread composer */}
      <div style={{ padding: 8, borderTop: '1px solid var(--nx-border)', background: 'var(--nx-panel)' }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) addThread(); }}
          placeholder={isKo ? '코멘트 작성… (⌘+Enter 게시)' : 'Write a comment… (⌘+Enter to post)'}
          rows={2}
          style={{
            width: '100%', resize: 'none', padding: 6,
            border: '1px solid var(--nx-border)', borderRadius: 4,
            background: 'var(--nx-bg)', color: 'var(--nx-text)',
            fontSize: 11, fontFamily: 'inherit', lineHeight: 1.4, outline: 'none',
          }}
        />
        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
          <span style={{ flex: 1 }} />
          <button
            onClick={addThread}
            disabled={!draft.trim()}
            style={{
              padding: '4px 12px', height: 24, border: 0, borderRadius: 4,
              background: draft.trim() ? 'var(--nx-accent)' : 'var(--nx-text-3)',
              color: '#fff', fontSize: 11, fontWeight: 600,
              cursor: draft.trim() ? 'pointer' : 'not-allowed',
            }}
          >
            {isKo ? '게시' : 'Post'}
          </button>
        </div>
      </div>
    </div>
  );
}

const iconBtnStyle: React.CSSProperties = {
  width: 18, height: 18, padding: 0, border: 0, background: 'transparent',
  color: 'var(--nx-text-3)', cursor: 'pointer', fontSize: 12,
};

function relativeTime(ts: number, isKo: boolean): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60_000);
  if (min < 1) return isKo ? '방금' : 'just now';
  if (min < 60) return isKo ? `${min}분 전` : `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return isKo ? `${h}시간 전` : `${h}h`;
  const d = Math.floor(h / 24);
  return isKo ? `${d}일 전` : `${d}d`;
}
