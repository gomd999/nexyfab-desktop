'use client';

/**
 * FeatureTreeStatsPanel — Phase 2.9 UX panel that surfaces the JJJJJ
 * `computeStats` output to the operator next to the FeatureTreeView.
 *
 * Standalone by design:
 *   - Pure prop-driven (lang, tree, density?, selectedNodeId?).
 *   - Owns the local UI controls (units, material) without touching the
 *     wrapper's tree state — wrapper integration is the next batch.
 *   - Re-runs `computeStats` whenever the input tree or chosen density
 *     changes, memoized so React re-renders that don't touch the tree
 *     don't pay for the walk.
 *
 * Material density:
 *   When the operator picks a material from the dropdown, the corresponding
 *   density from `DEFAULT_DENSITIES` (bomExport's catalogue, g/mm³) is fed
 *   into `computeStats(opts.density)`. Picking "custom" reverts to the
 *   `density` prop (or no mass derivation if neither is supplied). Picking
 *   "none" forces the mass row to hide regardless of the `density` prop.
 *
 * Unit display:
 *   Numbers are always computed in mm³ / mm² / mm internally (the IR
 *   contract). The unit toggle is presentation-only:
 *     mm    : raw values (volume → mm³, area → mm²)
 *     cm    : volume /= 1000, area /= 100, lengths /= 10
 *     inch  : volume /= 16387.064, area /= 645.16, lengths /= 25.4
 *
 * Test surface (data-testids):
 *   feature-tree-stats-panel
 *   feature-tree-stats-empty
 *   feature-tree-stats-total-volume
 *   feature-tree-stats-surface-area
 *   feature-tree-stats-bbox
 *   feature-tree-stats-center-of-mass
 *   feature-tree-stats-node-count
 *   feature-tree-stats-mass
 *   feature-tree-stats-unit-toggle
 *   feature-tree-stats-unit-toggle-{mm|cm|inch}
 *   feature-tree-stats-material-select
 *   feature-tree-stats-selected
 *   feature-tree-stats-selected-kind
 *   feature-tree-stats-selected-volume
 *   feature-tree-stats-selected-surface-area
 *   feature-tree-stats-selected-bbox
 */

import React, { useMemo, useState } from 'react';
import type { FeatureTree } from '@/lib/cad/featureTree';
import {
  computeStats,
  isEmptyBbox,
  type Bbox,
  type FeatureStats,
  type FeatureTreeStats,
  type Vec3,
} from '@/lib/cad/featureTreeStats';
import { DEFAULT_DENSITIES } from '@/lib/assembly/bomExport';

export type FeatureTreeStatsLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

export type LengthUnit = 'mm' | 'cm' | 'inch';

/**
 * Material catalogue surfaced in the dropdown. Maps to keys in
 * {@link DEFAULT_DENSITIES} except for the two sentinel entries:
 *   - 'none'   : do not derive mass, ignore density prop.
 *   - 'custom' : use the `density` prop (g/mm³). When absent, mass hides.
 */
export type MaterialChoice =
  | 'none'
  | 'custom'
  | 'steel'
  | 'stainless_steel'
  | 'aluminum'
  | 'brass'
  | 'copper'
  | 'titanium'
  | 'plastic_abs'
  | 'plastic_pla'
  | 'plastic_petg'
  | 'nylon'
  | 'wood'
  | 'rubber';

const MATERIAL_OPTIONS: ReadonlyArray<MaterialChoice> = [
  'none',
  'custom',
  'steel',
  'stainless_steel',
  'aluminum',
  'brass',
  'copper',
  'titanium',
  'plastic_abs',
  'plastic_pla',
  'plastic_petg',
  'nylon',
  'wood',
  'rubber',
];

export interface FeatureTreeStatsPanelProps {
  lang: FeatureTreeStatsLang;
  tree: FeatureTree;
  /** Custom density in g/mm³. Used when `material === 'custom'`. */
  density?: number;
  /** Highlight selected node's stats in a sub-section. */
  selectedNodeId?: string;
}

// ─── i18n ─────────────────────────────────────────────────────────────────

interface Dict {
  title: string;
  totalVolume: string;
  surfaceArea: string;
  bbox: string;
  centerOfMass: string;
  nodeCount: string;
  mass: string;
  material: string;
  unit: string;
  selectedTitle: string;
  selectedKind: string;
  selectedVolume: string;
  selectedSurfaceArea: string;
  selectedBbox: string;
  empty: string;
  bboxEmpty: string;
  noMass: string;
  materialNames: Record<MaterialChoice, string>;
}

const dict: Record<FeatureTreeStatsLang, Dict> = {
  ko: {
    title: '통계',
    totalVolume: '총 부피',
    surfaceArea: '표면적',
    bbox: '경계 상자',
    centerOfMass: '질량 중심',
    nodeCount: '피처 수',
    mass: '질량',
    material: '재질',
    unit: '단위',
    selectedTitle: '선택된 피처',
    selectedKind: '종류',
    selectedVolume: '부피',
    selectedSurfaceArea: '표면적',
    selectedBbox: '경계 상자',
    empty: '피처를 추가하여 통계를 확인하세요',
    bboxEmpty: '없음',
    noMass: '재질을 선택하세요',
    materialNames: {
      none: '재질 없음',
      custom: '사용자 정의',
      steel: '강철',
      stainless_steel: '스테인리스강',
      aluminum: '알루미늄',
      brass: '황동',
      copper: '구리',
      titanium: '티타늄',
      plastic_abs: 'ABS 플라스틱',
      plastic_pla: 'PLA 플라스틱',
      plastic_petg: 'PETG 플라스틱',
      nylon: '나일론',
      wood: '나무',
      rubber: '고무',
    },
  },
  en: {
    title: 'Statistics',
    totalVolume: 'Total volume',
    surfaceArea: 'Surface area',
    bbox: 'Bounding box',
    centerOfMass: 'Center of mass',
    nodeCount: 'Node count',
    mass: 'Mass',
    material: 'Material',
    unit: 'Unit',
    selectedTitle: 'Selected feature',
    selectedKind: 'Kind',
    selectedVolume: 'Volume',
    selectedSurfaceArea: 'Surface area',
    selectedBbox: 'Bounding box',
    empty: 'Add a feature to see statistics',
    bboxEmpty: 'empty',
    noMass: 'Pick a material',
    materialNames: {
      none: 'No material',
      custom: 'Custom',
      steel: 'Steel',
      stainless_steel: 'Stainless steel',
      aluminum: 'Aluminum',
      brass: 'Brass',
      copper: 'Copper',
      titanium: 'Titanium',
      plastic_abs: 'ABS plastic',
      plastic_pla: 'PLA plastic',
      plastic_petg: 'PETG plastic',
      nylon: 'Nylon',
      wood: 'Wood',
      rubber: 'Rubber',
    },
  },
  ja: {
    title: '統計',
    totalVolume: '総体積',
    surfaceArea: '表面積',
    bbox: 'バウンディングボックス',
    centerOfMass: '質量中心',
    nodeCount: 'フィーチャ数',
    mass: '質量',
    material: '材質',
    unit: '単位',
    selectedTitle: '選択されたフィーチャ',
    selectedKind: '種類',
    selectedVolume: '体積',
    selectedSurfaceArea: '表面積',
    selectedBbox: 'バウンディングボックス',
    empty: 'フィーチャを追加して統計を確認',
    bboxEmpty: 'なし',
    noMass: '材質を選択してください',
    materialNames: {
      none: '材質なし',
      custom: 'カスタム',
      steel: '鋼',
      stainless_steel: 'ステンレス鋼',
      aluminum: 'アルミニウム',
      brass: '真鍮',
      copper: '銅',
      titanium: 'チタン',
      plastic_abs: 'ABS樹脂',
      plastic_pla: 'PLA樹脂',
      plastic_petg: 'PETG樹脂',
      nylon: 'ナイロン',
      wood: '木材',
      rubber: 'ゴム',
    },
  },
  zh: {
    title: '统计',
    totalVolume: '总体积',
    surfaceArea: '表面积',
    bbox: '边界框',
    centerOfMass: '质量中心',
    nodeCount: '特征数量',
    mass: '质量',
    material: '材料',
    unit: '单位',
    selectedTitle: '选定的特征',
    selectedKind: '类型',
    selectedVolume: '体积',
    selectedSurfaceArea: '表面积',
    selectedBbox: '边界框',
    empty: '添加特征以查看统计',
    bboxEmpty: '空',
    noMass: '请选择材料',
    materialNames: {
      none: '无材料',
      custom: '自定义',
      steel: '钢',
      stainless_steel: '不锈钢',
      aluminum: '铝',
      brass: '黄铜',
      copper: '铜',
      titanium: '钛',
      plastic_abs: 'ABS塑料',
      plastic_pla: 'PLA塑料',
      plastic_petg: 'PETG塑料',
      nylon: '尼龙',
      wood: '木材',
      rubber: '橡胶',
    },
  },
  es: {
    title: 'Estadísticas',
    totalVolume: 'Volumen total',
    surfaceArea: 'Área de superficie',
    bbox: 'Caja delimitadora',
    centerOfMass: 'Centro de masa',
    nodeCount: 'Número de funciones',
    mass: 'Masa',
    material: 'Material',
    unit: 'Unidad',
    selectedTitle: 'Función seleccionada',
    selectedKind: 'Tipo',
    selectedVolume: 'Volumen',
    selectedSurfaceArea: 'Área de superficie',
    selectedBbox: 'Caja delimitadora',
    empty: 'Añade una función para ver estadísticas',
    bboxEmpty: 'vacío',
    noMass: 'Selecciona un material',
    materialNames: {
      none: 'Sin material',
      custom: 'Personalizado',
      steel: 'Acero',
      stainless_steel: 'Acero inoxidable',
      aluminum: 'Aluminio',
      brass: 'Latón',
      copper: 'Cobre',
      titanium: 'Titanio',
      plastic_abs: 'Plástico ABS',
      plastic_pla: 'Plástico PLA',
      plastic_petg: 'Plástico PETG',
      nylon: 'Nailon',
      wood: 'Madera',
      rubber: 'Caucho',
    },
  },
  ar: {
    title: 'إحصائيات',
    totalVolume: 'الحجم الإجمالي',
    surfaceArea: 'مساحة السطح',
    bbox: 'الصندوق المحيط',
    centerOfMass: 'مركز الكتلة',
    nodeCount: 'عدد الميزات',
    mass: 'الكتلة',
    material: 'المادة',
    unit: 'الوحدة',
    selectedTitle: 'الميزة المحددة',
    selectedKind: 'النوع',
    selectedVolume: 'الحجم',
    selectedSurfaceArea: 'مساحة السطح',
    selectedBbox: 'الصندوق المحيط',
    empty: 'أضف ميزة لرؤية الإحصائيات',
    bboxEmpty: 'فارغ',
    noMass: 'اختر مادة',
    materialNames: {
      none: 'بدون مادة',
      custom: 'مخصص',
      steel: 'فولاذ',
      stainless_steel: 'فولاذ مقاوم للصدأ',
      aluminum: 'ألمنيوم',
      brass: 'نحاس أصفر',
      copper: 'نحاس',
      titanium: 'تيتانيوم',
      plastic_abs: 'بلاستيك ABS',
      plastic_pla: 'بلاستيك PLA',
      plastic_petg: 'بلاستيك PETG',
      nylon: 'نايلون',
      wood: 'خشب',
      rubber: 'مطاط',
    },
  },
};

// ─── unit conversion ──────────────────────────────────────────────────────

/** Conversion factors from mm-based internal values to the display unit. */
const VOLUME_DIVISOR: Record<LengthUnit, number> = {
  mm: 1, // mm³
  cm: 1_000, // 10³
  inch: 16_387.064, // 25.4³
};

const AREA_DIVISOR: Record<LengthUnit, number> = {
  mm: 1, // mm²
  cm: 100, // 10²
  inch: 645.16, // 25.4²
};

const LENGTH_DIVISOR: Record<LengthUnit, number> = {
  mm: 1,
  cm: 10,
  inch: 25.4,
};

const VOLUME_SUFFIX: Record<LengthUnit, string> = {
  mm: 'mm³',
  cm: 'cm³',
  inch: 'in³',
};

const AREA_SUFFIX: Record<LengthUnit, string> = {
  mm: 'mm²',
  cm: 'cm²',
  inch: 'in²',
};

const LENGTH_SUFFIX: Record<LengthUnit, string> = {
  mm: 'mm',
  cm: 'cm',
  inch: 'in',
};

function formatNumber(value: number, fractionDigits = 3): string {
  if (!Number.isFinite(value)) return '—';
  // Trim trailing zeros after rounding to keep panel rows compact.
  const fixed = value.toFixed(fractionDigits);
  return fixed.replace(/\.?0+$/, '') || '0';
}

function formatVolume(mm3: number | undefined, unit: LengthUnit): string {
  if (mm3 === undefined || !Number.isFinite(mm3)) return '—';
  const converted = mm3 / VOLUME_DIVISOR[unit];
  return `${formatNumber(converted)} ${VOLUME_SUFFIX[unit]}`;
}

function formatArea(mm2: number | undefined, unit: LengthUnit): string {
  if (mm2 === undefined || !Number.isFinite(mm2)) return '—';
  const converted = mm2 / AREA_DIVISOR[unit];
  return `${formatNumber(converted)} ${AREA_SUFFIX[unit]}`;
}

function formatLength(mm: number, unit: LengthUnit): string {
  const converted = mm / LENGTH_DIVISOR[unit];
  return formatNumber(converted);
}

function formatVec3(v: Vec3, unit: LengthUnit): string {
  return `(${formatLength(v.x, unit)}, ${formatLength(v.y, unit)}, ${formatLength(v.z, unit)})`;
}

function formatBbox(bbox: Bbox | undefined, unit: LengthUnit, emptyLabel: string): string {
  if (!bbox || isEmptyBbox(bbox)) return emptyLabel;
  const suffix = LENGTH_SUFFIX[unit];
  return (
    `${formatLength(bbox.min.x, unit)},${formatLength(bbox.min.y, unit)},${formatLength(bbox.min.z, unit)}` +
    ` → ` +
    `${formatLength(bbox.max.x, unit)},${formatLength(bbox.max.y, unit)},${formatLength(bbox.max.z, unit)}` +
    ` ${suffix}`
  );
}

function formatMass(mass: number | undefined): string {
  if (mass === undefined || !Number.isFinite(mass)) return '—';
  return `${formatNumber(mass)} g`;
}

// ─── density resolution ───────────────────────────────────────────────────

/**
 * Resolve the effective density (g/mm³) for a material choice + custom
 * prop. Returns undefined → mass row hides.
 *   - 'none'   : always undefined.
 *   - 'custom' : echoes the `density` prop (if positive & finite).
 *   - other    : DEFAULT_DENSITIES catalogue lookup.
 */
function resolveDensity(
  material: MaterialChoice,
  customDensity: number | undefined,
): number | undefined {
  if (material === 'none') return undefined;
  if (material === 'custom') {
    if (customDensity === undefined) return undefined;
    if (!Number.isFinite(customDensity) || customDensity <= 0) return undefined;
    return customDensity;
  }
  const d = DEFAULT_DENSITIES[material];
  return d !== undefined && d > 0 ? d : undefined;
}

// ─── component ────────────────────────────────────────────────────────────

export default function FeatureTreeStatsPanel(
  props: FeatureTreeStatsPanelProps,
): React.ReactElement {
  const { lang, tree, density, selectedNodeId } = props;
  const t = dict[lang];

  // Default material: 'custom' iff a density prop was supplied (the operator
  // explicitly asked for one), otherwise 'none' (no mass row by default).
  const [material, setMaterial] = useState<MaterialChoice>(
    density !== undefined && Number.isFinite(density) && density > 0 ? 'custom' : 'none',
  );
  const [unit, setUnit] = useState<LengthUnit>('mm');

  const effectiveDensity = resolveDensity(material, density);

  // Re-run computeStats whenever the tree or effective density changes.
  // Memoized so unit/material toggles for selectedNode-only re-renders
  // don't re-walk the tree.
  const stats: FeatureTreeStats = useMemo(
    () => computeStats(tree, effectiveDensity !== undefined ? { density: effectiveDensity } : {}),
    [tree, effectiveDensity],
  );

  const selectedStats: FeatureStats | undefined =
    selectedNodeId !== undefined ? stats.perFeature.get(selectedNodeId) : undefined;

  const isEmpty = tree.nodes.length === 0;

  return (
    <div
      data-testid="feature-tree-stats-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        padding: 12,
        fontFamily: 'system-ui, sans-serif',
        background: 'var(--nx-panel, #111827)',
        color: 'var(--nx-text, #e5e7eb)',
        borderRadius: 6,
        minWidth: 220,
        fontSize: 12,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
      }}
    >
      <div style={{ fontSize: 12, fontWeight: 600 }}>{t.title}</div>

      {/* ─── unit + material controls ──────────────────────────────────── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            fontSize: 11,
            color: 'var(--nx-text-2, #9ca3af)',
          }}
        >
          <span style={{ flex: '0 0 auto' }}>{t.material}:</span>
          <select
            data-testid="feature-tree-stats-material-select"
            value={material}
            onChange={(e) => setMaterial(e.target.value as MaterialChoice)}
            style={{
              flex: 1,
              minWidth: 0,
              background: 'var(--nx-input-bg, #1f2937)',
              color: 'inherit',
              border: '1px solid var(--nx-border, #374151)',
              borderRadius: 4,
              padding: '2px 4px',
              fontSize: 11,
            }}
          >
            {MATERIAL_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {t.materialNames[m]}
              </option>
            ))}
          </select>
        </label>

        <div
          data-testid="feature-tree-stats-unit-toggle"
          role="group"
          aria-label={t.unit}
          style={{ display: 'flex', gap: 4 }}
        >
          {(['mm', 'cm', 'inch'] as const).map((u) => (
            <button
              key={u}
              data-testid={`feature-tree-stats-unit-toggle-${u}`}
              type="button"
              aria-pressed={unit === u}
              onClick={() => setUnit(u)}
              style={{
                flex: 1,
                padding: '3px 6px',
                fontSize: 11,
                background:
                  unit === u
                    ? 'var(--nx-accent, #2563eb)'
                    : 'var(--nx-input-bg, #1f2937)',
                color: 'inherit',
                border: '1px solid var(--nx-border, #374151)',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {u}
            </button>
          ))}
        </div>
      </div>

      {/* ─── aggregate stats ───────────────────────────────────────────── */}
      {isEmpty ? (
        <div
          data-testid="feature-tree-stats-empty"
          style={{
            fontStyle: 'italic',
            color: 'var(--nx-text-2, #9ca3af)',
            padding: '8px 0',
            textAlign: 'center',
          }}
        >
          {t.empty}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <StatRow
            testid="feature-tree-stats-total-volume"
            label={t.totalVolume}
            value={formatVolume(stats.volume, unit)}
          />
          <StatRow
            testid="feature-tree-stats-surface-area"
            label={t.surfaceArea}
            value={formatArea(stats.surfaceArea, unit)}
          />
          <StatRow
            testid="feature-tree-stats-bbox"
            label={t.bbox}
            value={formatBbox(stats.bbox, unit, t.bboxEmpty)}
          />
          <StatRow
            testid="feature-tree-stats-center-of-mass"
            label={t.centerOfMass}
            value={formatVec3(stats.centerOfMass, unit)}
          />
          <StatRow
            testid="feature-tree-stats-node-count"
            label={t.nodeCount}
            value={String(stats.nodeCount)}
          />
          {effectiveDensity !== undefined && (
            <StatRow
              testid="feature-tree-stats-mass"
              label={t.mass}
              value={formatMass(stats.mass)}
            />
          )}
        </div>
      )}

      {/* ─── selected feature sub-section ──────────────────────────────── */}
      {selectedStats !== undefined && (
        <div
          data-testid="feature-tree-stats-selected"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 4,
            paddingTop: 8,
            borderTop: '1px solid var(--nx-border, #374151)',
          }}
        >
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--nx-text-2, #9ca3af)' }}>
            {t.selectedTitle}
          </div>
          <StatRow
            testid="feature-tree-stats-selected-kind"
            label={t.selectedKind}
            value={selectedStats.kind}
          />
          <StatRow
            testid="feature-tree-stats-selected-volume"
            label={t.selectedVolume}
            value={formatVolume(selectedStats.volume, unit)}
          />
          <StatRow
            testid="feature-tree-stats-selected-surface-area"
            label={t.selectedSurfaceArea}
            value={formatArea(selectedStats.surfaceArea, unit)}
          />
          <StatRow
            testid="feature-tree-stats-selected-bbox"
            label={t.selectedBbox}
            value={formatBbox(selectedStats.bbox, unit, t.bboxEmpty)}
          />
        </div>
      )}
    </div>
  );
}

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
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {value}
      </span>
    </div>
  );
}
