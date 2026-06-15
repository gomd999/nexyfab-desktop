'use client';

/**
 * SketchExpressionsPanel — Phase 2.x of NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone UI for the parametric expression engine
 * (lib/sketch/sketchExpressions.ts):
 *   - A table of named variables; each row is `name = definition` where
 *     definition is any expression ("50", "width * 2", "90deg", "sin(pi/4)").
 *   - "Add variable" appends a fresh row. "Evaluate" runs the whole sheet
 *     through `evaluateAllVariables` (topological) and shows each resolved
 *     value or its error inline. A cycle banner surfaces circular refs from
 *     `detectCircularDependency`.
 *
 * Standalone-by-design:
 *   - NO dependency on planegcs / SketchSolver. Tests mount in jsdom without
 *     booting WASM. The engine is pure + eval-free (recursive-descent parser
 *     + builtin whitelist), so this panel never touches the live sketch —
 *     it's a scratchpad for working out dimension values before binding.
 *   - Does NOT modify sketchExpressions.ts or solver.ts.
 *
 * Test surface (data-testids):
 *   solver-sketch-expressions-panel
 *   solver-sketch-expressions-add
 *   solver-sketch-expressions-evaluate
 *   solver-sketch-expressions-empty
 *   solver-sketch-expressions-cycle           (banner, only when a cycle exists)
 *   solver-sketch-expressions-row-{key}
 *   solver-sketch-expressions-name-{key}
 *   solver-sketch-expressions-def-{key}
 *   solver-sketch-expressions-value-{key}      (resolved value or "—")
 *   solver-sketch-expressions-error-{key}      (only when that row failed)
 *   solver-sketch-expressions-delete-{key}
 */

import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  evaluateAllVariables,
  detectCircularDependency,
  type ExpressionContext,
  type ParametricVariable,
} from '@/lib/sketch/sketchExpressions';

// ─── i18n (6 langs) ────────────────────────────────────────────────────────

export type EditorLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  title: string;
  add: string;
  evaluate: string;
  empty: string;
  name: string;
  definition: string;
  value: string;
  delete: string;
  namePlaceholder: string;
  defPlaceholder: string;
  cycle: string;
  dupName: string;
  apply: string;
  applyHint: string;
}

const dict: Record<EditorLang, Dict> = {
  ko: {
    title: '파라메트릭 변수',
    add: '변수 추가', evaluate: '평가',
    empty: '변수가 없습니다',
    name: '이름', definition: '정의', value: '값', delete: '삭제',
    namePlaceholder: '예: width', defPlaceholder: '예: width * 2',
    cycle: '순환 참조',
    dupName: '이름 중복',
    apply: '적용', applyHint: '치수 제약을 먼저 선택하세요',
  },
  en: {
    title: 'Parametric Variables',
    add: 'Add variable', evaluate: 'Evaluate',
    empty: 'No variables yet',
    name: 'Name', definition: 'Definition', value: 'Value', delete: 'Delete',
    namePlaceholder: 'e.g. width', defPlaceholder: 'e.g. width * 2',
    cycle: 'Circular reference',
    dupName: 'Duplicate name',
    apply: 'Apply', applyHint: 'Select a dimensional constraint first',
  },
  ja: {
    title: 'パラメトリック変数',
    add: '変数を追加', evaluate: '評価',
    empty: '変数がありません',
    name: '名前', definition: '定義', value: '値', delete: '削除',
    namePlaceholder: '例: width', defPlaceholder: '例: width * 2',
    cycle: '循環参照',
    dupName: '名前の重複',
    apply: '適用', applyHint: '寸法拘束を先に選択してください',
  },
  zh: {
    title: '参数化变量',
    add: '添加变量', evaluate: '计算',
    empty: '尚无变量',
    name: '名称', definition: '定义', value: '值', delete: '删除',
    namePlaceholder: '例如 width', defPlaceholder: '例如 width * 2',
    cycle: '循环引用',
    dupName: '名称重复',
    apply: '应用', applyHint: '请先选择一个尺寸约束',
  },
  es: {
    title: 'Variables Paramétricas',
    add: 'Añadir variable', evaluate: 'Evaluar',
    empty: 'Sin variables',
    name: 'Nombre', definition: 'Definición', value: 'Valor', delete: 'Eliminar',
    namePlaceholder: 'ej. width', defPlaceholder: 'ej. width * 2',
    cycle: 'Referencia circular',
    dupName: 'Nombre duplicado',
    apply: 'Aplicar', applyHint: 'Selecciona primero una cota dimensional',
  },
  ar: {
    title: 'متغيرات معاملية',
    add: 'إضافة متغير', evaluate: 'تقييم',
    empty: 'لا توجد متغيرات بعد',
    name: 'الاسم', definition: 'التعريف', value: 'القيمة', delete: 'حذف',
    namePlaceholder: 'مثال: width', defPlaceholder: 'مثال: width * 2',
    cycle: 'مرجع دائري',
    dupName: 'اسم مكرر',
    apply: 'تطبيق', applyHint: 'اختر قيدًا بُعديًا أولاً',
  },
};

// ─── types ────────────────────────────────────────────────────────────────

/** One editable row. `key` is a stable internal id (survives name edits). */
interface VarRow {
  key: string;
  name: string;
  /** Raw definition text — any expression the engine accepts. */
  def: string;
}

/** Per-row evaluation outcome, keyed by row.name. */
interface RowResult {
  ok: boolean;
  value?: number;
  error?: string;
}

export interface SketchExpressionsPanelProps {
  lang?: EditorLang;
  /** Optional seed rows (mainly for tests / future constraint import). */
  initialRows?: ReadonlyArray<{ name: string; def: string }>;
  /**
   * When provided, each evaluated row shows an "Apply" button that pushes its
   * resolved value (canonical units: mm for length, rad for angle) onto the
   * host's currently-selected dimensional constraint. The host owns the
   * solver + selection.
   */
  onApply?: (varName: string, value: number) => void;
  /** Whether a dimensional constraint is currently selected in the host —
   *  gates the Apply buttons. */
  canApply?: boolean;
  /**
   * Live values of variables bound to a constraint (canonical units: mm /
   * rad), keyed by variable name. A bound row shows this value (with a 🔗
   * marker) instead of its evaluated one — this is the constraint→variable
   * half of the two-way binding (the variable mirrors the live constraint
   * even when the constraint is edited elsewhere). The host owns the binding
   * map and recomputes these from the solver snapshot.
   */
  boundValues?: Record<string, number>;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Round to at most 4 decimals and strip trailing zeros / -0. */
function fmt(n: number): string {
  if (!Number.isFinite(n)) return String(n);
  const r = Math.round(n * 1e4) / 1e4;
  const s = (Object.is(r, -0) ? 0 : r).toString();
  return s;
}

// ─── component ────────────────────────────────────────────────────────────

export default function SketchExpressionsPanel({
  lang = 'en',
  initialRows,
  onApply,
  canApply = false,
  boundValues,
}: SketchExpressionsPanelProps): React.ReactElement {
  const t = dict[lang];
  const counter = useRef<number>(0);
  const nextKey = useCallback((): string => `v${counter.current++}`, []);

  const [rows, setRows] = useState<VarRow[]>(() =>
    (initialRows ?? []).map((r) => ({ key: nextKey(), name: r.name, def: r.def })),
  );
  // Map row.key → evaluation result. Empty until the user hits Evaluate.
  const [results, setResults] = useState<Record<string, RowResult>>({});
  const [cycles, setCycles] = useState<string[][]>([]);

  const addRow = useCallback((): void => {
    setRows((prev) => [...prev, { key: nextKey(), name: '', def: '' }]);
  }, [nextKey]);

  const removeRow = useCallback((key: string): void => {
    setRows((prev) => prev.filter((r) => r.key !== key));
    setResults((prev) => {
      const { [key]: _drop, ...rest } = prev;
      return rest;
    });
  }, []);

  const setField = useCallback(
    (key: string, field: 'name' | 'def', value: string): void => {
      setRows((prev) =>
        prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)),
      );
    },
    [],
  );

  // Detect duplicate names up-front so we can flag them (Record would
  // otherwise silently collapse them into one variable).
  const dupNames = useMemo<Set<string>>(() => {
    const seen = new Set<string>();
    const dup = new Set<string>();
    for (const r of rows) {
      const nm = r.name.trim();
      if (!nm) continue;
      if (seen.has(nm)) dup.add(nm);
      seen.add(nm);
    }
    return dup;
  }, [rows]);

  const evaluate = useCallback((): void => {
    // Build the ExpressionContext from named rows. Every definition is fed
    // as an `expression` (a bare "50" parses to the number 50), so free vars
    // and computed vars share one path. Last write wins on duplicate names.
    const variables: Record<string, ParametricVariable> = {};
    const nameByKey = new Map<string, string>();
    for (const r of rows) {
      const nm = r.name.trim();
      if (!nm) continue;
      nameByKey.set(r.key, nm);
      variables[nm] = { id: nm, value: 0, expression: r.def.trim() };
    }
    const ctx: ExpressionContext = { variables };

    const evalResults = evaluateAllVariables(ctx);
    const byName = new Map(evalResults.map((e) => [e.variableId, e]));

    const next: Record<string, RowResult> = {};
    for (const r of rows) {
      const nm = nameByKey.get(r.key);
      if (!nm) continue;
      const e = byName.get(nm);
      if (!e) continue;
      next[r.key] = e.ok
        ? { ok: true, value: e.resolvedValue }
        : { ok: false, error: e.error };
    }
    setResults(next);
    setCycles(detectCircularDependency(ctx));
  }, [rows]);

  // ─── render ────────────────────────────────────────────────────────────

  return (
    <div
      data-testid="solver-sketch-expressions-panel"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        padding: 10,
        background: 'var(--nx-panel)',
        border: '1px solid var(--nx-border)',
        borderRadius: 6,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        color: 'var(--nx-text)',
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <h3 style={{ margin: 0, fontSize: 13, fontWeight: 600 }}>{t.title}</h3>
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            type="button"
            data-testid="solver-sketch-expressions-add"
            onClick={addRow}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: 'var(--nx-panel)', color: 'var(--nx-text)',
              border: '1px solid var(--nx-border)', borderRadius: 4, cursor: 'pointer',
            }}
          >
            {t.add}
          </button>
          <button
            type="button"
            data-testid="solver-sketch-expressions-evaluate"
            onClick={evaluate}
            disabled={rows.length === 0}
            style={{
              padding: '4px 10px', fontSize: 11,
              background: rows.length === 0 ? 'var(--nx-panel-2)' : '#0e7490',
              color: rows.length === 0 ? 'var(--nx-text-2)' : '#fff',
              border: '1px solid ' + (rows.length === 0 ? 'var(--nx-border)' : '#0e7490'),
              borderRadius: 4,
              cursor: rows.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {t.evaluate}
          </button>
        </div>
      </header>

      {cycles.length > 0 && (
        <div
          data-testid="solver-sketch-expressions-cycle"
          style={{
            fontSize: 11, color: '#b91c1c', background: '#fef2f2',
            border: '1px solid #fecaca', borderRadius: 4, padding: '4px 6px',
          }}
        >
          {t.cycle}: {cycles.map((c) => c.join(' → ')).join(', ')}
        </div>
      )}

      {rows.length === 0 ? (
        <div
          data-testid="solver-sketch-expressions-empty"
          style={{ fontSize: 11, color: 'var(--nx-text-2)', textAlign: 'center', padding: '8px 0' }}
        >
          {t.empty}
        </div>
      ) : (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {rows.map((r) => {
            const res = results[r.key];
            const isDup = r.name.trim() !== '' && dupNames.has(r.name.trim());
            // Constraint→variable half of the binding: a bound row mirrors the
            // live constraint value, overriding its own evaluated value.
            const boundVal = boundValues?.[r.name.trim()];
            const isBound = boundVal !== undefined;
            return (
              <li
                key={r.key}
                data-testid={`solver-sketch-expressions-row-${r.key}`}
                data-bound={isBound ? 'true' : 'false'}
                style={{ display: 'flex', flexDirection: 'column', gap: 2 }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <input
                    data-testid={`solver-sketch-expressions-name-${r.key}`}
                    aria-label={t.name}
                    placeholder={t.namePlaceholder}
                    value={r.name}
                    onChange={(e) => setField(r.key, 'name', e.target.value)}
                    style={{
                      width: 84, fontSize: 11, padding: '2px 4px',
                      border: '1px solid ' + (isDup ? '#fca5a5' : 'var(--nx-border)'),
                      borderRadius: 3,
                    }}
                  />
                  <span style={{ color: 'var(--nx-text-2)' }}>=</span>
                  <input
                    data-testid={`solver-sketch-expressions-def-${r.key}`}
                    aria-label={t.definition}
                    placeholder={t.defPlaceholder}
                    value={r.def}
                    onChange={(e) => setField(r.key, 'def', e.target.value)}
                    style={{ flex: '1 1 auto', fontSize: 11, padding: '2px 4px', border: '1px solid var(--nx-border)', borderRadius: 3 }}
                  />
                  <span
                    data-testid={`solver-sketch-expressions-value-${r.key}`}
                    title={isBound ? '🔗' : undefined}
                    style={{
                      width: 70, textAlign: 'right', fontVariantNumeric: 'tabular-nums',
                      color: res && !res.ok ? '#dc2626' : '#0e7490', fontWeight: 600,
                    }}
                  >
                    {isBound
                      ? `🔗 ${fmt(boundVal)}`
                      : res && res.ok && res.value !== undefined
                        ? fmt(res.value)
                        : '—'}
                  </span>
                  {onApply && res && res.ok && res.value !== undefined && (
                    <button
                      type="button"
                      data-testid={`solver-sketch-expressions-apply-${r.key}`}
                      onClick={() => onApply(r.name.trim(), res.value!)}
                      disabled={!canApply}
                      title={canApply ? undefined : t.applyHint}
                      style={{
                        padding: '2px 8px', fontSize: 11,
                        background: canApply ? '#0e7490' : 'var(--nx-panel-2)',
                        color: canApply ? '#fff' : 'var(--nx-text-2)',
                        border: '1px solid ' + (canApply ? '#0e7490' : 'var(--nx-border)'),
                        borderRadius: 3,
                        cursor: canApply ? 'pointer' : 'not-allowed',
                      }}
                    >
                      {t.apply}
                    </button>
                  )}
                  <button
                    type="button"
                    data-testid={`solver-sketch-expressions-delete-${r.key}`}
                    onClick={() => removeRow(r.key)}
                    title={t.delete}
                    style={{
                      padding: '2px 6px', fontSize: 11,
                      background: 'var(--nx-panel)', color: '#dc2626',
                      border: '1px solid #fca5a5', borderRadius: 3, cursor: 'pointer',
                    }}
                  >
                    ✕
                  </button>
                </div>
                {(isDup || (res && !res.ok)) && (
                  <div
                    data-testid={`solver-sketch-expressions-error-${r.key}`}
                    style={{ fontSize: 10, color: '#b91c1c', paddingLeft: 88 }}
                  >
                    {isDup ? t.dupName : res?.error}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
