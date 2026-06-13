'use client';

/**
 * SolverBatchPanel — Phase 3.3.UI dev/debug panel for the multi-assembly
 * batch solver driver (`solveBatch`, see solverBatch.ts, ADR-013).
 *
 * Renders a "Run batch" button + a `maxParallel` slider, then a results
 * table once a run has completed. Each row mirrors the BatchSolveResult
 * shape plus the per-item solver / id from the input list so callers can
 * see which item produced which numbers.
 *
 * Standalone by design — the panel takes the items to solve and an
 * optional `onRun` test seam as props. The default `onRun` calls
 * `solveBatch` directly; tests inject a stub so they don't pay for nine
 * real solver invocations per Run click.
 *
 * Two production use-cases the panel is meant to drive (mirrors the
 * solverBatch.ts header comment):
 *
 *   1. Multi-assembly UI. The user wants to compare how each of the
 *      open assembly tabs converges under a given solver.
 *   2. Hyperparameter / solver sweep. The user wants to feed the SAME
 *      assembly through all three solvers (and tweak per-item options)
 *      to see which configuration wins on this scenario.
 *
 * Stats strip:
 *
 *   - total time   — sum of `durationMs` across all results
 *   - avg time     — total / N (formatted to 3 decimal places)
 *   - failures     — count of `result.success === false` rows
 *
 * Note that "total time" is the SUM of solver wall-clock, NOT the
 * end-to-end batch wall-clock — under the current single-thread runtime
 * those are equivalent (CPU-bound, Promise.all interleaves but doesn't
 * truly parallelise), but Phase 4 worker-pool will widen the gap. Today
 * we report the sum because that's the number the auto-tuner cares about.
 *
 * 6-lang i18n: ko / en / ja / zh / es / ar — matches the page-shell
 * convention used by SolverBenchmarkPanel and the AssemblyBrowser modal.
 */

import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import {
  solveBatch,
  type BatchSolveItem,
  type BatchSolveResult,
  type SolveBatchOptions,
} from '@/lib/assembly/solverBatch';
import {
  checkAssemblyConstraints,
  type AssemblyConstraint,
  type ConstraintCheckResult,
} from '@/lib/assembly/assemblyConstraints';

// ─── i18n ──────────────────────────────────────────────────────────────────

export type SolverBatchLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface PanelDict {
  title: string;
  description: string;
  runButton: string;
  running: string;
  resetButton: string;
  noResults: string;
  errorRunning: string;
  emptyItems: string;
  // Slider
  maxParallelLabel: string;
  // Table columns
  colId: string;
  colSolver: string;
  colIterations: string;
  colDuration: string;
  colSuccess: string;
  colResidual: string;
  // Boolean cells
  successYes: string;
  successNo: string;
  // Stats strip
  statsTotal: string;
  statsAvg: string;
  statsFailures: string;
  statsItems: string;
  // Constraint check (optional bolt-on UX — toggle defaults off)
  addConstraintCheck: string;
  constraintResults: string;
  constraintPass: string;
  constraintFail: string;
  constraintMassLabel: string;
  constraintPartCountLabel: string;
}

const DICT: Record<SolverBatchLang, PanelDict> = {
  ko: {
    title: '배치 솔버 실행',
    description: '여러 어셈블리를 동시에 풀고 결과를 비교합니다.',
    runButton: '배치 실행',
    running: '실행 중...',
    resetButton: '초기화',
    noResults: '아직 결과가 없습니다',
    errorRunning: '배치 실행 중 오류가 발생했습니다',
    emptyItems: '실행할 항목이 없습니다',
    maxParallelLabel: '최대 병렬',
    colId: 'id',
    colSolver: '솔버',
    colIterations: '반복',
    colDuration: '시간(ms)',
    colSuccess: '성공',
    colResidual: '잔차',
    successYes: '예',
    successNo: '아니오',
    statsTotal: '총 시간',
    statsAvg: '평균',
    statsFailures: '실패',
    statsItems: '항목',
    addConstraintCheck: '제약 조건 검사 추가',
    constraintResults: '제약 결과',
    constraintPass: '통과',
    constraintFail: '실패',
    constraintMassLabel: '총 질량 한계(g)',
    constraintPartCountLabel: '부품 수 한계',
  },
  en: {
    title: 'Solver batch',
    description: 'Run many assembly solves concurrently and compare results.',
    runButton: 'Run batch',
    running: 'Running...',
    resetButton: 'Reset',
    noResults: 'No results yet',
    errorRunning: 'Batch run failed',
    emptyItems: 'No items to run',
    maxParallelLabel: 'maxParallel',
    colId: 'id',
    colSolver: 'solver',
    colIterations: 'iterations',
    colDuration: 'duration (ms)',
    colSuccess: 'success',
    colResidual: 'residual',
    successYes: 'yes',
    successNo: 'no',
    statsTotal: 'total',
    statsAvg: 'avg',
    statsFailures: 'failures',
    statsItems: 'items',
    addConstraintCheck: 'Add constraint check',
    constraintResults: 'constraints',
    constraintPass: 'pass',
    constraintFail: 'fail',
    constraintMassLabel: 'total mass limit (g)',
    constraintPartCountLabel: 'part count limit',
  },
  ja: {
    title: 'バッチソルバー',
    description: '複数のアセンブリを並行して解き、結果を比較します。',
    runButton: 'バッチ実行',
    running: '実行中...',
    resetButton: 'リセット',
    noResults: 'まだ結果がありません',
    errorRunning: 'バッチ実行中にエラーが発生しました',
    emptyItems: '実行する項目がありません',
    maxParallelLabel: '最大並列',
    colId: 'id',
    colSolver: 'ソルバー',
    colIterations: '反復',
    colDuration: '時間(ms)',
    colSuccess: '成功',
    colResidual: '残差',
    successYes: 'はい',
    successNo: 'いいえ',
    statsTotal: '合計',
    statsAvg: '平均',
    statsFailures: '失敗',
    statsItems: '項目',
    addConstraintCheck: '制約チェックを追加',
    constraintResults: '制約結果',
    constraintPass: '合格',
    constraintFail: '不合格',
    constraintMassLabel: '総質量上限(g)',
    constraintPartCountLabel: '部品数上限',
  },
  zh: {
    title: '批量求解',
    description: '并发运行多个装配求解并比较结果。',
    runButton: '运行批处理',
    running: '运行中...',
    resetButton: '重置',
    noResults: '尚无结果',
    errorRunning: '批处理运行失败',
    emptyItems: '没有可运行的项目',
    maxParallelLabel: '最大并行',
    colId: 'id',
    colSolver: '求解器',
    colIterations: '迭代',
    colDuration: '时间(ms)',
    colSuccess: '成功',
    colResidual: '残差',
    successYes: '是',
    successNo: '否',
    statsTotal: '总计',
    statsAvg: '平均',
    statsFailures: '失败',
    statsItems: '项目',
    addConstraintCheck: '添加约束检查',
    constraintResults: '约束结果',
    constraintPass: '通过',
    constraintFail: '失败',
    constraintMassLabel: '总质量限制(g)',
    constraintPartCountLabel: '零件数限制',
  },
  es: {
    title: 'Lote de solver',
    description: 'Ejecuta múltiples ensamblajes en paralelo y compara los resultados.',
    runButton: 'Ejecutar lote',
    running: 'Ejecutando...',
    resetButton: 'Reiniciar',
    noResults: 'Aún no hay resultados',
    errorRunning: 'Error al ejecutar el lote',
    emptyItems: 'No hay elementos para ejecutar',
    maxParallelLabel: 'maxParalelo',
    colId: 'id',
    colSolver: 'solver',
    colIterations: 'iteraciones',
    colDuration: 'duración (ms)',
    colSuccess: 'éxito',
    colResidual: 'residual',
    successYes: 'sí',
    successNo: 'no',
    statsTotal: 'total',
    statsAvg: 'promedio',
    statsFailures: 'fallos',
    statsItems: 'elementos',
    addConstraintCheck: 'Añadir verificación de restricciones',
    constraintResults: 'restricciones',
    constraintPass: 'aprobado',
    constraintFail: 'fallido',
    constraintMassLabel: 'límite de masa total (g)',
    constraintPartCountLabel: 'límite de piezas',
  },
  ar: {
    title: 'تشغيل دفعة المحلل',
    description: 'تشغيل عدة عمليات حل تجميع بالتوازي ومقارنة النتائج.',
    runButton: 'تشغيل الدفعة',
    running: 'قيد التشغيل...',
    resetButton: 'إعادة تعيين',
    noResults: 'لا توجد نتائج بعد',
    errorRunning: 'فشل تشغيل الدفعة',
    emptyItems: 'لا توجد عناصر للتشغيل',
    maxParallelLabel: 'أقصى توازٍ',
    colId: 'المعرّف',
    colSolver: 'المحلل',
    colIterations: 'التكرارات',
    colDuration: 'المدة (مللي ث)',
    colSuccess: 'نجاح',
    colResidual: 'المتبقي',
    successYes: 'نعم',
    successNo: 'لا',
    statsTotal: 'الإجمالي',
    statsAvg: 'المتوسط',
    statsFailures: 'الإخفاقات',
    statsItems: 'العناصر',
    addConstraintCheck: 'إضافة فحص القيود',
    constraintResults: 'نتائج القيود',
    constraintPass: 'نجاح',
    constraintFail: 'فشل',
    constraintMassLabel: 'حد الكتلة الإجمالي (g)',
    constraintPartCountLabel: 'حد عدد الأجزاء',
  },
};

// ─── slider bounds ─────────────────────────────────────────────────────────

/**
 * Slider range for `maxParallel`. The lower bound 1 mirrors solveBatch's
 * own clamp (`Math.max(1, …)`) — values < 1 would otherwise silently
 * become 1 inside the driver. The upper bound 8 is a UX cap: more than 8
 * concurrent items would saturate `navigator.hardwareConcurrency` on most
 * client machines (and under the Phase-1 single-thread reality check,
 * extra parallelism has zero wall-clock benefit anyway — see solverBatch.ts
 * header).
 *
 * Default 4 mirrors the driver's `DEFAULT_MAX_PARALLEL`.
 */
export const MAX_PARALLEL_MIN = 1;
export const MAX_PARALLEL_MAX = 8;
export const MAX_PARALLEL_DEFAULT = 4;

// ─── public props ──────────────────────────────────────────────────────────

export interface SolverBatchPanelProps {
  lang: SolverBatchLang;
  /** Batch items to solve. Empty → button disabled + "no items" hint. */
  items: ReadonlyArray<BatchSolveItem>;
  /**
   * Test seam — overriding the run callback lets tests assert the panel
   * wiring without paying for real solver work. Defaults to `solveBatch`.
   */
  onRun?: (
    items: ReadonlyArray<BatchSolveItem>,
    opts: SolveBatchOptions,
  ) => Promise<BatchSolveResult[]>;
}

interface BatchStats {
  totalMs: number;
  avgMs: number;
  failures: number;
  itemCount: number;
}

// ─── component ─────────────────────────────────────────────────────────────

export function SolverBatchPanel({
  lang,
  items,
  onRun,
}: SolverBatchPanelProps): React.ReactElement {
  const dict = DICT[lang];
  const [results, setResults] = useState<ReadonlyArray<BatchSolveResult>>([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxParallel, setMaxParallel] = useState<number>(MAX_PARALLEL_DEFAULT);

  // Cache the items array passed in at click time. Without this, a parent
  // that mutates `items` between Run click and result render would surface
  // the wrong solver in the results table.
  const [solvedItems, setSolvedItems] = useState<
    ReadonlyArray<BatchSolveItem>
  >([]);

  // ─── constraint check bolt-on (toggle defaults off — zero regression on
  //     existing batch UX) ─────────────────────────────────────────────────
  const [constraintCheckEnabled, setConstraintCheckEnabled] = useState(false);
  const [massLimitInput, setMassLimitInput] = useState('1000');
  const [partCountLimitInput, setPartCountLimitInput] = useState('50');
  // Snapshot of the constraints used for the most recent run, so the result
  // column stays accurate even if the user edits inputs after solving.
  const [resultConstraintChecks, setResultConstraintChecks] = useState<
    ReadonlyArray<ConstraintCheckResult | null>
  >([]);

  const handleRun = useCallback(async () => {
    if (items.length === 0) return;
    setRunning(true);
    setError(null);
    const snapshot = items;
    // Build the constraint list ONCE per Run so each item is checked
    // against the same set. Inputs are parsed defensively — a non-finite
    // value skips the constraint entirely (rather than poisoning the
    // checker with NaN, which would silently pass numeric comparisons).
    let constraints: ReadonlyArray<AssemblyConstraint> = [];
    if (constraintCheckEnabled) {
      const built: AssemblyConstraint[] = [];
      const mass = Number(massLimitInput);
      if (Number.isFinite(mass) && mass > 0) {
        built.push({ kind: 'total_mass_limit', maxGrams: mass });
      }
      const partCount = Number(partCountLimitInput);
      if (Number.isFinite(partCount) && partCount >= 0) {
        built.push({ kind: 'part_count_limit', max: Math.floor(partCount) });
      }
      constraints = built;
    }
    try {
      const runFn = onRun ?? solveBatch;
      const next = await runFn(snapshot, { maxParallel });
      setResults(next);
      setSolvedItems(snapshot);
      // Compute constraint check per result. We check against the SOLVED
      // state (next[i].result.state) so post-solve part positions feed
      // bbox-aware constraints when those are added later. Toggle off →
      // map of nulls so the result column stays absent (no regression).
      if (constraintCheckEnabled && constraints.length > 0) {
        const checks: (ConstraintCheckResult | null)[] = next.map((r) => {
          try {
            return checkAssemblyConstraints(r.result.state, constraints, {});
          } catch {
            // Defensive: the checker is pure but a malformed state could
            // surface here once additional kinds are wired in. Treat as
            // "no result" rather than blowing up the whole batch row.
            return null;
          }
        });
        setResultConstraintChecks(checks);
      } else {
        setResultConstraintChecks(next.map(() => null));
      }
    } catch (e) {
      // Surface the message but keep the panel functional — Run again is
      // the expected recovery path. Matches SolverBenchmarkPanel UX.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [
    items,
    onRun,
    maxParallel,
    constraintCheckEnabled,
    massLimitInput,
    partCountLimitInput,
  ]);

  const handleReset = useCallback(() => {
    setResults([]);
    setSolvedItems([]);
    setError(null);
    setResultConstraintChecks([]);
  }, []);

  const handleSliderChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const v = Number(e.target.value);
      if (Number.isFinite(v)) {
        // Clamp defensively — the slider's own min/max should keep us in
        // range, but a manual `value=` set (or a future numeric input)
        // could feed us anything.
        const clamped = Math.max(
          MAX_PARALLEL_MIN,
          Math.min(MAX_PARALLEL_MAX, Math.round(v)),
        );
        setMaxParallel(clamped);
      }
    },
    [],
  );

  const stats: BatchStats = useMemo(() => {
    if (results.length === 0) {
      return { totalMs: 0, avgMs: 0, failures: 0, itemCount: 0 };
    }
    let total = 0;
    let failures = 0;
    for (const r of results) {
      total += r.durationMs;
      if (!r.result.success) failures++;
    }
    return {
      totalMs: total,
      avgMs: total / results.length,
      failures,
      itemCount: results.length,
    };
  }, [results]);

  const solverById = useMemo(() => {
    // Build an index-based lookup so we can render the solver choice next
    // to each result. BatchSolveResult only carries `id` + numbers; the
    // solver choice lives on the input item. We index by position, NOT
    // by id, because solveBatch doesn't dedupe ids (per its docstring).
    const map = new Map<number, BatchSolveItem>();
    solvedItems.forEach((item, i) => map.set(i, item));
    return map;
  }, [solvedItems]);

  const itemsEmpty = items.length === 0;

  return (
    <section
      data-testid="solver-batch-panel"
      style={{
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
        background: 'var(--nx-panel)',
        border: '1px solid var(--nx-border)',
        borderRadius: 6,
        maxWidth: '100%',
        overflow: 'auto',
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2
          data-testid="solver-batch-title"
          style={{ margin: 0, fontSize: 16, fontWeight: 600, color: 'var(--nx-text)' }}
        >
          {dict.title}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--nx-text-2)' }}>
          {dict.description}
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 16,
          marginBottom: 12,
          flexWrap: 'wrap',
          alignItems: 'center',
        }}
      >
        <button
          type="button"
          data-testid="solver-batch-run"
          onClick={handleRun}
          disabled={running || itemsEmpty}
          style={{
            padding: '6px 12px',
            background: running || itemsEmpty ? '#9ca3af' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            cursor: running || itemsEmpty ? 'not-allowed' : 'pointer',
          }}
        >
          {running ? dict.running : dict.runButton}
        </button>

        <button
          type="button"
          data-testid="solver-batch-reset"
          onClick={handleReset}
          disabled={results.length === 0 && error === null}
          style={{
            padding: '6px 12px',
            background:
              results.length === 0 && error === null ? 'var(--nx-panel-2)' : '#6b7280',
            color: results.length === 0 && error === null ? 'var(--nx-text-2)' : '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            cursor:
              results.length === 0 && error === null ? 'not-allowed' : 'pointer',
          }}
        >
          {dict.resetButton}
        </button>

        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            fontSize: 12,
            color: 'var(--nx-text-2)',
          }}
        >
          <span data-testid="solver-batch-maxparallel-label">
            {dict.maxParallelLabel}
          </span>
          <input
            type="range"
            data-testid="solver-batch-maxparallel-slider"
            min={MAX_PARALLEL_MIN}
            max={MAX_PARALLEL_MAX}
            step={1}
            value={maxParallel}
            onChange={handleSliderChange}
            disabled={running}
            style={{ width: 140 }}
          />
          <span
            data-testid="solver-batch-maxparallel-value"
            style={{
              minWidth: 20,
              textAlign: 'right',
              fontVariantNumeric: 'tabular-nums',
              fontWeight: 600,
            }}
          >
            {maxParallel}
          </span>
        </label>

        {running && (
          <span
            data-testid="solver-batch-spinner"
            role="status"
            aria-label={dict.running}
            style={{
              display: 'inline-block',
              width: 14,
              height: 14,
              borderRadius: '50%',
              border: '2px solid var(--nx-border)',
              borderTopColor: '#2563eb',
              animation: 'solver-batch-spin 0.8s linear infinite',
            }}
          />
        )}
      </div>

      {/* Inline keyframes — keeps the panel self-contained so consumers
          don't need a stylesheet wired up. */}
      <style>{`@keyframes solver-batch-spin { to { transform: rotate(360deg); } }`}</style>

      {/* Constraint check bolt-on. Toggle defaults OFF; when OFF the form
          and the per-row column never render so existing UX is byte-for-byte
          identical. */}
      <div
        style={{
          marginBottom: 12,
          fontSize: 12,
          color: 'var(--nx-text-2)',
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
        }}
      >
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            cursor: 'pointer',
          }}
        >
          <input
            type="checkbox"
            data-testid="batch-constraint-toggle"
            checked={constraintCheckEnabled}
            onChange={(e) => setConstraintCheckEnabled(e.target.checked)}
            disabled={running}
          />
          <span>{dict.addConstraintCheck}</span>
        </label>
        {constraintCheckEnabled && (
          <div
            data-testid="batch-constraint-form"
            style={{
              display: 'flex',
              gap: 12,
              flexWrap: 'wrap',
              padding: '8px 10px',
              background: 'var(--nx-panel-2)',
              border: '1px solid var(--nx-border)',
              borderRadius: 4,
            }}
          >
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span>{dict.constraintMassLabel}</span>
              <input
                type="number"
                data-testid="batch-constraint-mass-input"
                value={massLimitInput}
                onChange={(e) => setMassLimitInput(e.target.value)}
                disabled={running}
                min={0}
                step={1}
                style={{
                  width: 90,
                  padding: '2px 4px',
                  border: '1px solid var(--nx-border)',
                  borderRadius: 3,
                  fontSize: 12,
                }}
              />
            </label>
            <label
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
            >
              <span>{dict.constraintPartCountLabel}</span>
              <input
                type="number"
                data-testid="batch-constraint-partcount-input"
                value={partCountLimitInput}
                onChange={(e) => setPartCountLimitInput(e.target.value)}
                disabled={running}
                min={0}
                step={1}
                style={{
                  width: 90,
                  padding: '2px 4px',
                  border: '1px solid var(--nx-border)',
                  borderRadius: 3,
                  fontSize: 12,
                }}
              />
            </label>
          </div>
        )}
      </div>

      {itemsEmpty && (
        <div
          data-testid="solver-batch-empty-items"
          style={{
            padding: '8px 12px',
            background: '#fef3c7',
            color: '#92400e',
            border: '1px solid #fde68a',
            borderRadius: 4,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {dict.emptyItems}
        </div>
      )}

      {error !== null && (
        <div
          data-testid="solver-batch-error"
          style={{
            padding: '8px 12px',
            background: '#fee2e2',
            color: '#b91c1c',
            border: '1px solid #fecaca',
            borderRadius: 4,
            fontSize: 12,
            marginBottom: 12,
          }}
        >
          {dict.errorRunning}: {error}
        </div>
      )}

      {results.length === 0 ? (
        <div
          data-testid="solver-batch-empty"
          style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--nx-text-2)',
            fontSize: 13,
            background: 'var(--nx-panel-2)',
            border: '1px dashed var(--nx-border)',
            borderRadius: 4,
          }}
        >
          {dict.noResults}
        </div>
      ) : (
        <>
          <div
            data-testid="solver-batch-stats"
            style={{
              marginBottom: 8,
              fontSize: 12,
              color: 'var(--nx-text-2)',
              fontWeight: 500,
              display: 'flex',
              gap: 16,
              flexWrap: 'wrap',
            }}
          >
            <span data-testid="solver-batch-stats-items">
              {dict.statsItems}: {stats.itemCount}
            </span>
            <span data-testid="solver-batch-stats-total">
              {dict.statsTotal}: {stats.totalMs.toFixed(3)} ms
            </span>
            <span data-testid="solver-batch-stats-avg">
              {dict.statsAvg}: {stats.avgMs.toFixed(3)} ms
            </span>
            <span
              data-testid="solver-batch-stats-failures"
              style={{
                color: stats.failures > 0 ? '#b91c1c' : '#16a34a',
                fontWeight: 600,
              }}
            >
              {dict.statsFailures}: {stats.failures}
            </span>
          </div>

          <table
            data-testid="solver-batch-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ background: 'var(--nx-panel-2)' }}>
                <th style={th}>{dict.colId}</th>
                <th style={th}>{dict.colSolver}</th>
                <th style={th}>{dict.colIterations}</th>
                <th style={th}>{dict.colDuration}</th>
                <th style={th}>{dict.colSuccess}</th>
                <th style={th}>{dict.colResidual}</th>
                {constraintCheckEnabled && (
                  <th
                    style={th}
                    data-testid="batch-result-constraints-header"
                  >
                    {dict.constraintResults}
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {results.map((r, i) => {
                const solver = solverById.get(i)?.solver ?? '—';
                const ok = r.result.success;
                // Row keys must be stable across re-renders. Index alone
                // is fine because `results` is replaced wholesale on each
                // Run; id can repeat across rows (BatchSolveItem doesn't
                // require uniqueness) so we suffix the index.
                return (
                  <tr
                    key={`${r.id}-${i}`}
                    data-testid={`solver-batch-row-${i}`}
                    data-row-id={r.id}
                    data-row-solver={solver}
                  >
                    <td style={td}>{r.id}</td>
                    <td style={td}>{solver}</td>
                    <td style={td}>{r.result.iterations}</td>
                    <td style={td}>{r.durationMs.toFixed(3)}</td>
                    <td
                      style={{
                        ...td,
                        color: ok ? '#16a34a' : '#b91c1c',
                        fontWeight: 600,
                      }}
                      data-testid={`solver-batch-success-${i}`}
                      data-success={ok ? 'true' : 'false'}
                    >
                      {ok ? dict.successYes : dict.successNo}
                    </td>
                    <td
                      style={td}
                      data-testid={`solver-batch-residual-${i}`}
                    >
                      {r.result.finalMaxResidual.toExponential(3)}
                    </td>
                    {constraintCheckEnabled && (() => {
                      const check = resultConstraintChecks[i] ?? null;
                      // Errors are the only "fail" signal — warnings do
                      // not flip ok=false in the checker either, so we keep
                      // the binary classification consistent. The failCount
                      // exposes the raw number for the UI badge.
                      const failCount = check
                        ? check.violations.filter(
                            (v) => v.severity === 'error',
                          ).length
                        : 0;
                      const passed = check?.ok ?? false;
                      return (
                        <td
                          style={{
                            ...td,
                            color: passed ? '#16a34a' : '#b91c1c',
                            fontWeight: 600,
                          }}
                          data-testid={`batch-result-constraints-${i}`}
                          data-constraint-pass={passed ? 'true' : 'false'}
                          data-constraint-fail-count={failCount}
                        >
                          {passed
                            ? dict.constraintPass
                            : `${dict.constraintFail} (${failCount})`}
                        </td>
                      );
                    })()}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}

export default SolverBatchPanel;

// ─── helpers ───────────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--nx-border)',
  textAlign: 'left',
  fontWeight: 600,
  color: 'var(--nx-text-2)',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid var(--nx-border)',
  color: 'var(--nx-text)',
  whiteSpace: 'nowrap',
};
