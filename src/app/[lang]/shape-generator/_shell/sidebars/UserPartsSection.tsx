'use client';

// User Parts section — Phase B (Wave 1 W6) addition to ModelerLeftPane
// Components tab. Inline thumbnail grid of localStorage-backed user parts;
// click → dispatch `nexyfab:insert-user-part` which Inner.tsx listens for
// and routes through the existing part-placement flow. "Manage…" button
// dispatches `nexyfab:open-user-parts-modal` to surface the full
// management modal (existing library/UserPartsPanel).

import { useEffect, useState } from 'react';
import { loadUserParts, type UserPart } from '../../library/userPartsStore';
import { I } from '../Icons';

export interface UserPartsSectionProps {
  isKo: boolean;
}

export function UserPartsSection({ isKo }: UserPartsSectionProps) {
  const [parts, setParts] = useState<UserPart[]>([]);
  const [collapsed, setCollapsed] = useState(false);

  // Load on mount + listen for both cross-tab (storage) and in-tab
  // (`nexyfab:user-parts-changed`) update signals so the grid stays
  // current after add / delete from anywhere in the app.
  useEffect(() => {
    const refresh = () => setParts(loadUserParts());
    refresh();
    if (typeof window === 'undefined') return;
    window.addEventListener('storage', refresh);
    window.addEventListener('nexyfab:user-parts-changed', refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener('nexyfab:user-parts-changed', refresh);
    };
  }, []);

  const onPartClick = (part: UserPart) => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nexyfab:insert-user-part', {
      detail: { id: part.id, shapeId: part.shapeId, params: part.params },
    }));
  };

  const onManage = () => {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('nexyfab:open-user-parts-modal'));
  };

  return (
    <div style={{ borderBottom: '1px solid var(--nx-border)', paddingBottom: 6 }}>
      <div
        onClick={() => setCollapsed(c => !c)}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          padding: '6px 12px',
          fontSize: 10,
          fontWeight: 700,
          color: 'var(--nx-text-2)',
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        {collapsed ? <I.caret_r size={10} /> : <I.caret_d size={10} />}
        <span style={{ flex: 1 }}>
          {isKo ? '내 파트' : 'My Parts'}
          {parts.length > 0 && (
            <span style={{ marginLeft: 6, opacity: 0.6, fontWeight: 500 }}>
              ({parts.length})
            </span>
          )}
        </span>
        <button
          type="button"
          className="nx-icon-btn"
          onClick={(e) => { e.stopPropagation(); onManage(); }}
          title={isKo ? '관리' : 'Manage'}
        >
          <I.cog size={10} />
        </button>
      </div>

      {!collapsed && (
        parts.length === 0 ? (
          <div style={{
            padding: '8px 12px 12px',
            fontSize: 10,
            color: 'var(--nx-text-3)',
            lineHeight: 1.4,
          }}>
            {isKo
              ? '저장된 파트 없음 — 파일 메뉴에서 현재 형상 저장'
              : 'No saved parts — save current shape from the File menu'}
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 4,
            padding: '4px 8px 6px',
          }}>
            {parts.slice(0, 12).map(p => (
              <button
                key={p.id}
                type="button"
                onClick={() => onPartClick(p)}
                title={`${p.name} (${p.shapeId})`}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2,
                  padding: 4,
                  border: '1px solid var(--nx-border)',
                  borderRadius: 4,
                  background: 'var(--nx-panel)',
                  cursor: 'pointer',
                  fontSize: 9,
                  color: 'var(--nx-text-2)',
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  width: '100%',
                  aspectRatio: '1 / 1',
                  background: p.thumbnail
                    ? `center / contain no-repeat url(${p.thumbnail}), var(--nx-panel-soft)`
                    : 'var(--nx-panel-soft)',
                  borderRadius: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {!p.thumbnail && <I.cube size={16} />}
                </div>
                <span style={{
                  width: '100%',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                  textAlign: 'center',
                }}>
                  {p.name}
                </span>
              </button>
            ))}
            {parts.length > 12 && (
              <button
                type="button"
                onClick={onManage}
                style={{
                  gridColumn: 'span 3',
                  padding: '4px 8px',
                  fontSize: 10,
                  color: 'var(--nx-text-3)',
                  background: 'transparent',
                  border: '1px dashed var(--nx-border)',
                  borderRadius: 4,
                  cursor: 'pointer',
                }}
              >
                {isKo
                  ? `+ ${parts.length - 12}개 더 — 관리에서 보기`
                  : `+ ${parts.length - 12} more — open Manage`}
              </button>
            )}
          </div>
        )
      )}
    </div>
  );
}
