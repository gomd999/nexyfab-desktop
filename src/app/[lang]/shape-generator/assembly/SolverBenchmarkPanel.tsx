'use client';

/**
 * SolverBenchmarkPanel — Phase 3.2.3 dev/debug UI for the solver
 * benchmark harness (ADR-013).
 *
 * Renders a "Run benchmarks" button and a results table comparing
 * iterativeSolve (Gauss-Seidel) against lagrangianSolve (Newton-LM) on
 * a set of canned scenarios. The panel is fully standalone — it accepts
 * an `onRun` callback (so the host route can decide which scenario set
 * to feed and avoid pulling the heavy solverBenchmark module into this
 * file) and an optional `initialResults` for SSR / fixture seeding.
 *
 * The table columns mirror the BenchmarkResult shape from
 * solverBenchmark.ts:
 *   scenario / GS iter / GS ms / GS ok / Lag iter / Lag ms / Lag ok /
 *   winner / ratio
 *
 * Winner cell colour mapping (deliberately distinguishable for
 * red/green colour-blind users — we pair colour with the label text):
 *   gauss_seidel  → blue   (#2563eb bg, white fg)
 *   lagrangian    → green  (#16a34a bg, white fg)
 *   tie           → grey   (#9ca3af bg, white fg)
 *
 * A finalResidual > the per-solver tolerance is shown in red so the
 * convergence-failure cases jump out at a glance.
 *
 * CSV export format: header row + one row per result, all numeric
 * fields written with .toString() (no fixed precision so we round-trip
 * losslessly into spreadsheets). Columns match the on-screen table.
 *
 * 6-lang i18n: ko / en / ja / zh / es / ar — matches the AssemblyBrowser
 * page-shell convention (see _content.tsx normalizeLang).
 */

import * as React from 'react';
import { useCallback, useMemo, useState } from 'react';
import type { BenchmarkResult } from '@/lib/assembly/solverBenchmark';

// ─── i18n ──────────────────────────────────────────────────────────────────

export type SolverBenchmarkLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface PanelDict {
  title: string;
  description: string;
  runButton: string;
  running: string;
  resetButton: string;
  exportCsvButton: string;
  noResults: string;
  errorRunning: string;
  // Table columns
  colScenario: string;
  colGsIter: string;
  colGsMs: string;
  colGsOk: string;
  colLagIter: string;
  colLagMs: string;
  colLagOk: string;
  colWinner: string;
  colRatio: string;
  // Boolean cells
  okYes: string;
  okNo: string;
  // Winner labels (mirror the union from solverBenchmark.ts)
  winnerGaussSeidel: string;
  winnerLagrangian: string;
  winnerTie: string;
  // Summary
  summaryTemplate: string; // {gs} / {lag} / {tie} / {total}
}

const DICT: Record<SolverBenchmarkLang, PanelDict> = {
  ko: {
    title: '솔버 벤치마크',
    description: 'Gauss-Seidel과 Lagrangian 솔버를 비교합니다.',
    runButton: '벤치마크 실행',
    running: '실행 중...',
    resetButton: '초기화',
    exportCsvButton: 'CSV 내보내기',
    noResults: '아직 결과가 없습니다',
    errorRunning: '벤치마크 실행 중 오류가 발생했습니다',
    colScenario: '시나리오',
    colGsIter: 'GS 반복',
    colGsMs: 'GS ms',
    colGsOk: 'GS 성공',
    colLagIter: 'Lag 반복',
    colLagMs: 'Lag ms',
    colLagOk: 'Lag 성공',
    colWinner: '승자',
    colRatio: '비율',
    okYes: '예',
    okNo: '아니오',
    winnerGaussSeidel: 'Gauss-Seidel',
    winnerLagrangian: 'Lagrangian',
    winnerTie: '무승부',
    summaryTemplate: 'GS {gs}/{total} 승, Lag {lag}/{total} 승, 무승부 {tie}/{total}',
  },
  en: {
    title: 'Solver benchmark',
    description: 'Compares the Gauss-Seidel and Lagrangian solvers side-by-side.',
    runButton: 'Run benchmarks',
    running: 'Running...',
    resetButton: 'Reset',
    exportCsvButton: 'Export CSV',
    noResults: 'No results yet',
    errorRunning: 'Benchmark run failed',
    colScenario: 'scenario',
    colGsIter: 'GS iter',
    colGsMs: 'GS ms',
    colGsOk: 'GS ok',
    colLagIter: 'Lag iter',
    colLagMs: 'Lag ms',
    colLagOk: 'Lag ok',
    colWinner: 'winner',
    colRatio: 'ratio',
    okYes: 'yes',
    okNo: 'no',
    winnerGaussSeidel: 'Gauss-Seidel',
    winnerLagrangian: 'Lagrangian',
    winnerTie: 'tie',
    summaryTemplate: 'GS wins {gs}/{total}, Lag wins {lag}/{total}, tie {tie}/{total}',
  },
  ja: {
    title: 'ソルバーベンチマーク',
    description: 'Gauss-SeidelとLagrangianソルバーを比較します。',
    runButton: 'ベンチマーク実行',
    running: '実行中...',
    resetButton: 'リセット',
    exportCsvButton: 'CSVエクスポート',
    noResults: 'まだ結果がありません',
    errorRunning: 'ベンチマーク実行中にエラーが発生しました',
    colScenario: 'シナリオ',
    colGsIter: 'GS 反復',
    colGsMs: 'GS ms',
    colGsOk: 'GS 成功',
    colLagIter: 'Lag 反復',
    colLagMs: 'Lag ms',
    colLagOk: 'Lag 成功',
    colWinner: '勝者',
    colRatio: '比率',
    okYes: 'はい',
    okNo: 'いいえ',
    winnerGaussSeidel: 'Gauss-Seidel',
    winnerLagrangian: 'Lagrangian',
    winnerTie: '引き分け',
    summaryTemplate: 'GS {gs}/{total} 勝, Lag {lag}/{total} 勝, 引き分け {tie}/{total}',
  },
  zh: {
    title: '求解器基准测试',
    description: '并排比较 Gauss-Seidel 和 Lagrangian 求解器。',
    runButton: '运行基准测试',
    running: '运行中...',
    resetButton: '重置',
    exportCsvButton: '导出 CSV',
    noResults: '尚无结果',
    errorRunning: '基准测试运行失败',
    colScenario: '场景',
    colGsIter: 'GS 迭代',
    colGsMs: 'GS ms',
    colGsOk: 'GS 成功',
    colLagIter: 'Lag 迭代',
    colLagMs: 'Lag ms',
    colLagOk: 'Lag 成功',
    colWinner: '获胜者',
    colRatio: '比率',
    okYes: '是',
    okNo: '否',
    winnerGaussSeidel: 'Gauss-Seidel',
    winnerLagrangian: 'Lagrangian',
    winnerTie: '平局',
    summaryTemplate: 'GS 胜 {gs}/{total}, Lag 胜 {lag}/{total}, 平局 {tie}/{total}',
  },
  es: {
    title: 'Banco de pruebas de solver',
    description: 'Compara los solvers Gauss-Seidel y Lagrangian lado a lado.',
    runButton: 'Ejecutar pruebas',
    running: 'Ejecutando...',
    resetButton: 'Reiniciar',
    exportCsvButton: 'Exportar CSV',
    noResults: 'Aún no hay resultados',
    errorRunning: 'Error al ejecutar las pruebas',
    colScenario: 'escenario',
    colGsIter: 'GS iter',
    colGsMs: 'GS ms',
    colGsOk: 'GS ok',
    colLagIter: 'Lag iter',
    colLagMs: 'Lag ms',
    colLagOk: 'Lag ok',
    colWinner: 'ganador',
    colRatio: 'razón',
    okYes: 'sí',
    okNo: 'no',
    winnerGaussSeidel: 'Gauss-Seidel',
    winnerLagrangian: 'Lagrangian',
    winnerTie: 'empate',
    summaryTemplate: 'GS gana {gs}/{total}, Lag gana {lag}/{total}, empate {tie}/{total}',
  },
  ar: {
    title: 'اختبار أداء المحلل',
    description: 'يقارن بين محلل Gauss-Seidel ومحلل Lagrangian جنبًا إلى جنب.',
    runButton: 'تشغيل الاختبارات',
    running: 'قيد التشغيل...',
    resetButton: 'إعادة تعيين',
    exportCsvButton: 'تصدير CSV',
    noResults: 'لا توجد نتائج بعد',
    errorRunning: 'فشل تشغيل اختبار الأداء',
    colScenario: 'السيناريو',
    colGsIter: 'GS تكرار',
    colGsMs: 'GS ms',
    colGsOk: 'GS نجاح',
    colLagIter: 'Lag تكرار',
    colLagMs: 'Lag ms',
    colLagOk: 'Lag نجاح',
    colWinner: 'الفائز',
    colRatio: 'النسبة',
    okYes: 'نعم',
    okNo: 'لا',
    winnerGaussSeidel: 'Gauss-Seidel',
    winnerLagrangian: 'Lagrangian',
    winnerTie: 'تعادل',
    summaryTemplate: 'فاز GS بـ {gs}/{total} و Lag بـ {lag}/{total} وتعادل {tie}/{total}',
  },
};

// ─── tolerances (mirror solverBenchmark.ts internal constants) ─────────────

/**
 * Per-solver tolerances mirror the constants in `benchmarkOne` inside
 * solverBenchmark.ts. We need them here so the table can colour any
 * `finalResidual > tolerance` cell red without depending on the
 * benchmark module exposing them.
 */
const GS_TOLERANCE = 1e-4;
const LAG_TOLERANCE = 1e-6;

// ─── public props ──────────────────────────────────────────────────────────

export interface SolverBenchmarkPanelProps {
  lang: SolverBenchmarkLang;
  /**
   * Run callback — the parent triggers the benchmark (typically
   * `runScenarios(buildDefaultScenarios())`) and resolves with the
   * results. The panel awaits the promise and stores them in state.
   */
  onRun: () => Promise<ReadonlyArray<BenchmarkResult>>;
  /**
   * Optionally pre-populated results (skip the "click to run" cycle —
   * useful when the host already cached a recent run).
   */
  initialResults?: ReadonlyArray<BenchmarkResult>;
}

// ─── component ─────────────────────────────────────────────────────────────

export function SolverBenchmarkPanel({
  lang,
  onRun,
  initialResults,
}: SolverBenchmarkPanelProps): React.ReactElement {
  const dict = DICT[lang];
  const [results, setResults] = useState<ReadonlyArray<BenchmarkResult>>(
    initialResults ?? [],
  );
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = useCallback(async () => {
    setRunning(true);
    setError(null);
    try {
      const next = await onRun();
      setResults(next);
    } catch (e) {
      // Surface the message but keep the panel functional — clicking
      // Run again is the expected recovery.
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }, [onRun]);

  const handleReset = useCallback(() => {
    setResults([]);
    setError(null);
  }, []);

  const handleExportCsv = useCallback(() => {
    if (results.length === 0) return;
    const csv = buildCsv(results);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    // Trigger a download via a transient anchor — same trick the
    // drawing page uses for PNG/JSON export.
    const a = document.createElement('a');
    a.href = url;
    a.download = 'solver-benchmark.csv';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Hand the URL back to the GC. Defer one tick so the click has a
    // chance to commit before we tear the blob down.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }, [results]);

  const summary = useMemo(() => {
    let gs = 0;
    let lag = 0;
    let tie = 0;
    for (const r of results) {
      if (r.winner === 'gauss_seidel') gs++;
      else if (r.winner === 'lagrangian') lag++;
      else tie++;
    }
    // Use replaceAll so {total} (which appears 3× in the template) is
    // substituted everywhere — String#replace only hits the first match.
    return dict.summaryTemplate
      .replaceAll('{gs}', String(gs))
      .replaceAll('{lag}', String(lag))
      .replaceAll('{tie}', String(tie))
      .replaceAll('{total}', String(results.length));
  }, [results, dict.summaryTemplate]);

  return (
    <section
      data-testid="solver-benchmark-panel"
      style={{
        padding: 16,
        fontFamily: 'system-ui, sans-serif',
        background: '#fff',
        border: '1px solid #d1d5db',
        borderRadius: 6,
        maxWidth: '100%',
        overflow: 'auto',
      }}
    >
      <header style={{ marginBottom: 12 }}>
        <h2
          data-testid="solver-benchmark-title"
          style={{ margin: 0, fontSize: 16, fontWeight: 600, color: '#111827' }}
        >
          {dict.title}
        </h2>
        <p style={{ margin: '4px 0 0', fontSize: 12, color: '#6b7280' }}>
          {dict.description}
        </p>
      </header>

      <div
        style={{
          display: 'flex',
          gap: 8,
          marginBottom: 12,
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          data-testid="solver-benchmark-run"
          onClick={handleRun}
          disabled={running}
          style={{
            padding: '6px 12px',
            background: running ? '#9ca3af' : '#2563eb',
            color: '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            cursor: running ? 'not-allowed' : 'pointer',
          }}
        >
          {running ? dict.running : dict.runButton}
        </button>
        <button
          type="button"
          data-testid="solver-benchmark-export-csv"
          onClick={handleExportCsv}
          disabled={results.length === 0}
          style={{
            padding: '6px 12px',
            background: results.length === 0 ? '#e5e7eb' : '#16a34a',
            color: results.length === 0 ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            cursor: results.length === 0 ? 'not-allowed' : 'pointer',
          }}
        >
          {dict.exportCsvButton}
        </button>
        <button
          type="button"
          data-testid="solver-benchmark-reset"
          onClick={handleReset}
          disabled={results.length === 0 && error === null}
          style={{
            padding: '6px 12px',
            background: results.length === 0 && error === null ? '#e5e7eb' : '#6b7280',
            color: results.length === 0 && error === null ? '#9ca3af' : '#fff',
            border: 'none',
            borderRadius: 4,
            fontSize: 12,
            cursor:
              results.length === 0 && error === null ? 'not-allowed' : 'pointer',
          }}
        >
          {dict.resetButton}
        </button>
      </div>

      {error !== null && (
        <div
          data-testid="solver-benchmark-error"
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
          data-testid="solver-benchmark-empty"
          style={{
            padding: 24,
            textAlign: 'center',
            color: '#6b7280',
            fontSize: 13,
            background: '#f9fafb',
            border: '1px dashed #d1d5db',
            borderRadius: 4,
          }}
        >
          {dict.noResults}
        </div>
      ) : (
        <>
          <div
            data-testid="solver-benchmark-summary"
            style={{
              marginBottom: 8,
              fontSize: 12,
              color: '#374151',
              fontWeight: 500,
            }}
          >
            {summary}
          </div>
          <table
            data-testid="solver-benchmark-table"
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: 12,
            }}
          >
            <thead>
              <tr style={{ background: '#f3f4f6' }}>
                <th style={th}>{dict.colScenario}</th>
                <th style={th}>{dict.colGsIter}</th>
                <th style={th}>{dict.colGsMs}</th>
                <th style={th}>{dict.colGsOk}</th>
                <th style={th}>{dict.colLagIter}</th>
                <th style={th}>{dict.colLagMs}</th>
                <th style={th}>{dict.colLagOk}</th>
                <th style={th}>{dict.colWinner}</th>
                <th style={th}>{dict.colRatio}</th>
              </tr>
            </thead>
            <tbody>
              {results.map((r) => {
                const gsFailedResidual = r.gaussSeidel.finalResidual > GS_TOLERANCE;
                const lagFailedResidual = r.lagrangian.finalResidual > LAG_TOLERANCE;
                return (
                  <tr
                    key={r.scenario}
                    data-testid={`solver-benchmark-row-${r.scenario}`}
                  >
                    <td style={td}>{r.scenario}</td>
                    <td style={td}>{r.gaussSeidel.iterations}</td>
                    <td style={td}>{r.gaussSeidel.durationMs.toFixed(3)}</td>
                    <td
                      style={{
                        ...td,
                        color: gsFailedResidual ? '#b91c1c' : '#111827',
                        fontWeight: gsFailedResidual ? 600 : 400,
                      }}
                      data-testid={`solver-benchmark-gs-ok-${r.scenario}`}
                      data-failed={gsFailedResidual ? 'true' : 'false'}
                    >
                      {r.gaussSeidel.success ? dict.okYes : dict.okNo}
                    </td>
                    <td style={td}>{r.lagrangian.iterations}</td>
                    <td style={td}>{r.lagrangian.durationMs.toFixed(3)}</td>
                    <td
                      style={{
                        ...td,
                        color: lagFailedResidual ? '#b91c1c' : '#111827',
                        fontWeight: lagFailedResidual ? 600 : 400,
                      }}
                      data-testid={`solver-benchmark-lag-ok-${r.scenario}`}
                      data-failed={lagFailedResidual ? 'true' : 'false'}
                    >
                      {r.lagrangian.success ? dict.okYes : dict.okNo}
                    </td>
                    <td
                      style={{
                        ...td,
                        ...winnerCellStyle(r.winner),
                      }}
                      data-testid={`solver-benchmark-winner-${r.scenario}`}
                      data-winner={r.winner}
                    >
                      {winnerLabel(r.winner, dict)}
                    </td>
                    <td style={td}>
                      {Number.isFinite(r.ratio) ? r.ratio.toFixed(3) : '∞'}
                    </td>
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

export default SolverBenchmarkPanel;

// ─── helpers ───────────────────────────────────────────────────────────────

const th: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #d1d5db',
  textAlign: 'left',
  fontWeight: 600,
  color: '#374151',
  whiteSpace: 'nowrap',
};

const td: React.CSSProperties = {
  padding: '6px 8px',
  borderBottom: '1px solid #e5e7eb',
  color: '#111827',
  whiteSpace: 'nowrap',
};

/**
 * Winner cell background/foreground colour mapping. The label text is
 * intentionally redundant with the colour so red/green colour-blind
 * users still get the information.
 *
 *   gauss_seidel → blue   (#2563eb / white)
 *   lagrangian   → green  (#16a34a / white)
 *   tie          → grey   (#9ca3af / white)
 */
function winnerCellStyle(
  winner: BenchmarkResult['winner'],
): React.CSSProperties {
  switch (winner) {
    case 'gauss_seidel':
      return { background: '#2563eb', color: '#fff', fontWeight: 600 };
    case 'lagrangian':
      return { background: '#16a34a', color: '#fff', fontWeight: 600 };
    case 'tie':
      return { background: '#9ca3af', color: '#fff', fontWeight: 600 };
  }
}

function winnerLabel(
  winner: BenchmarkResult['winner'],
  dict: PanelDict,
): string {
  switch (winner) {
    case 'gauss_seidel':
      return dict.winnerGaussSeidel;
    case 'lagrangian':
      return dict.winnerLagrangian;
    case 'tie':
      return dict.winnerTie;
  }
}

/**
 * Serialise the benchmark results to a CSV string.
 *
 * Header row + one row per result. Columns mirror the on-screen table
 * (scenario, gs_iterations, gs_durationMs, gs_success, gs_finalResidual,
 * lag_iterations, lag_durationMs, lag_success, lag_finalResidual,
 * winner, ratio). We dump the raw numeric values via String() so
 * spreadsheet roundtrip is lossless — no fixed precision. Strings are
 * quoted with the standard CSV escape (double-quote any inner quote).
 */
export function buildCsv(results: ReadonlyArray<BenchmarkResult>): string {
  const header = [
    'scenario',
    'gs_iterations',
    'gs_durationMs',
    'gs_success',
    'gs_finalResidual',
    'lag_iterations',
    'lag_durationMs',
    'lag_success',
    'lag_finalResidual',
    'winner',
    'ratio',
  ];
  const lines: string[] = [header.join(',')];
  for (const r of results) {
    lines.push([
      csvQuote(r.scenario),
      String(r.gaussSeidel.iterations),
      String(r.gaussSeidel.durationMs),
      String(r.gaussSeidel.success),
      String(r.gaussSeidel.finalResidual),
      String(r.lagrangian.iterations),
      String(r.lagrangian.durationMs),
      String(r.lagrangian.success),
      String(r.lagrangian.finalResidual),
      csvQuote(r.winner),
      String(r.ratio),
    ].join(','));
  }
  // Trailing newline keeps Excel + POSIX `wc -l` happy.
  return lines.join('\n') + '\n';
}

function csvQuote(s: string): string {
  // RFC 4180 — wrap in double quotes if the cell contains a comma,
  // double-quote, or newline; double up any embedded double-quote.
  if (/[",\n\r]/.test(s)) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}
