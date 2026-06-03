'use client';

/**
 * SketchViewOptionsPanel — Phase 1.B sketch UX (ADR-013, own pro-CAD).
 *
 * Standalone control panel exposing per-user view preferences for the
 * solver-backed sketch editor (SolverSketchEditor). Renders a small set of
 * toggles that a wrapper component (SolverSketchEditorWithExtrude or a
 * future settings drawer) folds into the editor's render path.
 *
 * Why standalone:
 *   - SolverSketchEditor is already large and its tests pin many testids;
 *     hanging another disclosure inside it would force surgery on the
 *     existing snap/property/overlay/AI panels. This panel is a leaf
 *     component with no solver / WASM / canvas dependency, so it mounts
 *     instantly in jsdom and stays cheap to test.
 *   - The wrapper owns the canonical `ViewOptions` state and persists it
 *     (Phase 2 — likely via localStorage keyed by user/project). This
 *     panel is purely controlled: parent passes the current `options`,
 *     panel emits partial diffs via `onChange`.
 *
 * Default policy (see DEFAULT_VIEW_OPTIONS below):
 *   - All visibility toggles default ON (grid / axes / dimensions /
 *     constraint glyphs). A first-time user gets the full CAD HUD; power
 *     users can dim individual layers without losing the others.
 *   - gridSpacing defaults to 10 mm — the planegcs sketches in the
 *     codebase work in millimetres, and 10 mm gives ~10 squares across a
 *     100 mm starter sketch which matches the existing canvas thumbnails.
 *   - axisOrigin defaults to 'bottom-left' — CAD convention (Y up) so it
 *     matches replicad / OCCT / OpenSCAD output. The 'top-left' option
 *     exists for users coming from screen-space tools (Figma / SVG).
 *     'center' is the natural choice for symmetry-heavy sketches.
 *   - darkMode defaults to TRUE because the editor chrome already uses
 *     the var(--nx-panel) dark token set; the option is exposed so the
 *     wrapper can flip to a light render in printable contexts.
 *
 * Test surface (data-testid):
 *   solver-sketch-view-options-panel
 *   solver-sketch-view-option-{showGrid|showAxes|showDimensions|showConstraintGlyphs|darkMode}
 *   solver-sketch-view-option-gridSpacing
 *   solver-sketch-view-option-axisOrigin-{top-left|bottom-left|center}
 *   solver-sketch-view-option-reset
 */

import React, { useCallback } from 'react';

// ─── i18n ────────────────────────────────────────────────────────────────

export type ViewOptionsLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

interface Dict {
  panelTitle: string;
  showGrid: string;
  showAxes: string;
  showDimensions: string;
  showConstraintGlyphs: string;
  darkMode: string;
  gridSpacing: string;
  axisOrigin: string;
  axisOriginTopLeft: string;
  axisOriginBottomLeft: string;
  axisOriginCenter: string;
  resetDefaults: string;
  visibilityLegend: string;
}

const dict: Record<ViewOptionsLang, Dict> = {
  ko: {
    panelTitle: '뷰 옵션',
    showGrid: '그리드',
    showAxes: '축',
    showDimensions: '치수',
    showConstraintGlyphs: '구속 기호',
    darkMode: '다크 모드',
    gridSpacing: '그리드 간격',
    axisOrigin: '축 원점',
    axisOriginTopLeft: '왼쪽 위',
    axisOriginBottomLeft: '왼쪽 아래',
    axisOriginCenter: '가운데',
    resetDefaults: '기본값으로 초기화',
    visibilityLegend: '표시 항목',
  },
  en: {
    panelTitle: 'View options',
    showGrid: 'Grid',
    showAxes: 'Axes',
    showDimensions: 'Dimensions',
    showConstraintGlyphs: 'Constraint glyphs',
    darkMode: 'Dark mode',
    gridSpacing: 'Grid spacing',
    axisOrigin: 'Axis origin',
    axisOriginTopLeft: 'Top-left',
    axisOriginBottomLeft: 'Bottom-left',
    axisOriginCenter: 'Center',
    resetDefaults: 'Reset to defaults',
    visibilityLegend: 'Visibility',
  },
  ja: {
    panelTitle: '表示オプション',
    showGrid: 'グリッド',
    showAxes: '軸',
    showDimensions: '寸法',
    showConstraintGlyphs: '拘束記号',
    darkMode: 'ダークモード',
    gridSpacing: 'グリッド間隔',
    axisOrigin: '軸の原点',
    axisOriginTopLeft: '左上',
    axisOriginBottomLeft: '左下',
    axisOriginCenter: '中央',
    resetDefaults: '既定値にリセット',
    visibilityLegend: '表示',
  },
  zh: {
    panelTitle: '视图选项',
    showGrid: '网格',
    showAxes: '坐标轴',
    showDimensions: '尺寸',
    showConstraintGlyphs: '约束符号',
    darkMode: '深色模式',
    gridSpacing: '网格间距',
    axisOrigin: '坐标原点',
    axisOriginTopLeft: '左上',
    axisOriginBottomLeft: '左下',
    axisOriginCenter: '中心',
    resetDefaults: '恢复默认',
    visibilityLegend: '可见性',
  },
  es: {
    panelTitle: 'Opciones de vista',
    showGrid: 'Cuadrícula',
    showAxes: 'Ejes',
    showDimensions: 'Cotas',
    showConstraintGlyphs: 'Glifos de restricción',
    darkMode: 'Modo oscuro',
    gridSpacing: 'Espaciado de cuadrícula',
    axisOrigin: 'Origen de ejes',
    axisOriginTopLeft: 'Arriba izquierda',
    axisOriginBottomLeft: 'Abajo izquierda',
    axisOriginCenter: 'Centro',
    resetDefaults: 'Restablecer valores',
    visibilityLegend: 'Visibilidad',
  },
  ar: {
    panelTitle: 'خيارات العرض',
    showGrid: 'الشبكة',
    showAxes: 'المحاور',
    showDimensions: 'الأبعاد',
    showConstraintGlyphs: 'رموز القيد',
    darkMode: 'الوضع الداكن',
    gridSpacing: 'تباعد الشبكة',
    axisOrigin: 'أصل المحاور',
    axisOriginTopLeft: 'أعلى اليسار',
    axisOriginBottomLeft: 'أسفل اليسار',
    axisOriginCenter: 'الوسط',
    resetDefaults: 'إعادة التعيين',
    visibilityLegend: 'الرؤية',
  },
};

// ─── types ───────────────────────────────────────────────────────────────

export type AxisOrigin = 'top-left' | 'bottom-left' | 'center';

export interface ViewOptions {
  showGrid: boolean;
  showAxes: boolean;
  showDimensions: boolean;
  /** Horizontal / vertical / perpendicular / parallel constraint glyphs (H / V / ⊥ / ∥). */
  showConstraintGlyphs: boolean;
  /** Grid line spacing in millimetres; must be a positive finite number. */
  gridSpacing: number;
  /** CAD convention default is `'bottom-left'` (Y up). */
  axisOrigin: AxisOrigin;
  darkMode: boolean;
}

/**
 * Canonical defaults — kept as an exported `const` so tests and the
 * wrapper can both reach for the same source of truth instead of
 * duplicating literals.
 */
export const DEFAULT_VIEW_OPTIONS: ViewOptions = {
  showGrid: true,
  showAxes: true,
  showDimensions: true,
  showConstraintGlyphs: true,
  gridSpacing: 10,
  axisOrigin: 'bottom-left',
  darkMode: true,
};

const AXIS_ORIGINS: ReadonlyArray<AxisOrigin> = ['top-left', 'bottom-left', 'center'];

// ─── props ───────────────────────────────────────────────────────────────

export interface SketchViewOptionsPanelProps {
  lang: ViewOptionsLang;
  options: ViewOptions;
  onChange: (opts: Partial<ViewOptions>) => void;
}

// ─── colour tokens ───────────────────────────────────────────────────────

const C = {
  bg: 'var(--nx-panel)',
  bgCard: 'var(--nx-panel-2)',
  border: 'var(--nx-border)',
  text: 'var(--nx-text)',
  textMuted: 'var(--nx-text-2)',
  accent: 'var(--nx-accent)',
} as const;

// ─── component ───────────────────────────────────────────────────────────

export default function SketchViewOptionsPanel(
  props: SketchViewOptionsPanelProps,
): React.ReactElement {
  const { lang, options, onChange } = props;
  const d = dict[lang];

  const handleCheckbox = useCallback(
    (key: 'showGrid' | 'showAxes' | 'showDimensions' | 'showConstraintGlyphs' | 'darkMode') =>
      (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange({ [key]: e.target.checked } as Partial<ViewOptions>);
      },
    [onChange],
  );

  const handleGridSpacing = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const raw = e.target.value;
      const parsed = Number.parseFloat(raw);
      // Suppress non-finite / non-positive values — keep current state untouched.
      if (!Number.isFinite(parsed) || parsed <= 0) return;
      onChange({ gridSpacing: parsed });
    },
    [onChange],
  );

  const handleAxisOrigin = useCallback(
    (origin: AxisOrigin) => () => {
      onChange({ axisOrigin: origin });
    },
    [onChange],
  );

  const handleReset = useCallback(() => {
    // Emit the entire default set so the parent can replace state in one go.
    onChange({ ...DEFAULT_VIEW_OPTIONS });
  }, [onChange]);

  return (
    <div
      data-testid="solver-sketch-view-options-panel"
      dir={lang === 'ar' ? 'rtl' : 'ltr'}
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        padding: 12,
        border: `1px solid ${C.border}`,
        borderRadius: 8,
        background: C.bg,
        color: C.text,
        fontFamily: 'system-ui, sans-serif',
        fontSize: 12,
        minWidth: 220,
      }}
    >
      <div style={{ fontWeight: 700, fontSize: 13, color: C.text }}>
        {d.panelTitle}
      </div>

      {/* ── visibility toggles ─────────────────────────────────────── */}
      <fieldset
        style={{
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: '6px 8px',
          margin: 0,
          background: C.bgCard,
        }}
      >
        <legend style={{ fontSize: 10, color: C.textMuted, padding: '0 4px' }}>
          {d.visibilityLegend}
        </legend>
        <CheckboxRow
          testid="solver-sketch-view-option-showGrid"
          label={d.showGrid}
          checked={options.showGrid}
          onChange={handleCheckbox('showGrid')}
        />
        <CheckboxRow
          testid="solver-sketch-view-option-showAxes"
          label={d.showAxes}
          checked={options.showAxes}
          onChange={handleCheckbox('showAxes')}
        />
        <CheckboxRow
          testid="solver-sketch-view-option-showDimensions"
          label={d.showDimensions}
          checked={options.showDimensions}
          onChange={handleCheckbox('showDimensions')}
        />
        <CheckboxRow
          testid="solver-sketch-view-option-showConstraintGlyphs"
          label={d.showConstraintGlyphs}
          checked={options.showConstraintGlyphs}
          onChange={handleCheckbox('showConstraintGlyphs')}
        />
        <CheckboxRow
          testid="solver-sketch-view-option-darkMode"
          label={d.darkMode}
          checked={options.darkMode}
          onChange={handleCheckbox('darkMode')}
        />
      </fieldset>

      {/* ── grid spacing ──────────────────────────────────────────── */}
      <label
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          fontSize: 11,
          color: C.text,
        }}
      >
        <span>{d.gridSpacing}</span>
        <input
          type="number"
          data-testid="solver-sketch-view-option-gridSpacing"
          value={options.gridSpacing}
          min={0.001}
          step={1}
          onChange={handleGridSpacing}
          style={{
            padding: '4px 6px',
            border: `1px solid ${C.border}`,
            borderRadius: 4,
            background: C.bgCard,
            color: C.text,
            fontSize: 12,
            fontFamily: 'inherit',
          }}
        />
      </label>

      {/* ── axis origin ───────────────────────────────────────────── */}
      <fieldset
        style={{
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          padding: '6px 8px',
          margin: 0,
          background: C.bgCard,
        }}
      >
        <legend style={{ fontSize: 10, color: C.textMuted, padding: '0 4px' }}>
          {d.axisOrigin}
        </legend>
        {AXIS_ORIGINS.map((origin) => {
          const label =
            origin === 'top-left'
              ? d.axisOriginTopLeft
              : origin === 'bottom-left'
                ? d.axisOriginBottomLeft
                : d.axisOriginCenter;
          return (
            <label
              key={origin}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                fontSize: 11,
                color: C.text,
                padding: '2px 0',
                cursor: 'pointer',
              }}
            >
              <input
                type="radio"
                name="solver-sketch-axis-origin"
                data-testid={`solver-sketch-view-option-axisOrigin-${origin}`}
                checked={options.axisOrigin === origin}
                onChange={handleAxisOrigin(origin)}
              />
              <span>{label}</span>
            </label>
          );
        })}
      </fieldset>

      {/* ── reset ─────────────────────────────────────────────────── */}
      <button
        type="button"
        data-testid="solver-sketch-view-option-reset"
        onClick={handleReset}
        style={{
          padding: '6px 10px',
          border: `1px solid ${C.border}`,
          borderRadius: 6,
          background: C.bgCard,
          color: C.text,
          fontSize: 11,
          fontWeight: 600,
          cursor: 'pointer',
        }}
      >
        {d.resetDefaults}
      </button>
    </div>
  );
}

// ─── checkbox subcomponent ───────────────────────────────────────────────

interface CheckboxRowProps {
  testid: string;
  label: string;
  checked: boolean;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
}

function CheckboxRow(props: CheckboxRowProps): React.ReactElement {
  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        fontSize: 11,
        color: C.text,
        padding: '2px 0',
        cursor: 'pointer',
      }}
    >
      <input
        type="checkbox"
        data-testid={props.testid}
        checked={props.checked}
        onChange={props.onChange}
      />
      <span>{props.label}</span>
    </label>
  );
}
