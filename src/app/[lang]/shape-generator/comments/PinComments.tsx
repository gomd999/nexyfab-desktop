'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface MeshComment {
  id: string;
  position: [number, number, number];
  text: string;
  author: string;
  authorPlan?: string;
  createdAt: number;
  resolved: boolean;
  type: 'comment' | 'issue' | 'approval';
}

interface PinCommentsProps {
  comments: MeshComment[];
  onAddComment: (position: [number, number, number], text: string) => void;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  isPlacingComment: boolean;
  lang?: string;
}

// ─── Constants ───────────────────────────────────────────────────────────────

const PIN_RADIUS = 0.002; // 2 mm in meters

const TYPE_COLOR: Record<MeshComment['type'], string> = {
  comment: '#388bfd',
  issue: '#e3b341',
  approval: '#3fb950',
};

const TYPE_LABEL: Record<MeshComment['type'], { en: string; ko: string }> = {
  comment: { en: 'Comment', ko: '댓글' },
  issue: { en: 'Issue', ko: '이슈' },
  approval: { en: 'Approval', ko: '승인' },
};

// ─── Popup styles (HTML overlay) ─────────────────────────────────────────────

const popupStyle: React.CSSProperties = {
  background: '#1c2128',
  border: '1px solid #30363d',
  borderRadius: 8,
  padding: '10px 12px',
  minWidth: 220,
  maxWidth: 300,
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

// ─── Single Pin ───────────────────────────────────────────────────────────────

interface PinProps {
  comment: MeshComment;
  onResolve: (id: string) => void;
  onDelete: (id: string) => void;
  lang?: string;
}

function Pin({ comment, onResolve, onDelete, lang }: PinProps) {
  const [hovered, setHovered] = useState(false);
  const isKo = lang === 'ko';
  const color = comment.resolved ? '#8b949e' : TYPE_COLOR[comment.type];
  const labelObj = TYPE_LABEL[comment.type];
  const typeLabel = isKo ? labelObj.ko : labelObj.en;
  const dateStr = new Date(comment.createdAt).toLocaleDateString(isKo ? 'ko-KR' : 'en-US');

  return (
    <group position={comment.position}>
      {/* Sphere pin */}
      <mesh
        onPointerEnter={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerLeave={(e) => { e.stopPropagation(); setHovered(false); }}
      >
        <sphereGeometry args={[PIN_RADIUS, 12, 12]} />
        <meshStandardMaterial
          color={color}
          emissive={color}
          emissiveIntensity={hovered ? 0.6 : 0.3}
          transparent
          opacity={comment.resolved ? 0.5 : 1}
        />
      </mesh>

      {/* Stem line */}
      <mesh position={[0, PIN_RADIUS * 2, 0]}>
        <cylinderGeometry args={[PIN_RADIUS * 0.3, PIN_RADIUS * 0.3, PIN_RADIUS * 3, 6]} />
        <meshStandardMaterial color={color} transparent opacity={0.7} />
      </mesh>

      {/* Popup */}
      {hovered && (
        <Html
          position={[0, PIN_RADIUS * 6, 0]}
          style={{ pointerEvents: 'none' }}
          distanceFactor={0.4}
          occlude={false}
          zIndexRange={[100, 0]}
        >
          <div style={popupStyle} onPointerEnter={() => setHovered(true)} onPointerLeave={() => setHovered(false)}>
            {/* Header row */}
            <div style={{ display: 'flex', alignItems: 'center', marginBottom: 6 }}>
              <span style={badgeStyle(color)}>{typeLabel}</span>
              {comment.resolved && (
                <span style={{ fontSize: 10, color: '#8b949e' }}>
                  {isKo ? '해결됨' : 'Resolved'}
                </span>
              )}
            </div>

            {/* Text */}
            <div style={{ marginBottom: 8, lineHeight: 1.5, wordBreak: 'break-word' }}>
              {comment.text}
            </div>

            {/* Meta */}
            <div style={{ fontSize: 10, color: '#8b949e', marginBottom: 8 }}>
              <span style={{ fontWeight: 600, color: '#c9d1d9' }}>{comment.author}</span>
              {comment.authorPlan && (
                <span style={{ marginLeft: 4, color: '#388bfd' }}>[{comment.authorPlan}]</span>
              )}
              <span style={{ marginLeft: 6 }}>{dateStr}</span>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: 6 }}>
              {!comment.resolved && (
                <button
                  style={btnStyle('#3fb950')}
                  onClick={(e) => { e.stopPropagation(); onResolve(comment.id); }}
                >
                  {isKo ? '해결' : 'Resolve'}
                </button>
              )}
              <button
                style={btnStyle('#f85149')}
                onClick={(e) => { e.stopPropagation(); onDelete(comment.id); }}
              >
                {isKo ? '삭제' : 'Delete'}
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
  isPlacingComment,
  lang,
}: PinCommentsProps) {
  const pendingTextRef = useRef<string>('');
  const [pendingPos, setPendingPos] = useState<[number, number, number] | null>(null);
  const [inputText, setInputText] = useState('');
  const { gl } = useThree();
  const isKo = lang === 'ko';

  // When isPlacingComment, intercept pointer-down on the invisible catch plane
  // We render a large invisible plane at z=0 to catch raycasts
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
    onAddComment(pendingPos, inputText.trim());
    setPendingPos(null);
    setInputText('');
  }, [pendingPos, inputText, onAddComment]);

  const cancelAdd = useCallback(() => {
    setPendingPos(null);
    setInputText('');
  }, []);

  return (
    <group>
      {/* Invisible catch mesh for placing comments */}
      {isPlacingComment && (
        <mesh onClick={handleMeshClick} visible={false}>
          <planeGeometry args={[1000, 1000]} />
          <meshBasicMaterial side={THREE.DoubleSide} />
        </mesh>
      )}

      {/* Render existing pins */}
      {comments.map((c) => (
        <Pin key={c.id} comment={c} onResolve={onResolve} onDelete={onDelete} lang={lang} />
      ))}

      {/* Pending placement popup (shown after click, before confirm) */}
      {pendingPos && (
        <group position={pendingPos}>
          <mesh>
            <sphereGeometry args={[PIN_RADIUS, 12, 12]} />
            <meshStandardMaterial color="#388bfd" emissive="#388bfd" emissiveIntensity={0.8} />
          </mesh>
          <Html
            position={[0, PIN_RADIUS * 8, 0]}
            distanceFactor={0.4}
            occlude={false}
            zIndexRange={[200, 0]}
          >
            <div style={{ ...popupStyle, pointerEvents: 'auto' }}>
              <div style={{ marginBottom: 8, fontWeight: 600, fontSize: 13, color: '#c9d1d9' }}>
                {isKo ? '댓글 추가' : 'Add Comment'}
              </div>
              <textarea
                autoFocus
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                rows={3}
                placeholder={isKo ? '내용을 입력하세요...' : 'Enter comment...'}
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
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && e.ctrlKey) confirmAdd();
                  if (e.key === 'Escape') cancelAdd();
                }}
              />
              <div style={{ display: 'flex', gap: 6 }}>
                <button style={btnStyle('#388bfd')} onClick={confirmAdd}>
                  {isKo ? '추가' : 'Add'}
                </button>
                <button style={btnStyle('#8b949e')} onClick={cancelAdd}>
                  {isKo ? '취소' : 'Cancel'}
                </button>
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
  /** When provided, syncs add/resolve/delete with the server */
  projectId?: string | null;
}

export function usePinComments(opts?: UsePinCommentsOptions) {
  const projectId = opts?.projectId ?? null;
  const [comments, setComments] = useState<MeshComment[]>([]);
  const [isPlacingComment, setIsPlacingComment] = useState(false);

  // Load from server on mount / when projectId appears
  useEffect(() => {
    if (!projectId) return;
    fetch(`/api/nexyfab/comments?projectId=${encodeURIComponent(projectId)}`)
      .then(r => r.ok ? r.json() : null)
      .then((data: { comments?: MeshComment[] } | null) => {
        if (data?.comments) setComments(data.comments);
      })
      .catch(() => {/* silent — local-only fallback */});
  }, [projectId]);

  const addComment = useCallback(
    async (pos: [number, number, number], text: string, author: string, type: MeshComment['type'] = 'comment') => {
      if (projectId) {
        // Server-side create — server assigns id and author from session
        try {
          const res = await fetch('/api/nexyfab/comments', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ projectId, position: pos, text, type }),
          });
          if (res.ok) {
            const data = await res.json() as { comment: MeshComment };
            setComments(prev => [...prev, data.comment]);
            setIsPlacingComment(false);
            return;
          }
        } catch { /* fall through to local */ }
      }
      // Offline / not logged in — local only
      const newComment: MeshComment = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        position: pos,
        text,
        author,
        createdAt: Date.now(),
        resolved: false,
        type,
      };
      setComments((prev) => [...prev, newComment]);
      setIsPlacingComment(false);
    },
    [projectId],
  );

  const resolveComment = useCallback(async (id: string) => {
    // Optimistic update
    setComments((prev) => prev.map((c) => (c.id === id ? { ...c, resolved: true } : c)));
    if (projectId) {
      await fetch(`/api/nexyfab/comments/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ resolved: true }),
      }).catch(() => {});
    }
  }, [projectId]);

  const deleteComment = useCallback(async (id: string) => {
    // Optimistic update
    setComments((prev) => prev.filter((c) => c.id !== id));
    if (projectId) {
      await fetch(`/api/nexyfab/comments/${id}`, { method: 'DELETE' }).catch(() => {});
    }
  }, [projectId]);

  return {
    comments,
    isPlacingComment,
    setIsPlacingComment,
    addComment,
    resolveComment,
    deleteComment,
  };
}
