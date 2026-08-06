'use client';

/**
 * MateConstraintsToolbar — Phase 3.A assembly UX (ADR-013 own pro-CAD).
 *
 * Standalone toolbar for adding assembly mate constraints between selected
 * mate references. The wrapper component (AssemblyBrowserModal, an assembly
 * viewport integrator, etc.) tracks the current selection (pairs of
 * partId/refId/refKind tuples) and routes `onAdd(mate)` into its assembly
 * state.
 *
 * Standalone-by-design:
 *   - No dependency on AssemblyBrowserModal, mateSolver, or geometry
 *     resolution. Pure UI + selection-rule registry.
 *   - Emits `Mate` IR objects validated by `validateMate` (mate.ts).
 *   - Mate IR (`src/lib/assembly/mate.ts`) is NOT modified.
 *
 * 12 button kinds (UI-level — `coincident` IR is split into two buttons,
 *  `coincident_point` and `coincident_plane`, because their selection rules
 *  differ; both map to `kind: 'coincident'` in the emitted Mate):
 *   concentric, coincident_point, coincident_plane,
 *   parallel, perpendicular, distance, angle, tangent,
 *   hinge, slot, gear, rack_pinion
 *
 * Enable rules (see `MATE_DEFS` below for canonical source):
 *   concentric        : 2 axes
 *   coincident_point  : 2 points
 *   coincident_plane  : 2 planes
 *   parallel          : 2 axes OR 2 planes
 *   perpendicular     : 2 axes OR 2 planes
 *   distance          : 2 points OR 2 planes      → numeric popover
 *   angle             : 2 axes OR 2 planes        → numeric popover
 *   tangent           : edge + axis OR 2 edges
 *   hinge             : 2 axes
 *   slot              : edge + axis
 *   gear              : 2 axes                    → ratio popover
 *   rack_pinion       : axis + edge               → pinionRadius popover
 *
 * Cross-part rule: every mate requires exactly 2 selected refs from
 * DIFFERENT parts. Two refs from the same partId disable all buttons
 * (matches `validateMate`'s same-part rejection in mate.ts).
 *
 * Test surface (data-testids):
 *   solver-mate-toolbar
 *   solver-mate-${kind}-button       (12)
 *   solver-mate-${kind}-popover      (distance, angle, gear, rack_pinion)
 *   solver-mate-${kind}-input        (distance, angle, gear, rack_pinion)
 *   solver-mate-${kind}-submit       (distance, angle, gear, rack_pinion)
 *   solver-mate-clear-button
 */

import React, { useCallback, useState } from 'react';
import type { Mate, MateRefKind } from '@/lib/assembly/mate';

// ─── i18n ─────────────────────────────────────────────────────────────────

export type EditorLang = 'ko' | 'en' | 'ja' | 'zh' | 'es' | 'ar';

// ─── selection ref ────────────────────────────────────────────────────────

/** Subset of {@link MateRefKind} the toolbar currently picks against. */
export type ToolbarRefKind = Extract<MateRefKind, 'face' | 'axis' | 'plane' | 'point' | 'edge'>;

export interface ToolbarSelectionRef {
  partId: string;
  refId: string;
  refKind: ToolbarRefKind;
}

// ─── button kinds (UI level) ──────────────────────────────────────────────

export type MateButtonKind =
  | 'concentric'
  | 'coincident_point'
  | 'coincident_plane'
  | 'parallel'
  | 'perpendicular'
  | 'distance'
  | 'angle'
  | 'tangent'
  | 'hinge'
  | 'slot'
  | 'gear'
  | 'rack_pinion';

// ─── i18n dict ────────────────────────────────────────────────────────────

interface Dict {
  toolbarLabel: string;
  concentric: string;
  coincidentPoint: string;
  coincidentPlane: string;
  parallel: string;
  perpendicular: string;
  distance: string;
  angle: string;
  tangent: string;
  hinge: string;
  slot: string;
  gear: string;
  rackPinion: string;
  clear: string;
  submit: string;
  cancel: string;
  distancePrompt: string;
  anglePrompt: string;
  ratioPrompt: string;
  pinionRadiusPrompt: string;
}

const dict: Record<EditorLang, Dict> = {
  ko: {
    toolbarLabel: '메이트 도구',
    concentric: '동심',
    coincidentPoint: '점일치',
    coincidentPlane: '면일치',
    parallel: '평행',
    perpendicular: '수직',
    distance: '거리',
    angle: '각도',
    tangent: '접선',
    hinge: '힌지',
    slot: '슬롯',
    gear: '기어',
    rackPinion: '랙피니언',
    clear: '선택 해제',
    submit: '적용',
    cancel: '취소',
    distancePrompt: '거리 (mm)',
    anglePrompt: '각도 (°)',
    ratioPrompt: '기어비',
    pinionRadiusPrompt: '피니언 반경 (mm)',
  },
  en: {
    toolbarLabel: 'Mates',
    concentric: 'Concentric',
    coincidentPoint: 'Coincident Point',
    coincidentPlane: 'Coincident Plane',
    parallel: 'Parallel',
    perpendicular: 'Perpendicular',
    distance: 'Distance',
    angle: 'Angle',
    tangent: 'Tangent',
    hinge: 'Hinge',
    slot: 'Slot',
    gear: 'Gear',
    rackPinion: 'Rack & Pinion',
    clear: 'Clear selection',
    submit: 'Apply',
    cancel: 'Cancel',
    distancePrompt: 'Distance (mm)',
    anglePrompt: 'Angle (°)',
    ratioPrompt: 'Gear ratio',
    pinionRadiusPrompt: 'Pinion radius (mm)',
  },
  ja: {
    toolbarLabel: '合致ツール',
    concentric: '同心',
    coincidentPoint: '点一致',
    coincidentPlane: '面一致',
    parallel: '平行',
    perpendicular: '直角',
    distance: '距離',
    angle: '角度',
    tangent: '接線',
    hinge: 'ヒンジ',
    slot: 'スロット',
    gear: 'ギア',
    rackPinion: 'ラック&ピニオン',
    clear: '選択解除',
    submit: '適用',
    cancel: 'キャンセル',
    distancePrompt: '距離 (mm)',
    anglePrompt: '角度 (°)',
    ratioPrompt: 'ギア比',
    pinionRadiusPrompt: 'ピニオン半径 (mm)',
  },
  zh: {
    toolbarLabel: '配合工具',
    concentric: '同心',
    coincidentPoint: '点重合',
    coincidentPlane: '面重合',
    parallel: '平行',
    perpendicular: '垂直',
    distance: '距离',
    angle: '角度',
    tangent: '相切',
    hinge: '铰链',
    slot: '滑槽',
    gear: '齿轮',
    rackPinion: '齿轮齿条',
    clear: '清除选择',
    submit: '应用',
    cancel: '取消',
    distancePrompt: '距离 (mm)',
    anglePrompt: '角度 (°)',
    ratioPrompt: '齿轮比',
    pinionRadiusPrompt: '齿轮半径 (mm)',
  },
  es: {
    toolbarLabel: 'Restricciones',
    concentric: 'Concéntrico',
    coincidentPoint: 'Coincidente (punto)',
    coincidentPlane: 'Coincidente (plano)',
    parallel: 'Paralelo',
    perpendicular: 'Perpendicular',
    distance: 'Distancia',
    angle: 'Ángulo',
    tangent: 'Tangente',
    hinge: 'Bisagra',
    slot: 'Ranura',
    gear: 'Engranaje',
    rackPinion: 'Cremallera y piñón',
    clear: 'Limpiar selección',
    submit: 'Aplicar',
    cancel: 'Cancelar',
    distancePrompt: 'Distancia (mm)',
    anglePrompt: 'Ángulo (°)',
    ratioPrompt: 'Relación de engranaje',
    pinionRadiusPrompt: 'Radio del piñón (mm)',
  },
  ar: {
    toolbarLabel: 'قيود التجميع',
    concentric: 'متمركز',
    coincidentPoint: 'تطابق نقطي',
    coincidentPlane: 'تطابق سطحي',
    parallel: 'متوازي',
    perpendicular: 'متعامد',
    distance: 'المسافة',
    angle: 'الزاوية',
    tangent: 'مماس',
    hinge: 'مفصلة',
    slot: 'مزلاج',
    gear: 'ترس',
    rackPinion: 'ترس ومسنن',
    clear: 'مسح التحديد',
    submit: 'تطبيق',
    cancel: 'إلغاء',
    distancePrompt: 'المسافة (مم)',
    anglePrompt: 'الزاوية (°)',
    ratioPrompt: 'نسبة التروس',
    pinionRadiusPrompt: 'نصف قطر الترس (مم)',
  },
};

// ─── selection-rule helpers ───────────────────────────────────────────────

/** True iff the pair has refKinds `(a, b)` in some order. */
function pairKinds(
  sel: ReadonlyArray<ToolbarSelectionRef>,
  a: ToolbarRefKind,
  b: ToolbarRefKind,
): boolean {
  if (sel.length !== 2) return false;
  const [k0, k1] = [sel[0]!.refKind, sel[1]!.refKind];
  return (k0 === a && k1 === b) || (k0 === b && k1 === a);
}

/** True iff both refs are of the given kind. */
function bothAre(
  sel: ReadonlyArray<ToolbarSelectionRef>,
  kind: ToolbarRefKind,
): boolean {
  return sel.length === 2 && sel[0]!.refKind === kind && sel[1]!.refKind === kind;
}

/**
 * Cross-part precondition: every mate links exactly 2 refs from DIFFERENT
 * parts. mate.ts `validateMate` rejects same-part mates, so we surface it
 * upstream in the UI by graying every button.
 */
function isCrossPartPair(sel: ReadonlyArray<ToolbarSelectionRef>): boolean {
  return sel.length === 2 && sel[0]!.partId !== sel[1]!.partId;
}

// ─── value popover specs ──────────────────────────────────────────────────

interface ValueSpec {
  /** Initial value shown in the input. */
  defaultValue: string;
  /** Localized prompt label. */
  prompt: (t: Dict) => string;
  /** Reject the value when this predicate fires. */
  isInvalid?: (v: number) => boolean;
}

// ─── mate definition registry ─────────────────────────────────────────────

interface MateDef {
  kind: MateButtonKind;
  symbol: string;
  label: (t: Dict) => string;
  /** Enabled iff selection satisfies this predicate (and cross-part). */
  canApply: (sel: ReadonlyArray<ToolbarSelectionRef>) => boolean;
  /** Optional popover spec — keyed off the value the popover collects. */
  value?: ValueSpec;
  /**
   * Build the Mate IR for the given selection and (optional) input value.
   * Caller guarantees `canApply(selection)` is true and selection is
   * cross-part. `id` is generated by the caller per `onAdd` call.
   */
  build: (
    id: string,
    selection: ReadonlyArray<ToolbarSelectionRef>,
    value: number | undefined,
  ) => Mate;
}

/** Stable monotonic id (jsdom timer-friendly — not security-sensitive). */
let _mateIdCounter = 0;
function nextMateId(kind: MateButtonKind): string {
  _mateIdCounter += 1;
  return `mate-${kind}-${_mateIdCounter}`;
}

const MATE_DEFS: MateDef[] = [
  {
    kind: 'concentric',
    symbol: '⊕', // ⊕
    label: (t) => t.concentric,
    canApply: (sel) => bothAre(sel, 'axis'),
    build: (id, sel) => ({
      kind: 'concentric',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
    }),
  },
  {
    kind: 'coincident_point',
    symbol: '⊙', // ⊙
    label: (t) => t.coincidentPoint,
    canApply: (sel) => bothAre(sel, 'point'),
    build: (id, sel) => ({
      kind: 'coincident',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
    }),
  },
  {
    kind: 'coincident_plane',
    symbol: '⊞', // ⊞
    label: (t) => t.coincidentPlane,
    canApply: (sel) => bothAre(sel, 'plane'),
    build: (id, sel) => ({
      kind: 'coincident',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
    }),
  },
  {
    kind: 'parallel',
    symbol: '∥', // ∥
    label: (t) => t.parallel,
    canApply: (sel) => bothAre(sel, 'axis') || bothAre(sel, 'plane'),
    build: (id, sel) => ({
      kind: 'parallel',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
    }),
  },
  {
    kind: 'perpendicular',
    symbol: '⟂', // ⟂
    label: (t) => t.perpendicular,
    canApply: (sel) => bothAre(sel, 'axis') || bothAre(sel, 'plane'),
    build: (id, sel) => ({
      kind: 'perpendicular',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
    }),
  },
  {
    kind: 'distance',
    symbol: '⇔', // ⇔
    label: (t) => t.distance,
    canApply: (sel) => bothAre(sel, 'point') || bothAre(sel, 'plane'),
    value: {
      defaultValue: '10',
      prompt: (t) => t.distancePrompt,
      // mate.ts validateMate requires ≥ 0; reject negatives at the UI edge.
      isInvalid: (v) => v < 0,
    },
    build: (id, sel, value) => ({
      kind: 'distance',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
      value: value ?? 0,
    }),
  },
  {
    kind: 'angle',
    symbol: '∠', // ∠
    label: (t) => t.angle,
    canApply: (sel) => bothAre(sel, 'axis') || bothAre(sel, 'plane'),
    value: {
      defaultValue: '90',
      prompt: (t) => t.anglePrompt,
      // mate.ts validateMate enforces [-180, 180].
      isInvalid: (v) => v < -180 || v > 180,
    },
    build: (id, sel, value) => ({
      kind: 'angle',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
      value: value ?? 0,
    }),
  },
  {
    kind: 'tangent',
    symbol: '◜', // ◜
    label: (t) => t.tangent,
    // mate.ts allows tangent on (face, face) or (edge, face) — the toolbar
    // doesn't surface faces yet, so we approximate with edge+axis (axis is
    // a circular-edge proxy) OR 2 edges.
    canApply: (sel) => pairKinds(sel, 'edge', 'axis') || bothAre(sel, 'edge'),
    build: (id, sel) => ({
      kind: 'tangent',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
    }),
  },
  {
    kind: 'hinge',
    symbol: '⟲', // ⟲
    label: (t) => t.hinge,
    canApply: (sel) => bothAre(sel, 'axis'),
    build: (id, sel) => ({
      kind: 'hinge',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
    }),
  },
  {
    kind: 'slot',
    symbol: '▭', // ▭
    label: (t) => t.slot,
    canApply: (sel) => pairKinds(sel, 'edge', 'axis'),
    build: (id, sel) => {
      // SlotMate IR: a = edge, b = axis. Reorder if user clicked axis first.
      const edge = sel[0]!.refKind === 'edge' ? sel[0]! : sel[1]!;
      const axis = sel[0]!.refKind === 'axis' ? sel[0]! : sel[1]!;
      return {
        kind: 'slot',
        id,
        a: { ...edge },
        b: { ...axis },
      };
    },
  },
  {
    kind: 'gear',
    symbol: '⚙', // ⚙
    label: (t) => t.gear,
    canApply: (sel) => bothAre(sel, 'axis'),
    value: {
      defaultValue: '1',
      prompt: (t) => t.ratioPrompt,
      // mate.ts validateMate requires ratio > 0.
      isInvalid: (v) => v <= 0,
    },
    build: (id, sel, value) => ({
      kind: 'gear',
      id,
      a: { ...sel[0]! },
      b: { ...sel[1]! },
      ratio: value ?? 1,
    }),
  },
  {
    kind: 'rack_pinion',
    symbol: '⫹', // ⫹ (rough rack-pinion glyph)
    label: (t) => t.rackPinion,
    canApply: (sel) => pairKinds(sel, 'axis', 'edge'),
    value: {
      defaultValue: '10',
      prompt: (t) => t.pinionRadiusPrompt,
      // mate.ts validateMate requires pinionRadius > 0.
      isInvalid: (v) => v <= 0,
    },
    build: (id, sel, value) => {
      // RackPinionMate IR: a = pinion axis, b = rack edge.
      const axis = sel[0]!.refKind === 'axis' ? sel[0]! : sel[1]!;
      const edge = sel[0]!.refKind === 'edge' ? sel[0]! : sel[1]!;
      return {
        kind: 'rack_pinion',
        id,
        a: { ...axis },
        b: { ...edge },
        pinionRadius: value ?? 10,
      };
    },
  },
];

// ─── props ────────────────────────────────────────────────────────────────

export interface MateConstraintsToolbarProps {
  lang: EditorLang;
  selection: ReadonlyArray<ToolbarSelectionRef>;
  onAdd: (mate: Mate) => void;
  onClear?: () => void;
  disabled?: boolean;
}

// ─── component ────────────────────────────────────────────────────────────

export default function MateConstraintsToolbar({
  lang,
  selection,
  onAdd,
  onClear,
  disabled = false,
}: MateConstraintsToolbarProps): React.JSX.Element {
  const t = dict[lang] ?? dict.en;
  const crossPart = isCrossPartPair(selection);
  const [openValueFor, setOpenValueFor] = useState<MateButtonKind | null>(null);

  const handleClick = useCallback(
    (def: MateDef) => {
      if (def.value) {
        setOpenValueFor((prev) => (prev === def.kind ? null : def.kind));
        return;
      }
      const mate = def.build(nextMateId(def.kind), selection, undefined);
      onAdd(mate);
    },
    [onAdd, selection],
  );

  const handleValueSubmit = useCallback(
    (def: MateDef, raw: string) => {
      const value = Number(raw);
      if (!Number.isFinite(value)) return;
      if (def.value?.isInvalid?.(value)) return;
      const mate = def.build(nextMateId(def.kind), selection, value);
      onAdd(mate);
      setOpenValueFor(null);
    },
    [onAdd, selection],
  );

  return (
    <div
      data-testid="solver-mate-toolbar"
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
      {MATE_DEFS.map((def) => {
        const enabled = !disabled && crossPart && def.canApply(selection);
        const label = def.label(t);
        const isOpen = openValueFor === def.kind;
        return (
          <span key={def.kind} style={{ position: 'relative', display: 'inline-flex' }}>
            <button
              type="button"
              data-testid={`solver-mate-${def.kind}-button`}
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
            {def.value && isOpen && enabled ? (
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
          data-testid="solver-mate-clear-button"
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
  def: MateDef;
  t: Dict;
  onSubmit: (raw: string) => void;
  onCancel: () => void;
}

function ValuePopover({ def, t, onSubmit, onCancel }: ValuePopoverProps): React.JSX.Element {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const spec = def.value!;
  const prompt = spec.prompt(t);
  return (
    <form
      data-testid={`solver-mate-${def.kind}-popover`}
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
        defaultValue={spec.defaultValue}
        data-testid={`solver-mate-${def.kind}-input`}
        aria-label={prompt}
        placeholder={prompt}
        style={{
          width: 96,
          padding: '4px 6px',
          border: '1px solid var(--nx-border)',
          borderRadius: 3,
          fontSize: 12,
        }}
      />
      <button
        type="submit"
        data-testid={`solver-mate-${def.kind}-submit`}
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
        data-testid={`solver-mate-${def.kind}-cancel`}
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
