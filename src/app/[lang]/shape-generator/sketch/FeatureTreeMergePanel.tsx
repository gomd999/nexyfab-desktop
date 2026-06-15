'use client';

/**
 * FeatureTreeMergePanel — standalone UX surface for the semantic merge
 * strategies in `featureTreeMerge.ts` (Agent-MMMMMMM).
 *
 * Standalone by design — does NOT wrap SolverSketchEditor:
 *   - Pure prop-driven (lang, base?, other?, trees?, onMerged?).
 *   - Two dropdowns let the operator pick the base + other tree from a
 *     `trees[]` catalogue. `base` / `other` props (when supplied) seed the
 *     initial selection so a parent can pre-wire "current tree vs branch X".
 *   - Five-strategy radio picker, default `semantic_dedup` (the strategy
 *     that matches typical "paste a sub-assembly" intent — drops duplicates
 *     but never loses geometry).
 *   - The Merge button calls `semanticMergeTrees` and surfaces a compact
 *     MergeStats table (added / removed / merged / deduped / replaced /
 *     warnings). Accept hands the merged tree back via onMerged.
 *
 * "added" / "removed" / "merged" semantics in the result table:
 *   - merged  : count of nodes in the result that came from BOTH trees
 *               (id intersection between base and other before merge).
 *   - added   : count of nodes ONLY in other (relative to base) that
 *               survived into the result. For `first_wins` this is the
 *               other-only contribution; for `last_wins` it's also
 *               other-only; for structural/composite it's all of other.
 *   - removed : count of nodes that were dropped from the inputs (only
 *               nonzero for `semantic_dedup` — equals `dedupedCount`).
 *
 * Test surface (data-testids — all prefixed solver-tree-merge-):
 *   solver-tree-merge-panel
 *   solver-tree-merge-base-select
 *   solver-tree-merge-other-select
 *   solver-tree-merge-strategy-structural
 *   solver-tree-merge-strategy-semantic_dedup
 *   solver-tree-merge-strategy-last_wins
 *   solver-tree-merge-strategy-first_wins
 *   solver-tree-merge-strategy-composite
 *   solver-tree-merge-merge-button
 *   solver-tree-merge-result
 *   solver-tree-merge-result-count
 *   solver-tree-merge-result-added
 *   solver-tree-merge-result-removed
 *   solver-tree-merge-result-merged
 *   solver-tree-merge-result-deduped
 *   solver-tree-merge-result-replaced
 *   solver-tree-merge-result-warnings
 *   solver-tree-merge-accept-button
 *   solver-tree-merge-error
 */

import React, { useMemo, useState } from 'react';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  semanticMergeTrees,
  type MergeStrategy,
  type SemanticMergeResult,
} from '@/lib/cad/featureTreeMerge';

export type FeatureTreeMergeLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export interface FeatureTreeMergePanelProps {
  lang: FeatureTreeMergeLang;
  /** Initial selection for the "base" dropdown. Must appear in `trees`. */
  base?: FeatureTree;
  /** Initial selection for the "other" dropdown. Must appear in `trees`. */
  other?: FeatureTree;
  /** Selectable catalogue of trees. When `base` / `other` props are passed
   *  but not present in `trees`, they are auto-prepended so the dropdowns
   *  can render them. */
  trees?: ReadonlyArray<FeatureTree>;
  /** Invoked when the operator clicks Accept on a successful merge. */
  onMerged?: (merged: FeatureTree) => void;
}

const STRATEGIES: ReadonlyArray<MergeStrategy> = [
  'structural',
  'semantic_dedup',
  'last_wins',
  'first_wins',
  'composite',
];

// ─── i18n ─────────────────────────────────────────────────────────────────

interface Dict {
  mergeTrees: string;
  baseTree: string;
  otherTree: string;
  strategy: string;
  strategyStructural: string;
  strategySemanticDedup: string;
  strategyLastWins: string;
  strategyFirstWins: string;
  strategyComposite: string;
  mergeButton: string;
  acceptButton: string;
  resultTitle: string;
  resultCount: string;
  resultAdded: string;
  resultRemoved: string;
  resultMerged: string;
  resultDeduped: string;
  resultReplaced: string;
  resultWarnings: string;
  errorMissingTrees: string;
  errorMergeFailed: string;
  treeLabel: (index: number, count: number) => string;
}

const dict: Record<FeatureTreeMergeLang, Dict> = {
  ko: {
    mergeTrees: '트리 병합',
    baseTree: '기준 트리',
    otherTree: '병합 트리',
    strategy: '전략',
    strategyStructural: '구조적',
    strategySemanticDedup: '의미 중복제거',
    strategyLastWins: '나중 우선',
    strategyFirstWins: '먼저 우선',
    strategyComposite: '합성',
    mergeButton: '병합',
    acceptButton: '적용',
    resultTitle: '병합 결과',
    resultCount: '피처 수',
    resultAdded: '추가됨',
    resultRemoved: '제거됨',
    resultMerged: '병합됨',
    resultDeduped: '중복제거',
    resultReplaced: '교체됨',
    resultWarnings: '경고',
    errorMissingTrees: '기준 트리와 병합 트리를 모두 선택하세요',
    errorMergeFailed: '병합 실패',
    treeLabel: (i, n) => `트리 ${i + 1} / ${n} (${n}피처)`,
  },
  en: {
    mergeTrees: 'Merge trees',
    baseTree: 'Base tree',
    otherTree: 'Other tree',
    strategy: 'Strategy',
    strategyStructural: 'Structural',
    strategySemanticDedup: 'Semantic dedup',
    strategyLastWins: 'Last wins',
    strategyFirstWins: 'First wins',
    strategyComposite: 'Composite',
    mergeButton: 'Merge',
    acceptButton: 'Accept',
    resultTitle: 'Merge result',
    resultCount: 'Feature count',
    resultAdded: 'Added',
    resultRemoved: 'Removed',
    resultMerged: 'Merged',
    resultDeduped: 'Deduped',
    resultReplaced: 'Replaced',
    resultWarnings: 'Warnings',
    errorMissingTrees: 'Select both a base and an other tree',
    errorMergeFailed: 'Merge failed',
    treeLabel: (i, n) => `Tree ${i + 1} of ${n}`,
  },
  ja: {
    mergeTrees: 'ツリーの統合',
    baseTree: 'ベースツリー',
    otherTree: '他のツリー',
    strategy: '戦略',
    strategyStructural: '構造的',
    strategySemanticDedup: '意味的重複排除',
    strategyLastWins: '後勝ち',
    strategyFirstWins: '先勝ち',
    strategyComposite: '複合',
    mergeButton: '統合',
    acceptButton: '適用',
    resultTitle: '統合結果',
    resultCount: 'フィーチャ数',
    resultAdded: '追加',
    resultRemoved: '削除',
    resultMerged: '統合',
    resultDeduped: '重複排除',
    resultReplaced: '置換',
    resultWarnings: '警告',
    errorMissingTrees: 'ベースと他のツリーを両方選択してください',
    errorMergeFailed: '統合に失敗しました',
    treeLabel: (i, n) => `ツリー ${i + 1} / ${n}`,
  },
  zh: {
    mergeTrees: '合并树',
    baseTree: '基础树',
    otherTree: '其他树',
    strategy: '策略',
    strategyStructural: '结构',
    strategySemanticDedup: '语义去重',
    strategyLastWins: '后者优先',
    strategyFirstWins: '前者优先',
    strategyComposite: '复合',
    mergeButton: '合并',
    acceptButton: '接受',
    resultTitle: '合并结果',
    resultCount: '特征数',
    resultAdded: '已添加',
    resultRemoved: '已移除',
    resultMerged: '已合并',
    resultDeduped: '已去重',
    resultReplaced: '已替换',
    resultWarnings: '警告',
    errorMissingTrees: '请同时选择基础树和其他树',
    errorMergeFailed: '合并失败',
    treeLabel: (i, n) => `树 ${i + 1} / ${n}`,
  },
  es: {
    mergeTrees: 'Fusionar árboles',
    baseTree: 'Árbol base',
    otherTree: 'Otro árbol',
    strategy: 'Estrategia',
    strategyStructural: 'Estructural',
    strategySemanticDedup: 'Deduplicación semántica',
    strategyLastWins: 'Último gana',
    strategyFirstWins: 'Primero gana',
    strategyComposite: 'Compuesto',
    mergeButton: 'Fusionar',
    acceptButton: 'Aceptar',
    resultTitle: 'Resultado de la fusión',
    resultCount: 'Cantidad de características',
    resultAdded: 'Añadido',
    resultRemoved: 'Eliminado',
    resultMerged: 'Fusionado',
    resultDeduped: 'Deduplicado',
    resultReplaced: 'Reemplazado',
    resultWarnings: 'Advertencias',
    errorMissingTrees: 'Selecciona un árbol base y otro árbol',
    errorMergeFailed: 'La fusión falló',
    treeLabel: (i, n) => `Árbol ${i + 1} de ${n}`,
  },
  ar: {
    mergeTrees: 'دمج الأشجار',
    baseTree: 'الشجرة الأساسية',
    otherTree: 'الشجرة الأخرى',
    strategy: 'الاستراتيجية',
    strategyStructural: 'هيكلي',
    strategySemanticDedup: 'إزالة التكرار الدلالي',
    strategyLastWins: 'الأخير يفوز',
    strategyFirstWins: 'الأول يفوز',
    strategyComposite: 'مركب',
    mergeButton: 'دمج',
    acceptButton: 'قبول',
    resultTitle: 'نتيجة الدمج',
    resultCount: 'عدد الميزات',
    resultAdded: 'مضاف',
    resultRemoved: 'محذوف',
    resultMerged: 'مدموج',
    resultDeduped: 'تمت إزالة التكرار',
    resultReplaced: 'مستبدل',
    resultWarnings: 'تحذيرات',
    errorMissingTrees: 'اختر شجرة أساسية وشجرة أخرى',
    errorMergeFailed: 'فشل الدمج',
    treeLabel: (i, n) => `الشجرة ${i + 1} من ${n}`,
  },
};

function strategyLabel(t: Dict, s: MergeStrategy): string {
  switch (s) {
    case 'structural':
      return t.strategyStructural;
    case 'semantic_dedup':
      return t.strategySemanticDedup;
    case 'last_wins':
      return t.strategyLastWins;
    case 'first_wins':
      return t.strategyFirstWins;
    case 'composite':
      return t.strategyComposite;
  }
}

// ─── stats derivation ─────────────────────────────────────────────────────

interface MergeStats {
  count: number;
  added: number;
  removed: number;
  merged: number;
  deduped: number;
  replaced: number;
  warnings: number;
}

function computeMergeStats(
  base: FeatureTree,
  other: FeatureTree,
  result: SemanticMergeResult,
): MergeStats {
  const baseIds = new Set(base.nodes.map((n) => n.id));
  const otherIds = new Set(other.nodes.map((n) => n.id));
  let shared = 0;
  for (const id of baseIds) if (otherIds.has(id)) shared += 1;
  // Other-only ids (added). Structural/composite suffix-rename collisions
  // but the count of "things from other that survived" still equals
  // other.nodes.length for those strategies (the renamed nodes are still
  // contributions).
  const otherOnly = other.nodes.length - shared;
  return {
    count: result.merged.nodes.length,
    added: otherOnly,
    removed: result.dedupedCount,
    merged: shared,
    deduped: result.dedupedCount,
    replaced: result.replacedNodes.length,
    warnings: result.warnings.length,
  };
}

// ─── component ────────────────────────────────────────────────────────────

export default function FeatureTreeMergePanel(
  props: FeatureTreeMergePanelProps,
): React.ReactElement {
  const { lang, base, other, trees, onMerged } = props;
  const t = dict[lang];

  // Build the selectable catalogue: combine `trees` with any prop-supplied
  // `base` / `other` that aren't already in the list. De-dup by reference
  // identity (these are the same JS objects).
  const catalogue: ReadonlyArray<FeatureTree> = useMemo(() => {
    const seen = new Set<FeatureTree>();
    const out: FeatureTree[] = [];
    const push = (tree: FeatureTree | undefined): void => {
      if (tree === undefined) return;
      if (seen.has(tree)) return;
      seen.add(tree);
      out.push(tree);
    };
    for (const tree of trees ?? []) push(tree);
    push(base);
    push(other);
    return out;
  }, [trees, base, other]);

  const initialBaseIndex = base !== undefined ? catalogue.indexOf(base) : 0;
  const initialOtherIndex =
    other !== undefined ? catalogue.indexOf(other) : Math.min(1, catalogue.length - 1);

  const [baseIndex, setBaseIndex] = useState<number>(
    initialBaseIndex >= 0 ? initialBaseIndex : 0,
  );
  const [otherIndex, setOtherIndex] = useState<number>(
    initialOtherIndex >= 0 ? initialOtherIndex : 0,
  );
  const [strategy, setStrategy] = useState<MergeStrategy>('semantic_dedup');
  const [result, setResult] = useState<SemanticMergeResult | null>(null);
  const [stats, setStats] = useState<MergeStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  const baseTree = catalogue[baseIndex];
  const otherTree = catalogue[otherIndex];

  const handleMerge = (): void => {
    setError(null);
    setResult(null);
    setStats(null);
    if (!baseTree || !otherTree) {
      setError(t.errorMissingTrees);
      return;
    }
    try {
      const r = semanticMergeTrees(baseTree, otherTree, strategy);
      setResult(r);
      setStats(computeMergeStats(baseTree, otherTree, r));
    } catch (e) {
      setError(`${t.errorMergeFailed}: ${(e as Error).message}`);
    }
  };

  const handleAccept = (): void => {
    if (!result || !onMerged) return;
    onMerged(result.merged);
  };

  return (
    <div
      data-testid="solver-tree-merge-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        padding: 12,
        fontFamily: 'system-ui, sans-serif',
        background: 'var(--nx-panel, #111827)',
        color: 'var(--nx-text, #e5e7eb)',
        borderRadius: 6,
        minWidth: 260,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>{t.mergeTrees}</div>

      {/* ─── tree selectors ───────────────────────────────────────────── */}
      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: 'var(--nx-text-2, #9ca3af)',
        }}
      >
        <span style={{ flex: '0 0 auto', minWidth: 80 }}>{t.baseTree}:</span>
        <select
          data-testid="solver-tree-merge-base-select"
          value={baseIndex}
          onChange={(e) => setBaseIndex(Number(e.target.value))}
          style={selectStyle}
        >
          {catalogue.map((tree, i) => (
            <option key={`base-${i}`} value={i}>
              {t.treeLabel(i, catalogue.length)} ({tree.nodes.length})
            </option>
          ))}
        </select>
      </label>

      <label
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 6,
          fontSize: 11,
          color: 'var(--nx-text-2, #9ca3af)',
        }}
      >
        <span style={{ flex: '0 0 auto', minWidth: 80 }}>{t.otherTree}:</span>
        <select
          data-testid="solver-tree-merge-other-select"
          value={otherIndex}
          onChange={(e) => setOtherIndex(Number(e.target.value))}
          style={selectStyle}
        >
          {catalogue.map((tree, i) => (
            <option key={`other-${i}`} value={i}>
              {t.treeLabel(i, catalogue.length)} ({tree.nodes.length})
            </option>
          ))}
        </select>
      </label>

      {/* ─── strategy picker ──────────────────────────────────────────── */}
      <fieldset
        style={{
          border: '1px solid var(--nx-border, #374151)',
          borderRadius: 4,
          padding: 6,
          display: 'flex',
          flexDirection: 'column',
          gap: 3,
        }}
      >
        <legend style={{ padding: '0 4px', fontSize: 11, color: 'var(--nx-text-2, #9ca3af)' }}>
          {t.strategy}
        </legend>
        {STRATEGIES.map((s) => (
          <label
            key={s}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              fontSize: 11,
              cursor: 'pointer',
            }}
          >
            <input
              data-testid={`solver-tree-merge-strategy-${s}`}
              type="radio"
              name="solver-tree-merge-strategy"
              value={s}
              checked={strategy === s}
              onChange={() => setStrategy(s)}
            />
            <span>{strategyLabel(t, s)}</span>
          </label>
        ))}
      </fieldset>

      {/* ─── merge button ─────────────────────────────────────────────── */}
      <button
        data-testid="solver-tree-merge-merge-button"
        type="button"
        onClick={handleMerge}
        style={primaryButtonStyle}
      >
        {t.mergeButton}
      </button>

      {/* ─── error ────────────────────────────────────────────────────── */}
      {error !== null && (
        <div
          data-testid="solver-tree-merge-error"
          style={{
            color: 'var(--nx-error, #f87171)',
            fontSize: 11,
            padding: '4px 6px',
            background: 'var(--nx-error-bg, rgba(248,113,113,0.08))',
            borderRadius: 4,
          }}
        >
          {error}
        </div>
      )}

      {/* ─── result table ─────────────────────────────────────────────── */}
      {result !== null && stats !== null && (
        <div
          data-testid="solver-tree-merge-result"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            paddingTop: 8,
            borderTop: '1px solid var(--nx-border, #374151)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nx-text-2, #9ca3af)' }}>
            {t.resultTitle}
          </div>
          <StatRow
            testid="solver-tree-merge-result-count"
            label={t.resultCount}
            value={String(stats.count)}
          />
          <StatRow
            testid="solver-tree-merge-result-added"
            label={t.resultAdded}
            value={String(stats.added)}
          />
          <StatRow
            testid="solver-tree-merge-result-removed"
            label={t.resultRemoved}
            value={String(stats.removed)}
          />
          <StatRow
            testid="solver-tree-merge-result-merged"
            label={t.resultMerged}
            value={String(stats.merged)}
          />
          <StatRow
            testid="solver-tree-merge-result-deduped"
            label={t.resultDeduped}
            value={String(stats.deduped)}
          />
          <StatRow
            testid="solver-tree-merge-result-replaced"
            label={t.resultReplaced}
            value={String(stats.replaced)}
          />
          <StatRow
            testid="solver-tree-merge-result-warnings"
            label={t.resultWarnings}
            value={String(stats.warnings)}
          />
          <button
            data-testid="solver-tree-merge-accept-button"
            type="button"
            onClick={handleAccept}
            disabled={onMerged === undefined}
            style={{
              ...primaryButtonStyle,
              marginTop: 4,
              opacity: onMerged === undefined ? 0.5 : 1,
              cursor: onMerged === undefined ? 'not-allowed' : 'pointer',
            }}
          >
            {t.acceptButton}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── shared styles ────────────────────────────────────────────────────────

const selectStyle: React.CSSProperties = {
  flex: 1,
  minWidth: 0,
  background: 'var(--nx-input-bg, #1f2937)',
  color: 'inherit',
  border: '1px solid var(--nx-border, #374151)',
  borderRadius: 4,
  padding: '2px 4px',
  fontSize: 11,
};

const primaryButtonStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 12,
  background: 'var(--nx-accent, #2563eb)',
  color: 'white',
  border: '1px solid var(--nx-border, #374151)',
  borderRadius: 4,
  cursor: 'pointer',
};

// ─── row helper ───────────────────────────────────────────────────────────

interface StatRowProps {
  testid: string;
  label: string;
  value: string;
}

function StatRow(props: StatRowProps): React.ReactElement {
  const { testid, label, value } = props;
  return (
    <div
      data-testid={testid}
      style={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
        alignItems: 'baseline',
      }}
    >
      <span style={{ color: 'var(--nx-text-2, #9ca3af)', flex: '0 0 auto' }}>{label}</span>
      <span
        data-testid={`${testid}-value`}
        style={{
          fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
          textAlign: 'right',
          flex: 1,
          minWidth: 0,
        }}
      >
        {value}
      </span>
    </div>
  );
}
