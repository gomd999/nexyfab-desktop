'use client';

/**
 * SketchConstraintToolbar — Phase 1.A sketch UX (ADR-013, own pro-CAD).
 *
 * Standalone toolbar for adding sketch constraints. The wrapper component
 * (SolverSketchEditor or a higher-level integrator) decides what the
 * current selection is, hands it to this toolbar, and routes `onAdd`
 * calls into its solver.
 *
 * Standalone-by-design:
 *   - Has NO dependency on planegcs / SketchSolver. Tests can mount it
 *     in jsdom without booting WASM.
 *   - Constraint IR is a thin discriminated union (kept compatible with
 *     the constraint kinds exposed by lib/sketch/solver.ts).
 *
 * 11 constraint kinds:
 *   coincident, parallel, perpendicular, tangent,
 *   equal_length, equal_radius, fix,
 *   horizontal, vertical, distance, angle
 *
 * Selection rules (enabled when satisfied — see `canApply`):
 *   coincident      : 2+ points
 *   parallel        : 2 lines
 *   perpendicular   : 2 lines
 *   tangent         : 1 line + 1 (circle|arc), OR 2 (circle|arc)
 *   equal_length    : 2+ lines
 *   equal_radius    : 2+ (circle|arc)
 *   fix             : 1+ entities (any kind)
 *   horizontal      : 1+ lines
 *   vertical        : 1+ lines
 *   distance        : 2 entities (points)            → numeric input
 *   angle           : 2 lines                         → numeric input
 *
 * Test surface (data-testids):
 *   solver-constraint-toolbar
 *   solver-constraint-${kind}-button       (11)
 *   solver-constraint-${kind}-input        (distance, angle)
 *   solver-constraint-${kind}-submit       (distance, angle)
 *   solver-constraint-clear-button
 */

import React, { useCallback, useState } from 'react';

// ─── i18n ─────────────────────────────────────────────────────────────────

export type EditorLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

// ─── entity ref + constraint IR ───────────────────────────────────────────

export type SketchEntityKind = 'point' | 'line' | 'circle' | 'arc';

export interface SketchEntityRef {
  kind: SketchEntityKind;
  id: string;
}

export type ConstraintKind =
  | 'coincident'
  | 'parallel'
  | 'perpendicular'
  | 'tangent'
  | 'equal_length'
  | 'equal_radius'
  | 'fix'
  | 'horizontal'
  | 'vertical'
  | 'distance'
  | 'angle';

export interface BaseConstraint {
  kind: ConstraintKind;
  entities: ReadonlyArray<SketchEntityRef>;
}

export interface CoincidentConstraint extends BaseConstraint { kind: 'coincident' }
export interface ParallelConstraint extends BaseConstraint { kind: 'parallel' }
export interface PerpendicularConstraint extends BaseConstraint { kind: 'perpendicular' }
export interface TangentConstraint extends BaseConstraint { kind: 'tangent' }
export interface EqualLengthConstraint extends BaseConstraint { kind: 'equal_length' }
export interface EqualRadiusConstraint extends BaseConstraint { kind: 'equal_radius' }
export interface FixConstraint extends BaseConstraint { kind: 'fix' }
export interface HorizontalConstraint extends BaseConstraint { kind: 'horizontal' }
export interface VerticalConstraint extends BaseConstraint { kind: 'vertical' }
export interface DistanceConstraint extends BaseConstraint { kind: 'distance'; value: number }
export interface AngleConstraint extends BaseConstraint { kind: 'angle'; value: number }

export type Constraint =
  | CoincidentConstraint
  | ParallelConstraint
  | PerpendicularConstraint
  | TangentConstraint
  | EqualLengthConstraint
  | EqualRadiusConstraint
  | FixConstraint
  | HorizontalConstraint
  | VerticalConstraint
  | DistanceConstraint
  | AngleConstraint;

// ─── i18n dict ────────────────────────────────────────────────────────────

interface Dict {
  toolbarLabel: string;
  coincident: string;
  parallel: string;
  perpendicular: string;
  tangent: string;
  equalLength: string;
  equalRadius: string;
  fix: string;
  horizontal: string;
  vertical: string;
  distance: string;
  angle: string;
  clear: string;
  submit: string;
  cancel: string;
  distancePrompt: string;
  anglePrompt: string;
}

const dict: Record<EditorLang, Dict> = {
  ko: {
    toolbarLabel: '제약 도구',
    coincident: '일치',
    parallel: '평행',
    perpendicular: '수직',
    tangent: '접선',
    equalLength: '등길이',
    equalRadius: '등반경',
    fix: '고정',
    horizontal: '수평',
    vertical: '수직',
    distance: '거리',
    angle: '각도',
    clear: '선택 해제',
    submit: '적용',
    cancel: '취소',
    distancePrompt: '거리 (mm)',
    anglePrompt: '각도 (°)',
  },
  en: {
    toolbarLabel: 'Constraints',
    coincident: 'Coincident',
    parallel: 'Parallel',
    perpendicular: 'Perpendicular',
    tangent: 'Tangent',
    equalLength: 'Equal Length',
    equalRadius: 'Equal Radius',
    fix: 'Fix',
    horizontal: 'Horizontal',
    vertical: 'Vertical',
    distance: 'Distance',
    angle: 'Angle',
    clear: 'Clear selection',
    submit: 'Apply',
    cancel: 'Cancel',
    distancePrompt: 'Distance (mm)',
    anglePrompt: 'Angle (°)',
  },
  ja: {
    toolbarLabel: '拘束ツール',
    coincident: '一致',
    parallel: '平行',
    perpendicular: '直角',
    tangent: '接線',
    equalLength: '等長',
    equalRadius: '等半径',
    fix: '固定',
    horizontal: '水平',
    vertical: '垂直',
    distance: '距離',
    angle: '角度',
    clear: '選択解除',
    submit: '適用',
    cancel: 'キャンセル',
    distancePrompt: '距離 (mm)',
    anglePrompt: '角度 (°)',
  },
  zh: {
    toolbarLabel: '约束工具',
    coincident: '重合',
    parallel: '平行',
    perpendicular: '垂直',
    tangent: '相切',
    equalLength: '等长',
    equalRadius: '等半径',
    fix: '固定',
    horizontal: '水平',
    vertical: '竖直',
    distance: '距离',
    angle: '角度',
    clear: '清除选择',
    submit: '应用',
    cancel: '取消',
    distancePrompt: '距离 (mm)',
    anglePrompt: '角度 (°)',
  },
  es: {
    toolbarLabel: 'Restricciones',
    coincident: 'Coincidente',
    parallel: 'Paralelo',
    perpendicular: 'Perpendicular',
    tangent: 'Tangente',
    equalLength: 'Igual longitud',
    equalRadius: 'Igual radio',
    fix: 'Fijar',
    horizontal: 'Horizontal',
    vertical: 'Vertical',
    distance: 'Distancia',
    angle: 'Ángulo',
    clear: 'Limpiar selección',
    submit: 'Aplicar',
    cancel: 'Cancelar',
    distancePrompt: 'Distancia (mm)',
    anglePrompt: 'Ángulo (°)',
  },
  ar: {
    toolbarLabel: 'قيود',
    coincident: 'متطابق',
    parallel: 'متوازي',
    perpendicular: 'متعامد',
    tangent: 'مماس',
    equalLength: 'تساوي الطول',
    equalRadius: 'تساوي نصف القطر',
    fix: 'تثبيت',
    horizontal: 'أفقي',
    vertical: 'رأسي',
    distance: 'المسافة',
    angle: 'الزاوية',
    clear: 'مسح التحديد',
    submit: 'تطبيق',
    cancel: 'إلغاء',
    distancePrompt: 'المسافة (مم)',
    anglePrompt: 'الزاوية (°)',
  },
};

// ─── selection-rule registry ──────────────────────────────────────────────

interface ConstraintDef {
  kind: ConstraintKind;
  symbol: string;
  label: (t: Dict) => string;
  needsValue?: boolean;
  valuePrompt?: (t: Dict) => string;
  canApply: (sel: ReadonlyArray<SketchEntityRef>) => boolean;
}

function countKinds(sel: ReadonlyArray<SketchEntityRef>): Record<SketchEntityKind, number> {
  const out: Record<SketchEntityKind, number> = { point: 0, line: 0, circle: 0, arc: 0 };
  for (const e of sel) out[e.kind]++;
  return out;
}

const CONSTRAINT_DEFS: ConstraintDef[] = [
  {
    kind: 'coincident',
    symbol: '⊙',
    label: (t) => t.coincident,
    canApply: (sel) => {
      const c = countKinds(sel);
      return c.point >= 2 && c.line === 0 && c.circle === 0 && c.arc === 0;
    },
  },
  {
    kind: 'parallel',
    symbol: '∥',
    label: (t) => t.parallel,
    canApply: (sel) => {
      const c = countKinds(sel);
      return c.line === 2 && sel.length === 2;
    },
  },
  {
    kind: 'perpendicular',
    symbol: '⟂',
    label: (t) => t.perpendicular,
    canApply: (sel) => {
      const c = countKinds(sel);
      return c.line === 2 && sel.length === 2;
    },
  },
  {
    kind: 'tangent',
    symbol: '◜',
    label: (t) => t.tangent,
    canApply: (sel) => {
      if (sel.length !== 2) return false;
      const c = countKinds(sel);
      const curves = c.circle + c.arc;
      // line + curve
      if (c.line === 1 && curves === 1) return true;
      // 2 curves (any combo of circles/arcs)
      if (c.line === 0 && curves === 2) return true;
      return false;
    },
  },
  {
    kind: 'equal_length',
    symbol: '=',
    label: (t) => t.equalLength,
    canApply: (sel) => {
      const c = countKinds(sel);
      return c.line >= 2 && c.point === 0 && c.circle === 0 && c.arc === 0;
    },
  },
  {
    kind: 'equal_radius',
    symbol: '=R',
    label: (t) => t.equalRadius,
    canApply: (sel) => {
      const c = countKinds(sel);
      return (c.circle + c.arc) >= 2 && c.point === 0 && c.line === 0;
    },
  },
  {
    kind: 'fix',
    symbol: '⚓',
    label: (t) => t.fix,
    canApply: (sel) => sel.length >= 1,
  },
  {
    kind: 'horizontal',
    symbol: '↔',
    label: (t) => t.horizontal,
    canApply: (sel) => {
      const c = countKinds(sel);
      return c.line >= 1 && c.point === 0 && c.circle === 0 && c.arc === 0;
    },
  },
  {
    kind: 'vertical',
    symbol: '↕',
    label: (t) => t.vertical,
    canApply: (sel) => {
      const c = countKinds(sel);
      return c.line >= 1 && c.point === 0 && c.circle === 0 && c.arc === 0;
    },
  },
  {
    kind: 'distance',
    symbol: '⇔',
    label: (t) => t.distance,
    needsValue: true,
    valuePrompt: (t) => t.distancePrompt,
    canApply: (sel) => {
      if (sel.length !== 2) return false;
      const c = countKinds(sel);
      return c.point === 2;
    },
  },
  {
    kind: 'angle',
    symbol: '∠',
    label: (t) => t.angle,
    needsValue: true,
    valuePrompt: (t) => t.anglePrompt,
    canApply: (sel) => {
      const c = countKinds(sel);
      return c.line === 2 && sel.length === 2;
    },
  },
];

// ─── props ────────────────────────────────────────────────────────────────

export interface SketchConstraintToolbarProps {
  lang: EditorLang;
  selection: ReadonlyArray<SketchEntityRef>;
  onAdd: (constraint: Constraint) => void;
  onClear?: () => void;
  disabled?: boolean;
}

// ─── component ────────────────────────────────────────────────────────────

export default function SketchConstraintToolbar({
  lang,
  selection,
  onAdd,
  onClear,
  disabled = false,
}: SketchConstraintToolbarProps): React.JSX.Element {
  const t = dict[lang] ?? dict.en;
  const [openValueFor, setOpenValueFor] = useState<ConstraintKind | null>(null);

  const handleClick = useCallback(
    (def: ConstraintDef) => {
      if (def.needsValue) {
        setOpenValueFor((prev) => (prev === def.kind ? null : def.kind));
        return;
      }
      onAdd({ kind: def.kind, entities: [...selection] } as Constraint);
    },
    [onAdd, selection],
  );

  const handleValueSubmit = useCallback(
    (def: ConstraintDef, raw: string) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      const c: Constraint =
        def.kind === 'distance'
          ? { kind: 'distance', entities: [...selection], value }
          : { kind: 'angle', entities: [...selection], value };
      onAdd(c);
      setOpenValueFor(null);
    },
    [onAdd, selection],
  );

  return (
    <div
      data-testid="solver-constraint-toolbar"
      role="toolbar"
      aria-label={t.toolbarLabel}
      style={{
        display: 'flex',
        flexDirection: 'row',
        gap: 4,
        padding: 6,
        flexWrap: 'wrap',
        alignItems: 'center',
        background: 'var(--nx-panel-2)',
        border: '1px solid var(--nx-border)',
        borderRadius: 6,
      }}
    >
      {CONSTRAINT_DEFS.map((def) => {
        const enabled = !disabled && def.canApply(selection);
        const label = def.label(t);
        const isOpen = openValueFor === def.kind;
        return (
          <span key={def.kind} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              data-testid={`solver-constraint-${def.kind}-button`}
              onClick={() => handleClick(def)}
              disabled={!enabled}
              aria-label={label}
              title={label}
              style={{
                minWidth: 36,
                height: 32,
                padding: '0 8px',
                border: '1px solid var(--nx-border)',
                borderRadius: 4,
                background: enabled ? 'var(--nx-panel)' : 'var(--nx-panel-2)',
                color: enabled ? 'var(--nx-text)' : 'var(--nx-text-2)',
                cursor: enabled ? 'pointer' : 'not-allowed',
                fontSize: 14,
                lineHeight: 1,
                display: 'inline-flex',
                gap: 4,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <span aria-hidden="true">{def.symbol}</span>
              <span style={{ fontSize: 11 }}>{label}</span>
            </button>
            {def.needsValue && isOpen && enabled ? (
              <ValuePopover
                def={def}
                t={t}
                onSubmit={(raw) => handleValueSubmit(def, raw)}
                onCancel={() => setOpenValueFor(null)}
              />
            ) : null}
          </span>
        );
      })}
      {onClear ? (
        <button
          type="button"
          data-testid="solver-constraint-clear-button"
          onClick={onClear}
          disabled={disabled}
          aria-label={t.clear}
          title={t.clear}
          style={{
            marginInlineStart: 'auto',
            height: 32,
            padding: '0 10px',
            border: '1px solid var(--nx-border)',
            borderRadius: 4,
            background: disabled ? 'var(--nx-panel-2)' : 'var(--nx-panel)',
            color: disabled ? 'var(--nx-text-2)' : 'var(--nx-text-2)',
            cursor: disabled ? 'not-allowed' : 'pointer',
            fontSize: 12,
          }}
        >
          {t.clear}
        </button>
      ) : null}
    </div>
  );
}

// ─── inline numeric popover ───────────────────────────────────────────────

interface ValuePopoverProps {
  def: ConstraintDef;
  t: Dict;
  onSubmit: (raw: string) => void;
  onCancel: () => void;
}

function ValuePopover({ def, t, onSubmit, onCancel }: ValuePopoverProps): React.JSX.Element {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const prompt = def.valuePrompt ? def.valuePrompt(t) : '';
  return (
    <form
      data-testid={`solver-constraint-${def.kind}-popover`}
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(inputRef.current?.value ?? '');
      }}
      style={{
        position: 'absolute',
        top: '100%',
        insetInlineStart: 0,
        marginTop: 4,
        zIndex: 10,
        display: 'flex',
        gap: 4,
        padding: 6,
        background: 'var(--nx-panel)',
        border: '1px solid var(--nx-border)',
        borderRadius: 4,
        boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
      }}
    >
      <input
        ref={inputRef}
        type="number"
        step="any"
        defaultValue={def.kind === 'angle' ? '90' : '10'}
        data-testid={`solver-constraint-${def.kind}-input`}
        aria-label={prompt}
        placeholder={prompt}
        style={{
          width: 80,
          padding: '4px 6px',
          border: '1px solid var(--nx-border)',
          borderRadius: 3,
          fontSize: 12,
        }}
      />
      <button
        type="submit"
        data-testid={`solver-constraint-${def.kind}-submit`}
        style={{
          padding: '4px 8px',
          border: '1px solid #2563eb',
          borderRadius: 3,
          background: '#2563eb',
          color: '#fff',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {t.submit}
      </button>
      <button
        type="button"
        data-testid={`solver-constraint-${def.kind}-cancel`}
        onClick={onCancel}
        style={{
          padding: '4px 8px',
          border: '1px solid var(--nx-border)',
          borderRadius: 3,
          background: 'var(--nx-panel)',
          color: 'var(--nx-text-2)',
          fontSize: 11,
          cursor: 'pointer',
        }}
      >
        {t.cancel}
      </button>
    </form>
  );
}
