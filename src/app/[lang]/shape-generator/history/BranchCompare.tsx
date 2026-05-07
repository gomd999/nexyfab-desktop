'use client';

import React, { useState, useCallback, useEffect } from 'react';
import Image from 'next/image';
import { usePathname } from 'next/navigation';
import type { DesignBranch, BranchDiff } from './DesignBranch';
import type { Theme } from '../theme';

const dict = {
  ko: {
    visualDiff: '시각적 변경 분석',
    paramChanges: '파라미터 변경량',
    preview3d: '3D 미리보기',
    onlyA: 'A에만 있음',
    onlyB: 'B에만 있음',
    changed: '변경됨',
    noParamChanges: '수치 파라미터 변경 없음',
    legend: '범례',
    featureSummary: '피처 변경 요약',
    added: '추가됨',
    removed: '제거됨',
    modified: '수정됨',
    noChange: '변경 없음',
    shapeChanged: '형상 변경',
    from: '에서',
    to: '로',
    deltaSuffix: '개 변경',
    noPreview: '미리보기 없음',
    title: '브랜치 비교',
    compare: '비교',
    merge: '병합',
    mergeInto: '에 병합',
    selectBranch: '브랜치 선택...',
    noDiff: '차이가 없습니다',
    params: '파라미터',
    features: '피처',
    shape: '형상',
    confirmMerge: '병합하시겠습니까?',
    yes: '예',
    cancel: '취소',
    onlyInA: 'A에만 있음',
    onlyInB: 'B에만 있음',
    none: '(없음)',
  },
  en: {
    visualDiff: 'Visual Change Analysis',
    paramChanges: 'Parameter Changes',
    preview3d: '3D Preview',
    onlyA: 'Only in A',
    onlyB: 'Only in B',
    changed: 'Changed',
    noParamChanges: 'No numeric parameter changes',
    legend: 'Legend',
    featureSummary: 'Feature Change Summary',
    added: 'Added',
    removed: 'Removed',
    modified: 'Modified',
    noChange: 'No change',
    shapeChanged: 'Shape changed',
    from: 'from',
    to: 'to',
    deltaSuffix: ' Δ',
    noPreview: 'No preview',
    title: 'Branch Compare',
    compare: 'Compare',
    merge: 'Merge',
    mergeInto: 'Merge into',
    selectBranch: 'Select branch...',
    noDiff: 'No differences found',
    params: 'Parameters',
    features: 'Features',
    shape: 'Shape',
    confirmMerge: 'Confirm merge?',
    yes: 'Yes',
    cancel: 'Cancel',
    onlyInA: 'Only in A',
    onlyInB: 'Only in B',
    none: '(none)',
  },
  ja: {
    visualDiff: '視覚的変更分析',
    paramChanges: 'パラメータ変更量',
    preview3d: '3Dプレビュー',
    onlyA: 'Aのみ',
    onlyB: 'Bのみ',
    changed: '変更済み',
    noParamChanges: '数値パラメータ変更なし',
    legend: '凡例',
    featureSummary: 'フィーチャー変更概要',
    added: '追加',
    removed: '削除',
    modified: '変更',
    noChange: '変更なし',
    shapeChanged: '形状変更',
    from: 'から',
    to: 'へ',
    deltaSuffix: '件変更',
    noPreview: 'プレビューなし',
    title: 'ブランチ比較',
    compare: '比較',
    merge: 'マージ',
    mergeInto: 'にマージ',
    selectBranch: 'ブランチを選択...',
    noDiff: '差分がありません',
    params: 'パラメータ',
    features: 'フィーチャー',
    shape: '形状',
    confirmMerge: 'マージしますか?',
    yes: 'はい',
    cancel: 'キャンセル',
    onlyInA: 'Aのみ',
    onlyInB: 'Bのみ',
    none: '(なし)',
  },
  zh: {
    visualDiff: '视觉变更分析',
    paramChanges: '参数变更量',
    preview3d: '3D 预览',
    onlyA: '仅 A',
    onlyB: '仅 B',
    changed: '已更改',
    noParamChanges: '无数值参数变更',
    legend: '图例',
    featureSummary: '特征变更摘要',
    added: '已添加',
    removed: '已移除',
    modified: '已修改',
    noChange: '无变更',
    shapeChanged: '形状变更',
    from: '从',
    to: '到',
    deltaSuffix: '项变更',
    noPreview: '无预览',
    title: '分支比较',
    compare: '比较',
    merge: '合并',
    mergeInto: '合并到',
    selectBranch: '选择分支...',
    noDiff: '未发现差异',
    params: '参数',
    features: '特征',
    shape: '形状',
    confirmMerge: '确认合并?',
    yes: '是',
    cancel: '取消',
    onlyInA: '仅 A',
    onlyInB: '仅 B',
    none: '(无)',
  },
  es: {
    visualDiff: 'Análisis Visual de Cambios',
    paramChanges: 'Cambios de Parámetros',
    preview3d: 'Vista 3D',
    onlyA: 'Solo en A',
    onlyB: 'Solo en B',
    changed: 'Cambiado',
    noParamChanges: 'Sin cambios en parámetros numéricos',
    legend: 'Leyenda',
    featureSummary: 'Resumen de Cambios',
    added: 'Añadido',
    removed: 'Eliminado',
    modified: 'Modificado',
    noChange: 'Sin cambios',
    shapeChanged: 'Forma cambiada',
    from: 'desde',
    to: 'a',
    deltaSuffix: ' cambios',
    noPreview: 'Sin vista previa',
    title: 'Comparar Ramas',
    compare: 'Comparar',
    merge: 'Fusionar',
    mergeInto: 'Fusionar en',
    selectBranch: 'Seleccionar rama...',
    noDiff: 'No se encontraron diferencias',
    params: 'Parámetros',
    features: 'Características',
    shape: 'Forma',
    confirmMerge: '¿Confirmar fusión?',
    yes: 'Sí',
    cancel: 'Cancelar',
    onlyInA: 'Solo en A',
    onlyInB: 'Solo en B',
    none: '(ninguno)',
  },
  ar: {
    visualDiff: 'تحليل التغيير المرئي',
    paramChanges: 'تغييرات المعلمات',
    preview3d: 'معاينة ثلاثية الأبعاد',
    onlyA: 'في A فقط',
    onlyB: 'في B فقط',
    changed: 'تم التغيير',
    noParamChanges: 'لا توجد تغييرات معلمات رقمية',
    legend: 'مفتاح',
    featureSummary: 'ملخص تغييرات الميزات',
    added: 'تمت الإضافة',
    removed: 'تمت الإزالة',
    modified: 'تم التعديل',
    noChange: 'لا تغيير',
    shapeChanged: 'تغير الشكل',
    from: 'من',
    to: 'إلى',
    deltaSuffix: ' تغييرات',
    noPreview: 'لا توجد معاينة',
    title: 'مقارنة الفروع',
    compare: 'مقارنة',
    merge: 'دمج',
    mergeInto: 'دمج في',
    selectBranch: 'اختر الفرع...',
    noDiff: 'لم يتم العثور على فروق',
    params: 'المعلمات',
    features: 'الميزات',
    shape: 'الشكل',
    confirmMerge: 'تأكيد الدمج؟',
    yes: 'نعم',
    cancel: 'إلغاء',
    onlyInA: 'في A فقط',
    onlyInB: 'في B فقط',
    none: '(لا شيء)',
  },
};

const langMap: Record<string, keyof typeof dict> = {
  kr: 'ko', ko: 'ko', en: 'en', ja: 'ja', cn: 'zh', zh: 'zh', es: 'es', ar: 'ar',
};

/* ─── Visual 3D Diff Sub-component ──────────────────────────────────────── */

interface Visual3DDiffProps {
  branchA: DesignBranch | undefined;
  branchB: DesignBranch | undefined;
  diff: BranchDiff;
  theme: Theme;
  lang: string;
}

function Visual3DDiff({ branchA, branchB, diff, theme, lang }: Visual3DDiffProps) {
  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];
  const labels = t;

  // Collect numeric param diffs only
  const numericDiffs = diff.paramDiffs.filter(
    pd => typeof pd.valueA === 'number' && typeof pd.valueB === 'number'
  ) as Array<{ key: string; valueA: number; valueB: number }>;

  // For each numeric diff compute magnitude and bar widths
  const maxAbsVal = numericDiffs.reduce((m, pd) => Math.max(m, Math.abs(pd.valueA), Math.abs(pd.valueB)), 1);

  // Animated mount state
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  // Feature summary counts
  const featuresOnlyA = diff.featureDiffsA.filter(
    fa => !diff.featureDiffsB.some(fb => fb.type === fa.type)
  );
  const featuresOnlyB = diff.featureDiffsB.filter(
    fb => !diff.featureDiffsA.some(fa => fa.type === fb.type)
  );
  const featuresCommon = diff.featureDiffsA.filter(
    fa => diff.featureDiffsB.some(fb => fb.type === fa.type)
  );

  const colorA = branchA?.color || '#f85149';
  const colorB = branchB?.color || '#3fb950';

  const cardStyle: React.CSSProperties = {
    background: theme.cardBg,
    border: `1px solid ${theme.border}`,
    borderRadius: 8,
    padding: '10px 12px',
    marginBottom: 8,
  };

  const sectionTitle: React.CSSProperties = {
    fontSize: 11,
    fontWeight: 700,
    color: theme.text,
    marginBottom: 8,
  };

  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {/* Section header */}
      <div style={{
        fontSize: 11,
        fontWeight: 800,
        color: theme.textMuted,
        letterSpacing: '0.05em',
        textTransform: 'uppercase',
        paddingTop: 4,
        paddingBottom: 2,
        borderTop: `1px solid ${theme.border}`,
      }}>
        {labels.visualDiff}
      </div>

      {/* Legend row */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ fontSize: 10, color: theme.textMuted }}>{labels.legend}:</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: colorA, display: 'inline-block' }} />
          <span style={{ color: theme.text }}>{branchA?.name || 'A'} ({labels.onlyA})</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: colorB, display: 'inline-block' }} />
          <span style={{ color: theme.text }}>{branchB?.name || 'B'} ({labels.onlyB})</span>
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#8b949e', display: 'inline-block' }} />
          <span style={{ color: theme.text }}>{labels.noChange}</span>
        </span>
      </div>

      {/* 3D preview side-by-side (thumbnails or placeholder) */}
      <div style={cardStyle}>
        <div style={sectionTitle}>{labels.preview3d}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          {/* Branch A preview */}
          <div style={{ flex: 1, position: 'relative' }}>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: colorA,
              marginBottom: 4,
              textAlign: 'center',
            }}>
              {branchA?.name || 'A'}
            </div>
            <div style={{
              height: 110,
              borderRadius: 6,
              border: `2px solid ${colorA}40`,
              background: `${colorA}08`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              position: 'relative',
            }}>
              {diff.thumbnailA ? (
                <Image
                  src={diff.thumbnailA}
                  alt={branchA?.name || 'A'}
                  fill
                  className="object-contain"
                  sizes="200px"
                  unoptimized
                />
              ) : (
                <div style={{ textAlign: 'center', color: theme.textMuted }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>⬡</div>
                  <div style={{ fontSize: 9 }}>{branchA?.name || 'Branch A'}</div>
                  {diff.shapeA && (
                    <div style={{ fontSize: 9, color: colorA, marginTop: 2, fontFamily: 'monospace' }}>{diff.shapeA}</div>
                  )}
                </div>
              )}
              {/* Overlay: key dimension changes */}
              {numericDiffs.length > 0 && (
                <div style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 4,
                  right: 4,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 2,
                }}>
                  {numericDiffs.slice(0, 3).map(pd => (
                    <span key={pd.key} style={{
                      fontSize: 8,
                      background: `${colorA}cc`,
                      color: '#fff',
                      borderRadius: 3,
                      padding: '1px 4px',
                      fontFamily: 'monospace',
                    }}>
                      {pd.key}: {pd.valueA}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>

          {/* Diff arrow */}
          <div style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column',
            gap: 4,
            minWidth: 32,
          }}>
            <div style={{ fontSize: 16, color: theme.textMuted }}>{'\u2194'}</div>
            {diff.shapeA !== diff.shapeB && (
              <div style={{
                fontSize: 8,
                background: `${theme.accent}20`,
                color: theme.accent,
                borderRadius: 3,
                padding: '1px 4px',
                textAlign: 'center',
              }}>
                {labels.shapeChanged}
              </div>
            )}
            <div style={{
              fontSize: 8,
              color: theme.textMuted,
              textAlign: 'center',
            }}>
              {diff.paramDiffs.length}
              {t.deltaSuffix}
            </div>
          </div>

          {/* Branch B preview */}
          <div style={{ flex: 1, position: 'relative' }}>
            <div style={{
              fontSize: 10,
              fontWeight: 700,
              color: colorB,
              marginBottom: 4,
              textAlign: 'center',
            }}>
              {branchB?.name || 'B'}
            </div>
            <div style={{
              height: 110,
              borderRadius: 6,
              border: `2px solid ${colorB}40`,
              background: `${colorB}08`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              overflow: 'hidden',
              position: 'relative',
            }}>
              {diff.thumbnailB ? (
                <Image
                  src={diff.thumbnailB}
                  alt={branchB?.name || 'B'}
                  fill
                  className="object-contain"
                  sizes="200px"
                  unoptimized
                />
              ) : (
                <div style={{ textAlign: 'center', color: theme.textMuted }}>
                  <div style={{ fontSize: 22, marginBottom: 4 }}>⬡</div>
                  <div style={{ fontSize: 9 }}>{branchB?.name || 'Branch B'}</div>
                  {diff.shapeB && (
                    <div style={{ fontSize: 9, color: colorB, marginTop: 2, fontFamily: 'monospace' }}>{diff.shapeB}</div>
                  )}
                </div>
              )}
              {/* Overlay: key dimension changes */}
              {numericDiffs.length > 0 && (
                <div style={{
                  position: 'absolute',
                  bottom: 4,
                  left: 4,
                  right: 4,
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 2,
                }}>
                  {numericDiffs.slice(0, 3).map(pd => (
                    <span key={pd.key} style={{
                      fontSize: 8,
                      background: `${colorB}cc`,
                      color: '#fff',
                      borderRadius: 3,
                      padding: '1px 4px',
                      fontFamily: 'monospace',
                    }}>
                      {pd.key}: {pd.valueB}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Animated parameter change bars */}
      <div style={cardStyle}>
        <div style={sectionTitle}>{labels.paramChanges}</div>
        {numericDiffs.length === 0 ? (
          <div style={{ fontSize: 11, color: theme.textMuted, textAlign: 'center', padding: '8px 0' }}>
            {labels.noParamChanges}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {numericDiffs.map(pd => {
              const pctA = (Math.abs(pd.valueA) / maxAbsVal) * 100;
              const pctB = (Math.abs(pd.valueB) / maxAbsVal) * 100;
              const delta = pd.valueB - pd.valueA;
              const deltaPct = pd.valueA !== 0 ? ((delta / Math.abs(pd.valueA)) * 100) : null;
              const increased = delta > 0;
              const deltaColor = increased ? colorB : colorA;

              return (
                <div key={pd.key}>
                  <div style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: 3,
                  }}>
                    <span style={{ fontSize: 10, fontWeight: 600, color: theme.text, fontFamily: 'monospace' }}>
                      {pd.key}
                    </span>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                      <span style={{ fontSize: 10, color: colorA, fontFamily: 'monospace' }}>{pd.valueA}</span>
                      <span style={{ fontSize: 10, color: theme.textMuted }}>{'\u2192'}</span>
                      <span style={{ fontSize: 10, color: colorB, fontFamily: 'monospace' }}>{pd.valueB}</span>
                      {deltaPct !== null && (
                        <span style={{
                          fontSize: 9,
                          color: deltaColor,
                          fontFamily: 'monospace',
                          background: `${deltaColor}15`,
                          borderRadius: 3,
                          padding: '0 4px',
                          minWidth: 40,
                          textAlign: 'right',
                        }}>
                          {increased ? '+' : ''}{deltaPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                  </div>
                  {/* Dual bar chart: A (red) and B (green) */}
                  <div style={{ position: 'relative', height: 14 }}>
                    {/* Background track */}
                    <div style={{
                      position: 'absolute',
                      top: 2,
                      left: 0,
                      right: 0,
                      height: 10,
                      background: theme.bg,
                      borderRadius: 5,
                      border: `1px solid ${theme.border}`,
                    }} />
                    {/* Branch A bar */}
                    <div style={{
                      position: 'absolute',
                      top: 2,
                      left: 0,
                      height: 10,
                      width: `${mounted ? pctA : 0}%`,
                      background: `${colorA}70`,
                      borderRadius: 5,
                      transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1)',
                    }} />
                    {/* Branch B bar */}
                    <div style={{
                      position: 'absolute',
                      top: 2,
                      left: 0,
                      height: 10,
                      width: `${mounted ? pctB : 0}%`,
                      background: `${colorB}70`,
                      borderRadius: 5,
                      border: `1px solid ${colorB}`,
                      transition: 'width 0.5s cubic-bezier(0.4,0,0.2,1) 0.1s',
                      mixBlendMode: 'screen',
                    }} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Feature change summary pills */}
      {(featuresOnlyA.length > 0 || featuresOnlyB.length > 0 || featuresCommon.length > 0) && (
        <div style={cardStyle}>
          <div style={sectionTitle}>{labels.featureSummary}</div>
          <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
            {featuresOnlyA.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: colorA, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase' }}>
                  {labels.onlyA} ({featuresOnlyA.length})
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {featuresOnlyA.map((f, i) => (
                    <span key={i} style={{
                      fontSize: 9,
                      background: `${colorA}20`,
                      color: colorA,
                      border: `1px solid ${colorA}40`,
                      borderRadius: 4,
                      padding: '1px 5px',
                      fontFamily: 'monospace',
                    }}>
                      {f.type}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {featuresOnlyB.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: colorB, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase' }}>
                  {labels.onlyB} ({featuresOnlyB.length})
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {featuresOnlyB.map((f, i) => (
                    <span key={i} style={{
                      fontSize: 9,
                      background: `${colorB}20`,
                      color: colorB,
                      border: `1px solid ${colorB}40`,
                      borderRadius: 4,
                      padding: '1px 5px',
                      fontFamily: 'monospace',
                    }}>
                      {f.type}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {featuresCommon.length > 0 && (
              <div>
                <div style={{ fontSize: 9, color: theme.textMuted, fontWeight: 700, marginBottom: 3, textTransform: 'uppercase' }}>
                  {labels.noChange} ({featuresCommon.length})
                </div>
                <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                  {featuresCommon.map((f, i) => (
                    <span key={i} style={{
                      fontSize: 9,
                      background: `${theme.cardBg}`,
                      color: theme.textMuted,
                      border: `1px solid ${theme.border}`,
                      borderRadius: 4,
                      padding: '1px 5px',
                      fontFamily: 'monospace',
                    }}>
                      {f.type}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── BranchCompare Props ─────────────────────────────────────────────────── */

interface BranchCompareProps {
  visible: boolean;
  branches: DesignBranch[];
  activeBranch: string;
  onCompare: (branchAId: string, branchBId: string) => BranchDiff | null;
  onMerge: (sourceBranchId: string, targetBranchId: string) => void;
  onClose: () => void;
  theme: Theme;
  lang: string;
}

export default function BranchCompare({
  visible,
  branches,
  activeBranch,
  onCompare,
  onMerge,
  onClose,
  theme,
  lang,
}: BranchCompareProps) {
  const [branchAId, setBranchAId] = useState(activeBranch);
  const [branchBId, setBranchBId] = useState('');
  const [diff, setDiff] = useState<BranchDiff | null>(null);
  const [confirmMerge, setConfirmMerge] = useState(false);

  const pathname = usePathname();
  const seg = pathname?.split('/').filter(Boolean)[0] ?? lang ?? 'en';
  const t = dict[langMap[seg] ?? 'en'];
  const labels = t;

  const handleCompare = useCallback(() => {
    if (!branchAId || !branchBId) return;
    const result = onCompare(branchAId, branchBId);
    setDiff(result);
    setConfirmMerge(false);
  }, [branchAId, branchBId, onCompare]);

  const handleMerge = useCallback(() => {
    if (!branchBId) return;
    onMerge(branchBId, branchAId);
    setDiff(null);
    setConfirmMerge(false);
    onClose();
  }, [branchAId, branchBId, onMerge, onClose]);

  const branchA = branches.find(b => b.id === branchAId);
  const branchB = branches.find(b => b.id === branchBId);

  if (!visible) return null;

  return (
    <div style={{
      position: 'fixed',
      top: 0,
      left: 0,
      right: 0,
      bottom: 0,
      background: 'rgba(0,0,0,0.5)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      zIndex: 1100,
    }}
      onClick={onClose}
    >
      <div
        style={{
          width: 520,
          maxHeight: '80vh',
          background: theme.panelBg,
          border: `1px solid ${theme.border}`,
          borderRadius: 12,
          boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          padding: '12px 16px',
          borderBottom: `1px solid ${theme.border}`,
          gap: 8,
        }}>
          <div style={{ flex: 1, fontSize: 14, fontWeight: 800, color: theme.text }}>
            {labels.title}
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
            }}
          >
            &#x2715;
          </button>
        </div>

        {/* Branch selectors */}
        <div style={{ padding: '12px 16px', display: 'flex', gap: 8, alignItems: 'center', flexShrink: 0 }}>
          <select
            value={branchAId}
            onChange={e => { setBranchAId(e.target.value); setDiff(null); }}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.inputBg,
              color: theme.text,
              fontSize: 12,
              outline: 'none',
            }}
          >
            {branches.map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 700 }}>vs</span>
          <select
            value={branchBId}
            onChange={e => { setBranchBId(e.target.value); setDiff(null); }}
            style={{
              flex: 1,
              padding: '6px 8px',
              borderRadius: 6,
              border: `1px solid ${theme.border}`,
              background: theme.inputBg,
              color: theme.text,
              fontSize: 12,
              outline: 'none',
            }}
          >
            <option value="">{labels.selectBranch}</option>
            {branches.filter(b => b.id !== branchAId).map(b => (
              <option key={b.id} value={b.id}>{b.name}</option>
            ))}
          </select>
          <button
            onClick={handleCompare}
            disabled={!branchAId || !branchBId}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: 'none',
              background: branchBId ? theme.accent : theme.border,
              color: '#fff',
              fontSize: 12,
              fontWeight: 700,
              cursor: branchBId ? 'pointer' : 'default',
            }}
          >
            {labels.compare}
          </button>
        </div>

        {/* Diff result */}
        <div className="nf-scroll" style={{ flex: 1, overflowY: 'auto', padding: '0 16px 16px' }}>
          {diff && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {/* Thumbnail comparison */}
              {(diff.thumbnailA || diff.thumbnailB) && (
                <div style={{ display: 'flex', gap: 12 }}>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: branchA?.color || theme.textMuted, marginBottom: 4 }}>
                      {branchA?.name || 'A'}
                    </div>
                    {diff.thumbnailA ? (
                      <div style={{
                        position: 'relative',
                        width: '100%',
                        height: 100,
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.bg,
                      }}>
                        <Image src={diff.thumbnailA} alt="" fill className="object-contain" sizes="200px" unoptimized />
                      </div>
                    ) : (
                      <div style={{
                        width: '100%',
                        height: 100,
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        color: theme.textMuted,
                      }}>
                        {t.noPreview}
                      </div>
                    )}
                  </div>
                  <div style={{ flex: 1, textAlign: 'center' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: branchB?.color || theme.textMuted, marginBottom: 4 }}>
                      {branchB?.name || 'B'}
                    </div>
                    {diff.thumbnailB ? (
                      <div style={{
                        position: 'relative',
                        width: '100%',
                        height: 100,
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.bg,
                      }}>
                        <Image src={diff.thumbnailB} alt="" fill className="object-contain" sizes="200px" unoptimized />
                      </div>
                    ) : (
                      <div style={{
                        width: '100%',
                        height: 100,
                        borderRadius: 6,
                        border: `1px solid ${theme.border}`,
                        background: theme.bg,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 10,
                        color: theme.textMuted,
                      }}>
                        {t.noPreview}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Shape diff */}
              {diff.shapeA !== diff.shapeB && (
                <div style={{
                  padding: '8px 10px',
                  borderRadius: 6,
                  background: `${theme.accent}10`,
                  border: `1px solid ${theme.accent}30`,
                }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: theme.textMuted, marginBottom: 4 }}>
                    {labels.shape}
                  </div>
                  <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
                    <span style={{ color: '#f85149', fontFamily: 'monospace' }}>- {diff.shapeA || t.none}</span>
                    <span style={{ color: '#3fb950', fontFamily: 'monospace' }}>+ {diff.shapeB || t.none}</span>
                  </div>
                </div>
              )}

              {/* Parameter diffs */}
              {diff.paramDiffs.length > 0 && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
                    {labels.params}
                  </div>
                  {diff.paramDiffs.map((pd, i) => (
                    <div key={i} style={{
                      display: 'flex',
                      gap: 8,
                      padding: '3px 8px',
                      borderRadius: 4,
                      marginBottom: 2,
                      fontFamily: 'monospace',
                      fontSize: 11,
                      background: theme.bg,
                    }}>
                      <span style={{ color: theme.textMuted, fontWeight: 600, minWidth: 80 }}>{pd.key}</span>
                      <span style={{ color: '#f85149' }}>
                        {pd.valueA !== undefined ? pd.valueA : '-'}
                      </span>
                      <span style={{ color: theme.textMuted }}>{'\u2192'}</span>
                      <span style={{ color: '#3fb950' }}>
                        {pd.valueB !== undefined ? pd.valueB : '-'}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Feature diffs */}
              {(diff.featureDiffsA.length > 0 || diff.featureDiffsB.length > 0) && (
                <div>
                  <div style={{ fontSize: 11, fontWeight: 700, color: theme.text, marginBottom: 4 }}>
                    {labels.features}
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {/* Branch A features */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: branchA?.color || theme.textMuted, marginBottom: 4 }}>
                        {branchA?.name || 'A'}
                      </div>
                      {diff.featureDiffsA.map((f, i) => {
                        const inB = diff.featureDiffsB.some(fb => fb.type === f.type);
                        return (
                          <div key={i} style={{
                            padding: '2px 6px',
                            borderRadius: 3,
                            marginBottom: 2,
                            fontSize: 10,
                            fontFamily: 'monospace',
                            background: inB ? theme.bg : '#f8514915',
                            color: inB ? theme.text : '#f85149',
                          }}>
                            {f.type} {!f.enabled && '(off)'}
                            {!inB && <span style={{ marginLeft: 4, opacity: 0.7 }}>({labels.onlyInA})</span>}
                          </div>
                        );
                      })}
                    </div>
                    {/* Branch B features */}
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: branchB?.color || theme.textMuted, marginBottom: 4 }}>
                        {branchB?.name || 'B'}
                      </div>
                      {diff.featureDiffsB.map((f, i) => {
                        const inA = diff.featureDiffsA.some(fa => fa.type === f.type);
                        return (
                          <div key={i} style={{
                            padding: '2px 6px',
                            borderRadius: 3,
                            marginBottom: 2,
                            fontSize: 10,
                            fontFamily: 'monospace',
                            background: inA ? theme.bg : '#3fb95015',
                            color: inA ? theme.text : '#3fb950',
                          }}>
                            {f.type} {!f.enabled && '(off)'}
                            {!inA && <span style={{ marginLeft: 4, opacity: 0.7 }}>({labels.onlyInB})</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              )}

              {/* No differences */}
              {diff.paramDiffs.length === 0 && diff.shapeA === diff.shapeB &&
                diff.featureDiffsA.length === diff.featureDiffsB.length &&
                diff.featureDiffsA.every((f, i) => f.type === diff.featureDiffsB[i]?.type) && (
                <div style={{ padding: 16, textAlign: 'center', color: theme.textMuted, fontSize: 12 }}>
                  {labels.noDiff}
                </div>
              )}

              {/* Visual 3D Diff panel */}
              <Visual3DDiff
                branchA={branchA}
                branchB={branchB}
                diff={diff}
                theme={theme}
                lang={lang}
              />

              {/* Merge button */}
              {branchBId && (
                <div style={{ marginTop: 8 }}>
                  {confirmMerge ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                      <span style={{ fontSize: 12, color: theme.textMuted, fontWeight: 600 }}>
                        {labels.confirmMerge}
                      </span>
                      <button
                        onClick={handleMerge}
                        style={{
                          padding: '6px 16px',
                          borderRadius: 6,
                          border: 'none',
                          background: '#3fb950',
                          color: '#fff',
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {labels.yes}
                      </button>
                      <button
                        onClick={() => setConfirmMerge(false)}
                        style={{
                          padding: '6px 16px',
                          borderRadius: 6,
                          border: `1px solid ${theme.border}`,
                          background: theme.cardBg,
                          color: theme.textMuted,
                          fontSize: 12,
                          fontWeight: 700,
                          cursor: 'pointer',
                        }}
                      >
                        {labels.cancel}
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setConfirmMerge(true)}
                      style={{
                        width: '100%',
                        padding: '8px 14px',
                        borderRadius: 8,
                        border: `1px solid #3fb950`,
                        background: '#3fb95018',
                        color: '#3fb950',
                        fontSize: 12,
                        fontWeight: 700,
                        cursor: 'pointer',
                        transition: 'all 0.15s',
                      }}
                      onMouseEnter={e => { e.currentTarget.style.background = '#3fb95030'; }}
                      onMouseLeave={e => { e.currentTarget.style.background = '#3fb95018'; }}
                    >
                      {labels.merge} &quot;{branchB?.name}&quot; {labels.mergeInto} &quot;{branchA?.name}&quot;
                    </button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
