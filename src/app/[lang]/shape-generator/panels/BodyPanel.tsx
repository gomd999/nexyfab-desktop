'use client';

import React, { useState, useCallback } from 'react';
import { usePathname } from 'next/navigation';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BodyEntry {
  id: string;
  name: string;
  color: string;
  visible: boolean;
  locked: boolean;
  mergedFrom?: string[];
  splitFrom?: { bodyId: string; plane: number; offset: number };
}

interface BodyPanelProps {
  lang: string;
  bodies: BodyEntry[];
  activeBodyId: string | null;
  selectedBodyIds: string[];
  onSetActive: (id: string) => void;
  onToggleSelect: (id: string) => void;
  onToggleVisible: (id: string) => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  onSplit: (bodyId: string, plane: number, offset: number) => void;
  onMerge: (bodyIds: string[]) => void;
  onClose: () => void;
}

// ─── Labels ───────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '바디 관리',
    noBody: '바디 없음',
    split: '바디 분리',
    merge: '선택 바디 합체',
    splitPlane: '분리 기준 평면',
    splitOffset: '오프셋',
    applySplit: '분리 실행',
    delete: '삭제',
    planeXY: 'XY (Z 기준)',
    planeXZ: 'XZ (Y 기준)',
    planeYZ: 'YZ (X 기준)',
    mergeHint: '2개 이상 선택 후 합체',
    splitHint: '분리할 바디를 선택하세요',
    active: '현재',
    merged: '합체됨',
    split_tag: '분리됨',
    close: '닫기',
    renameHint: '더블클릭하여 이름 변경',
    toggleVisible: '가시성 토글',
  },
  en: {
    title: 'Body Manager',
    noBody: 'No bodies',
    split: 'Split Body',
    merge: 'Merge Selected',
    splitPlane: 'Split Plane',
    splitOffset: 'Offset',
    applySplit: 'Apply Split',
    delete: 'Delete',
    planeXY: 'XY (split by Z)',
    planeXZ: 'XZ (split by Y)',
    planeYZ: 'YZ (split by X)',
    mergeHint: 'Select 2+ bodies to merge',
    splitHint: 'Select a body to split',
    active: 'Active',
    merged: 'Merged',
    split_tag: 'Split',
    close: 'Close',
    renameHint: 'Double-click to rename',
    toggleVisible: 'Toggle visibility',
  },
  ja: {
    title: 'ボディ管理',
    noBody: 'ボディなし',
    split: 'ボディ分割',
    merge: '選択ボディを結合',
    splitPlane: '分割平面',
    splitOffset: 'オフセット',
    applySplit: '分割実行',
    delete: '削除',
    planeXY: 'XY (Z 基準)',
    planeXZ: 'XZ (Y 基準)',
    planeYZ: 'YZ (X 基準)',
    mergeHint: '2個以上選択してから結合',
    splitHint: '分割するボディを選択',
    active: '現在',
    merged: '結合済',
    split_tag: '分割済',
    close: '閉じる',
    renameHint: 'ダブルクリックで名前変更',
    toggleVisible: '表示切替',
  },
  zh: {
    title: '实体管理',
    noBody: '无实体',
    split: '拆分实体',
    merge: '合并所选',
    splitPlane: '拆分平面',
    splitOffset: '偏移',
    applySplit: '执行拆分',
    delete: '删除',
    planeXY: 'XY (按 Z)',
    planeXZ: 'XZ (按 Y)',
    planeYZ: 'YZ (按 X)',
    mergeHint: '选择 2 个以上实体合并',
    splitHint: '选择一个实体进行拆分',
    active: '当前',
    merged: '已合并',
    split_tag: '已拆分',
    close: '关闭',
    renameHint: '双击重命名',
    toggleVisible: '切换可见性',
  },
  es: {
    title: 'Gestor de Cuerpos',
    noBody: 'Sin cuerpos',
    split: 'Dividir Cuerpo',
    merge: 'Combinar Selección',
    splitPlane: 'Plano de División',
    splitOffset: 'Desplazamiento',
    applySplit: 'Aplicar División',
    delete: 'Eliminar',
    planeXY: 'XY (por Z)',
    planeXZ: 'XZ (por Y)',
    planeYZ: 'YZ (por X)',
    mergeHint: 'Selecciona 2+ cuerpos para combinar',
    splitHint: 'Selecciona un cuerpo para dividir',
    active: 'Activo',
    merged: 'Combinado',
    split_tag: 'Dividido',
    close: 'Cerrar',
    renameHint: 'Doble clic para renombrar',
    toggleVisible: 'Alternar visibilidad',
  },
  ar: {
    title: 'مدير الأجسام',
    noBody: 'لا توجد أجسام',
    split: 'تقسيم الجسم',
    merge: 'دمج المحدد',
    splitPlane: 'مستوى التقسيم',
    splitOffset: 'الإزاحة',
    applySplit: 'تطبيق التقسيم',
    delete: 'حذف',
    planeXY: 'XY (حسب Z)',
    planeXZ: 'XZ (حسب Y)',
    planeYZ: 'YZ (حسب X)',
    mergeHint: 'اختر جسمين أو أكثر للدمج',
    splitHint: 'اختر جسمًا للتقسيم',
    active: 'نشط',
    merged: 'مدموج',
    split_tag: 'مقسم',
    close: 'إغلاق',
    renameHint: 'انقر مزدوجًا لإعادة التسمية',
    toggleVisible: 'تبديل الرؤية',
  },
} as const;

// ─── BodyPanel ────────────────────────────────────────────────────────────────

export default function BodyPanel({
  lang,
  bodies,
  activeBodyId,
  selectedBodyIds,
  onSetActive,
  onToggleSelect,
  onToggleVisible,
  onRename,
  onDelete,
  onSplit,
  onMerge,
  onClose,
}: BodyPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const t = dict[langMap[seg] ?? (lang === 'ko' ? 'ko' : 'en')];

  const [splitPlane, setSplitPlane] = useState(0);
  const [splitOffset, setSplitOffset] = useState(0);
  const [showSplitForm, setShowSplitForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');

  const canMerge = selectedBodyIds.length >= 2;
  const splitTarget = selectedBodyIds.length === 1
    ? selectedBodyIds[0]
    : activeBodyId && selectedBodyIds.length === 0
      ? activeBodyId
      : null;
  const canSplit = !!splitTarget;

  const handleApplySplit = useCallback(() => {
    if (!splitTarget) return;
    onSplit(splitTarget, splitPlane, splitOffset);
    setShowSplitForm(false);
    setSplitOffset(0);
  }, [splitTarget, splitPlane, splitOffset, onSplit]);

  const handleRenameCommit = useCallback((id: string) => {
    if (editingName.trim()) onRename(id, editingName.trim());
    setEditingId(null);
  }, [editingName, onRename]);

  // ── Styles ──────────────────────────────────────────────────────────────────
  const C = {
    bg: '#161b22',
    border: '#30363d',
    text: '#e6edf3',
    muted: '#8b949e',
    active: '#1f6feb',
    activeBorder: '#388bfd',
    rowHover: '#1c2128',
    checked: '#6366f1',
    danger: '#f85149',
    success: '#2ea043',
    tag: '#21262d',
  };

  return (
    <div
      style={{
        position: 'fixed',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        zIndex: 9100,
        width: 340,
        maxHeight: '80vh',
        display: 'flex',
        flexDirection: 'column',
        background: C.bg,
        border: `1px solid ${C.border}`,
        borderRadius: 10,
        boxShadow: '0 8px 32px rgba(0,0,0,0.65)',
        color: C.text,
        fontFamily: 'inherit',
        userSelect: 'none',
      }}
    >
      {/* ── Header ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '14px 16px 10px', borderBottom: `1px solid ${C.border}` }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>
          ⬡ {t.title} <span style={{ color: C.muted, fontWeight: 400, fontSize: 12 }}>({bodies.length})</span>
        </span>
        <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.muted, fontSize: 18, cursor: 'pointer', lineHeight: 1, padding: 2 }}>×</button>
      </div>

      {/* ── Body list ── */}
      <div style={{ overflowY: 'auto', maxHeight: 260, padding: '6px 0' }}>
        {bodies.length === 0 && (
          <div style={{ padding: '16px', textAlign: 'center', color: C.muted, fontSize: 12 }}>{t.noBody}</div>
        )}
        {bodies.map(body => {
          const isActive = body.id === activeBodyId;
          const isSelected = selectedBodyIds.includes(body.id);
          return (
            <div
              key={body.id}
              onClick={() => onSetActive(body.id)}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '6px 12px',
                cursor: 'pointer',
                background: isActive ? '#1c2128' : 'transparent',
                borderLeft: isActive ? `2px solid ${C.activeBorder}` : '2px solid transparent',
                transition: 'background 0.1s',
              }}
            >
              {/* Checkbox */}
              <input
                type="checkbox"
                checked={isSelected}
                onChange={e => { e.stopPropagation(); onToggleSelect(body.id); }}
                onClick={e => e.stopPropagation()}
                style={{ accentColor: C.checked, cursor: 'pointer', flexShrink: 0 }}
              />
              {/* Color dot */}
              <div style={{ width: 10, height: 10, borderRadius: '50%', background: body.color, flexShrink: 0 }} />
              {/* Name (editable) */}
              {editingId === body.id ? (
                <input
                  autoFocus
                  value={editingName}
                  onChange={e => setEditingName(e.target.value)}
                  onBlur={() => handleRenameCommit(body.id)}
                  onKeyDown={e => { if (e.key === 'Enter') handleRenameCommit(body.id); if (e.key === 'Escape') setEditingId(null); }}
                  onClick={e => e.stopPropagation()}
                  style={{ flex: 1, background: '#0d1117', border: `1px solid ${C.activeBorder}`, borderRadius: 4, color: C.text, fontSize: 12, padding: '2px 6px', outline: 'none' }}
                />
              ) : (
                <span
                  onDoubleClick={e => { e.stopPropagation(); setEditingId(body.id); setEditingName(body.name); }}
                  style={{ flex: 1, fontSize: 12, color: isActive ? '#e6edf3' : C.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  title={t.renameHint}
                >
                  {body.name}
                </span>
              )}
              {/* Tags */}
              <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                {isActive && (
                  <span style={{ fontSize: 9, background: C.active, color: '#fff', borderRadius: 3, padding: '1px 4px' }}>
                    {t.active}
                  </span>
                )}
                {body.mergedFrom && (
                  <span style={{ fontSize: 9, background: '#2d333b', color: '#8b9cf4', borderRadius: 3, padding: '1px 4px' }}>
                    {t.merged}
                  </span>
                )}
                {body.splitFrom && (
                  <span style={{ fontSize: 9, background: '#2d333b', color: '#f4a28b', borderRadius: 3, padding: '1px 4px' }}>
                    {t.split_tag}
                  </span>
                )}
              </div>
              {/* Visibility */}
              <button
                onClick={e => { e.stopPropagation(); onToggleVisible(body.id); }}
                title={t.toggleVisible}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: body.visible ? '#8b9cf4' : C.muted, fontSize: 12, lineHeight: 1, flexShrink: 0 }}
              >
                {body.visible ? '👁' : '◌'}
              </button>
              {/* Delete */}
              <button
                onClick={e => { e.stopPropagation(); onDelete(body.id); }}
                title={t.delete}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: C.muted, fontSize: 11, lineHeight: 1, flexShrink: 0 }}
              >
                ✕
              </button>
            </div>
          );
        })}
      </div>

      {/* ── Action bar ── */}
      <div style={{ padding: '10px 12px', borderTop: `1px solid ${C.border}`, display: 'flex', gap: 8 }}>
        {/* Merge button */}
        <button
          onClick={() => { if (canMerge) onMerge(selectedBodyIds); }}
          disabled={!canMerge}
          title={!canMerge ? t.mergeHint : ''}
          style={{
            flex: 1,
            padding: '7px 0',
            background: canMerge ? 'linear-gradient(135deg,#1f6feb,#388bfd)' : '#21262d',
            border: `1px solid ${canMerge ? '#388bfd' : C.border}`,
            borderRadius: 6,
            color: canMerge ? '#fff' : C.muted,
            fontSize: 12,
            fontWeight: 600,
            cursor: canMerge ? 'pointer' : 'not-allowed',
          }}
        >
          ⊕ {t.merge}
        </button>
        {/* Split button */}
        <button
          onClick={() => { if (canSplit) setShowSplitForm(v => !v); }}
          disabled={!canSplit}
          title={!canSplit ? t.splitHint : ''}
          style={{
            flex: 1,
            padding: '7px 0',
            background: showSplitForm ? '#272e38' : canSplit ? '#21262d' : '#1a1f28',
            border: `1px solid ${showSplitForm ? '#388bfd' : canSplit ? C.border : '#21262d'}`,
            borderRadius: 6,
            color: canSplit ? (showSplitForm ? '#58a6ff' : C.text) : C.muted,
            fontSize: 12,
            fontWeight: 600,
            cursor: canSplit ? 'pointer' : 'not-allowed',
          }}
        >
          ✂ {t.split}
        </button>
      </div>

      {/* ── Split form (expandable) ── */}
      {showSplitForm && (
        <div style={{ padding: '12px 14px 14px', borderTop: `1px solid ${C.border}`, background: '#0d1117', borderBottomLeftRadius: 10, borderBottomRightRadius: 10 }}>
          {/* Plane selector */}
          <div style={{ marginBottom: 10 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 5, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{t.splitPlane}</div>
            <div style={{ display: 'flex', gap: 6 }}>
              {([0, 1, 2] as const).map(p => (
                <button
                  key={p}
                  onClick={() => setSplitPlane(p)}
                  style={{
                    flex: 1,
                    padding: '5px 0',
                    background: splitPlane === p ? '#1f3a5c' : '#21262d',
                    border: `1px solid ${splitPlane === p ? '#388bfd' : C.border}`,
                    borderRadius: 5,
                    color: splitPlane === p ? '#58a6ff' : C.muted,
                    fontSize: 11,
                    cursor: 'pointer',
                  }}
                >
                  {t[(['planeXY', 'planeXZ', 'planeYZ'] as const)[p]]}
                </button>
              ))}
            </div>
          </div>
          {/* Offset slider */}
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {t.splitOffset}: <span style={{ color: '#58a6ff', fontFamily: 'monospace' }}>{splitOffset} mm</span>
            </div>
            <input
              type="range"
              min={-200}
              max={200}
              step={1}
              value={splitOffset}
              onChange={e => setSplitOffset(Number(e.target.value))}
              style={{ width: '100%', accentColor: '#388bfd' }}
            />
          </div>
          {/* Apply */}
          <button
            onClick={handleApplySplit}
            style={{
              width: '100%',
              padding: '8px 0',
              background: 'linear-gradient(135deg,#238636,#2ea043)',
              border: '1px solid #2ea043',
              borderRadius: 6,
              color: '#fff',
              fontSize: 13,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            ✂ {t.applySplit}
          </button>
        </div>
      )}
    </div>
  );
}
