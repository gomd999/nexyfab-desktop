'use client';

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { usePathname } from 'next/navigation';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

const dict = {
  ko: {
    comment: '댓글', issue: '이슈', approval: '승인',
    resolved: '해결됨', resolve: '해결', delete: '삭제', reply: '답글', cancel: '취소', add: '추가',
    addPin: '핀 추가',
    replyPh: '답글 입력... (@멘션 가능)',
    commentPh: '내용을 입력하세요... (@멘션 가능)',
    locale: 'ko-KR',
  },
  en: {
    comment: 'Comment', issue: 'Issue', approval: 'Approval',
    resolved: 'Resolved', resolve: 'Resolve', delete: 'Delete', reply: 'Reply', cancel: 'Cancel', add: 'Add',
    addPin: 'Add Pin',
    replyPh: 'Reply... (@mention supported)',
    commentPh: 'Enter comment... (@mention supported)',
    locale: 'en-US',
  },
  ja: {
    comment: 'コメント', issue: '問題', approval: '承認',
    resolved: '解決済み', resolve: '解決', delete: '削除', reply: '返信', cancel: 'キャンセル', add: '追加',
    addPin: 'ピンを追加',
    replyPh: '返信... (@メンション対応)',
    commentPh: 'コメントを入力... (@メンション対応)',
    locale: 'ja-JP',
  },
  zh: {
    comment: '评论', issue: '问题', approval: '批准',
    resolved: '已解决', resolve: '解决', delete: '删除', reply: '回复', cancel: '取消', add: '添加',
    addPin: '添加标记',
    replyPh: '回复... (支持 @提及)',
    commentPh: '输入评论... (支持 @提及)',
    locale: 'zh-CN',
  },
  es: {
    comment: 'Comentario', issue: 'Problema', approval: 'Aprobación',
    resolved: 'Resuelto', resolve: 'Resolver', delete: 'Eliminar', reply: 'Responder', cancel: 'Cancelar', add: 'Añadir',
    addPin: 'Añadir Pin',
    replyPh: 'Responder... (@mención soportado)',
    commentPh: 'Introduce comentario... (@mención soportado)',
    locale: 'es-ES',
  },
  ar: {
    comment: 'تعليق', issue: 'مشكلة', approval: 'موافقة',
    resolved: 'تم الحل', resolve: 'حل', delete: 'حذف', reply: 'رد', cancel: 'إلغاء', add: 'إضافة',
    addPin: 'إضافة دبوس',
    replyPh: 'رد... (يدعم @الإشارة)',
    commentPh: 'أدخل تعليقًا... (يدعم @الإشارة)',
    locale: 'ar',
  },
};

type T = typeof dict['en'];

function usePinT(lang?: string): T {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  return dict[langMap[seg] ?? 'en'];
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface CommentReply {
  id: string;
  author: string;
  authorColor?: string;
  text: string;
  createdAt: number;
}

export interface MeshComment {
  id: string;
  position: [number, number, number];
  text: string;
  author: string;
  authorColor?: string;
  authorPlan?: string;
  createdAt: number;
  resolved: boolean;
  type: 'comment' | 'issue' | 'approval';
  replies: CommentReply[];
  reactions: Record<string, string[]>; // emoji → list of userIds who reacted
}

interface PinCommentsProps {
  comments: MeshComment[];
  onAddComment: (position: [number, number, number], text: string, type?: MeshComment['type']) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onReact?: (id: string, emoji: string) => void;
  onReply?: (id: string, text: string) => void;
  isPlacingComment: boolean;
  focusedId?: string | null;
  roomUsers?: Array<{ id: string; name: string; color: string }>;
  currentUserId?: string;
  lang?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PIN_RADIUS = 0.002;

export const TYPE_COLOR: Record<MeshComment['type'], string> = {
  comment: '#388bfd',
  issue: '#e3b341',
  approval: '#3fb950',
};

export const TYPE_LABEL: Record<MeshComment['type'], { en: string; ko: string }> = {
  comment: { en: 'Comment', ko: '댓글' },
  issue: { en: 'Issue', ko: '이슈' },
  approval: { en: 'Approval', ko: '승인' },
};

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '✅', '⚠️', '❓'];

// ─── Popup styles ─────────────────────────────────────────────────────────────

const popupStyle: React.CSSProperties = {
  background: '#1c2128',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: '10px 12px',
  minWidth: 240,
  maxWidth: 320,
  boxShadow: '0 4px 20px rgba(0,0,0,0.6)',
  color: '#c9d1d9',
  fontSize: 12,
  fontFamily: 'system-ui, sans-serif',
  pointerEvents: 'auto',
  userSelect: 'none',
};

const badgeStyle = (color: string): React.CSSProperties => ({
  display: 'inline-block',
  padding: '1px 7px',
  borderRadius: 10,
  fontSize: 10,
  fontWeight: 700,
  background: color + '33',
  color,
  border: `1px solid ${color}66`,
  marginRight: 6,
});

const btnStyle = (color: string): React.CSSProperties => ({
  padding: '3px 10px',
  borderRadius: 5,
  border: `1px solid ${color}66`,
  background: color + '22',
  color,
  fontSize: 11,
  cursor: 'pointer',
  fontWeight: 600,
});

// ─── @mention textarea ────────────────────────────────────────────────────────

function MentionTextarea({
  value,
  onChange,
  onKeyDown,
  placeholder,
  rows,
  users,
}: {
  value: string;
  onChange: (v: string) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  placeholder: string;
  rows: number;
  users?: Array<{ id: string; name: string; color: string }>;
}) {
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionOpen, setMentionOpen] = useState(false);
  const taRef = useRef<HTMLTextAreaElement>(null);

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    onChange(v);
    const cursor = e.target.selectionStart ?? 0;
    const textBefore = v.slice(0, cursor);
    const atMatch = textBefore.match(/@(\w*)$/);
    if (atMatch && users && users.length > 0) {
      setMentionQuery(atMatch[1].toLowerCase());
      setMentionOpen(true);
    } else {
      setMentionOpen(false);
    }
  };

  const insertMention = (name: string) => {
    const cursor = taRef.current?.selectionStart ?? value.length;
    const textBefore = value.slice(0, cursor);
    const atIdx = textBefore.lastIndexOf('@');
    const newVal = value.slice(0, atIdx) + `@${name} ` + value.slice(cursor);
    onChange(newVal);
    setMentionOpen(false);
    setTimeout(() => taRef.current?.focus(), 0);
  };

  const filteredUsers = (users ?? []).filter(u =>
    u.name.toLowerCase().includes(mentionQuery),
  );

  return (
    <div style={{ position: 'relative' }}>
      <textarea
        ref={taRef}
        autoFocus
        value={value}
        onChange={handleChange}
        rows={rows}
        placeholder={placeholder}
        style={{
          width: '100%',
          background: '#161b22',
          border: '1px solid #30363d',
          borderRadius: 5,
          color: '#c9d1d9',
          fontSize: 12,
          padding: '5px 8px',
          resize: 'vertical',
          outline: 'none',
          boxSizing: 'border-box',
          marginBottom: 8,
          fontFamily: 'system-ui, sans-serif',
        }}
        onKeyDown={onKeyDown}
      />
      {mentionOpen && filteredUsers.length > 0 && (
        <div style={{
          position: 'absolute', bottom: '100%', left: 0, zIndex: 999,
          background: '#1c2128', border: '1px solid #388bfd66', borderRadius: 6,
          boxShadow: '0 4px 12px rgba(0,0,0,0.5)', overflow: 'hidden', minWidth: 140,
        }}>
          {filteredUsers.map(u => (
            <div
              key={u.id}
              onMouseDown={(e) => { e.preventDefault(); insertMention(u.name); }}
              style={{
                padding: '6px 10px', cursor: 'pointer', fontSize: 12,
                display: 'flex', alignItems: 'center', gap: 6,
              }}
              onMouseEnter={e => (e.currentTarget.style.background = '#388bfd22')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <span style={{
                width: 8, height: 8, borderRadius: '50%', background: u.color, flexShrink: 0,
              }} />
              <span style={{ color: '#c9d1d9' }}>{u.name}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Single Pin ───────────────────────────────────────────────────────────────

interface PinProps {
  comment: MeshComment;
  focused?: boolean;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onReact?: (id: string, emoji: string) => void;
  onReply?: (id: string, text: string) => void;
  roomUsers?: Array<{ id: string; name: string; color: string }>;
  currentUserId?: string;
  lang?: string;
}

function Pin({ comment, focused, onResolve, onDelete, onReact, onReply, roomUsers, currentUserId, lang }: PinProps) {
  const [hovered, setHovered] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showReply, setShowReply] = useState(false);
  const tt = usePinT(lang);
  const color = comment.resolved ? '#8b949e' : TYPE_COLOR[comment.type];
  const typeLabel = tt[comment.type];
  const dateStr = new Date(comment.createdAt).toLocaleDateString(tt.locale);

  const open = hovered || focused;

  const submitReply = useCallback(() => {
    if (!replyText.trim()) return;
    onReply?.(comment.id, replyText.trim());
    setReplyText('');
    setShowReply(false);
  }, [comment.id, replyText, onReply]);

  const totalReactions = Object.values(comment.reactions ?? {}).flat().length;

  return (
    <group position={comment.position}>
      <mesh
        onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerLeave={(e) => { e.stopPropagation(); setHovered(false); }}
      >
        <sphereGeometry args={[focused ? PIN_RADIUS * 1.5 : PIN_RADIUS, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={open ? 0.8 : 0.3}
          transparent
          opacity={comment.resolved ? 0.5 : 1}
        />
      </mesh>

      <mesh position={[0, PIN_RADIUS * 2, 0]}>
        <cylinderGeometry args={[PIN_RADIUS * 0.3, PIN_RADIUS * 0.3, PIN_RADIUS * 3, 6]} />
        <meshStandardMaterial color={color} transparent opacity={0.7} />
      </mesh>

      {open && (
        <Html
          position={[0, PIN_RADIUS * 6, 0]}
          style={{ pointerEvents: 'none' }}
          distanceFactor={0.4}
          occlude={false}
          zIndexRange={[100, 0]}
        >
          <div
            style={popupStyle}
            onPointerEnter={() => setHovered(true)}
            onPointerLeave={() => { setHovered(false); }}
          >
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={badgeStyle(color)}>{typeLabel}</span>
              {comment.resolved && (
                <span style={{ fontSize: 10, color: '#8b949e' }}>{tt.resolved}</span>
              )}
              {focused && <span style={{ fontSize: 10, color: '#388bfd', marginLeft: 'auto' }}>●</span>}
            </div>

            {/* Text */}
            <div style={{ marginBottom: 8, lineHeight: 1.5, wordBreak: 'break-word' }}>
              {comment.text}
            </div>

            {/* Meta */}
            <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
              {comment.authorColor && (
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: comment.authorColor, flexShrink: 0, display: 'inline-block' }} />
              )}
              <span style={{ fontWeight: 600, color: '#c9d1d9' }}>{comment.author}</span>
              {comment.authorPlan && (
                <span style={{ color: '#388bfd' }}>[{comment.authorPlan}]</span>
              )}
              <span style={{ marginLeft: 'auto' }}>{dateStr}</span>
            </div>

            {/* Reactions */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: totalReactions > 0 ? 6 : 0 }}>
              {Object.entries(comment.reactions ?? {}).map(([emoji, userIds]) =>
                userIds.length > 0 ? (
                  <button
                    key={emoji}
                    onClick={(e) => { e.stopPropagation(); onReact?.(comment.id, emoji); }}
                    style={{
                      padding: '1px 6px', borderRadius: 10, fontSize: 11, cursor: 'pointer',
                      border: `1px solid ${userIds.includes(currentUserId ?? '') ? '#388bfd66' : '#30363d'}`,
                      background: userIds.includes(currentUserId ?? '') ? '#388bfd22' : '#21262d',
                      color: '#c9d1d9',
                    }}
                  >
                    {emoji} {userIds.length}
                  </button>
                ) : null,
              )}
            </div>

            {/* Reaction picker */}
            {onReact && (
              <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                {REACTION_EMOJIS.map(emoji => (
                  <button
                    key={emoji}
                    onClick={(e) => { e.stopPropagation(); onReact(comment.id, emoji); }}
                    title={emoji}
                    style={{
                      padding: '2px 4px', borderRadius: 4, fontSize: 13, cursor: 'pointer',
                      border: '1px solid transparent', background: 'transparent',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#388bfd22')}
                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                  >
                    {emoji}
                  </button>
                ))}
              </div>
            )}

            {/* Replies */}
            {comment.replies?.length > 0 && (
              <div style={{ borderTop: '1px solid #21262d', paddingTop: 8, marginBottom: 8 }}>
                {comment.replies.map(r => (
                  <div key={r.id} style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                      {r.authorColor && (
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.authorColor, flexShrink: 0, display: 'inline-block' }} />
                      )}
                      <span style={{ fontSize: 10, fontWeight: 600, color: '#8b949e' }}>{r.author}</span>
                      <span style={{ fontSize: 9, color: '#6e7681', marginLeft: 'auto' }}>
                        {new Date(r.createdAt).toLocaleTimeString(tt.locale, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </div>
                    <div style={{ fontSize: 11, color: '#c9d1d9', lineHeight: 1.4, paddingLeft: 10 }}>{r.text}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Reply input */}
            {onReply && showReply && (
              <div style={{ borderTop: '1px solid #21262d', paddingTop: 8, marginBottom: 6 }}>
                <MentionTextarea
                  value={replyText}
                  onChange={setReplyText}
                  placeholder={tt.replyPh}
                  rows={2}
                  users={roomUsers}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && e.ctrlKey) submitReply();
                    if (e.key === 'Escape') setShowReply(false);
                  }}
                />
                <div style={{ display: 'flex', gap: 5 }}>
                  <button style={btnStyle('#388bfd')} onClick={submitReply}>{tt.reply}</button>
                  <button style={btnStyle('#8b949e')} onClick={() => setShowReply(false)}>{tt.cancel}</button>
                </div>
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {onReply && !showReply && (
                <button style={btnStyle('#8b949e')} onClick={(e) => { e.stopPropagation(); setShowReply(true); }}>
                  {tt.reply}
                  {comment.replies?.length > 0 && ` (${comment.replies.length})`}
                </button>
              )}
              {!comment.resolved && (
                <button style={btnStyle('#3fb950')} onClick={(e) => { e.stopPropagation(); onResolve(comment.id); }}>
                  {tt.resolve}
                </button>
              )}
              <button style={btnStyle('#f85149')} onClick={(e) => { e.stopPropagation(); onDelete(comment.id); }}>
                {tt.delete}
              </button>
            </div>
          </div>
        </Html>
      )}
    </group>
  );
}

// ─── PinComments Component ────────────────────────────────────────────────────

export default function PinComments({
  comments,
  onAddComment,
  onResolve,
  onDelete,
  onReact,
  onReply,
  isPlacingComment,
  focusedId,
  roomUsers,
  currentUserId,
  lang,
}: PinCommentsProps) {
  const [pendingPos, setPendingPos] = useState<[number, number, number] | null>(null);
  const [inputText, setInputText] = useState('');
  const [pendingType, setPendingType] = useState<MeshComment['type']>('comment');
  useThree();
  const tt = usePinT(lang);

  const handleMeshClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!isPlacingComment) return;
      if (!e.point) return;
      e.stopPropagation();
      const pos: [number, number, number] = [e.point.x, e.point.y, e.point.z];
      setPendingPos(pos);
      setInputText('');
    },
    [isPlacingComment],
  );

  const confirmAdd = useCallback(() => {
    if (!pendingPos || !inputText.trim()) return;
    onAddComment(pendingPos, inputText.trim(), pendingType);
    setPendingPos(null);
    setInputText('');
    setPendingType('comment');
  }, [pendingPos, inputText, pendingType, onAddComment]);

  const cancelAdd = useCallback(() => {
    setPendingPos(null);
    setInputText('');
    setPendingType('comment');
  }, []);

  return (
    <group>
      {isPlacingComment && (
        <mesh onClick={handleMeshClick} visible={false}>
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial side={THREE.DoubleSide} />
        </mesh>
      )}

      {comments.map((c) => (
        <Pin
          key={c.id}
          comment={c}
          focused={focusedId === c.id}
          onResolve={onResolve}
          onDelete={onDelete}
          onReact={onReact}
          onReply={onReply}
          roomUsers={roomUsers}
          currentUserId={currentUserId}
          lang={lang}
        />
      ))}

      {pendingPos && (
        <group position={pendingPos}>
          <mesh>
            <sphereGeometry args={[PIN_RADIUS, 12, 12]} />
            <meshStandardMaterial color="#388bfd" emissive="#388bfd" emissiveIntensity={0.8} />
          </mesh>
          <Html position={[0, PIN_RADIUS * 8, 0]} distanceFactor={0.4} occlude={false} zIndexRange={[200, 0]}>
            <div style={{ ...popupStyle, pointerEvents: 'auto' }}>
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13, color: '#c9d1d9' }}>
                {tt.addPin}
              </div>
              <div style={{ display: 'flex', gap: 5, marginBottom: 10 }}>
                {(['comment', 'issue', 'approval'] as MeshComment['type'][]).map(t => (
                  <button
                    key={t}
                    onClick={() => setPendingType(t)}
                    style={{
                      flex: 1, padding: '3px 0', borderRadius: 5, fontSize: 10, fontWeight: 700, cursor: 'pointer',
                      border: `1px solid ${pendingType === t ? TYPE_COLOR[t] : '#30363d'}`,
                      background: pendingType === t ? TYPE_COLOR[t] + '33' : 'transparent',
                      color: pendingType === t ? TYPE_COLOR[t] : '#8b949e',
                      transition: 'all 0.12s',
                    }}
                  >
                    {tt[t]}
                  </button>
                ))}
              </div>
              <MentionTextarea
                value={inputText}
                onChange={setInputText}
                placeholder={tt.commentPh}
                rows={3}
                users={roomUsers}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) confirmAdd();
                  if (e.key === 'Escape') cancelAdd();
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={btnStyle('#388bfd')} onClick={confirmAdd}>{tt.add}</button>
                <button style={btnStyle('#8b949e')} onClick={cancelAdd}>{tt.cancel}</button>
              </div>
            </div>
          </Html>
        </group>
      )}
    </group>
  );
}

// ─── usePinComments Hook ──────────────────────────────────────────────────────

interface UsePinCommentsOptions {
  projectId?: string | null;
  collabSend?: {
    commentAdd: (c: unknown) => void;
    commentResolve: (id: string) => void;
    commentDelete: (id: string) => void;
    commentReact: (id: string, emoji: string) => void;
    commentReply: (commentId: string, reply: unknown) => void;
  };
}

export function usePinComments(opts?: UsePinCommentsOptions) {
  const projectId = opts?.projectId ?? null;
  const collabSend = opts?.collabSend;
  const [comments, setComments] = useState<MeshComment[]>([]);
  const [isPlacingComment, setIsPlacingComment] = useState(false);
  const [focusedCommentId, setFocusedCommentId] = useState<string | null>(null);

  // Load from server on mount
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/nexyfab/comments?projectId=${encodeURIComponent(projectId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { comments?: MeshComment[] } | null) => {
        if (data?.comments) {
          // Ensure replies/reactions defaults
          setComments(data.comments.map(c => ({
            ...c,
            replies: c.replies ?? [],
            reactions: c.reactions ?? {},
          })));
        }
      })
      .catch(() => {});
  }, [projectId]);

  const addComment = useCallback(
    async (pos: [number, number, number], text: string, author: string, type?: MeshComment['type'], authorColor?: string) => {
      const commentType = type ?? 'comment';
      if (projectId) {
        try {
          const res = await fetch('/api/nexyfab/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, position: pos, text, type: commentType }),
          });
          if (res.ok) {
            const data = await res.json() as { comment: MeshComment };
            const newComment = { ...data.comment, replies: data.comment.replies ?? [], reactions: data.comment.reactions ?? {} };
            setComments(prev => [...prev, newComment]);
            setIsPlacingComment(false);
            collabSend?.commentAdd(newComment);
            return;
          }
        } catch { /* fall through */ }
      }
      const newComment: MeshComment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        position: pos,
        text,
        author,
        authorColor,
        createdAt: Date.now(),
        resolved: false,
        type: commentType,
        replies: [],
        reactions: {},
      };
      setComments((prev) => [...prev, newComment]);
      setIsPlacingComment(false);
      collabSend?.commentAdd(newComment);
    },
    [projectId, collabSend],
  );

  const resolveComment = useCallback(async (id: string) => {
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, resolved: true } : c)));
    collabSend?.commentResolve(id);
    if (projectId) {
      await fetch(`/api/nexyfab/comments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: true }),
      }).catch(() => {});
    }
  }, [projectId, collabSend]);

  const deleteComment = useCallback(async (id: string) => {
    setComments((prev) => prev.filter((c) => c.id !== id));
    collabSend?.commentDelete(id);
    if (projectId) {
      await fetch(`/api/nexyfab/comments/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  }, [projectId, collabSend]);

  const reactToComment = useCallback((id: string, emoji: string, userId: string) => {
    setComments(prev => prev.map(c => {
      if (c.id !== id) return c;
      const existing = c.reactions[emoji] ?? [];
      const hasReacted = existing.includes(userId);
      return {
        ...c,
        reactions: {
          ...c.reactions,
          [emoji]: hasReacted ? existing.filter(u => u !== userId) : [...existing, userId],
        },
      };
    }));
    collabSend?.commentReact(id, emoji);
  }, [collabSend]);

  const addReply = useCallback((commentId: string, text: string, author: string, authorColor?: string) => {
    const reply: CommentReply = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      author,
      authorColor,
      text,
      createdAt: Date.now(),
    };
    setComments(prev => prev.map(c =>
      c.id === commentId ? { ...c, replies: [...(c.replies ?? []), reply] } : c,
    ));
    collabSend?.commentReply(commentId, reply);
  }, [collabSend]);

  // ── Receive remote events ─────────────────────────────────────────────────

  const applyRemoteCommentAdd = useCallback((comment: unknown) => {
    const c = comment as MeshComment;
    setComments(prev => {
      if (prev.find(x => x.id === c.id)) return prev;
      return [...prev, { ...c, replies: c.replies ?? [], reactions: c.reactions ?? {} }];
    });
  }, []);

  const applyRemoteCommentResolve = useCallback((id: string) => {
    setComments(prev => prev.map(c => c.id === id ? { ...c, resolved: true } : c));
  }, []);

  const applyRemoteCommentDelete = useCallback((id: string) => {
    setComments(prev => prev.filter(c => c.id !== id));
  }, []);

  const applyRemoteCommentReact = useCallback((id: string, emoji: string, userId: string) => {
    setComments(prev => prev.map(c => {
      if (c.id !== id) return c;
      const existing = c.reactions[emoji] ?? [];
      const hasReacted = existing.includes(userId);
      return {
        ...c,
        reactions: {
          ...c.reactions,
          [emoji]: hasReacted ? existing.filter(u => u !== userId) : [...existing, userId],
        },
      };
    }));
  }, []);

  const applyRemoteCommentReply = useCallback((commentId: string, reply: unknown) => {
    const r = reply as CommentReply;
    setComments(prev => prev.map(c =>
      c.id === commentId && !(c.replies ?? []).find(x => x.id === r.id)
        ? { ...c, replies: [...(c.replies ?? []), r] }
        : c,
    ));
  }, []);

  return {
    comments,
    isPlacingComment,
    setIsPlacingComment,
    focusedCommentId,
    setFocusedCommentId,
    addComment,
    resolveComment,
    deleteComment,
    reactToComment,
    addReply,
    applyRemoteCommentAdd,
    applyRemoteCommentResolve,
    applyRemoteCommentDelete,
    applyRemoteCommentReact,
    applyRemoteCommentReply,
  };
}
