'use client';

import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { FeatureType } from './features/types';
import { FEATURE_DEFS, getFeatureDefinition, classifyFeatureError } from './features';
import type { FeatureHistory, HistoryNode } from './useFeatureStack';
import FeatureParams from './FeatureParams';

// ─── i18n dict ────────────────────────────────────────────────────────────────
// Keep feature type names ('Extrude', 'Fillet', 'Chamfer', etc.) in English — canonical.
const dict = {
  ko: {
    rollbackBar: '현재',
    diagnosticTitle: '피처 실행 실패',
    editParams: '파라미터 편집',
    suppress: '일시 중지',
    unsuppress: '활성화',
    remove: '삭제',
    confirmRemove: '이 피처를 삭제하시겠습니까?',
    featureTree: '디자인 트리',
    rollbackStart: '처음으로 롤백',
    stepBack: '한 단계 뒤로',
    stepForward: '한 단계 앞으로',
    rollbackEnd: '끝까지 롤',
    fixFeatureErrorFirst: '피처 오류를 먼저 수정하세요',
    addFeature: '추가',
    noFeatures: '피처 없음',
    editingSketch: '스케치 편집',
    editFeature: '편집',
    rollbackHere: '여기로 롤백',
    suppressFeature: '억제 토글',
    deleteFeature: '삭제',
    disabled: '비활성화됨',
    suppressTitle: '억제',
    unsuppressTitle: '활성화',
    finishEditing: '편집 완료',
    editTitle: '편집',
    deleteTitle: '삭제',
    baseShape: '기본 형상',
    rollbackBeforeThis: '부모 단계까지만 활성 (이 피처 제외)',
    copyError: '오류 복사',
    treeFilterPlaceholder: '이름·타입 검색…',
    treeNoMatch: '일치하는 항목이 없습니다',
  },
  en: {
    rollbackBar: 'Current',
    diagnosticTitle: 'Feature execution failed',
    editParams: 'Edit Params',
    suppress: 'Suppress',
    unsuppress: 'Unsuppress',
    remove: 'Delete',
    confirmRemove: 'Delete this feature?',
    featureTree: 'Design Tree',
    rollbackStart: 'Rollback to start',
    stepBack: 'Step back',
    stepForward: 'Step forward',
    rollbackEnd: 'Roll to end',
    fixFeatureErrorFirst: 'Fix feature errors first',
    addFeature: 'Add',
    noFeatures: 'No features added',
    editingSketch: 'Edit Sketch',
    editFeature: 'Edit',
    rollbackHere: 'Rollback here',
    suppressFeature: 'Toggle suppress',
    deleteFeature: 'Delete',
    disabled: 'Disabled',
    suppressTitle: 'Suppress',
    unsuppressTitle: 'Unsuppress',
    finishEditing: 'Finish Editing',
    editTitle: 'Edit',
    deleteTitle: 'Delete',
    baseShape: 'Base shape',
    rollbackBeforeThis: 'Activate only up to parent (exclude this feature)',
    copyError: 'Copy error',
    treeFilterPlaceholder: 'Filter by name or type…',
    treeNoMatch: 'No matching features',
  },
  ja: {
    rollbackBar: '現在',
    diagnosticTitle: 'フィーチャー実行失敗',
    editParams: 'パラメータ編集',
    suppress: '一時停止',
    unsuppress: '有効化',
    remove: '削除',
    confirmRemove: 'このフィーチャーを削除しますか?',
    featureTree: 'デザインツリー',
    rollbackStart: '最初にロールバック',
    stepBack: '1ステップ戻る',
    stepForward: '1ステップ進む',
    rollbackEnd: '最後までロール',
    fixFeatureErrorFirst: '先にフィーチャーのエラーを修正してください',
    addFeature: '追加',
    noFeatures: 'フィーチャーなし',
    editingSketch: 'スケッチ編集',
    editFeature: '編集',
    rollbackHere: 'ここにロールバック',
    suppressFeature: '抑制切替',
    deleteFeature: '削除',
    disabled: '無効',
    suppressTitle: '抑制',
    unsuppressTitle: '解除',
    finishEditing: '編集終了',
    editTitle: '編集',
    deleteTitle: '削除',
    baseShape: 'ベース形状',
    rollbackBeforeThis: '親まで有効化（このフィーチャーを除外）',
    copyError: 'エラーをコピー',
    treeFilterPlaceholder: '名前・タイプで検索…',
    treeNoMatch: '該当なし',
  },
  zh: {
    rollbackBar: '当前',
    diagnosticTitle: '特征执行失败',
    editParams: '编辑参数',
    suppress: '暂停',
    unsuppress: '激活',
    remove: '删除',
    confirmRemove: '是否删除此特征?',
    featureTree: '设计树',
    rollbackStart: '回滚到起点',
    stepBack: '后退一步',
    stepForward: '前进一步',
    rollbackEnd: '滚动到末尾',
    fixFeatureErrorFirst: '请先修复特征错误',
    addFeature: '添加',
    noFeatures: '暂无特征',
    editingSketch: '编辑草图',
    editFeature: '编辑',
    rollbackHere: '回滚到此',
    suppressFeature: '切换抑制',
    deleteFeature: '删除',
    disabled: '已禁用',
    suppressTitle: '抑制',
    unsuppressTitle: '取消抑制',
    finishEditing: '完成编辑',
    editTitle: '编辑',
    deleteTitle: '删除',
    baseShape: '基础形状',
    rollbackBeforeThis: '仅启用到父步骤（排除此项）',
    copyError: '复制错误',
    treeFilterPlaceholder: '按名称或类型筛选…',
    treeNoMatch: '无匹配项',
  },
  es: {
    rollbackBar: 'Actual',
    diagnosticTitle: 'Fallo al ejecutar la operación',
    editParams: 'Editar parámetros',
    suppress: 'Suprimir',
    unsuppress: 'Activar',
    remove: 'Eliminar',
    confirmRemove: '¿Eliminar esta operación?',
    featureTree: 'Árbol de diseño',
    rollbackStart: 'Volver al inicio',
    stepBack: 'Paso atrás',
    stepForward: 'Paso adelante',
    rollbackEnd: 'Ir al final',
    fixFeatureErrorFirst: 'Corrija primero los errores de operaciones',
    addFeature: 'Añadir',
    noFeatures: 'Sin operaciones',
    editingSketch: 'Editar boceto',
    editFeature: 'Editar',
    rollbackHere: 'Volver aquí',
    suppressFeature: 'Alternar supresión',
    deleteFeature: 'Eliminar',
    disabled: 'Desactivado',
    suppressTitle: 'Suprimir',
    unsuppressTitle: 'Activar',
    finishEditing: 'Finalizar edición',
    editTitle: 'Editar',
    deleteTitle: 'Eliminar',
    baseShape: 'Forma base',
    rollbackBeforeThis: 'Activar solo hasta el padre (excluir esta operación)',
    copyError: 'Copiar error',
    treeFilterPlaceholder: 'Filtrar por nombre o tipo…',
    treeNoMatch: 'Sin coincidencias',
  },
  ar: {
    rollbackBar: 'الحالي',
    diagnosticTitle: 'فشل تنفيذ العملية',
    editParams: 'تحرير المعلمات',
    suppress: 'تعليق',
    unsuppress: 'تفعيل',
    remove: 'حذف',
    confirmRemove: 'هل تريد حذف هذه العملية؟',
    featureTree: 'شجرة التصميم',
    rollbackStart: 'التراجع إلى البداية',
    stepBack: 'خطوة للخلف',
    stepForward: 'خطوة للأمام',
    rollbackEnd: 'التقديم إلى النهاية',
    fixFeatureErrorFirst: 'أصلح أخطاء العمليات أولاً',
    addFeature: 'إضافة',
    noFeatures: 'لا توجد عمليات',
    editingSketch: 'تحرير الرسم',
    editFeature: 'تحرير',
    rollbackHere: 'التراجع هنا',
    suppressFeature: 'تبديل التعليق',
    deleteFeature: 'حذف',
    disabled: 'معطَّل',
    suppressTitle: 'تعليق',
    unsuppressTitle: 'تفعيل',
    finishEditing: 'إنهاء التحرير',
    editTitle: 'تحرير',
    deleteTitle: 'حذف',
    baseShape: 'الشكل الأساسي',
    rollbackBeforeThis: 'تفعيل حتى الأب فقط (استبعاد هذه العملية)',
    copyError: 'نسخ الخطأ',
    treeFilterPlaceholder: 'تصفية بالاسم أو النوع…',
    treeNoMatch: 'لا توجد نتائج',
  },
} as const;

function pickDiagnosticHint(diag: { hintKo: string; hintEn: string }, langKey: keyof typeof dict) {
  return langKey === 'ko' ? diag.hintKo : diag.hintEn;
}

// ─── Props ────────────────────────────────────────────────────────────────────

interface FeatureTreeProps {
  history: FeatureHistory;
  onRollbackTo: (id: string) => void;
  onStartEditing: (id: string) => void;
  onFinishEditing: () => void;
  onToggleExpanded: (id: string) => void;
  onToggleEnabled: (id: string) => void;
  onRemoveNode: (id: string) => void;
  onUpdateParam: (id: string, key: string, value: number) => void;
  onAddFeature: (type: FeatureType) => void;
  onEditSketch?: (featureId: string) => void;
  onMoveFeature?: (fromId: string, toId: string) => void;
  /** Optional: notify parent when a feature is double-clicked (for timeline highlight). */
  onSelectFeature?: (id: string) => void;
  /** When filtering, expand ancestor rows so matches stay visible. */
  onEnsureExpanded?: (nodeIds: string[]) => void;
  t: Record<string, string>;
}

// ─── Colors ───────────────────────────────────────────────────────────────────

const C = {
  bg: '#1b1f27',
  bgNode: '#22272e',
  bgNodeHover: '#2d333b',
  bgEditing: '#2a2520',
  text: '#c9d1d9',
  textMuted: '#8b949e',
  textDim: '#484f58',
  border: '#30363d',
  borderEditing: '#d29922',
  active: '#388bfd',
  activeBg: '#1a2332',
  danger: '#f85149',
  dangerBg: '#3d1519',
  accent: '#58a6ff',
  rollbar: '#388bfd',
} as const;

// ─── Context Menu ─────────────────────────────────────────────────────────────

interface ContextMenu {
  x: number;
  y: number;
  nodeId: string;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function FeatureTree({
  history,
  onRollbackTo,
  onStartEditing,
  onFinishEditing,
  onToggleExpanded,
  onToggleEnabled,
  onRemoveNode,
  onUpdateParam,
  onAddFeature,
  onEditSketch,
  onMoveFeature,
  onSelectFeature,
  onEnsureExpanded,
  t,
}: FeatureTreeProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? 'en';
  const langMap: Record<string, keyof typeof dict> = {
    kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
  };
  const tt = dict[langMap[seg] ?? 'en'];

  const [showAddMenu, setShowAddMenu] = useState(false);
  // #wf11: disable Add Feature when any feature has an error
  const hasFeatureError = history.nodes.some(n => n.error && n.enabled);
  const [contextMenu, setContextMenu] = useState<ContextMenu | null>(null);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  const [lockedIds, setLockedIds] = useState<Set<string>>(new Set());
  const toggleLock = useCallback((id: string) => {
    setLockedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }, []);
  const [expandedErrorId, setExpandedErrorId] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const tooltipTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  const { nodes, rootId, activeNodeId, editingNodeId } = history;

  const [treeFilter, setTreeFilter] = useState('');
  const filterNorm = treeFilter.trim().toLowerCase();
  const visibleIds = useMemo((): Set<string> | null => {
    if (!filterNorm) return null;
    const byId = new Map(nodes.map(n => [n.id, n]));
    const matchSelf = new Set<string>();
    for (const n of nodes) {
      const label = (n.label || '').toLowerCase();
      const ft = (n.featureType || '').toString().toLowerCase();
      if (label.includes(filterNorm) || ft.includes(filterNorm)) matchSelf.add(n.id);
    }
    const out = new Set<string>();
    for (const id of matchSelf) {
      let cur = byId.get(id);
      while (cur) {
        out.add(cur.id);
        const pid = cur.parentId;
        if (pid == null) break;
        cur = byId.get(pid);
        if (!cur) break;
      }
    }
    return out;
  }, [nodes, filterNorm]);

  const lastExpandKeyRef = useRef('');
  useEffect(() => {
    if (!onEnsureExpanded || !filterNorm) {
      lastExpandKeyRef.current = '';
      return;
    }
    const byId = new Map(nodes.map(n => [n.id, n]));
    const matchSelf = new Set<string>();
    for (const n of nodes) {
      const label = (n.label || '').toLowerCase();
      const ft = (n.featureType || '').toString().toLowerCase();
      if (label.includes(filterNorm) || ft.includes(filterNorm)) matchSelf.add(n.id);
    }
    if (matchSelf.size === 0) return;
    const parents = new Set<string>();
    for (const id of matchSelf) {
      let cur = byId.get(id);
      while (cur?.parentId) {
        const p = byId.get(cur.parentId);
        if (p && p.children.length > 0) parents.add(p.id);
        cur = p;
      }
    }
    if (parents.size === 0) return;
    const expandKey =
      filterNorm +
      '|' +
      Array.from(parents)
        .sort()
        .map(id => `${id}:${byId.get(id)?.expanded ? 1 : 0}`)
        .join(',');
    if (expandKey === lastExpandKeyRef.current) return;
    lastExpandKeyRef.current = expandKey;
    onEnsureExpanded(Array.from(parents));
  }, [filterNorm, nodes, onEnsureExpanded]);

  // Find where the active node is in the ordered list
  const activeIdx = nodes.findIndex(n => n.id === activeNodeId);

  // Close context menu on outside click
  const handleTreeClick = useCallback(() => {
    if (contextMenu) setContextMenu(null);
  }, [contextMenu]);

  // ── Context menu handler ──

  const handleContextMenu = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId });
  }, []);

  // ── Drag and drop ──

  const handleDragStart = useCallback((e: React.DragEvent, id: string) => {
    if (id === rootId) { e.preventDefault(); return; }
    setDragId(id);
    e.dataTransfer.effectAllowed = 'move';
  }, [rootId]);

  const handleDragOver = useCallback((e: React.DragEvent, id: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverId(id);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    setDragOverId(null);
    if (!dragId || dragId === targetId || targetId === rootId) { setDragId(null); return; }
    onMoveFeature?.(dragId, targetId);
    setDragId(null);
  }, [dragId, rootId, onMoveFeature]);

  const handleDragEnd = useCallback(() => {
    setDragId(null);
    setDragOverId(null);
  }, []);

  // ── Render a single tree node ──

  const renderNode = (node: HistoryNode, depth: number, idx: number) => {
    if (visibleIds !== null && !visibleIds.has(node.id)) return null;
    const isLocked = lockedIds.has(node.id);
    const isActive = idx <= activeIdx;
    const isActiveNode = node.id === activeNodeId;
    const isEditing = node.id === editingNodeId;
    const isRoot = node.id === rootId;
    const isDragTarget = node.id === dragOverId && dragId !== node.id;
    const hasChildren = node.children.length > 0;
    const suppressed = !isActive;

    const def = node.featureType ? getFeatureDefinition(node.featureType) : null;

    // Node container style
    const containerStyle: React.CSSProperties = {
      display: 'flex',
      flexDirection: 'column',
      marginLeft: depth * 16,
      marginBottom: 1,
    };

    // Row style — use longhand only (no `border` / `borderLeft` shorthand) so React
    // does not warn about mixing shorthand with borderLeftWidth/Style/Color.
    const edgeColor = isEditing
      ? C.borderEditing
      : node.error
        ? C.danger
        : isDragTarget
          ? C.accent
          : 'transparent';
    const rowStyle: React.CSSProperties = {
      display: 'flex',
      alignItems: 'center',
      gap: 6,
      padding: '5px 8px',
      borderRadius: 6,
      cursor: 'pointer',
      position: 'relative',
      transition: 'background 0.12s, opacity 0.12s',
      background: node.error ? C.dangerBg : isEditing ? C.bgEditing : isActiveNode ? C.activeBg : isDragTarget ? C.bgNodeHover : C.bgNode,
      opacity: suppressed ? 0.35 : node.enabled ? 1 : 0.45,
      borderTopWidth: 1,
      borderTopStyle: 'solid',
      borderTopColor: edgeColor,
      borderRightWidth: 1,
      borderRightStyle: 'solid',
      borderRightColor: edgeColor,
      borderBottomWidth: 1,
      borderBottomStyle: 'solid',
      borderBottomColor: edgeColor,
      borderLeftWidth: 3,
      borderLeftStyle: 'solid',
      borderLeftColor: node.error ? C.danger : isActiveNode ? C.active : isEditing ? C.borderEditing : 'transparent',
    };

    return (
      <div key={node.id} style={containerStyle}>
        {/* Rollback bar: show between active and next node */}
        {isActiveNode && idx < nodes.length - 1 && (
          <div style={{
            height: 3,
            background: `linear-gradient(90deg, ${C.rollbar}, ${C.rollbar}80)`,
            borderRadius: 2,
            margin: '2px 0',
            cursor: 'ns-resize',
            position: 'relative',
          }}>
            <div style={{
              position: 'absolute',
              right: 4,
              top: -6,
              fontSize: 9,
              color: C.active,
              fontWeight: 700,
              userSelect: 'none',
            }}>
              ▼ {t.rollbackBar || tt.rollbackBar}
            </div>
          </div>
        )}

        <div
          style={rowStyle}
          draggable={!isRoot}
          onDragStart={e => handleDragStart(e, node.id)}
          onDragOver={e => handleDragOver(e, node.id)}
          onDrop={e => handleDrop(e, node.id)}
          onDragEnd={handleDragEnd}
          onClick={() => onRollbackTo(node.id)}
          onDoubleClick={() => {
            if (isRoot) return;
            onSelectFeature?.(node.id);
            if (node.type === 'sketch' && onEditSketch) {
              onEditSketch(node.id);
            } else {
              onStartEditing(node.id);
            }
          }}
          onContextMenu={e => handleContextMenu(e, node.id)}
          onMouseEnter={e => {
            if (isRoot || Object.keys(node.params).length === 0) return;
            const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
            if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
            tooltipTimerRef.current = setTimeout(() => {
              setTooltip({ nodeId: node.id, x: rect.right + 6, y: rect.top });
            }, 400);
          }}
          onMouseLeave={() => {
            if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current);
            setTooltip(null);
          }}
        >
          {/* Expand/collapse arrow */}
          {hasChildren ? (
            <span
              onClick={e => { e.stopPropagation(); onToggleExpanded(node.id); }}
              style={{
                fontSize: 10,
                color: C.textMuted,
                cursor: 'pointer',
                width: 14,
                textAlign: 'center',
                userSelect: 'none',
                flexShrink: 0,
                transition: 'transform 0.15s',
                display: 'inline-block',
                transform: node.expanded ? 'rotate(90deg)' : 'rotate(0deg)',
              }}
            >
              ▶
            </span>
          ) : (
            <span style={{ width: 14, flexShrink: 0 }} />
          )}

          {/* Icon */}
          <span style={{ fontSize: 14, flexShrink: 0 }}>{node.icon}</span>

          {/* Label */}
          <span style={{
            flex: 1,
            fontSize: 12,
            fontWeight: isActiveNode ? 700 : 500,
            color: suppressed ? C.textDim : isActiveNode ? C.accent : C.text,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            userSelect: 'none',
          }}>
            {node.type === 'baseShape' ? tt.baseShape : node.label}
          </span>

          {/* Sketch plane badge */}
          {node.featureType === 'sketchExtrude' && node.sketchData && (
            <span style={{
              fontSize: 9,
              color: '#58a6ff',
              background: '#0d1a2e',
              border: '1px solid #1a3a5e',
              padding: '1px 5px',
              borderRadius: 4,
              fontWeight: 700,
              flexShrink: 0,
              letterSpacing: '0.04em',
            }}>
              {node.sketchData.plane.toUpperCase()}
              {node.sketchData.operation === 'subtract' ? ' −' : ' +'}
            </span>
          )}

          {/* Error badge — clickable to toggle diagnostic panel */}
          {node.error && (
            <button
              onClick={e => {
                e.stopPropagation();
                setExpandedErrorId(prev => (prev === node.id ? null : node.id));
              }}
              title={node.error}
              style={{
                fontSize: 10,
                color: '#fff',
                background: C.danger,
                padding: '2px 7px',
                borderRadius: 4,
                fontWeight: 700,
                flexShrink: 0,
                border: 'none',
                cursor: 'pointer',
                letterSpacing: '0.04em',
              }}
            >
              ⚠ {expandedErrorId === node.id ? 'HIDE' : 'ERROR'}
            </button>
          )}

          {/* Feature count badge */}
          {hasChildren && (
            <span style={{
              fontSize: 9, fontWeight: 700, color: '#58a6ff',
              background: 'rgba(88,166,255,0.12)',
              border: '1px solid rgba(88,166,255,0.25)',
              padding: '1px 5px', borderRadius: 8,
              flexShrink: 0, letterSpacing: '0.03em',
            }}>
              {node.children.length}
            </span>
          )}

          {/* Action buttons */}
          {!isRoot && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={e => e.stopPropagation()}>
              {/* Toggle visibility */}
              <button
                onClick={() => onToggleEnabled(node.id)}
                title={node.enabled ? tt.suppressTitle : tt.unsuppressTitle}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: node.enabled ? C.textMuted : C.textDim,
                  padding: '1px 3px',
                  lineHeight: 1,
                  transition: 'color 0.12s',
                }}
              >
                {node.enabled ? '👁' : '🚫'}
              </button>

              {/* Lock toggle */}
              <button
                onClick={() => toggleLock(node.id)}
                title={isLocked ? 'Unlock' : 'Lock'}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 11,
                  color: isLocked ? '#fcc419' : C.textDim,
                  padding: '1px 3px',
                  lineHeight: 1,
                  transition: 'color 0.12s',
                }}
              >
                {isLocked ? '🔒' : '🔓'}
              </button>

              {/* Edit */}
              {isEditing ? (
                <button
                  onClick={onFinishEditing}
                  title={tt.finishEditing}
                  style={{
                    border: 'none',
                    background: C.borderEditing,
                    color: '#000',
                    cursor: 'pointer',
                    fontSize: 10,
                    fontWeight: 700,
                    padding: '2px 6px',
                    borderRadius: 4,
                    lineHeight: 1,
                  }}
                >
                  ✓
                </button>
              ) : node.type === 'sketch' && onEditSketch ? (
                <button
                  onClick={() => onEditSketch(node.id)}
                  title={t.editingSketch || tt.editingSketch}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: C.accent,
                    padding: '1px 3px',
                    lineHeight: 1,
                  }}
                >
                  ✏️
                </button>
              ) : (
                <button
                  onClick={() => onStartEditing(node.id)}
                  title={tt.editTitle}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    cursor: 'pointer',
                    fontSize: 11,
                    color: C.textMuted,
                    padding: '1px 3px',
                    lineHeight: 1,
                  }}
                >
                  ✎
                </button>
              )}

              {/* Delete */}
              <button
                onClick={() => onRemoveNode(node.id)}
                title={tt.deleteTitle}
                style={{
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  fontSize: 12,
                  color: C.danger,
                  padding: '1px 3px',
                  lineHeight: 1,
                  fontWeight: 700,
                }}
              >
                ×
              </button>
            </div>
          )}
        </div>

        {/* Diagnostic panel (when error badge clicked) */}
        {node.error && expandedErrorId === node.id && (() => {
          const diag = classifyFeatureError(node.featureType ?? 'sketchExtrude', node.error, { nodeId: node.id });
          return (
            <div style={{
              marginLeft: 20,
              marginTop: 4,
              marginBottom: 4,
              padding: '10px 12px',
              background: '#1e0d10',
              border: `1px solid ${C.danger}`,
              borderRadius: 6,
              fontSize: 11,
              lineHeight: 1.5,
            }}>
              <div style={{ color: C.danger, fontWeight: 700, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>⚠</span>
                <span>{t.diagnosticTitle || tt.diagnosticTitle}</span>
                <span style={{
                  fontSize: 9, padding: '1px 5px', borderRadius: 3,
                  background: '#3d1519', color: '#ffb4ab', fontWeight: 600,
                  marginLeft: 'auto', letterSpacing: '0.04em',
                }}>{diag.code}</span>
              </div>
              <div style={{ color: '#e8b0b0', fontFamily: 'monospace', fontSize: 10, marginBottom: 6, wordBreak: 'break-word' }}>
                {diag.message}
              </div>
              <div style={{ color: '#ffd4a8', marginBottom: 8 }}>
                💡 {pickDiagnosticHint(diag, (langMap[seg] ?? 'en') as keyof typeof dict)}
              </div>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {!isRoot && node.parentId != null && (
                  <button
                    type="button"
                    onClick={e => {
                      e.stopPropagation();
                      onRollbackTo(node.parentId!);
                      setExpandedErrorId(null);
                    }}
                    style={{
                      padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.rollbar}`,
                      background: 'transparent', color: C.rollbar, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                    }}
                  >
                    {t.rollbackBeforeThis || tt.rollbackBeforeThis}
                  </button>
                )}
                <button
                  type="button"
                  onClick={e => {
                    e.stopPropagation();
                    const text = `[${diag.code}] ${node.error ?? ''}`;
                    void navigator.clipboard?.writeText(text).catch(() => {});
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.textDim}`,
                    background: 'transparent', color: C.textMuted, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {t.copyError || tt.copyError}
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onStartEditing(node.id);
                    setExpandedErrorId(null);
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.active}`,
                    background: 'transparent', color: C.accent, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {t.editParams || tt.editParams}
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    onToggleEnabled(node.id);
                    setExpandedErrorId(null);
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.textMuted}`,
                    background: 'transparent', color: C.textMuted, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {node.enabled ? (t.suppress || tt.suppress) : (t.unsuppress || tt.unsuppress)}
                </button>
                <button
                  onClick={e => {
                    e.stopPropagation();
                    if (confirm(t.confirmRemove || tt.confirmRemove)) {
                      onRemoveNode(node.id);
                      setExpandedErrorId(null);
                    }
                  }}
                  style={{
                    padding: '4px 10px', borderRadius: 4, border: `1px solid ${C.danger}`,
                    background: 'transparent', color: C.danger, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  {t.remove || tt.remove}
                </button>
              </div>
            </div>
          );
        })()}

        {/* Inline parameter editor (when editing) */}
        {isEditing && def && (
          <div style={{
            marginLeft: 20,
            marginTop: 4,
            marginBottom: 4,
            padding: 10,
            background: '#2a2520',
            border: `1px solid ${C.borderEditing}`,
            borderRadius: 6,
          }}>
            <FeatureParams
              instance={{
                id: node.id,
                type: node.featureType!,
                params: node.params,
                enabled: node.enabled,
                error: node.error,
              }}
              definition={def}
              t={t}
              onParamChange={onUpdateParam}
            />
          </div>
        )}

        {/* Recursively render children */}
        {node.expanded && hasChildren && node.children.map(childId => {
          const childNode = nodes.find(n => n.id === childId);
          if (!childNode) return null;
          const childIdx = nodes.indexOf(childNode);
          return renderNode(childNode, depth + 1, childIdx);
        })}
      </div>
    );
  };

  // ── Render ──

  const rootNode = nodes.find(n => n.id === rootId);

  return (
    <div
      ref={treeRef}
      onClick={handleTreeClick}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* Header */}
      <div style={{
        background: C.bg,
        borderRadius: 10,
        border: `1px solid ${C.border}`,
        padding: 12,
      }}>
        <div style={{ marginBottom: 10 }}>
          {/* Title + add on one row — avoids CJK wrapping one char per line when the panel is narrow */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 8,
            marginBottom: 6,
            minWidth: 0,
          }}>
            <h3 style={{
              fontSize: 13,
              fontWeight: 800,
              color: C.text,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              minWidth: 0,
              flex: '1 1 auto',
              overflow: 'hidden',
            }}>
              <span style={{ fontSize: 14, flexShrink: 0 }}>🌳</span>
              <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                {t.featureTree || tt.featureTree}
              </span>
            </h3>

            {/* Add feature button */}
            <div style={{ position: 'relative', flexShrink: 0 }}>
            <button
              onClick={() => { if (!hasFeatureError) setShowAddMenu(!showAddMenu); }}
              disabled={hasFeatureError}
              title={hasFeatureError ? (t.fixFeatureErrorFirst || tt.fixFeatureErrorFirst) : (t.addFeature || tt.addFeature)}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${C.border}`,
                background: C.bgNode,
                color: hasFeatureError ? '#6e7681' : C.accent,
                fontSize: 12,
                fontWeight: 700,
                cursor: hasFeatureError ? 'not-allowed' : 'pointer',
                opacity: hasFeatureError ? 0.5 : 1,
                whiteSpace: 'nowrap',
              }}
            >
              + {t.addFeature || tt.addFeature}
            </button>

            {showAddMenu && (
              <div style={{
                position: 'absolute',
                top: '100%',
                right: 0,
                marginTop: 4,
                background: C.bgNode,
                borderRadius: 8,
                border: `1px solid ${C.border}`,
                boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                padding: 4,
                zIndex: 100,
                minWidth: 180,
                maxHeight: 300,
                overflowY: 'auto',
              }}>
                {FEATURE_DEFS.map(def => (
                  <button
                    key={def.type}
                    onClick={() => { onAddFeature(def.type); setShowAddMenu(false); }}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      width: '100%',
                      padding: '6px 10px',
                      borderRadius: 5,
                      border: 'none',
                      background: 'transparent',
                      cursor: 'pointer',
                      fontSize: 12,
                      fontWeight: 600,
                      color: C.text,
                      textAlign: 'left',
                      transition: 'background 0.1s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = C.bgNodeHover; }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
                  >
                    <span style={{ fontSize: 14 }}>{def.icon}</span>
                    {(t as Record<string, string>)[`featureName_${def.type}`] || def.type}
                  </button>
                ))}
              </div>
            )}
            </div>
          </div>

          {/* Rollback step controls on their own row — avoids squeezing between title and + button */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, justifyContent: 'center' }}>
            {(() => {
              const stepBtn = (label: string, title: string, targetIdx: number | null, disabled: boolean) => (
                <button
                  key={label}
                  onClick={() => { if (targetIdx != null && targetIdx >= 0 && targetIdx < nodes.length) onRollbackTo(nodes[targetIdx].id); }}
                  disabled={disabled}
                  title={title}
                  style={{
                    padding: '3px 6px', borderRadius: 4, border: `1px solid ${C.border}`,
                    background: C.bgNode, color: disabled ? C.textDim : C.textMuted,
                    fontSize: 10, cursor: disabled ? 'not-allowed' : 'pointer',
                    opacity: disabled ? 0.4 : 1, lineHeight: 1, fontFamily: 'monospace',
                  }}
                >{label}</button>
              );
              return [
                stepBtn('⏮', t.rollbackStart || tt.rollbackStart, 0, activeIdx <= 0),
                stepBtn('⏪', t.stepBack || tt.stepBack, activeIdx - 1, activeIdx <= 0),
                stepBtn('⏩', t.stepForward || tt.stepForward, activeIdx + 1, activeIdx >= nodes.length - 1),
                stepBtn('⏭', t.rollbackEnd || tt.rollbackEnd, nodes.length - 1, activeIdx >= nodes.length - 1),
              ];
            })()}
          </div>
        </div>

        <input
          type="search"
          value={treeFilter}
          onChange={e => setTreeFilter(e.target.value)}
          placeholder={t.treeFilterPlaceholder || tt.treeFilterPlaceholder}
          aria-label={t.treeFilterPlaceholder || tt.treeFilterPlaceholder}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            marginBottom: 8,
            padding: '6px 10px',
            borderRadius: 6,
            border: `1px solid ${C.border}`,
            background: C.bgNode,
            color: C.text,
            fontSize: 11,
            outline: 'none',
          }}
        />

        {/* Tree body */}
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
        }}>
          {nodes.length === 0 || !rootNode ? (
            <div style={{ padding: '16px 0', textAlign: 'center' }}>
              <span style={{ fontSize: 20, opacity: 0.3 }}>🌳</span>
              <p style={{ color: C.textMuted, fontSize: 11, marginTop: 6 }}>
                {t.noFeatures || tt.noFeatures}
              </p>
            </div>
          ) : visibleIds !== null && visibleIds.size === 0 ? (
            <div style={{ padding: '14px 0', textAlign: 'center', color: C.textMuted, fontSize: 11 }}>
              {t.treeNoMatch || tt.treeNoMatch}
            </div>
          ) : (
            renderNode(rootNode, 0, 0)
          )}
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: C.bgNode,
            border: `1px solid ${C.border}`,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            padding: 4,
            zIndex: 1000,
            minWidth: 140,
          }}
          onClick={e => e.stopPropagation()}
        >
          {(() => {
            const ctxNode = nodes.find(n => n.id === contextMenu.nodeId);
            const isSketchNode = ctxNode?.type === 'sketch';
            return [
              ...(isSketchNode && onEditSketch ? [{ label: t.editingSketch || tt.editingSketch, action: () => { onEditSketch(contextMenu.nodeId); setContextMenu(null); }, disabled: false }] : []),
              { label: t.editFeature || tt.editFeature, action: () => { onStartEditing(contextMenu.nodeId); setContextMenu(null); }, disabled: contextMenu.nodeId === rootId || isSketchNode },
              { label: t.rollbackHere || tt.rollbackHere, action: () => { onRollbackTo(contextMenu.nodeId); setContextMenu(null); } },
              { label: t.suppressFeature || tt.suppressFeature, action: () => { onToggleEnabled(contextMenu.nodeId); setContextMenu(null); }, disabled: contextMenu.nodeId === rootId },
              { label: t.deleteFeature || tt.deleteFeature, action: () => { onRemoveNode(contextMenu.nodeId); setContextMenu(null); }, disabled: contextMenu.nodeId === rootId, danger: true },
            ];
          })().map((item, i) => (
            <button
              key={i}
              onClick={item.disabled ? undefined : item.action}
              style={{
                display: 'block',
                width: '100%',
                padding: '6px 12px',
                borderRadius: 4,
                border: 'none',
                background: 'transparent',
                cursor: item.disabled ? 'default' : 'pointer',
                fontSize: 12,
                fontWeight: 500,
                color: item.disabled ? C.textDim : (item as any).danger ? C.danger : C.text,
                textAlign: 'left',
                opacity: item.disabled ? 0.4 : 1,
                transition: 'background 0.1s',
              }}
              onMouseEnter={e => { if (!item.disabled) e.currentTarget.style.background = C.bgNodeHover; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}

      {/* ── Node param hover tooltip ── */}
      {tooltip && (() => {
        const node = nodes.find(n => n.id === tooltip.nodeId);
        if (!node || Object.keys(node.params).length === 0) return null;
        const def = node.featureType ? getFeatureDefinition(node.featureType) : null;
        return (
          <div
            onMouseEnter={() => { if (tooltipTimerRef.current) clearTimeout(tooltipTimerRef.current); }}
            onMouseLeave={() => setTooltip(null)}
            style={{
              position: 'fixed',
              left: Math.min(tooltip.x, window.innerWidth - 180),
              top: Math.max(4, Math.min(tooltip.y, window.innerHeight - 160)),
              zIndex: 9999,
              background: '#161b22',
              border: '1px solid #30363d',
              borderRadius: 8,
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
              padding: '8px 10px',
              minWidth: 150,
              pointerEvents: 'auto',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
              <span style={{ fontSize: 14 }}>{node.icon}</span>
              <span style={{ fontSize: 11, fontWeight: 700, color: '#e6edf3' }}>
                {(def as any)?.label ?? (node.type === 'baseShape' ? tt.baseShape : node.label) ?? node.id}
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
              {Object.entries(node.params).map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, fontSize: 10 }}>
                  <span style={{ color: '#8b949e' }}>{k}</span>
                  <span style={{ color: '#79c0ff', fontFamily: 'monospace', fontWeight: 700 }}>{Math.round(v * 100) / 100}</span>
                </div>
              ))}
            </div>
            {!node.enabled && (
              <div style={{ marginTop: 5, fontSize: 9, color: '#f0883e', fontWeight: 700 }}>⊘ {tt.disabled}</div>
            )}
          </div>
        );
      })()}
    </div>
  );
}
