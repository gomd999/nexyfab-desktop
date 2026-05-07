'use client';

import React, { useState, useMemo, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { MeshComment } from './PinComments';
import { TYPE_COLOR, TYPE_LABEL } from './PinComments';

// ─── i18n dict ───────────────────────────────────────────────────────────────

type Lang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

const dict = {
  ko: {
    pinComments: '핀 코멘트',
    comments: '코멘트',
    activity: '활동 내역',
    openIssue: (n: number) => '미해결 이슈',
    approval: (n: number) => '승인 대기',
    clickToPlacePin: '📌 클릭해서 핀 배치',
    addPin: '+ 핀 추가',
    clickHint: '3D 모델을 클릭해 핀을 배치하세요. Esc로 취소.',
    all: '전체',
    open: '미해결',
    resolved: '해결됨',
    noComments: '3D 모델에 핀을 추가해 피드백을 남겨보세요.',
    noMatchFilter: '해당 필터에 맞는 코멘트가 없습니다.',
    resolvedLabel: '해결됨',
    focused: '포커스',
    replyPlaceholder: '답글 입력...',
    reply: '답글',
    cancel: '취소',
    resolve: '해결',
    delete: '삭제',
    noActivity: '활동 내역이 없습니다.',
    actComment: '핀 추가',
    actResolve: '해결 처리',
    actDelete: '핀 삭제',
    actParam: '파라미터 변경',
    actShape: '형상 변경',
    actJoin: '세션 참가',
    actLeave: '세션 이탈',
    actChat: '메시지 전송',
    typeComment: '코멘트',
    typeIssue: '이슈',
    typeApproval: '승인',
  },
  en: {
    pinComments: 'Pin Comments',
    comments: 'Comments',
    activity: 'Activity',
    openIssue: (n: number) => `open issue${n > 1 ? 's' : ''}`,
    approval: (n: number) => `approval${n > 1 ? 's' : ''}`,
    clickToPlacePin: '📌 Click to place pin',
    addPin: '+ Add Pin',
    clickHint: 'Click on the 3D model to place a pin. Esc to cancel.',
    all: 'All',
    open: 'Open',
    resolved: 'Resolved',
    noComments: 'Add pins to the 3D model to leave feedback.',
    noMatchFilter: 'No comments match the filter.',
    resolvedLabel: 'Resolved',
    focused: 'Focused',
    replyPlaceholder: 'Write a reply...',
    reply: 'Reply',
    cancel: 'Cancel',
    resolve: 'Resolve',
    delete: 'Delete',
    noActivity: 'No activity yet.',
    actComment: 'added a comment',
    actResolve: 'resolved a comment',
    actDelete: 'deleted a comment',
    actParam: 'changed parameter',
    actShape: 'changed shape',
    actJoin: 'joined the session',
    actLeave: 'left the session',
    actChat: 'sent a message',
    typeComment: 'Comment',
    typeIssue: 'Issue',
    typeApproval: 'Approval',
  },
  ja: {
    pinComments: 'ピンコメント',
    comments: 'コメント',
    activity: 'アクティビティ',
    openIssue: (_n: number) => '未解決の課題',
    approval: (_n: number) => '承認待ち',
    clickToPlacePin: '📌 クリックしてピンを配置',
    addPin: '+ ピン追加',
    clickHint: '3D モデルをクリックしてピンを配置。Esc でキャンセル。',
    all: 'すべて',
    open: '未解決',
    resolved: '解決済み',
    noComments: '3D モデルにピンを追加してフィードバックを残しましょう。',
    noMatchFilter: 'フィルタに一致するコメントがありません。',
    resolvedLabel: '解決済み',
    focused: 'フォーカス',
    replyPlaceholder: '返信を入力...',
    reply: '返信',
    cancel: 'キャンセル',
    resolve: '解決',
    delete: '削除',
    noActivity: 'アクティビティはありません。',
    actComment: 'がコメントを追加',
    actResolve: 'がコメントを解決',
    actDelete: 'がコメントを削除',
    actParam: 'がパラメータを変更',
    actShape: '形状を変更',
    actJoin: 'がセッションに参加',
    actLeave: 'がセッションを退出',
    actChat: 'がメッセージを送信',
    typeComment: 'コメント',
    typeIssue: '課題',
    typeApproval: '承認',
  },
  zh: {
    pinComments: '图钉评论',
    comments: '评论',
    activity: '活动',
    openIssue: (_n: number) => '未解决问题',
    approval: (_n: number) => '待审批',
    clickToPlacePin: '📌 点击放置图钉',
    addPin: '+ 添加图钉',
    clickHint: '点击 3D 模型放置图钉,按 Esc 取消。',
    all: '全部',
    open: '未解决',
    resolved: '已解决',
    noComments: '在 3D 模型上添加图钉以留下反馈。',
    noMatchFilter: '没有符合筛选条件的评论。',
    resolvedLabel: '已解决',
    focused: '聚焦',
    replyPlaceholder: '输入回复...',
    reply: '回复',
    cancel: '取消',
    resolve: '解决',
    delete: '删除',
    noActivity: '暂无活动记录。',
    actComment: '添加了评论',
    actResolve: '解决了评论',
    actDelete: '删除了评论',
    actParam: '修改了参数',
    actShape: '修改了形状',
    actJoin: '加入了会话',
    actLeave: '离开了会话',
    actChat: '发送了消息',
    typeComment: '评论',
    typeIssue: '问题',
    typeApproval: '审批',
  },
  es: {
    pinComments: 'Comentarios de pin',
    comments: 'Comentarios',
    activity: 'Actividad',
    openIssue: (n: number) => n > 1 ? 'incidencias abiertas' : 'incidencia abierta',
    approval: (n: number) => n > 1 ? 'aprobaciones' : 'aprobación',
    clickToPlacePin: '📌 Haga clic para colocar pin',
    addPin: '+ Añadir pin',
    clickHint: 'Haga clic en el modelo 3D para colocar un pin. Esc para cancelar.',
    all: 'Todos',
    open: 'Abierto',
    resolved: 'Resuelto',
    noComments: 'Añada pins al modelo 3D para dejar comentarios.',
    noMatchFilter: 'Ningún comentario coincide con el filtro.',
    resolvedLabel: 'Resuelto',
    focused: 'Enfocado',
    replyPlaceholder: 'Escribir una respuesta...',
    reply: 'Responder',
    cancel: 'Cancelar',
    resolve: 'Resolver',
    delete: 'Eliminar',
    noActivity: 'Aún no hay actividad.',
    actComment: 'añadió un comentario',
    actResolve: 'resolvió un comentario',
    actDelete: 'eliminó un comentario',
    actParam: 'cambió un parámetro',
    actShape: 'cambió la forma',
    actJoin: 'se unió a la sesión',
    actLeave: 'salió de la sesión',
    actChat: 'envió un mensaje',
    typeComment: 'Comentario',
    typeIssue: 'Incidencia',
    typeApproval: 'Aprobación',
  },
  ar: {
    pinComments: 'تعليقات الدبوس',
    comments: 'التعليقات',
    activity: 'النشاط',
    openIssue: (_n: number) => 'مسائل مفتوحة',
    approval: (_n: number) => 'بانتظار الموافقة',
    clickToPlacePin: '📌 انقر لوضع الدبوس',
    addPin: '+ إضافة دبوس',
    clickHint: 'انقر على النموذج ثلاثي الأبعاد لوضع دبوس. Esc للإلغاء.',
    all: 'الكل',
    open: 'مفتوح',
    resolved: 'محلول',
    noComments: 'أضف دبابيس إلى النموذج ثلاثي الأبعاد لترك الملاحظات.',
    noMatchFilter: 'لا توجد تعليقات مطابقة للفلتر.',
    resolvedLabel: 'محلول',
    focused: 'مُركَّز',
    replyPlaceholder: 'اكتب ردًا...',
    reply: 'رد',
    cancel: 'إلغاء',
    resolve: 'حل',
    delete: 'حذف',
    noActivity: 'لا يوجد نشاط بعد.',
    actComment: 'أضاف تعليقًا',
    actResolve: 'حلّ تعليقًا',
    actDelete: 'حذف تعليقًا',
    actParam: 'غيّر معاملًا',
    actShape: 'غيّر الشكل',
    actJoin: 'انضم إلى الجلسة',
    actLeave: 'غادر الجلسة',
    actChat: 'أرسل رسالة',
    typeComment: 'تعليق',
    typeIssue: 'مسألة',
    typeApproval: 'موافقة',
  },
} as const;

const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

// Localized type label — use dict for known types; fallback to en for types not mapped
function typeLabelFor(t: MeshComment['type'], tt: (typeof dict)[keyof typeof dict]): string {
  switch (t) {
    case 'comment':  return tt.typeComment;
    case 'issue':    return tt.typeIssue;
    case 'approval': return tt.typeApproval;
    default:         return String(t);
  }
}

// ─── Activity feed event ──────────────────────────────────────────────────────

export interface ActivityEvent {
  id: string;
  ts: number;
  actor: string;
  actorColor?: string;
  type: 'comment_add' | 'comment_resolve' | 'comment_delete' | 'param_change' | 'shape_change' | 'user_join' | 'user_leave' | 'chat_message';
  detail?: string;
}

interface CommentsPanelProps {
  comments: MeshComment[];
  isPlacingComment: boolean;
  setIsPlacingComment: (v: boolean) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onReact?: (id: string, emoji: string) => void;
  onReply?: (id: string, text: string) => void;
  focusedCommentId?: string | null;
  setFocusedCommentId?: (id: string | null) => void;
  activityFeed?: ActivityEvent[];
  lang?: string;
}

const REACTION_EMOJIS = ['👍', '❤️', '🔥', '✅', '⚠️', '❓'];

type FilterType = 'all' | MeshComment['type'];
type FilterStatus = 'all' | 'open' | 'resolved';
type TabView = 'comments' | 'activity';

// Map app lang to BCP47 locale for toLocaleTimeString / toLocaleDateString
function bcp47(lang: Lang): string {
  switch (lang) {
    case 'ko': return 'ko-KR';
    case 'ja': return 'ja-JP';
    case 'zh': return 'zh-CN';
    case 'es': return 'es-ES';
    case 'ar': return 'ar';
    default:   return 'en-US';
  }
}

export default function CommentsPanel({
  comments,
  isPlacingComment,
  setIsPlacingComment,
  onResolve,
  onDelete,
  onReact,
  onReply,
  focusedCommentId,
  setFocusedCommentId,
  activityFeed = [],
  lang,
}: CommentsPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const resolvedLang: Lang = langMap[seg] ?? 'en';
  const tt = dict[resolvedLang];

  const [typeFilter, setTypeFilter] = useState<FilterType>('all');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('all');
  const [tab, setTab] = useState<TabView>('comments');
  const focusedRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    return comments
      .filter(c => typeFilter === 'all' || c.type === typeFilter)
      .filter(c => {
        if (statusFilter === 'open')     return !c.resolved;
        if (statusFilter === 'resolved') return c.resolved;
        return true;
      })
      .sort((a, b) => b.createdAt - a.createdAt);
  }, [comments, typeFilter, statusFilter]);

  const openCount     = comments.filter(c => !c.resolved).length;
  const issueCount    = comments.filter(c => c.type === 'issue' && !c.resolved).length;
  const approvalCount = comments.filter(c => c.type === 'approval' && !c.resolved).length;

  // Scroll focused comment into view
  useEffect(() => {
    if (focusedCommentId && focusedRef.current) {
      focusedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [focusedCommentId]);

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', height: '100%',
      background: '#0d1117', color: '#c9d1d9',
      fontFamily: 'system-ui, -apple-system, sans-serif',
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px', borderBottom: '1px solid #21262d',
        display: 'flex', alignItems: 'center', gap: 8,
      }}>
        <span style={{ fontSize: 14 }}>📌</span>
        <span style={{ fontWeight: 700, fontSize: 13, flex: 1 }}>
          {tt.pinComments}
        </span>
        {openCount > 0 && (
          <span style={{
            padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
            background: '#388bfd22', color: '#388bfd', border: '1px solid #388bfd44',
          }}>
            {openCount}
          </span>
        )}
      </div>

      {/* Tab switcher */}
      <div style={{ display: 'flex', borderBottom: '1px solid #21262d' }}>
        {(['comments', 'activity'] as TabView[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            style={{
              flex: 1, padding: '8px 0', fontSize: 11, fontWeight: tab === t ? 700 : 400, cursor: 'pointer',
              border: 'none', borderBottom: tab === t ? '2px solid #388bfd' : '2px solid transparent',
              background: 'transparent', color: tab === t ? '#388bfd' : '#6e7681',
              transition: 'all 0.15s',
            }}
          >
            {t === 'comments' ? tt.comments : tt.activity}
            {t === 'activity' && activityFeed.length > 0 && (
              <span style={{ marginLeft: 4, fontSize: 9, background: '#388bfd', color: '#fff', borderRadius: 10, padding: '0 4px' }}>
                {activityFeed.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'activity' ? (
        <ActivityFeedPanel events={activityFeed} tt={tt} lang={resolvedLang} />
      ) : (
        <>
          {/* Stats row */}
          {comments.length > 0 && (issueCount > 0 || approvalCount > 0) && (
            <div style={{ display: 'flex', gap: 6, padding: '8px 14px', borderBottom: '1px solid #21262d' }}>
              {issueCount > 0 && (
                <span style={{ fontSize: 10, color: '#e3b341', fontWeight: 700 }}>
                  ⚠ {issueCount} {tt.openIssue(issueCount)}
                </span>
              )}
              {approvalCount > 0 && (
                <span style={{ fontSize: 10, color: '#3fb950', fontWeight: 700 }}>
                  ✓ {approvalCount} {tt.approval(approvalCount)}
                </span>
              )}
            </div>
          )}

          {/* Add pin button */}
          <div style={{ padding: '10px 14px', borderBottom: '1px solid #21262d' }}>
            <button
              onClick={() => setIsPlacingComment(!isPlacingComment)}
              style={{
                width: '100%', padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 700,
                cursor: 'pointer', border: `1px solid ${isPlacingComment ? '#388bfd' : '#30363d'}`,
                background: isPlacingComment ? '#388bfd22' : 'transparent',
                color: isPlacingComment ? '#388bfd' : '#8b949e',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                transition: 'all 0.15s',
              }}
            >
              {isPlacingComment ? tt.clickToPlacePin : tt.addPin}
            </button>
            {isPlacingComment && (
              <p style={{ margin: '6px 0 0', fontSize: 10, color: '#6e7681', textAlign: 'center', lineHeight: 1.4 }}>
                {tt.clickHint}
              </p>
            )}
          </div>

          {/* Filters */}
          {comments.length > 0 && (
            <div style={{ padding: '8px 14px', borderBottom: '1px solid #21262d', display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['all', 'comment', 'issue', 'approval'] as FilterType[]).map(t => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    style={{
                      flex: 1, padding: '3px 0', borderRadius: 5, fontSize: 10,
                      fontWeight: typeFilter === t ? 700 : 400, cursor: 'pointer',
                      border: `1px solid ${typeFilter === t ? (t === 'all' ? '#8b949e' : TYPE_COLOR[t as MeshComment['type']]) : '#30363d'}`,
                      background: typeFilter === t ? (t === 'all' ? '#8b949e22' : TYPE_COLOR[t as MeshComment['type']] + '22') : 'transparent',
                      color: typeFilter === t ? (t === 'all' ? '#c9d1d9' : TYPE_COLOR[t as MeshComment['type']]) : '#6e7681',
                      transition: 'all 0.12s',
                    }}
                  >
                    {t === 'all' ? tt.all : typeLabelFor(t as MeshComment['type'], tt)}
                  </button>
                ))}
              </div>
              <div style={{ display: 'flex', gap: 4 }}>
                {(['all', 'open', 'resolved'] as FilterStatus[]).map(s => (
                  <button
                    key={s}
                    onClick={() => setStatusFilter(s)}
                    style={{
                      flex: 1, padding: '3px 0', borderRadius: 5, fontSize: 10,
                      fontWeight: statusFilter === s ? 700 : 400, cursor: 'pointer',
                      border: `1px solid ${statusFilter === s ? '#388bfd' : '#30363d'}`,
                      background: statusFilter === s ? '#388bfd22' : 'transparent',
                      color: statusFilter === s ? '#388bfd' : '#6e7681',
                      transition: 'all 0.12s',
                    }}
                  >
                    {s === 'all' ? tt.all : s === 'open' ? tt.open : tt.resolved}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Comment list */}
          <div style={{ flex: 1, overflowY: 'auto' }}>
            {comments.length === 0 ? (
              <div style={{ padding: '40px 20px', textAlign: 'center', color: '#6e7681' }}>
                <div style={{ fontSize: 32, marginBottom: 10, opacity: 0.4 }}>📌</div>
                <p style={{ margin: 0, fontSize: 12, lineHeight: 1.5 }}>
                  {tt.noComments}
                </p>
              </div>
            ) : filtered.length === 0 ? (
              <div style={{ padding: '28px 20px', textAlign: 'center', color: '#6e7681', fontSize: 12 }}>
                {tt.noMatchFilter}
              </div>
            ) : (
              filtered.map(comment => (
                <CommentItem
                  key={comment.id}
                  comment={comment}
                  isFocused={focusedCommentId === comment.id}
                  focusedRef={focusedCommentId === comment.id ? focusedRef : undefined}
                  tt={tt}
                  lang={resolvedLang}
                  onResolve={onResolve}
                  onDelete={onDelete}
                  onReact={onReact}
                  onReply={onReply}
                  onClick={() => setFocusedCommentId?.(focusedCommentId === comment.id ? null : comment.id)}
                />
              ))
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Comment Item ─────────────────────────────────────────────────────────────

function CommentItem({
  comment, isFocused, focusedRef, tt, lang, onResolve, onDelete, onReact, onReply, onClick,
}: {
  comment: MeshComment;
  isFocused: boolean;
  focusedRef?: React.RefObject<HTMLDivElement | null>;
  tt: (typeof dict)[keyof typeof dict];
  lang: Lang;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  onReact?: (id: string, emoji: string) => void;
  onReply?: (id: string, text: string) => void;
  onClick?: () => void;
}) {
  const color = comment.resolved ? '#8b949e' : TYPE_COLOR[comment.type];
  const typeLabel = typeLabelFor(comment.type, tt);
  const [showReply, setShowReply] = useState(false);
  const [replyText, setReplyText] = useState('');
  const [showReactions, setShowReactions] = useState(false);

  const dateStr = new Date(comment.createdAt).toLocaleDateString(bcp47(lang), {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const submitReply = () => {
    if (!replyText.trim()) return;
    onReply?.(comment.id, replyText.trim());
    setReplyText('');
    setShowReply(false);
  };

  return (
    <div
      ref={focusedRef as React.RefObject<HTMLDivElement>}
      onClick={onClick}
      style={{
        borderBottom: '1px solid #21262d',
        padding: '11px 14px',
        opacity: comment.resolved ? 0.65 : 1,
        cursor: 'pointer',
        background: isFocused ? '#388bfd11' : 'transparent',
        borderLeft: isFocused ? '2px solid #388bfd' : '2px solid transparent',
        transition: 'background 0.15s',
      }}
    >
      {/* Type badge + resolved */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
        <span style={{
          padding: '1px 7px', borderRadius: 10, fontSize: 10, fontWeight: 700,
          background: color + '33', color, border: `1px solid ${color}66`,
        }}>
          {typeLabel}
        </span>
        {comment.resolved && (
          <span style={{ fontSize: 10, color: '#3fb950' }}>✓ {tt.resolvedLabel}</span>
        )}
        {isFocused && <span style={{ marginLeft: 'auto', fontSize: 10, color: '#388bfd' }}>● {tt.focused}</span>}
      </div>

      {/* Text */}
      <p style={{ margin: '0 0 6px', fontSize: 12, color: '#c9d1d9', lineHeight: 1.5, wordBreak: 'break-word' }}>
        {comment.text}
      </p>

      {/* Meta */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
        {comment.authorColor && (
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: comment.authorColor, flexShrink: 0, display: 'inline-block' }} />
        )}
        <span style={{ fontSize: 10, fontWeight: 600, color: '#8b949e' }}>{comment.author}</span>
        {comment.authorPlan && (
          <span style={{ fontSize: 9, color: '#388bfd', padding: '0 4px', border: '1px solid #388bfd44', borderRadius: 3 }}>
            {comment.authorPlan}
          </span>
        )}
        <span style={{ fontSize: 10, color: '#6e7681', marginLeft: 'auto' }}>{dateStr}</span>
      </div>

      {/* Existing reactions */}
      {Object.keys(comment.reactions ?? {}).length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 6 }}>
          {Object.entries(comment.reactions).map(([emoji, userIds]) =>
            userIds.length > 0 ? (
              <button
                key={emoji}
                onClick={(e) => { e.stopPropagation(); onReact?.(comment.id, emoji); }}
                style={{
                  padding: '1px 6px', borderRadius: 10, fontSize: 11, cursor: 'pointer',
                  border: '1px solid #30363d', background: '#21262d', color: '#c9d1d9',
                }}
              >
                {emoji} {userIds.length}
              </button>
            ) : null,
          )}
        </div>
      )}

      {/* Replies preview */}
      {(comment.replies?.length ?? 0) > 0 && (
        <div style={{ borderLeft: '2px solid #30363d', paddingLeft: 8, marginBottom: 8 }}>
          {comment.replies.map(r => (
            <div key={r.id} style={{ marginBottom: 4 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                {r.authorColor && <span style={{ width: 6, height: 6, borderRadius: '50%', background: r.authorColor, flexShrink: 0, display: 'inline-block' }} />}
                <span style={{ fontSize: 10, fontWeight: 600, color: '#6e7681' }}>{r.author}</span>
                <span style={{ fontSize: 9, color: '#6e7681', marginLeft: 'auto' }}>
                  {new Date(r.createdAt).toLocaleTimeString(bcp47(lang), { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              <p style={{ margin: 0, fontSize: 11, color: '#c9d1d9', lineHeight: 1.4 }}>{r.text}</p>
            </div>
          ))}
        </div>
      )}

      {/* Reply input */}
      {showReply && onReply && (
        <div style={{ marginBottom: 8 }} onClick={e => e.stopPropagation()}>
          <textarea
            autoFocus
            value={replyText}
            onChange={e => setReplyText(e.target.value)}
            rows={2}
            placeholder={tt.replyPlaceholder}
            style={{
              width: '100%', background: '#161b22', border: '1px solid #30363d',
              borderRadius: 5, color: '#c9d1d9', fontSize: 12, padding: '5px 8px',
              resize: 'none', outline: 'none', boxSizing: 'border-box', marginBottom: 6,
              fontFamily: 'system-ui, sans-serif',
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.ctrlKey) submitReply();
              if (e.key === 'Escape') setShowReply(false);
            }}
          />
          <div style={{ display: 'flex', gap: 5 }}>
            <button onClick={(e) => { e.stopPropagation(); submitReply(); }}
              style={{ padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid #388bfd66', background: '#388bfd22', color: '#388bfd' }}>
              {tt.reply}
            </button>
            <button onClick={(e) => { e.stopPropagation(); setShowReply(false); }}
              style={{ padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid #6e767166', background: 'transparent', color: '#6e7681' }}>
              {tt.cancel}
            </button>
          </div>
        </div>
      )}

      {/* Reaction picker */}
      {showReactions && onReact && (
        <div style={{ display: 'flex', gap: 4, marginBottom: 6 }} onClick={e => e.stopPropagation()}>
          {REACTION_EMOJIS.map(emoji => (
            <button key={emoji} onClick={() => { onReact(comment.id, emoji); setShowReactions(false); }}
              style={{ padding: '2px 5px', borderRadius: 5, fontSize: 13, cursor: 'pointer', border: '1px solid #30363d', background: '#21262d' }}>
              {emoji}
            </button>
          ))}
        </div>
      )}

      {/* Actions */}
      <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }} onClick={e => e.stopPropagation()}>
        {onReact && (
          <button
            onClick={() => setShowReactions(v => !v)}
            style={{ padding: '3px 8px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid #30363d', background: 'transparent', color: '#6e7681' }}
          >
            😊
          </button>
        )}
        {onReply && !showReply && (
          <button onClick={() => setShowReply(true)}
            style={{ padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid #6e767166', background: 'transparent', color: '#6e7681' }}>
            {tt.reply}
            {(comment.replies?.length ?? 0) > 0 && ` (${comment.replies.length})`}
          </button>
        )}
        {!comment.resolved && (
          <button onClick={() => onResolve(comment.id)}
            style={{ padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid #3fb95066', background: '#3fb95022', color: '#3fb950' }}>
            {tt.resolve}
          </button>
        )}
        <button onClick={() => onDelete(comment.id)}
          style={{ padding: '3px 10px', borderRadius: 5, fontSize: 10, fontWeight: 600, cursor: 'pointer', border: '1px solid #f8514966', background: '#f8514922', color: '#f85149' }}>
          {tt.delete}
        </button>
      </div>
    </div>
  );
}

// ─── Activity Feed Panel ──────────────────────────────────────────────────────

function ActivityFeedPanel({ events, tt, lang }: { events: ActivityEvent[]; tt: (typeof dict)[keyof typeof dict]; lang: Lang }) {
  const sorted = [...events].sort((a, b) => b.ts - a.ts);

  const ACTIVITY_ICON: Record<ActivityEvent['type'], string> = {
    comment_add: '📌',
    comment_resolve: '✅',
    comment_delete: '🗑',
    param_change: '⚙️',
    shape_change: '🔷',
    user_join: '👋',
    user_leave: '🚪',
    chat_message: '💬',
  };

  const activityLabel = (type: ActivityEvent['type']): string => {
    switch (type) {
      case 'comment_add':     return tt.actComment;
      case 'comment_resolve': return tt.actResolve;
      case 'comment_delete':  return tt.actDelete;
      case 'param_change':    return tt.actParam;
      case 'shape_change':    return tt.actShape;
      case 'user_join':       return tt.actJoin;
      case 'user_leave':      return tt.actLeave;
      case 'chat_message':    return tt.actChat;
    }
  };

  if (sorted.length === 0) {
    return (
      <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#6e7681', flexDirection: 'column', gap: 8 }}>
        <div style={{ fontSize: 28, opacity: 0.4 }}>📋</div>
        <p style={{ margin: 0, fontSize: 12 }}>{tt.noActivity}</p>
      </div>
    );
  }

  return (
    <div style={{ flex: 1, overflowY: 'auto' }}>
      {sorted.map(evt => (
        <div key={evt.id} style={{ padding: '9px 14px', borderBottom: '1px solid #21262d', display: 'flex', gap: 8, alignItems: 'flex-start' }}>
          <span style={{ fontSize: 14, flexShrink: 0, marginTop: 1 }}>{ACTIVITY_ICON[evt.type]}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
              {evt.actorColor && (
                <span style={{ width: 7, height: 7, borderRadius: '50%', background: evt.actorColor, flexShrink: 0, display: 'inline-block' }} />
              )}
              <span style={{ fontSize: 11, fontWeight: 600, color: '#c9d1d9' }}>{evt.actor}</span>
              <span style={{ fontSize: 11, color: '#6e7681' }}>
                {activityLabel(evt.type)}
              </span>
            </div>
            {evt.detail && (
              <p style={{ margin: 0, fontSize: 10, color: '#8b949e', lineHeight: 1.4, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {evt.detail}
              </p>
            )}
          </div>
          <span style={{ fontSize: 9, color: '#6e7681', flexShrink: 0, marginTop: 2 }}>
            {new Date(evt.ts).toLocaleTimeString(bcp47(lang), { hour: '2-digit', minute: '2-digit' })}
          </span>
        </div>
      ))}
    </div>
  );
}
