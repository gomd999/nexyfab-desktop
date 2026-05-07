'use client';

import React, { useState, useCallback, useRef, useEffect } from 'react';
import { usePathname } from 'next/navigation';
import type { DesignVersion } from './useVersionHistory';
import type { DesignBranch } from './DesignBranch';
import { DEFAULT_BRANCH_ID } from './DesignBranch';
import BranchSelector from './BranchSelector';
import type { Theme } from '../theme';

// ─── i18n ────────────────────────────────────────────────────────────────────

const dict = {
  ko: {
    title: '버전 히스토리',
    saveSnapshot: '스냅샷 저장',
    restore: '복원',
    confirmRestore: '이 버전으로 복원하시겠습니까?',
    yes: '예',
    cancel: '취소',
    delete: '삭제',
    rename: '이름 변경',
    noVersions: '저장된 버전이 없습니다',
    params: '파라미터 변경',
    featureChanges: '피처 변경',
    features: '피처',
    compare: '비교',
    compareMode: '버전 비교',
    compareModeHint: '비교할 버전 2개 선택',
    compareExit: '비교 종료',
    compareSelected: '선택됨',
    paramDiff: '파라미터 비교',
    featureDiff: '피처 비교',
    newer: '새 버전',
    older: '이전 버전',
    noDiff: '변경 없음',
    versionsWord: '개 버전',
    threeDDiff: '3D 비교',
    comparisonResult: '버전 비교 결과',
    hideDiff: '변경사항 숨기기',
    changes: '변경사항',
    justNow: '방금 전',
    minAgo: (m: number) => `${m}분 전`,
    hrAgo: (h: number) => `${h}시간 전`,
    dayAgo: (d: number) => `${d}일 전`,
  },
  en: {
    title: 'Version History',
    saveSnapshot: 'Save Snapshot',
    restore: 'Restore',
    confirmRestore: 'Restore this version?',
    yes: 'Yes',
    cancel: 'Cancel',
    delete: 'Delete',
    rename: 'Rename',
    noVersions: 'No saved versions',
    params: 'Parameter changes',
    featureChanges: 'Feature changes',
    features: 'features',
    compare: 'Compare',
    compareMode: 'Compare Versions',
    compareModeHint: 'Select 2 versions to compare',
    compareExit: 'Exit Compare',
    compareSelected: 'selected',
    paramDiff: 'Parameter diff',
    featureDiff: 'Feature diff',
    newer: 'Newer',
    older: 'Older',
    noDiff: 'No changes',
    versionsWord: 'versions',
    threeDDiff: '3D Diff',
    comparisonResult: 'Version Comparison',
    hideDiff: 'Hide diff',
    changes: 'changes',
    justNow: 'just now',
    minAgo: (m: number) => `${m}m ago`,
    hrAgo: (h: number) => `${h}h ago`,
    dayAgo: (d: number) => `${d}d ago`,
  },
  ja: {
    title: 'バージョン履歴',
    saveSnapshot: 'スナップショット保存',
    restore: '復元',
    confirmRestore: 'このバージョンに復元しますか?',
    yes: 'はい',
    cancel: 'キャンセル',
    delete: '削除',
    rename: '名前変更',
    noVersions: '保存されたバージョンがありません',
    params: 'パラメータ変更',
    featureChanges: 'フィーチャー変更',
    features: 'フィーチャー',
    compare: '比較',
    compareMode: 'バージョン比較',
    compareModeHint: '比較するバージョンを2つ選択',
    compareExit: '比較終了',
    compareSelected: '選択済み',
    paramDiff: 'パラメータ差分',
    featureDiff: 'フィーチャー差分',
    newer: '新しい',
    older: '古い',
    noDiff: '変更なし',
    versionsWord: 'バージョン',
    threeDDiff: '3D比較',
    comparisonResult: 'バージョン比較結果',
    hideDiff: '差分を隠す',
    changes: '変更',
    justNow: 'たった今',
    minAgo: (m: number) => `${m}分前`,
    hrAgo: (h: number) => `${h}時間前`,
    dayAgo: (d: number) => `${d}日前`,
  },
  zh: {
    title: '版本历史',
    saveSnapshot: '保存快照',
    restore: '恢复',
    confirmRestore: '恢复到此版本?',
    yes: '是',
    cancel: '取消',
    delete: '删除',
    rename: '重命名',
    noVersions: '无已保存版本',
    params: '参数变更',
    featureChanges: '特征变更',
    features: '特征',
    compare: '比较',
    compareMode: '版本比较',
    compareModeHint: '选择2个版本进行比较',
    compareExit: '退出比较',
    compareSelected: '已选',
    paramDiff: '参数差异',
    featureDiff: '特征差异',
    newer: '较新',
    older: '较旧',
    noDiff: '无变更',
    versionsWord: '个版本',
    threeDDiff: '3D比较',
    comparisonResult: '版本比较结果',
    hideDiff: '隐藏差异',
    changes: '项变更',
    justNow: '刚刚',
    minAgo: (m: number) => `${m}分钟前`,
    hrAgo: (h: number) => `${h}小时前`,
    dayAgo: (d: number) => `${d}天前`,
  },
  es: {
    title: 'Historial de Versiones',
    saveSnapshot: 'Guardar Instantánea',
    restore: 'Restaurar',
    confirmRestore: '¿Restaurar esta versión?',
    yes: 'Sí',
    cancel: 'Cancelar',
    delete: 'Eliminar',
    rename: 'Renombrar',
    noVersions: 'Sin versiones guardadas',
    params: 'Cambios de parámetros',
    featureChanges: 'Cambios de características',
    features: 'características',
    compare: 'Comparar',
    compareMode: 'Comparar Versiones',
    compareModeHint: 'Seleccione 2 versiones para comparar',
    compareExit: 'Salir de Comparación',
    compareSelected: 'seleccionadas',
    paramDiff: 'Diff de parámetros',
    featureDiff: 'Diff de características',
    newer: 'Más nueva',
    older: 'Más antigua',
    noDiff: 'Sin cambios',
    versionsWord: 'versiones',
    threeDDiff: 'Diff 3D',
    comparisonResult: 'Comparación de Versiones',
    hideDiff: 'Ocultar diff',
    changes: 'cambios',
    justNow: 'ahora mismo',
    minAgo: (m: number) => `hace ${m}m`,
    hrAgo: (h: number) => `hace ${h}h`,
    dayAgo: (d: number) => `hace ${d}d`,
  },
  ar: {
    title: 'سجل الإصدارات',
    saveSnapshot: 'حفظ لقطة',
    restore: 'استعادة',
    confirmRestore: 'استعادة هذا الإصدار؟',
    yes: 'نعم',
    cancel: 'إلغاء',
    delete: 'حذف',
    rename: 'إعادة تسمية',
    noVersions: 'لا توجد إصدارات محفوظة',
    params: 'تغييرات المعاملات',
    featureChanges: 'تغييرات الميزات',
    features: 'ميزات',
    compare: 'مقارنة',
    compareMode: 'مقارنة الإصدارات',
    compareModeHint: 'اختر إصدارَين للمقارنة',
    compareExit: 'إنهاء المقارنة',
    compareSelected: 'محدد',
    paramDiff: 'فرق المعاملات',
    featureDiff: 'فرق الميزات',
    newer: 'أحدث',
    older: 'أقدم',
    noDiff: 'لا تغييرات',
    versionsWord: 'إصدارات',
    threeDDiff: 'مقارنة 3D',
    comparisonResult: 'نتيجة مقارنة الإصدارات',
    hideDiff: 'إخفاء الفرق',
    changes: 'تغييرات',
    justNow: 'الآن',
    minAgo: (m: number) => `قبل ${m} د`,
    hrAgo: (h: number) => `قبل ${h} س`,
    dayAgo: (d: number) => `قبل ${d} ي`,
  },
};

type Lang = keyof typeof dict;
const langMap: Record<string, Lang> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

// ─── Types ───────────────────────────────────────────────────────────────────

interface VersionPanelProps {
  visible: boolean;
  versions: DesignVersion[];
  onClose: () => void;
  onSaveSnapshot: () => void;
  onRestore: (version: DesignVersion) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, newLabel: string) => void;
  theme: Theme;
  lang: string;
  // Branch props
  branches?: DesignBranch[];
  activeBranch?: string;
  onCreateBranch?: (name: string) => void;
  onSwitchBranch?: (branchId: string) => void;
  onDeleteBranch?: (branchId: string) => void;
  onShowCompare?: () => void;
  /** Called with [versionA, versionB] when user wants 3D diff */
  onShow3DDiff?: (a: DesignVersion, b: DesignVersion) => void;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relativeTime(ts: number, t: typeof dict[Lang]): string {
  const now = Date.now();
  const diff = now - ts;
  const sec = Math.floor(diff / 1000);
  const min = Math.floor(sec / 60);
  const hr = Math.floor(min / 60);
  const day = Math.floor(hr / 24);

  if (sec < 60) return t.justNow;
  if (min < 60) return t.minAgo(min);
  if (hr < 24) return t.hrAgo(hr);
  return t.dayAgo(day);
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Compute simple diff between two versions for visual highlighting */
function computeDiff(
  current: DesignVersion,
  previous: DesignVersion | null,
): { paramChanges: string[]; featureChanges: string[] } {
  if (!previous) return { paramChanges: [], featureChanges: [] };

  const paramChanges: string[] = [];
  for (const [key, val] of Object.entries(current.params)) {
    const prev = previous.params[key];
    if (prev !== undefined && prev !== val) {
      paramChanges.push(`${key}: ${prev} -> ${val}`);
    } else if (prev === undefined) {
      paramChanges.push(`+ ${key} = ${val}`);
    }
  }

  const featureChanges: string[] = [];
  const prevTypes = previous.features.map(f => f.type);
  const curTypes = current.features.map(f => f.type);
  curTypes.forEach(t => {
    if (!prevTypes.includes(t)) featureChanges.push(`+ ${t}`);
  });
  prevTypes.forEach(t => {
    if (!curTypes.includes(t)) featureChanges.push(`- ${t}`);
  });

  return { paramChanges, featureChanges };
}

// ─── Component ───────────────────────────────────────────────────────────────

export default function VersionPanel({
  visible,
  versions,
  onClose,
  onSaveSnapshot,
  onRestore,
  onDelete,
  onRename,
  theme,
  lang,
  branches,
  activeBranch,
  onCreateBranch,
  onSwitchBranch,
  onDeleteBranch,
  onShowCompare,
  onShow3DDiff,
}: VersionPanelProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const t = dict[langMap[seg] ?? langMap[lang] ?? 'en'];

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [compareMode, setCompareMode] = useState(false);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const editInputRef = useRef<HTMLInputElement>(null);

  const toggleCompareSelect = useCallback((id: string) => {
    setCompareIds(prev => {
      if (prev.includes(id)) return prev.filter(x => x !== id);
      if (prev.length >= 2) return [prev[1], id]; // replace oldest
      return [...prev, id];
    });
  }, []);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  // Close context menu on outside click
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu]);

  const handleDoubleClick = useCallback((v: DesignVersion) => {
    setEditingId(v.id);
    setEditValue(v.label || v.autoLabel);
  }, []);

  const handleEditSubmit = useCallback(() => {
    if (editingId) {
      onRename(editingId, editValue.trim());
      setEditingId(null);
    }
  }, [editingId, editValue, onRename]);

  const handleEditKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleEditSubmit();
    } else if (e.key === 'Escape') {
      setEditingId(null);
    }
  }, [handleEditSubmit]);

  const handleContextMenu = useCallback((e: React.MouseEvent, id: string) => {
    e.preventDefault();
    setContextMenu({ id, x: e.clientX, y: e.clientY });
  }, []);

  const handleRestore = useCallback((v: DesignVersion) => {
    setConfirmId(v.id);
  }, []);

  const handleConfirmRestore = useCallback((v: DesignVersion) => {
    onRestore(v);
    setConfirmId(null);
  }, [onRestore]);

  const labels = t;

  // Filter versions by active branch
  const currentBranchId = activeBranch || DEFAULT_BRANCH_ID;
  const filteredVersions = branches && activeBranch
    ? versions.filter(v => (v.branchId || DEFAULT_BRANCH_ID) === currentBranchId)
    : versions;

  // Get current branch color
  const currentBranchColor = branches?.find(b => b.id === currentBranchId)?.color;

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      right: 0,
      width: 340,
      height: '100vh',
      background: theme.panelBg,
      borderLeft: `1px solid ${theme.border}`,
      display: 'flex',
      flexDirection: 'column',
      zIndex: 900,
      boxShadow: '-4px 0 24px rgba(0,0,0,0.3)',
      transition: 'transform 0.25s ease',
      transform: visible ? 'translateX(0)' : 'translateX(100%)',
    }}>
      {/* Header */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        padding: '10px 14px',
        borderBottom: `1px solid ${theme.border}`,
        gap: 8,
        flexShrink: 0,
      }}>
        <span style={{ fontSize: 15 }}>🕐</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: theme.text }}>{labels.title}</div>
          <div style={{ fontSize: 10, color: theme.textMuted, fontWeight: 600 }}>
            {filteredVersions.length} {labels.versionsWord}
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            border: 'none',
            background: theme.cardBg,
            cursor: 'pointer',
            fontSize: 12,
            color: theme.textMuted,
            width: 24,
            height: 24,
            borderRadius: 6,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transition: 'all 0.12s',
          }}
          onMouseEnter={e => { e.currentTarget.style.background = theme.hoverBg; e.currentTarget.style.color = theme.text; }}
          onMouseLeave={e => { e.currentTarget.style.background = theme.cardBg; e.currentTarget.style.color = theme.textMuted; }}
        >
          ✕
        </button>
      </div>

      {/* Branch selector */}
      {branches && branches.length > 0 && onCreateBranch && onSwitchBranch && onDeleteBranch && (
        <div style={{
          padding: '8px 14px',
          borderBottom: `1px solid ${theme.border}`,
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          flexShrink: 0,
        }}>
          <BranchSelector
            branches={branches}
            activeBranch={currentBranchId}
            onCreateBranch={onCreateBranch}
            onSwitchBranch={onSwitchBranch}
            onDeleteBranch={onDeleteBranch}
            theme={theme}
            lang={lang}
          />
          {onShowCompare && branches.length > 1 && (
            <button
              onClick={onShowCompare}
              style={{
                padding: '4px 10px',
                borderRadius: 6,
                border: `1px solid ${theme.border}`,
                background: theme.cardBg,
                color: theme.textMuted,
                fontSize: 11,
                fontWeight: 700,
                cursor: 'pointer',
                transition: 'all 0.12s',
              }}
              onMouseEnter={e => { e.currentTarget.style.borderColor = theme.accent; e.currentTarget.style.color = theme.accentBright; }}
              onMouseLeave={e => { e.currentTarget.style.borderColor = theme.border; e.currentTarget.style.color = theme.textMuted; }}
            >
              {labels.compare}
            </button>
          )}
        </div>
      )}

      {/* Save Snapshot + Compare mode buttons */}
      <div style={{ padding: '10px 14px', borderBottom: `1px solid ${theme.border}`, flexShrink: 0, display: 'flex', gap: 6 }}>
        {!compareMode && (
          <button
            onClick={onSaveSnapshot}
            style={{
              flex: 1, padding: '8px 14px', borderRadius: 8,
              border: `1px solid ${theme.accent}`, background: `${theme.accent}18`,
              color: theme.accentBright, fontSize: 12, fontWeight: 700, cursor: 'pointer',
              transition: 'all 0.15s', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            }}
            onMouseEnter={e => { e.currentTarget.style.background = `${theme.accent}30`; }}
            onMouseLeave={e => { e.currentTarget.style.background = `${theme.accent}18`; }}
          >
            📸 {labels.saveSnapshot}
          </button>
        )}
        <button
          onClick={() => { setCompareMode(v => !v); setCompareIds([]); }}
          style={{
            padding: '8px 12px', borderRadius: 8, cursor: 'pointer',
            fontSize: 11, fontWeight: 700, transition: 'all 0.15s',
            border: `1px solid ${compareMode ? '#f0883e' : theme.border}`,
            background: compareMode ? '#f0883e18' : theme.cardBg,
            color: compareMode ? '#f0883e' : theme.textMuted,
            flex: compareMode ? 1 : 0, whiteSpace: 'nowrap',
          }}
          onMouseEnter={e => { e.currentTarget.style.borderColor = '#f0883e'; e.currentTarget.style.color = '#f0883e'; }}
          onMouseLeave={e => {
            e.currentTarget.style.borderColor = compareMode ? '#f0883e' : theme.border;
            e.currentTarget.style.color = compareMode ? '#f0883e' : theme.textMuted;
          }}
        >
          {compareMode ? `✕ ${labels.compareExit}` : `⇄ ${labels.compareMode}`}
        </button>
      </div>
      {compareMode && (
        <div style={{ padding: '6px 14px', background: '#f0883e0a', borderBottom: `1px solid ${theme.border}`, flexShrink: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#f0883e', fontWeight: 600, flex: 1 }}>
            {labels.compareModeHint} — {compareIds.length}/2 {labels.compareSelected}
          </span>
          {compareIds.length === 2 && onShow3DDiff && (() => {
            const vA = versions.find(v => v.id === compareIds[0]);
            const vB = versions.find(v => v.id === compareIds[1]);
            if (!vA || !vB) return null;
            const [older, newer] = vA.timestamp < vB.timestamp ? [vA, vB] : [vB, vA];
            return (
              <button
                onClick={() => onShow3DDiff(older, newer)}
                style={{
                  padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 700,
                  background: '#388bfd', color: '#fff', border: 'none', cursor: 'pointer',
                }}
              >
                {labels.threeDDiff}
              </button>
            );
          })()}
        </div>
      )}

      {/* Version list */}
      <div className="nf-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px 10px' }}>
        {filteredVersions.length === 0 ? (
          <div style={{ padding: 24, textAlign: 'center', color: theme.textMuted, fontSize: 12 }}>
            {labels.noVersions}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            {filteredVersions.map((v, idx) => {
              const prevVersion = idx < filteredVersions.length - 1 ? filteredVersions[idx + 1] : null;
              const diff = computeDiff(v, prevVersion);
              const isExpanded = expandedId === v.id;
              const isConfirming = confirmId === v.id;
              const displayLabel = v.label || v.autoLabel;
              const isCompareSelected = compareIds.includes(v.id);
              const compareSelectionIdx = compareIds.indexOf(v.id);

              return (
                <div
                  key={v.id}
                  onContextMenu={e => handleContextMenu(e, v.id)}
                  style={{
                    position: 'relative',
                    display: 'flex',
                    flexDirection: 'column',
                  }}
                >
                  {/* Timeline connector */}
                  {idx < filteredVersions.length - 1 && (
                    <div style={{
                      position: 'absolute',
                      left: 18,
                      top: 36,
                      bottom: -2,
                      width: 2,
                      background: currentBranchColor || theme.border,
                      opacity: 0.5,
                      zIndex: 0,
                    }} />
                  )}

                  {/* Card */}
                  <div
                    onClick={() => compareMode ? toggleCompareSelect(v.id) : handleRestore(v)}
                    style={{
                      display: 'flex',
                      gap: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      background: isCompareSelected ? '#f0883e12' : isConfirming ? `${theme.accent}12` : 'transparent',
                      border: isCompareSelected ? '1px solid #f0883e88' : isConfirming ? `1px solid ${theme.accent}` : '1px solid transparent',
                      cursor: 'pointer',
                      transition: 'all 0.12s',
                      position: 'relative',
                      zIndex: 1,
                      outline: isCompareSelected ? '2px solid #f0883e44' : 'none',
                    }}
                    onMouseEnter={e => {
                      if (!isConfirming) {
                        e.currentTarget.style.background = theme.hoverBg;
                      }
                    }}
                    onMouseLeave={e => {
                      if (!isConfirming) {
                        e.currentTarget.style.background = 'transparent';
                      }
                    }}
                  >
                    {/* Timeline dot or compare badge */}
                    {compareMode ? (
                      <div style={{
                        width: 18, height: 18, borderRadius: '50%', flexShrink: 0, zIndex: 2, marginTop: 1,
                        background: isCompareSelected ? '#f0883e' : theme.cardBg,
                        border: `2px solid ${isCompareSelected ? '#f0883e' : theme.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 9, fontWeight: 800, color: isCompareSelected ? '#fff' : theme.textMuted,
                      }}>
                        {isCompareSelected ? compareSelectionIdx + 1 : ''}
                      </div>
                    ) : (
                      <div style={{
                        width: 10, height: 10, borderRadius: '50%',
                        background: idx === 0 ? (currentBranchColor || theme.accentBright) : theme.border,
                        border: `2px solid ${idx === 0 ? (currentBranchColor || theme.accent) : theme.textMuted}`,
                        marginTop: 4, flexShrink: 0, zIndex: 2,
                      }} />
                    )}

                    {/* Thumbnail */}
                    {v.thumbnail ? (
                      <div style={{
                        width: 48,
                        height: 36,
                        borderRadius: 4,
                        overflow: 'hidden',
                        flexShrink: 0,
                        background: theme.bg,
                        border: `1px solid ${theme.border}`,
                      }}>
                        <img
                          src={v.thumbnail}
                          alt=""
                          style={{ width: '100%', height: '100%', objectFit: 'cover' }}
                        />
                      </div>
                    ) : (
                      <div style={{
                        width: 48,
                        height: 36,
                        borderRadius: 4,
                        flexShrink: 0,
                        background: theme.bg,
                        border: `1px solid ${theme.border}`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 16,
                      }}>
                        🧊
                      </div>
                    )}

                    {/* Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      {/* Label — editable on double-click */}
                      {editingId === v.id ? (
                        <input
                          ref={editInputRef}
                          value={editValue}
                          onChange={e => setEditValue(e.target.value)}
                          onBlur={handleEditSubmit}
                          onKeyDown={handleEditKeyDown}
                          style={{
                            width: '100%',
                            padding: '2px 4px',
                            borderRadius: 4,
                            border: `1px solid ${theme.accent}`,
                            background: theme.inputBg,
                            color: theme.text,
                            fontSize: 11,
                            fontWeight: 700,
                            outline: 'none',
                          }}
                          onClick={e => e.stopPropagation()}
                        />
                      ) : (
                        <div
                          onDoubleClick={e => { e.stopPropagation(); handleDoubleClick(v); }}
                          style={{
                            fontSize: 11,
                            fontWeight: 700,
                            color: theme.text,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                            lineHeight: 1.3,
                          }}
                          title={displayLabel}
                        >
                          {displayLabel}
                        </div>
                      )}

                      {/* Timestamp */}
                      <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 1 }}>
                        {relativeTime(v.timestamp, t)}
                        <span style={{ marginLeft: 6, opacity: 0.6 }}>{formatTimestamp(v.timestamp)}</span>
                      </div>

                      {/* Change summary */}
                      <div style={{ fontSize: 10, color: theme.textMuted, marginTop: 2, display: 'flex', gap: 6 }}>
                        <span>{v.shapeId}</span>
                        {v.features.length > 0 && (
                          <span>{v.features.length} {labels.features}</span>
                        )}
                      </div>

                      {/* Expand/collapse for diff */}
                      {(diff.paramChanges.length > 0 || diff.featureChanges.length > 0) && (
                        <button
                          onClick={e => { e.stopPropagation(); setExpandedId(isExpanded ? null : v.id); }}
                          style={{
                            border: 'none',
                            background: 'none',
                            padding: '2px 0',
                            color: theme.accentBright,
                            fontSize: 10,
                            fontWeight: 600,
                            cursor: 'pointer',
                            marginTop: 2,
                          }}
                        >
                          {isExpanded ? `▾ ${labels.hideDiff}` : `▸ ${diff.paramChanges.length + diff.featureChanges.length} ${labels.changes}`}
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Confirmation bar */}
                  {isConfirming && (
                    <div style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '6px 10px 6px 40px',
                      fontSize: 11,
                    }}>
                      <span style={{ color: theme.textMuted, fontWeight: 600, flex: 1 }}>
                        {labels.confirmRestore}
                      </span>
                      <button
                        onClick={e => { e.stopPropagation(); handleConfirmRestore(v); }}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 4,
                          border: 'none',
                          background: theme.accent,
                          color: '#fff',
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {labels.yes}
                      </button>
                      <button
                        onClick={e => { e.stopPropagation(); setConfirmId(null); }}
                        style={{
                          padding: '3px 10px',
                          borderRadius: 4,
                          border: `1px solid ${theme.border}`,
                          background: theme.cardBg,
                          color: theme.textMuted,
                          fontSize: 10,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  )}

                  {/* Expanded diff */}
                  {isExpanded && (
                    <div style={{
                      padding: '4px 10px 8px 40px',
                      fontSize: 10,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                    }}>
                      {diff.paramChanges.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 700, color: theme.textMuted, marginBottom: 2 }}>
                            {labels.params}
                          </div>
                          {diff.paramChanges.map((c, i) => (
                            <div key={i} style={{
                              padding: '1px 6px',
                              borderRadius: 3,
                              background: `${theme.accent}15`,
                              color: theme.accentBright,
                              fontFamily: 'monospace',
                              marginBottom: 1,
                            }}>
                              {c}
                            </div>
                          ))}
                        </div>
                      )}
                      {diff.featureChanges.length > 0 && (
                        <div>
                          <div style={{ fontWeight: 700, color: theme.textMuted, marginBottom: 2 }}>
                            {labels.featureChanges}
                          </div>
                          {diff.featureChanges.map((c, i) => (
                            <div key={i} style={{
                              padding: '1px 6px',
                              borderRadius: 3,
                              background: c.startsWith('+') ? '#16a34a20' : '#f8514920',
                              color: c.startsWith('+') ? '#3fb950' : '#f85149',
                              fontFamily: 'monospace',
                              marginBottom: 1,
                            }}>
                              {c}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Compare pane ── */}
      {compareMode && compareIds.length === 2 && (() => {
        const vA = filteredVersions.find(v => v.id === compareIds[0]);
        const vB = filteredVersions.find(v => v.id === compareIds[1]);
        if (!vA || !vB) return null;
        const diff = computeDiff(vA, vB);
        return (
          <div style={{
            borderTop: `1px solid #f0883e44`, background: '#0d1117',
            padding: '12px 14px', flexShrink: 0, maxHeight: 260, overflowY: 'auto',
          }}>
            <div style={{ fontSize: 11, fontWeight: 800, color: '#f0883e', marginBottom: 8 }}>⇄ {labels.comparisonResult}</div>
            {/* Side-by-side thumbnails */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
              {[vA, vB].map((v, i) => (
                <div key={v.id} style={{ flex: 1, background: theme.cardBg, borderRadius: 6, padding: '6px 8px', border: `1px solid ${i === 0 ? '#f0883e55' : '#388bfd55'}` }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: i === 0 ? '#f0883e' : '#58a6ff', marginBottom: 4 }}>
                    {i === 0 ? '① ' : '② '}{v.label || v.autoLabel}
                  </div>
                  {v.thumbnail ? (
                    <img src={v.thumbnail} alt="" style={{ width: '100%', height: 50, objectFit: 'cover', borderRadius: 3 }} />
                  ) : (
                    <div style={{ width: '100%', height: 50, background: theme.bg, borderRadius: 3, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}>🧊</div>
                  )}
                  <div style={{ fontSize: 9, color: theme.textMuted, marginTop: 3 }}>{relativeTime(v.timestamp, t)}</div>
                </div>
              ))}
            </div>
            {/* Param diff */}
            {diff.paramChanges.length > 0 ? (
              <div style={{ marginBottom: 6 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, marginBottom: 3 }}>{labels.paramDiff}</div>
                {diff.paramChanges.map((c, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: 10, padding: '2px 6px', borderRadius: 3, background: `${theme.accent}15`, color: theme.accentBright, marginBottom: 2 }}>{c}</div>
                ))}
              </div>
            ) : (
              <div style={{ fontSize: 10, color: theme.textMuted, marginBottom: 4 }}>✓ {labels.noDiff} ({labels.paramDiff})</div>
            )}
            {/* Feature diff */}
            {diff.featureChanges.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, marginBottom: 3 }}>{labels.featureDiff}</div>
                {diff.featureChanges.map((c, i) => (
                  <div key={i} style={{ fontFamily: 'monospace', fontSize: 10, padding: '2px 6px', borderRadius: 3, background: c.startsWith('+') ? '#16a34a20' : '#f8514920', color: c.startsWith('+') ? '#3fb950' : '#f85149', marginBottom: 2 }}>{c}</div>
                ))}
              </div>
            )}
          </div>
        );
      })()}

      {/* Right-click context menu */}
      {contextMenu && (
        <div
          style={{
            position: 'fixed',
            left: contextMenu.x,
            top: contextMenu.y,
            background: theme.cardBg,
            border: `1px solid ${theme.border}`,
            borderRadius: 8,
            boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
            zIndex: 1000,
            padding: 4,
            minWidth: 120,
          }}
          onClick={e => e.stopPropagation()}
        >
          <button
            onClick={() => {
              const v = versions.find(ver => ver.id === contextMenu.id);
              if (v) handleDoubleClick(v);
              setContextMenu(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: 'transparent',
              color: theme.text,
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              borderRadius: 4,
              textAlign: 'left',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = theme.hoverBg; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            ✏️ {labels.rename}
          </button>
          <button
            onClick={() => {
              onDelete(contextMenu.id);
              setContextMenu(null);
            }}
            style={{
              display: 'block',
              width: '100%',
              padding: '6px 12px',
              border: 'none',
              background: 'transparent',
              color: '#f85149',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              borderRadius: 4,
              textAlign: 'left',
              transition: 'background 0.1s',
            }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f8514915'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
          >
            🗑️ {labels.delete}
          </button>
        </div>
      )}
    </div>
  );
}
