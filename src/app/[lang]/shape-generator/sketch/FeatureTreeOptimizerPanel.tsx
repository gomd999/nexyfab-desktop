'use client';

/**
 * FeatureTreeOptimizerPanel — standalone surface that exposes the
 * `optimizeTree` garbage-collection pass (companion to
 * `featureTreeOptimizer.ts`) to the operator next to FeatureTreeView.
 *
 * Standalone by design:
 *   - Pure prop-driven (lang, tree, onOptimized?).
 *   - Owns the local UI state for the three opt flags + the last-run
 *     OptimizeResult. The wrapper integration (auto-apply, history) is
 *     not in scope for this batch.
 *   - Computes a kind histogram diff (before vs after) so the user can
 *     see at a glance which feature kinds were thinned.
 *
 * UX flow:
 *   1. Operator toggles any of the three opt flags (all default ON to
 *      match what most users want: drop suppressed + drop orphans +
 *      attempt pattern merge once Phase 2 lands).
 *   2. "Optimize" button runs `optimizeTree(tree, opts)` → result is
 *      stashed in component state. The button stays clickable so the
 *      operator can re-run after toggling flags without re-mounting.
 *   3. Result panel renders:
 *        - before / after node count + delta
 *        - per-removed feature row (kind + id + reason)
 *        - kind histogram diff (kind → before → after, deltas)
 *      Empty result = "No changes" placeholder; the button still ran.
 *   4. "Apply" button forwards the optimized tree to `onOptimized` (if
 *      provided). Disabled until a successful run has produced an
 *      `optimized` tree. Hidden entirely when no callback is wired.
 *
 * Removal reason resolution:
 *   `optimizeTree` returns `warnings: string[]` that match removedNodes
 *   in order of removal (one warning per cascade or orphan removal,
 *   plus one terminal "mergePatterns not implemented" message when
 *   that flag is on). We extract the *first* warning that mentions the
 *   removed node id verbatim — that's the most specific breadcrumb the
 *   optimizer surfaces. If no warning mentions the id (suppressed-root
 *   case), we fall back to a generic "suppressed" / "orphan" label
 *   derived from whether the node was suppressed in the input tree.
 *
 * Test surface (data-testids — all prefixed `solver-tree-optimize-`):
 *   solver-tree-optimize-panel
 *   solver-tree-optimize-toggle-{removeSuppressed|removeOrphans|mergePatterns}
 *   solver-tree-optimize-optimize-button
 *   solver-tree-optimize-before-count
 *   solver-tree-optimize-after-count
 *   solver-tree-optimize-removed-list
 *   solver-tree-optimize-removed-{id}
 *   solver-tree-optimize-apply-button
 *
 * CONSTRAINTS:
 *   - Does NOT mutate `tree` or any node references.
 *   - Does NOT modify featureTreeOptimizer.ts or featureTree.ts.
 */

import React, { useMemo, useState } from 'react';
import type { FeatureNode, FeatureTree } from '@/lib/cad/featureTree';
import {
  optimizeTree,
  type OptimizeOptions,
  type OptimizeResult,
} from '@/lib/cad/featureTreeOptimizer';

export type FeatureTreeOptimizerLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface FeatureTreeOptimizerPanelProps {
  lang: FeatureTreeOptimizerLang;
  tree: FeatureTree;
  /** Called with the optimized tree when the operator clicks Apply. */
  onOptimized?: (optimized: FeatureTree) => void;
}

// ─── i18n ─────────────────────────────────────────────────────────────────

interface Dict {
  optimize: string;
  removeSuppressed: string;
  removeOrphans: string;
  mergePatterns: string;
  optimizeButton: string;
  applyButton: string;
  beforeAfter: string;
  before: string;
  after: string;
  delta: string;
  features: string;
  removedHeading: string;
  removedEmpty: string;
  histogramHeading: string;
  noRunYet: string;
  reasonSuppressed: string;
  reasonOrphan: string;
  reasonCascade: string;
  reasonUnknown: string;
}

const dict: Record<FeatureTreeOptimizerLang, Dict> = {
  ko: {
    optimize: '최적화',
    removeSuppressed: '억제된 피처 제거',
    removeOrphans: '고아 피처 제거',
    mergePatterns: '패턴 병합',
    optimizeButton: '최적화 실행',
    applyButton: '적용',
    beforeAfter: '전/후',
    before: '전',
    after: '후',
    delta: '변화',
    features: '피처',
    removedHeading: '제거된 피처',
    removedEmpty: '제거된 피처가 없습니다',
    histogramHeading: '종류별 변화',
    noRunYet: '최적화를 실행하세요',
    reasonSuppressed: '억제됨',
    reasonOrphan: '고아',
    reasonCascade: '연쇄 제거',
    reasonUnknown: '알 수 없음',
  },
  en: {
    optimize: 'Optimize',
    removeSuppressed: 'Remove suppressed',
    removeOrphans: 'Remove orphans',
    mergePatterns: 'Merge patterns',
    optimizeButton: 'Run optimize',
    applyButton: 'Apply',
    beforeAfter: 'Before / After',
    before: 'Before',
    after: 'After',
    delta: 'Delta',
    features: 'features',
    removedHeading: 'Removed features',
    removedEmpty: 'No features removed',
    histogramHeading: 'Kind histogram',
    noRunYet: 'Run optimize to see results',
    reasonSuppressed: 'suppressed',
    reasonOrphan: 'orphan',
    reasonCascade: 'cascade-removed',
    reasonUnknown: 'unknown',
  },
  ja: {
    optimize: '最適化',
    removeSuppressed: '抑制済みを削除',
    removeOrphans: '孤立を削除',
    mergePatterns: 'パターン統合',
    optimizeButton: '最適化を実行',
    applyButton: '適用',
    beforeAfter: '前/後',
    before: '前',
    after: '後',
    delta: '差分',
    features: 'フィーチャ',
    removedHeading: '削除されたフィーチャ',
    removedEmpty: '削除されたフィーチャはありません',
    histogramHeading: '種類別の変化',
    noRunYet: '最適化を実行してください',
    reasonSuppressed: '抑制',
    reasonOrphan: '孤立',
    reasonCascade: '連鎖削除',
    reasonUnknown: '不明',
  },
  zh: {
    optimize: '优化',
    removeSuppressed: '移除抑制项',
    removeOrphans: '移除孤立项',
    mergePatterns: '合并模式',
    optimizeButton: '执行优化',
    applyButton: '应用',
    beforeAfter: '前/后',
    before: '前',
    after: '后',
    delta: '差异',
    features: '特征',
    removedHeading: '已移除的特征',
    removedEmpty: '没有移除的特征',
    histogramHeading: '种类直方图',
    noRunYet: '请执行优化',
    reasonSuppressed: '抑制',
    reasonOrphan: '孤立',
    reasonCascade: '级联移除',
    reasonUnknown: '未知',
  },
  es: {
    optimize: 'Optimizar',
    removeSuppressed: 'Eliminar suprimidos',
    removeOrphans: 'Eliminar huérfanos',
    mergePatterns: 'Fusionar patrones',
    optimizeButton: 'Ejecutar optimización',
    applyButton: 'Aplicar',
    beforeAfter: 'Antes / Después',
    before: 'Antes',
    after: 'Después',
    delta: 'Delta',
    features: 'funciones',
    removedHeading: 'Funciones eliminadas',
    removedEmpty: 'No se han eliminado funciones',
    histogramHeading: 'Histograma por tipo',
    noRunYet: 'Ejecuta la optimización para ver resultados',
    reasonSuppressed: 'suprimido',
    reasonOrphan: 'huérfano',
    reasonCascade: 'eliminado en cascada',
    reasonUnknown: 'desconocido',
  },
  ar: {
    optimize: 'تحسين',
    removeSuppressed: 'إزالة المكبوتة',
    removeOrphans: 'إزالة الأيتام',
    mergePatterns: 'دمج الأنماط',
    optimizeButton: 'تشغيل التحسين',
    applyButton: 'تطبيق',
    beforeAfter: 'قبل / بعد',
    before: 'قبل',
    after: 'بعد',
    delta: 'الفرق',
    features: 'ميزات',
    removedHeading: 'الميزات المُزالة',
    removedEmpty: 'لم تتم إزالة ميزات',
    histogramHeading: 'مدرج النوع',
    noRunYet: 'شغّل التحسين لرؤية النتائج',
    reasonSuppressed: 'مكبوت',
    reasonOrphan: 'يتيم',
    reasonCascade: 'إزالة متتالية',
    reasonUnknown: 'غير معروف',
  },
};

// ─── helpers ──────────────────────────────────────────────────────────────

interface RemovedRow {
  id: string;
  kind: string;
  reason: string;
}

/**
 * Build the per-removed-feature rows. We look up the node in the INPUT
 * tree (post-optimize the node is gone), match warnings by id substring
 * to extract the most specific reason, and fall back to suppressed /
 * orphan labels when the warning surface is empty (suppressed-root
 * case — no warning is emitted for the seed itself).
 */
function buildRemovedRows(
  tree: FeatureTree,
  result: OptimizeResult,
  t: Dict,
): RemovedRow[] {
  const byId = new Map<string, FeatureNode>();
  for (const n of tree.nodes) byId.set(n.id, n);
  return result.removedNodes.map((id): RemovedRow => {
    const node = byId.get(id);
    const kind = node?.payload.kind ?? t.reasonUnknown;
    // Match warnings where this id is the SUBJECT (starts with `node "id"`)
    // rather than where it appears anywhere — cascade warnings for node X
    // mention both X (subject) and the suppressed source Y, so a plain
    // `includes` lookup for Y would mis-attribute the cascade reason to Y.
    const warn = result.warnings.find((w) => w.startsWith(`node "${id}"`));
    let reason: string;
    if (warn) {
      if (warn.includes('cascade-removed')) reason = t.reasonCascade;
      else if (warn.includes('orphan')) reason = t.reasonOrphan;
      else reason = t.reasonSuppressed;
    } else if (node?.suppressed) {
      reason = t.reasonSuppressed;
    } else {
      reason = t.reasonOrphan;
    }
    return { id, kind, reason };
  });
}

/** Build a per-kind histogram of the tree (kind → count). */
function buildHistogram(tree: FeatureTree): Map<string, number> {
  const h = new Map<string, number>();
  for (const n of tree.nodes) {
    const k = n.payload.kind;
    h.set(k, (h.get(k) ?? 0) + 1);
  }
  return h;
}

interface HistogramRow {
  kind: string;
  before: number;
  after: number;
  delta: number;
}

function diffHistograms(
  before: Map<string, number>,
  after: Map<string, number>,
): HistogramRow[] {
  const kinds = new Set<string>([...before.keys(), ...after.keys()]);
  const rows: HistogramRow[] = [];
  for (const kind of kinds) {
    const b = before.get(kind) ?? 0;
    const a = after.get(kind) ?? 0;
    rows.push({ kind, before: b, after: a, delta: a - b });
  }
  // Sort by kind name for deterministic UI order.
  rows.sort((x, y) => x.kind.localeCompare(y.kind));
  return rows;
}

// ─── component ────────────────────────────────────────────────────────────

export default function FeatureTreeOptimizerPanel(
  props: FeatureTreeOptimizerPanelProps,
): React.ReactElement {
  const { lang, tree, onOptimized } = props;
  const t = dict[lang];

  const [removeSuppressed, setRemoveSuppressed] = useState(true);
  const [removeOrphans, setRemoveOrphans] = useState(true);
  const [mergePatterns, setMergePatterns] = useState(true);
  const [result, setResult] = useState<OptimizeResult | null>(null);

  const handleOptimize = (): void => {
    const opts: OptimizeOptions = { removeSuppressed, removeOrphans, mergePatterns };
    try {
      const r = optimizeTree(tree, opts);
      setResult(r);
    } catch {
      // Input validation failure — present an "empty" result so the panel
      // still rerenders with a fresh state. We swallow the throw because
      // the panel is non-blocking by contract.
      setResult({ optimized: tree, removedNodes: [], mergedNodes: [], warnings: [] });
    }
  };

  const handleApply = (): void => {
    if (result && onOptimized) onOptimized(result.optimized);
  };

  const beforeCount = tree.nodes.length;
  const afterCount = result?.optimized.nodes.length ?? beforeCount;
  const delta = afterCount - beforeCount;

  const removedRows = useMemo(
    () => (result ? buildRemovedRows(tree, result, t) : []),
    [result, tree, t],
  );

  const histogramRows = useMemo(() => {
    if (!result) return [];
    return diffHistograms(buildHistogram(tree), buildHistogram(result.optimized));
  }, [result, tree]);

  const applyDisabled = !result;

  return (
    <div
      data-testid="solver-tree-optimize-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        padding: 12,
        fontFamily: 'system-ui, sans-serif',
        background: 'var(--nx-panel, #111827)',
        color: 'var(--nx-text, #e5e7eb)',
        borderRadius: 6,
        minWidth: 240,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>{t.optimize}</div>

      {/* ─── toggles ────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <ToggleRow
          testid="solver-tree-optimize-toggle-removeSuppressed"
          label={t.removeSuppressed}
          checked={removeSuppressed}
          onChange={setRemoveSuppressed}
        />
        <ToggleRow
          testid="solver-tree-optimize-toggle-removeOrphans"
          label={t.removeOrphans}
          checked={removeOrphans}
          onChange={setRemoveOrphans}
        />
        <ToggleRow
          testid="solver-tree-optimize-toggle-mergePatterns"
          label={t.mergePatterns}
          checked={mergePatterns}
          onChange={setMergePatterns}
        />
      </div>

      {/* ─── action buttons ────────────────────────────────────────── */}
      <div style={{ display: 'flex', gap: 6 }}>
        <button
          type="button"
          data-testid="solver-tree-optimize-optimize-button"
          onClick={handleOptimize}
          style={{
            flex: 1,
            padding: '4px 8px',
            fontSize: 11,
            background: 'var(--nx-accent, #2563eb)',
            color: 'inherit',
            border: '1px solid var(--nx-border, #374151)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {t.optimizeButton}
        </button>
        {onOptimized !== undefined && (
          <button
            type="button"
            data-testid="solver-tree-optimize-apply-button"
            onClick={handleApply}
            disabled={applyDisabled}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: 11,
              background: applyDisabled
                ? 'var(--nx-input-bg, #1f2937)'
                : 'var(--nx-accent-2, #059669)',
              color: 'inherit',
              border: '1px solid var(--nx-border, #374151)',
              borderRadius: 4,
              cursor: applyDisabled ? 'not-allowed' : 'pointer',
              opacity: applyDisabled ? 0.5 : 1,
            }}
          >
            {t.applyButton}
          </button>
        )}
      </div>

      {/* ─── results ──────────────────────────────────────────────── */}
      {result === null ? (
        <div
          style={{
            fontStyle: 'italic',
            color: 'var(--nx-text-2, #9ca3af)',
            padding: '8px 0',
            textAlign: 'center',
          }}
        >
          {t.noRunYet}
        </div>
      ) : (
        <>
          {/* before / after */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              paddingTop: 6,
              borderTop: '1px solid var(--nx-border, #374151)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nx-text-2, #9ca3af)' }}>
              {t.beforeAfter}
            </div>
            <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
              <span data-testid="solver-tree-optimize-before-count">
                {t.before}: {beforeCount}
              </span>
              <span style={{ color: 'var(--nx-text-2, #9ca3af)' }}>→</span>
              <span data-testid="solver-tree-optimize-after-count">
                {t.after}: {afterCount}
              </span>
              <span
                style={{
                  marginLeft: 'auto',
                  color: delta < 0 ? '#10b981' : delta > 0 ? '#f59e0b' : 'inherit',
                }}
              >
                {delta > 0 ? `+${delta}` : delta} {t.features}
              </span>
            </div>
          </div>

          {/* removed list */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              paddingTop: 6,
              borderTop: '1px solid var(--nx-border, #374151)',
            }}
          >
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nx-text-2, #9ca3af)' }}>
              {t.removedHeading}
            </div>
            <div
              data-testid="solver-tree-optimize-removed-list"
              style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
            >
              {removedRows.length === 0 ? (
                <div
                  style={{
                    fontStyle: 'italic',
                    color: 'var(--nx-text-2, #9ca3af)',
                  }}
                >
                  {t.removedEmpty}
                </div>
              ) : (
                removedRows.map((row) => (
                  <div
                    key={row.id}
                    data-testid={`solver-tree-optimize-removed-${row.id}`}
                    style={{
                      display: 'flex',
                      gap: 6,
                      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                      fontSize: 11,
                    }}
                  >
                    <span style={{ flex: '0 0 auto', color: 'var(--nx-accent, #60a5fa)' }}>
                      {row.kind}
                    </span>
                    <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {row.id}
                    </span>
                    <span style={{ flex: '0 0 auto', color: 'var(--nx-text-2, #9ca3af)' }}>
                      {row.reason}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* histogram diff */}
          {histogramRows.length > 0 && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
                paddingTop: 6,
                borderTop: '1px solid var(--nx-border, #374151)',
              }}
            >
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nx-text-2, #9ca3af)' }}>
                {t.histogramHeading}
              </div>
              {histogramRows.map((row) => (
                <div
                  key={row.kind}
                  style={{
                    display: 'flex',
                    gap: 6,
                    fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
                    fontSize: 11,
                  }}
                >
                  <span style={{ flex: 1, color: 'var(--nx-accent, #60a5fa)' }}>{row.kind}</span>
                  <span style={{ flex: '0 0 60px', textAlign: 'right' }}>
                    {row.before} → {row.after}
                  </span>
                  <span
                    style={{
                      flex: '0 0 36px',
                      textAlign: 'right',
                      color: row.delta < 0 ? '#10b981' : row.delta > 0 ? '#f59e0b' : 'inherit',
                    }}
                  >
                    {row.delta > 0 ? `+${row.delta}` : row.delta}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ─── row helper ───────────────────────────────────────────────────────────

interface ToggleRowProps {
  testid: string;
  label: string;
  checked: boolean;
  onChange: (next: boolean) => void;
}

function ToggleRow(props: ToggleRowProps): React.ReactElement {
  const { testid, label, checked, onChange } = props;
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        data-testid={testid}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{label}</span>
    </label>
  );
}
