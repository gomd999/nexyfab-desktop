'use client';

/**
 * AssemblyConstraintsPanel — Phase 4.7 UI surface for NNNNNNN's
 * assembly-wide constraint checker (`assemblyConstraints.ts`).
 *
 * Standalone panel that lets the user:
 *
 *   - Build a list of {@link AssemblyConstraint} entries (one row per
 *     constraint) with type-aware parameter inputs for each of the 6
 *     supported kinds:
 *       1. total_mass_limit           → grams numeric input.
 *       2. bbox_envelope              → three (x/y/z) mm inputs.
 *       3. part_count_limit           → max-count numeric input.
 *       4. manufacturing_volume_min   → minMm3 numeric input.
 *       5. cost_limit                 → maxCurrency + currency picker.
 *       6. material_homogeneity       → comma-separated allowed list.
 *   - Add a new constraint via a kind-picker dropdown + "+ Add constraint"
 *     button (defaults to sensible starter values per kind so the
 *     pure-function checker never sees a NaN / zero limit by accident).
 *   - Remove any constraint from the list.
 *   - Click "Check" to run `checkAssemblyConstraints` and render the per-
 *     violation result with severity colour, the constraint kind, the
 *     observed value, and the limit it was compared against.
 *
 * Hosting:
 *   - Mounted from AssemblyBrowserModal behind a top-bar "Constraints"
 *     toggle (default off so the 210 pre-existing modal tests are
 *     untouched). Can also be used standalone — `onConstraintsChange` and
 *     `initialConstraints` let a wrapper persist the list across mounts.
 *
 * Pure boundary: the panel never reads or writes `AssemblyState` /
 * `FeatureTree` / `assemblyConstraints.ts`. It owns only the constraint
 * list + the most recent check result. Tests can therefore drive the full
 * UX with a stub `state` and zero featureTrees.
 *
 * Test surface (data-testids — all prefixed `assembly-constraints-`):
 *   assembly-constraints-panel,
 *   assembly-constraints-add-kind, assembly-constraints-add-button,
 *   assembly-constraints-row-{idx},
 *   assembly-constraints-kind-{idx},
 *   assembly-constraints-remove-{idx},
 *   assembly-constraints-input-{idx}-{field},
 *   assembly-constraints-check-button,
 *   assembly-constraints-summary,
 *   assembly-constraints-violation-{idx},
 *   assembly-constraints-empty-violations.
 */

import React, { useCallback, useMemo, useState } from 'react';
import {
  checkAssemblyConstraints,
  type AssemblyConstraint,
  type ConstraintCheckResult,
  type ConstraintViolation,
  type CostCurrency,
} from '@/lib/assembly/assemblyConstraints';
import type { AssemblyState } from '@/lib/assembly/assemblyState';
import type { FeatureTree } from '@/lib/cad/featureTree';

// ─── i18n ────────────────────────────────────────────────────────────────

export type AssemblyConstraintsLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  panelTitle: string;
  /** Empty-list placeholder shown when no constraints have been added. */
  emptyList: string;
  addConstraint: string;
  /** Picker label shown next to the add dropdown. */
  addKindLabel: string;
  remove: string;
  check: string;
  /** Per-kind localized labels — used in row headers + the add dropdown. */
  kindTotalMass: string;
  kindBboxEnvelope: string;
  kindPartCount: string;
  kindManufacturingVolume: string;
  kindCostLimit: string;
  kindMaterialHomogeneity: string;
  /** Per-field labels (used as the input's aria-label / row legend). */
  fieldMaxGrams: string;
  fieldSizeX: string;
  fieldSizeY: string;
  fieldSizeZ: string;
  fieldMaxCount: string;
  fieldMinMm3: string;
  fieldMaxCurrency: string;
  fieldCurrency: string;
  fieldAllowedMaterials: string;
  /** Helper hint shown beneath the comma-separated materials input. */
  materialsHint: string;
  /** Severity labels for the per-violation rows. */
  severityError: string;
  severityWarning: string;
  /** Result summary line headers. */
  summaryOk: string;
  summaryHasErrors: (errors: number, warnings: number) => string;
  summaryHasWarnings: (warnings: number) => string;
  emptyViolations: string;
  /** Per-violation line — "actual A vs limit L". */
  actualLabel: string;
  limitLabel: string;
}

const dict: Record<AssemblyConstraintsLang, Dict> = {
  ko: {
    panelTitle: '어셈블리 제약',
    emptyList: '아직 제약이 없습니다',
    addConstraint: '+ 제약 추가',
    addKindLabel: '종류',
    remove: '삭제',
    check: '검사',
    kindTotalMass: '총 질량 한도',
    kindBboxEnvelope: 'BBox 봉투',
    kindPartCount: '부품 수 한도',
    kindManufacturingVolume: '최소 가공 부피',
    kindCostLimit: '비용 한도',
    kindMaterialHomogeneity: '재료 균일성',
    fieldMaxGrams: '최대 질량 (g)',
    fieldSizeX: 'X (mm)',
    fieldSizeY: 'Y (mm)',
    fieldSizeZ: 'Z (mm)',
    fieldMaxCount: '최대 개수',
    fieldMinMm3: '최소 부피 (mm³)',
    fieldMaxCurrency: '최대 비용',
    fieldCurrency: '통화',
    fieldAllowedMaterials: '허용 재료',
    materialsHint: '쉼표로 구분 (예: aluminum, steel)',
    severityError: '오류',
    severityWarning: '경고',
    summaryOk: '모든 제약 통과',
    summaryHasErrors: (e, w) => `오류 ${e}개, 경고 ${w}개`,
    summaryHasWarnings: (w) => `경고 ${w}개 (오류 없음)`,
    emptyViolations: '위반 없음',
    actualLabel: '실제값',
    limitLabel: '한계값',
  },
  en: {
    panelTitle: 'Assembly Constraints',
    emptyList: 'No constraints yet',
    addConstraint: '+ Add constraint',
    addKindLabel: 'Kind',
    remove: 'Remove',
    check: 'Check',
    kindTotalMass: 'Total mass limit',
    kindBboxEnvelope: 'BBox envelope',
    kindPartCount: 'Part count limit',
    kindManufacturingVolume: 'Min manufacturing volume',
    kindCostLimit: 'Cost limit',
    kindMaterialHomogeneity: 'Material homogeneity',
    fieldMaxGrams: 'Max grams',
    fieldSizeX: 'X (mm)',
    fieldSizeY: 'Y (mm)',
    fieldSizeZ: 'Z (mm)',
    fieldMaxCount: 'Max count',
    fieldMinMm3: 'Min volume (mm³)',
    fieldMaxCurrency: 'Max cost',
    fieldCurrency: 'Currency',
    fieldAllowedMaterials: 'Allowed materials',
    materialsHint: 'Comma-separated (e.g., aluminum, steel)',
    severityError: 'Error',
    severityWarning: 'Warning',
    summaryOk: 'All constraints pass',
    summaryHasErrors: (e, w) => `${e} error(s), ${w} warning(s)`,
    summaryHasWarnings: (w) => `${w} warning(s) (no errors)`,
    emptyViolations: 'No violations',
    actualLabel: 'actual',
    limitLabel: 'limit',
  },
  ja: {
    panelTitle: 'アセンブリ制約',
    emptyList: '制約がまだありません',
    addConstraint: '+ 制約を追加',
    addKindLabel: '種類',
    remove: '削除',
    check: 'チェック',
    kindTotalMass: '総質量上限',
    kindBboxEnvelope: 'BBox エンベロープ',
    kindPartCount: 'パーツ数上限',
    kindManufacturingVolume: '最小加工体積',
    kindCostLimit: 'コスト上限',
    kindMaterialHomogeneity: '材料均一性',
    fieldMaxGrams: '最大グラム',
    fieldSizeX: 'X (mm)',
    fieldSizeY: 'Y (mm)',
    fieldSizeZ: 'Z (mm)',
    fieldMaxCount: '最大数',
    fieldMinMm3: '最小体積 (mm³)',
    fieldMaxCurrency: '最大コスト',
    fieldCurrency: '通貨',
    fieldAllowedMaterials: '許可材料',
    materialsHint: 'カンマ区切り (例: aluminum, steel)',
    severityError: 'エラー',
    severityWarning: '警告',
    summaryOk: 'すべての制約が合格',
    summaryHasErrors: (e, w) => `エラー ${e} 件、警告 ${w} 件`,
    summaryHasWarnings: (w) => `警告 ${w} 件 (エラーなし)`,
    emptyViolations: '違反なし',
    actualLabel: '実測',
    limitLabel: '上限',
  },
  zh: {
    panelTitle: '装配约束',
    emptyList: '尚无约束',
    addConstraint: '+ 添加约束',
    addKindLabel: '类型',
    remove: '删除',
    check: '检查',
    kindTotalMass: '总质量上限',
    kindBboxEnvelope: 'BBox 外包',
    kindPartCount: '零件数上限',
    kindManufacturingVolume: '最小加工体积',
    kindCostLimit: '成本上限',
    kindMaterialHomogeneity: '材料一致性',
    fieldMaxGrams: '最大克数',
    fieldSizeX: 'X (mm)',
    fieldSizeY: 'Y (mm)',
    fieldSizeZ: 'Z (mm)',
    fieldMaxCount: '最大数量',
    fieldMinMm3: '最小体积 (mm³)',
    fieldMaxCurrency: '最大成本',
    fieldCurrency: '货币',
    fieldAllowedMaterials: '允许材料',
    materialsHint: '逗号分隔 (例如: aluminum, steel)',
    severityError: '错误',
    severityWarning: '警告',
    summaryOk: '全部约束通过',
    summaryHasErrors: (e, w) => `${e} 个错误, ${w} 个警告`,
    summaryHasWarnings: (w) => `${w} 个警告 (无错误)`,
    emptyViolations: '无违反',
    actualLabel: '实际',
    limitLabel: '上限',
  },
  es: {
    panelTitle: 'Restricciones de ensamblaje',
    emptyList: 'Sin restricciones todavía',
    addConstraint: '+ Añadir restricción',
    addKindLabel: 'Tipo',
    remove: 'Eliminar',
    check: 'Verificar',
    kindTotalMass: 'Límite de masa total',
    kindBboxEnvelope: 'Envolvente BBox',
    kindPartCount: 'Límite de piezas',
    kindManufacturingVolume: 'Volumen mín. de fabricación',
    kindCostLimit: 'Límite de costo',
    kindMaterialHomogeneity: 'Homogeneidad de materiales',
    fieldMaxGrams: 'Máx. gramos',
    fieldSizeX: 'X (mm)',
    fieldSizeY: 'Y (mm)',
    fieldSizeZ: 'Z (mm)',
    fieldMaxCount: 'Máx. cantidad',
    fieldMinMm3: 'Volumen mín. (mm³)',
    fieldMaxCurrency: 'Costo máx.',
    fieldCurrency: 'Moneda',
    fieldAllowedMaterials: 'Materiales permitidos',
    materialsHint: 'Separados por coma (p. ej., aluminum, steel)',
    severityError: 'Error',
    severityWarning: 'Aviso',
    summaryOk: 'Todas las restricciones cumplen',
    summaryHasErrors: (e, w) => `${e} error(es), ${w} aviso(s)`,
    summaryHasWarnings: (w) => `${w} aviso(s) (sin errores)`,
    emptyViolations: 'Sin violaciones',
    actualLabel: 'real',
    limitLabel: 'límite',
  },
  ar: {
    panelTitle: 'قيود التجميع',
    emptyList: 'لا توجد قيود بعد',
    addConstraint: '+ إضافة قيد',
    addKindLabel: 'النوع',
    remove: 'حذف',
    check: 'فحص',
    kindTotalMass: 'حد الكتلة الإجمالية',
    kindBboxEnvelope: 'مظروف BBox',
    kindPartCount: 'حد عدد الأجزاء',
    kindManufacturingVolume: 'الحد الأدنى لحجم التصنيع',
    kindCostLimit: 'حد التكلفة',
    kindMaterialHomogeneity: 'تجانس المواد',
    fieldMaxGrams: 'أقصى غرام',
    fieldSizeX: 'X (مم)',
    fieldSizeY: 'Y (مم)',
    fieldSizeZ: 'Z (مم)',
    fieldMaxCount: 'العدد الأقصى',
    fieldMinMm3: 'الحد الأدنى للحجم (مم³)',
    fieldMaxCurrency: 'الحد الأقصى للتكلفة',
    fieldCurrency: 'العملة',
    fieldAllowedMaterials: 'المواد المسموح بها',
    materialsHint: 'مفصولة بفاصلة (مثال: aluminum, steel)',
    severityError: 'خطأ',
    severityWarning: 'تحذير',
    summaryOk: 'جميع القيود مستوفاة',
    summaryHasErrors: (e, w) => `${e} خطأ، ${w} تحذير`,
    summaryHasWarnings: (w) => `${w} تحذير (بدون أخطاء)`,
    emptyViolations: 'لا مخالفات',
    actualLabel: 'القيمة',
    limitLabel: 'الحد',
  },
};

// ─── kind metadata ───────────────────────────────────────────────────────

/**
 * Discriminated-union kind list (mirrors {@link AssemblyConstraint}).
 * Order is deliberate — it's also the order they appear in the add dropdown.
 */
export const ALL_CONSTRAINT_KINDS: ReadonlyArray<AssemblyConstraint['kind']> = [
  'total_mass_limit',
  'bbox_envelope',
  'part_count_limit',
  'manufacturing_volume_min',
  'cost_limit',
  'material_homogeneity',
];

const ALL_CURRENCIES: ReadonlyArray<CostCurrency> = ['USD', 'EUR', 'KRW'];

/**
 * Per-kind starter defaults used when the user clicks "+ Add constraint".
 * Picked to be obviously-non-trivial (no zero limits — the checker would
 * surface a warning storm) but conservative enough that a user with a
 * normal small assembly typically passes most of them without editing.
 */
function defaultConstraintFor(kind: AssemblyConstraint['kind']): AssemblyConstraint {
  switch (kind) {
    case 'total_mass_limit':
      return { kind: 'total_mass_limit', maxGrams: 1000 };
    case 'bbox_envelope':
      return { kind: 'bbox_envelope', size: { x: 500, y: 500, z: 500 } };
    case 'part_count_limit':
      return { kind: 'part_count_limit', max: 50 };
    case 'manufacturing_volume_min':
      return { kind: 'manufacturing_volume_min', minMm3: 10 };
    case 'cost_limit':
      return { kind: 'cost_limit', maxCurrency: 100, currency: 'USD' };
    case 'material_homogeneity':
      return {
        kind: 'material_homogeneity',
        allowedMaterials: ['aluminum', 'steel'],
      };
  }
}

function localizedKindLabel(kind: AssemblyConstraint['kind'], d: Dict): string {
  switch (kind) {
    case 'total_mass_limit':
      return d.kindTotalMass;
    case 'bbox_envelope':
      return d.kindBboxEnvelope;
    case 'part_count_limit':
      return d.kindPartCount;
    case 'manufacturing_volume_min':
      return d.kindManufacturingVolume;
    case 'cost_limit':
      return d.kindCostLimit;
    case 'material_homogeneity':
      return d.kindMaterialHomogeneity;
  }
}

// ─── helpers for rendering "actual" / "limit" in violations ──────────────

/**
 * Format `actual` / `limit` payloads (which are typed `unknown` in the
 * checker IR) into a short single-line string the row UI can render
 * inside `<code>`. We intentionally keep the formatter forgiving: it's
 * meant for at-a-glance human readability, not round-trip parsing.
 */
function formatViolationValue(v: unknown): string {
  if (v === undefined) return '—';
  if (v === null) return 'null';
  if (typeof v === 'number') {
    // Trim trailing zeros while still showing reasonable precision.
    return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/0+$/, '').replace(/\.$/, '');
  }
  if (typeof v === 'string') return v;
  if (Array.isArray(v)) return `[${v.join(', ')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if ('x' in o && 'y' in o && 'z' in o) {
      const parts = ['x', 'y', 'z'].map((k) => formatViolationValue(o[k]));
      return `(${parts.join(', ')})`;
    }
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

// ─── props ───────────────────────────────────────────────────────────────

export interface AssemblyConstraintsPanelProps {
  lang: AssemblyConstraintsLang;
  /** Current assembly state. Forwarded verbatim to the checker. */
  state: AssemblyState;
  /** Optional per-part FeatureTrees, forwarded to the checker. */
  featureTrees?: Record<string, FeatureTree>;
  /** Optional per-part material override, forwarded to the checker. */
  materials?: Record<string, string>;
  /**
   * Optional initial constraint list. When provided, the panel hydrates
   * its internal list from this value (treated as a one-shot seed — later
   * edits live inside the panel and bubble out via `onConstraintsChange`).
   */
  initialConstraints?: ReadonlyArray<AssemblyConstraint>;
  /**
   * Optional callback fired with the new list whenever the user edits it
   * (add / remove / parameter change). Lets a hosting wrapper persist the
   * constraints across mounts without re-implementing the editor.
   */
  onConstraintsChange?: (next: ReadonlyArray<AssemblyConstraint>) => void;
}

// ─── component ───────────────────────────────────────────────────────────

export default function AssemblyConstraintsPanel(
  props: AssemblyConstraintsPanelProps,
): React.ReactElement {
  const { lang, state, featureTrees, materials, initialConstraints, onConstraintsChange } =
    props;
  const t = dict[lang];

  const [constraints, setConstraints] = useState<ReadonlyArray<AssemblyConstraint>>(
    () => initialConstraints ?? [],
  );
  const [addKind, setAddKind] = useState<AssemblyConstraint['kind']>('total_mass_limit');
  const [result, setResult] = useState<ConstraintCheckResult | null>(null);

  // Single funnel that updates internal state AND notifies the host.
  // Keeps the two writes atomic so the host can't see a stale list.
  const updateConstraints = useCallback(
    (next: ReadonlyArray<AssemblyConstraint>) => {
      setConstraints(next);
      onConstraintsChange?.(next);
      // Invalidate the previously-rendered result since the input changed.
      setResult(null);
    },
    [onConstraintsChange],
  );

  const handleAdd = useCallback(() => {
    updateConstraints([...constraints, defaultConstraintFor(addKind)]);
  }, [addKind, constraints, updateConstraints]);

  const handleRemove = useCallback(
    (index: number) => {
      updateConstraints(constraints.filter((_, i) => i !== index));
    },
    [constraints, updateConstraints],
  );

  const handlePatch = useCallback(
    (index: number, patched: AssemblyConstraint) => {
      const next = constraints.map((c, i) => (i === index ? patched : c));
      updateConstraints(next);
    },
    [constraints, updateConstraints],
  );

  const handleCheck = useCallback(() => {
    // The checker is pure + sync — call it inline.
    const res = checkAssemblyConstraints(state, constraints, {
      featureTrees,
      materials,
    });
    setResult(res);
  }, [state, constraints, featureTrees, materials]);

  const errorCount = useMemo(
    () => (result ? result.violations.filter((v) => v.severity === 'error').length : 0),
    [result],
  );
  const warningCount = useMemo(
    () => (result ? result.violations.filter((v) => v.severity === 'warning').length : 0),
    [result],
  );

  return (
    <div
      data-testid="assembly-constraints-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        padding: 12,
        border: '1px solid var(--nx-border)',
        borderRadius: 8,
        background: 'var(--nx-panel)',
        fontFamily: 'system-ui, sans-serif',
        fontSize: 13,
        minWidth: 280,
      }}
    >
      <div style={{ fontWeight: 600, fontSize: 14 }}>{t.panelTitle}</div>

      {/* ── constraint list ─────────────────────────────────────────── */}
      <div
        data-testid="assembly-constraints-list"
        style={{ display: 'flex', flexDirection: 'column', gap: 8 }}
      >
        {constraints.length === 0 ? (
          <div
            data-testid="assembly-constraints-empty"
            style={{ fontSize: 12, color: 'var(--nx-text-2)', padding: 8 }}
          >
            {t.emptyList}
          </div>
        ) : (
          constraints.map((c, idx) => (
            <ConstraintRow
              key={idx}
              index={idx}
              constraint={c}
              dict={t}
              onPatch={(patched) => handlePatch(idx, patched)}
              onRemove={() => handleRemove(idx)}
            />
          ))
        )}
      </div>

      {/* ── add-constraint row ──────────────────────────────────────── */}
      <div
        style={{
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          borderTop: '1px solid #f3f4f6',
          paddingTop: 8,
        }}
      >
        <label style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>{t.addKindLabel}</label>
        <select
          data-testid="assembly-constraints-add-kind"
          value={addKind}
          onChange={(e) => setAddKind(e.target.value as AssemblyConstraint['kind'])}
          style={{
            fontSize: 12,
            padding: '4px 6px',
            border: '1px solid var(--nx-border)',
            borderRadius: 4,
          }}
        >
          {ALL_CONSTRAINT_KINDS.map((k) => (
            <option key={k} value={k}>
              {localizedKindLabel(k, t)}
            </option>
          ))}
        </select>
        <button
          type="button"
          data-testid="assembly-constraints-add-button"
          onClick={handleAdd}
          style={{
            fontSize: 12,
            padding: '6px 10px',
            background: 'var(--nx-panel-2)',
            border: '1px solid var(--nx-border)',
            borderRadius: 4,
            cursor: 'pointer',
          }}
        >
          {t.addConstraint}
        </button>
      </div>

      {/* ── check button ────────────────────────────────────────────── */}
      <div>
        <button
          type="button"
          data-testid="assembly-constraints-check-button"
          onClick={handleCheck}
          style={{
            fontSize: 12,
            padding: '6px 14px',
            background: '#2563eb',
            color: '#fff',
            border: '1px solid #2563eb',
            borderRadius: 4,
            cursor: 'pointer',
            fontWeight: 600,
          }}
        >
          {t.check}
        </button>
      </div>

      {/* ── result summary + violations ─────────────────────────────── */}
      {result !== null && (
        <div
          data-testid="assembly-constraints-result"
          style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
        >
          <div
            data-testid="assembly-constraints-summary"
            data-ok={result.ok ? 'true' : 'false'}
            style={{
              fontSize: 12,
              fontWeight: 600,
              padding: '6px 8px',
              borderRadius: 4,
              background: result.ok
                ? warningCount > 0
                  ? '#fef3c7'
                  : '#ecfdf5'
                : '#fee2e2',
              color: result.ok ? (warningCount > 0 ? '#92400e' : '#065f46') : '#991b1b',
              border: `1px solid ${
                result.ok ? (warningCount > 0 ? '#fcd34d' : '#6ee7b7') : '#fca5a5'
              }`,
            }}
          >
            {result.ok && warningCount === 0
              ? t.summaryOk
              : result.ok
              ? t.summaryHasWarnings(warningCount)
              : t.summaryHasErrors(errorCount, warningCount)}
          </div>

          {result.violations.length === 0 ? (
            <div
              data-testid="assembly-constraints-empty-violations"
              style={{ fontSize: 12, color: 'var(--nx-text-2)', padding: 4 }}
            >
              {t.emptyViolations}
            </div>
          ) : (
            <ul
              data-testid="assembly-constraints-violations-list"
              style={{
                margin: 0,
                padding: 0,
                listStyle: 'none',
                display: 'flex',
                flexDirection: 'column',
                gap: 4,
              }}
            >
              {result.violations.map((v, idx) => (
                <ViolationRow key={idx} index={idx} violation={v} dict={t} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

// ─── per-row sub-components ──────────────────────────────────────────────

interface ConstraintRowProps {
  index: number;
  constraint: AssemblyConstraint;
  dict: Dict;
  onPatch: (next: AssemblyConstraint) => void;
  onRemove: () => void;
}

function ConstraintRow(props: ConstraintRowProps): React.ReactElement {
  const { index, constraint, dict: d, onPatch, onRemove } = props;
  const headerLabel = localizedKindLabel(constraint.kind, d);

  return (
    <div
      data-testid={`assembly-constraints-row-${index}`}
      data-kind={constraint.kind}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 6,
        padding: 8,
        border: '1px solid var(--nx-border)',
        borderRadius: 4,
        background: '#fafafa',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          justifyContent: 'space-between',
        }}
      >
        <span
          data-testid={`assembly-constraints-kind-${index}`}
          style={{ fontSize: 12, fontWeight: 600, color: 'var(--nx-text-2)' }}
        >
          {headerLabel}
        </span>
        <button
          type="button"
          data-testid={`assembly-constraints-remove-${index}`}
          onClick={onRemove}
          style={{
            fontSize: 11,
            padding: '2px 8px',
            background: '#fee2e2',
            color: '#991b1b',
            border: '1px solid #fecaca',
            borderRadius: 3,
            cursor: 'pointer',
          }}
        >
          {d.remove}
        </button>
      </div>
      <ConstraintFields
        index={index}
        constraint={constraint}
        dict={d}
        onPatch={onPatch}
      />
    </div>
  );
}

interface ConstraintFieldsProps {
  index: number;
  constraint: AssemblyConstraint;
  dict: Dict;
  onPatch: (next: AssemblyConstraint) => void;
}

function ConstraintFields(props: ConstraintFieldsProps): React.ReactElement {
  const { index, constraint, dict: d, onPatch } = props;

  switch (constraint.kind) {
    case 'total_mass_limit':
      return (
        <NumberField
          testId={`assembly-constraints-input-${index}-maxGrams`}
          label={d.fieldMaxGrams}
          value={constraint.maxGrams}
          onChange={(v) => onPatch({ ...constraint, maxGrams: v })}
        />
      );
    case 'bbox_envelope':
      return (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          <NumberField
            testId={`assembly-constraints-input-${index}-sizeX`}
            label={d.fieldSizeX}
            value={constraint.size.x}
            onChange={(v) =>
              onPatch({ ...constraint, size: { ...constraint.size, x: v } })
            }
          />
          <NumberField
            testId={`assembly-constraints-input-${index}-sizeY`}
            label={d.fieldSizeY}
            value={constraint.size.y}
            onChange={(v) =>
              onPatch({ ...constraint, size: { ...constraint.size, y: v } })
            }
          />
          <NumberField
            testId={`assembly-constraints-input-${index}-sizeZ`}
            label={d.fieldSizeZ}
            value={constraint.size.z}
            onChange={(v) =>
              onPatch({ ...constraint, size: { ...constraint.size, z: v } })
            }
          />
        </div>
      );
    case 'part_count_limit':
      return (
        <NumberField
          testId={`assembly-constraints-input-${index}-max`}
          label={d.fieldMaxCount}
          value={constraint.max}
          // Part count is integer-only — coerce in the patch.
          onChange={(v) => onPatch({ ...constraint, max: Math.floor(v) })}
        />
      );
    case 'manufacturing_volume_min':
      return (
        <NumberField
          testId={`assembly-constraints-input-${index}-minMm3`}
          label={d.fieldMinMm3}
          value={constraint.minMm3}
          onChange={(v) => onPatch({ ...constraint, minMm3: v })}
        />
      );
    case 'cost_limit':
      return (
        <div style={{ display: 'flex', gap: 6, alignItems: 'flex-end', flexWrap: 'wrap' }}>
          <NumberField
            testId={`assembly-constraints-input-${index}-maxCurrency`}
            label={d.fieldMaxCurrency}
            value={constraint.maxCurrency}
            onChange={(v) => onPatch({ ...constraint, maxCurrency: v })}
          />
          <label
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 2,
              fontSize: 11,
              color: 'var(--nx-text-2)',
            }}
          >
            <span>{d.fieldCurrency}</span>
            <select
              data-testid={`assembly-constraints-input-${index}-currency`}
              value={constraint.currency}
              onChange={(e) =>
                onPatch({ ...constraint, currency: e.target.value as CostCurrency })
              }
              style={{
                fontSize: 12,
                padding: '3px 6px',
                border: '1px solid var(--nx-border)',
                borderRadius: 3,
              }}
            >
              {ALL_CURRENCIES.map((cur) => (
                <option key={cur} value={cur}>
                  {cur}
                </option>
              ))}
            </select>
          </label>
        </div>
      );
    case 'material_homogeneity':
      return (
        <label
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 2,
            fontSize: 11,
            color: 'var(--nx-text-2)',
          }}
        >
          <span>{d.fieldAllowedMaterials}</span>
          <input
            type="text"
            data-testid={`assembly-constraints-input-${index}-allowedMaterials`}
            value={constraint.allowedMaterials.join(', ')}
            onChange={(e) => {
              const items = e.target.value
                .split(',')
                .map((s) => s.trim())
                .filter((s) => s.length > 0);
              onPatch({ ...constraint, allowedMaterials: items });
            }}
            style={{
              fontSize: 12,
              padding: '3px 6px',
              border: '1px solid var(--nx-border)',
              borderRadius: 3,
              minWidth: 240,
            }}
          />
          <span style={{ fontSize: 10, color: 'var(--nx-text-2)' }}>{d.materialsHint}</span>
        </label>
      );
  }
}

interface NumberFieldProps {
  testId: string;
  label: string;
  value: number;
  onChange: (v: number) => void;
}

function NumberField(props: NumberFieldProps): React.ReactElement {
  const { testId, label, value, onChange } = props;
  return (
    <label
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        fontSize: 11,
        color: 'var(--nx-text-2)',
      }}
    >
      <span>{label}</span>
      <input
        type="number"
        data-testid={testId}
        value={Number.isFinite(value) ? value : 0}
        onChange={(e) => {
          const v = Number(e.target.value);
          // Surface NaN as 0 — the checker would otherwise produce
          // confusing "actual=NaN" violations.
          onChange(Number.isFinite(v) ? v : 0);
        }}
        style={{
          fontSize: 12,
          padding: '3px 6px',
          border: '1px solid var(--nx-border)',
          borderRadius: 3,
          width: 100,
        }}
      />
    </label>
  );
}

interface ViolationRowProps {
  index: number;
  violation: ConstraintViolation;
  dict: Dict;
}

function ViolationRow(props: ViolationRowProps): React.ReactElement {
  const { index, violation, dict: d } = props;
  const isError = violation.severity === 'error';
  return (
    <li
      data-testid={`assembly-constraints-violation-${index}`}
      data-severity={violation.severity}
      data-kind={violation.kind}
      data-constraint-index={violation.constraintIndex}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 2,
        padding: '6px 8px',
        borderRadius: 4,
        background: isError ? '#fef2f2' : '#fefce8',
        border: `1px solid ${isError ? '#fca5a5' : '#fde68a'}`,
      }}
    >
      <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <span
          data-testid={`assembly-constraints-violation-severity-${index}`}
          style={{
            fontSize: 10,
            fontWeight: 700,
            padding: '1px 6px',
            borderRadius: 9999,
            background: isError ? '#dc2626' : '#d97706',
            color: '#fff',
            textTransform: 'uppercase',
          }}
        >
          {isError ? d.severityError : d.severityWarning}
        </span>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{violation.kind}</span>
      </div>
      <div style={{ fontSize: 11, color: 'var(--nx-text-2)' }}>
        <span data-testid={`assembly-constraints-violation-actual-${index}`}>
          {d.actualLabel}: <code>{formatViolationValue(violation.actual)}</code>
        </span>
        {' · '}
        <span data-testid={`assembly-constraints-violation-limit-${index}`}>
          {d.limitLabel}: <code>{formatViolationValue(violation.limit)}</code>
        </span>
      </div>
      {violation.detail !== undefined && (
        <div
          data-testid={`assembly-constraints-violation-detail-${index}`}
          style={{ fontSize: 11, color: 'var(--nx-text-2)' }}
        >
          {violation.detail}
        </div>
      )}
    </li>
  );
}
