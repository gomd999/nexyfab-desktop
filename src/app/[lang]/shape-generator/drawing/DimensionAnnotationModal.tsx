'use client';

/**
 * DimensionAnnotationModal — Phase 4.2 of NexyFab Pro own-CAD (ADR-013).
 *
 * Standalone modal for authoring a Dimension or GdtCallout against a
 * specific viewport on a Sheet. The modal does not mutate the sheet
 * itself — it builds an IR object and hands it back via `onAdd` so the
 * caller can splice it into the sheet's `dimensions` / `gdtCallouts`
 * arrays.
 *
 * Layout:
 *   1. Kind selector — radio "dimension" vs "gd&t"
 *   2. If dimension: kind (linear/aligned/radial/diametric/angular) +
 *      refs (N text inputs, N = KIND_REF_COUNT) + tolerance form +
 *      prefix/suffix
 *   3. If GD&T: symbol + target ref + tolerance value + datums (comma list)
 *      + material condition
 *   4. Submit + Cancel
 *
 * Validation: light client-side — the produced IR is validated by the
 * caller (validateDimension / validateGdt) before persisting.
 */

import * as React from 'react';
import type { Sheet } from '@/lib/drawing/sheet';
import type {
  Dimension,
  DimensionKind,
  GdtCallout,
  GdtKind,
  Tolerance,
} from '@/lib/drawing/dimension';

// ─── props ───────────────────────────────────────────────────────────────

export interface DimensionAnnotationModalProps {
  lang: string;
  sheet: Sheet;
  /** Which viewport the new annotation will attach to. */
  viewportId: string;
  /** Receiver for the new annotation. */
  onAdd: (annotation: Dimension | GdtCallout) => void;
  onClose: () => void;
}

// ─── i18n ────────────────────────────────────────────────────────────────

interface ModalDict {
  title: string;
  kindDimension: string;
  kindGdt: string;
  dimKindLabel: string;
  refsLabel: string;
  refPlaceholder: (i: number) => string;
  prefixLabel: string;
  suffixLabel: string;
  valueOverrideLabel: string;
  toleranceLabel: string;
  toleranceUpper: string;
  toleranceLower: string;
  toleranceMin: string;
  toleranceMax: string;
  toleranceDesignation: string;
  gdtSymbolLabel: string;
  gdtTargetLabel: string;
  gdtToleranceValueLabel: string;
  gdtDatumsLabel: string;
  gdtMaterialConditionLabel: string;
  submit: string;
  cancel: string;
}

const DICT: Record<string, ModalDict> = {
  en: {
    title: 'Add Annotation',
    kindDimension: 'Dimension',
    kindGdt: 'GD&T',
    dimKindLabel: 'Dimension kind',
    refsLabel: 'Geometry refs',
    refPlaceholder: (i) => `ref ${i + 1} (e.g. f.side.0 / e.vert.1)`,
    prefixLabel: 'Prefix',
    suffixLabel: 'Suffix',
    valueOverrideLabel: 'Value override (optional)',
    toleranceLabel: 'Tolerance',
    toleranceUpper: 'Upper',
    toleranceLower: 'Lower',
    toleranceMin: 'Min',
    toleranceMax: 'Max',
    toleranceDesignation: 'ISO fit (e.g. H7)',
    gdtSymbolLabel: 'GD&T symbol',
    gdtTargetLabel: 'Target ref',
    gdtToleranceValueLabel: 'Tolerance value (mm)',
    gdtDatumsLabel: 'Datums (comma-separated, e.g. A,B)',
    gdtMaterialConditionLabel: 'Material condition',
    submit: 'Add',
    cancel: 'Cancel',
  },
  ko: {
    title: '주석 추가',
    kindDimension: '치수',
    kindGdt: 'GD&T (기하공차)',
    dimKindLabel: '치수 종류',
    refsLabel: '형상 참조',
    refPlaceholder: (i) => `참조 ${i + 1} (예: f.side.0 / e.vert.1)`,
    prefixLabel: '접두어',
    suffixLabel: '접미어',
    valueOverrideLabel: '값 수동입력 (선택)',
    toleranceLabel: '공차',
    toleranceUpper: '상한',
    toleranceLower: '하한',
    toleranceMin: '최소',
    toleranceMax: '최대',
    toleranceDesignation: 'ISO 끼워맞춤 (예: H7)',
    gdtSymbolLabel: 'GD&T 기호',
    gdtTargetLabel: '대상 ref',
    gdtToleranceValueLabel: '공차값 (mm)',
    gdtDatumsLabel: '데이텀 (쉼표구분, 예: A,B)',
    gdtMaterialConditionLabel: '재료 조건',
    submit: '추가',
    cancel: '취소',
  },
};

function pickDict(lang: string): ModalDict {
  const key = lang === 'cn' ? 'zh' : lang;
  return DICT[key] ?? DICT.en;
}

// ─── constants ───────────────────────────────────────────────────────────

const DIMENSION_KINDS: ReadonlyArray<DimensionKind> = [
  'linear', 'aligned', 'radial', 'diametric', 'angular',
];

const GDT_KINDS: ReadonlyArray<GdtKind> = [
  'straightness', 'flatness', 'circularity', 'cylindricity',
  'position', 'concentricity', 'runout',
];

const KIND_REF_COUNT: Record<DimensionKind, number> = {
  linear: 2,
  aligned: 2,
  radial: 1,
  diametric: 1,
  angular: 2,
};

type ToleranceKind = Tolerance['kind'];

// ─── component ───────────────────────────────────────────────────────────

export default function DimensionAnnotationModal(
  props: DimensionAnnotationModalProps,
): React.ReactElement {
  const { lang, viewportId, onAdd, onClose } = props;
  const dict = pickDict(lang);

  const [annotationKind, setAnnotationKind] = React.useState<'dimension' | 'gdt'>('dimension');

  // ─── dimension state ─────────────────────────────────────────────────
  const [dimKind, setDimKind] = React.useState<DimensionKind>('linear');
  const refCount = KIND_REF_COUNT[dimKind];
  const [refs, setRefs] = React.useState<string[]>(['', '']);
  React.useEffect(() => {
    setRefs((prev) => {
      const next = [...prev];
      while (next.length < refCount) next.push('');
      while (next.length > refCount) next.pop();
      return next;
    });
  }, [refCount]);
  const [prefix, setPrefix] = React.useState('');
  const [suffix, setSuffix] = React.useState('');
  const [valueOverride, setValueOverride] = React.useState('');
  const [tolKind, setTolKind] = React.useState<ToleranceKind>('none');
  const [tolUpper, setTolUpper] = React.useState('0.1');
  const [tolLower, setTolLower] = React.useState('0.1');
  const [tolMin, setTolMin] = React.useState('9.9');
  const [tolMax, setTolMax] = React.useState('10.1');
  const [tolDesignation, setTolDesignation] = React.useState('H7');

  // ─── gd&t state ──────────────────────────────────────────────────────
  const [gdtKind, setGdtKind] = React.useState<GdtKind>('flatness');
  const [gdtTarget, setGdtTarget] = React.useState('');
  const [gdtToleranceValue, setGdtToleranceValue] = React.useState('0.05');
  const [gdtDatumsStr, setGdtDatumsStr] = React.useState('');
  const [gdtMaterialCondition, setGdtMaterialCondition] = React.useState<'' | 'M' | 'L'>('');

  const [error, setError] = React.useState<string | null>(null);

  // ─── builders ────────────────────────────────────────────────────────

  function buildTolerance(): Tolerance | undefined {
    switch (tolKind) {
      case 'none':
        return undefined;
      case 'bilateral':
        return { kind: 'bilateral', upper: Number(tolUpper), lower: Number(tolLower) };
      case 'unilateral':
        return { kind: 'unilateral', upper: Number(tolUpper), lower: Number(tolLower) };
      case 'limit':
        return { kind: 'limit', min: Number(tolMin), max: Number(tolMax) };
      case 'iso_fit':
        return { kind: 'iso_fit', designation: tolDesignation };
    }
  }

  function buildDimension(): Dimension {
    const id = `dim-${Date.now()}`;
    const tolerance = buildTolerance();
    const base = {
      id,
      viewportId,
      refs: refs.slice(0, refCount),
      tolerance,
      prefix: prefix || undefined,
      suffix: suffix || undefined,
      valueOverride: valueOverride === '' ? undefined : Number(valueOverride),
    };
    return { ...base, kind: dimKind } as Dimension;
  }

  function buildGdt(): GdtCallout {
    const id = `gdt-${Date.now()}`;
    const datums = gdtDatumsStr
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    return {
      id,
      viewportId,
      kind: gdtKind,
      targetRef: gdtTarget,
      toleranceValue: Number(gdtToleranceValue),
      datums: datums.length > 0 ? datums : undefined,
      materialCondition: gdtMaterialCondition || undefined,
    };
  }

  function handleSubmit(): void {
    setError(null);
    try {
      if (annotationKind === 'dimension') {
        const built = buildDimension();
        // Basic client-side guard: refs must all be filled.
        if (built.refs.some((r) => !r)) {
          throw new Error('all refs must be filled');
        }
        onAdd(built);
      } else {
        const built = buildGdt();
        if (!built.targetRef) {
          throw new Error('targetRef is required');
        }
        if (!(Number(gdtToleranceValue) > 0)) {
          throw new Error('tolerance value must be positive');
        }
        onAdd(built);
      }
    } catch (e) {
      setError((e as Error).message);
    }
  }

  // ─── render ──────────────────────────────────────────────────────────

  return (
    <div
      data-testid="solver-dim-modal"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.5)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
      }}
    >
      <div
        style={{
          background: '#fff',
          padding: 24,
          borderRadius: 8,
          minWidth: 420,
          maxWidth: 560,
          maxHeight: '90vh',
          overflowY: 'auto',
          fontFamily: 'system-ui, sans-serif',
          color: '#111',
        }}
      >
        <h2 style={{ marginTop: 0, fontSize: 18 }}>{dict.title}</h2>

        {/* Kind selector */}
        <div style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              name="annotation-kind"
              data-testid="solver-dim-kind-dimension"
              checked={annotationKind === 'dimension'}
              onChange={() => setAnnotationKind('dimension')}
            />
            {dict.kindDimension}
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <input
              type="radio"
              name="annotation-kind"
              data-testid="solver-dim-kind-gdt"
              checked={annotationKind === 'gdt'}
              onChange={() => setAnnotationKind('gdt')}
            />
            {dict.kindGdt}
          </label>
        </div>

        {annotationKind === 'dimension' ? (
          <div data-testid="solver-dim-dimension-form">
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.dimKindLabel}
              <select
                data-testid="solver-dim-dimkind-select"
                value={dimKind}
                onChange={(e) => setDimKind(e.target.value as DimensionKind)}
                style={{ marginLeft: 8 }}
              >
                {DIMENSION_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>

            <fieldset style={{ marginBottom: 8 }}>
              <legend>{dict.refsLabel}</legend>
              {refs.map((r, i) => (
                <input
                  key={i}
                  data-testid={`solver-dim-ref-${i}-input`}
                  value={r}
                  placeholder={dict.refPlaceholder(i)}
                  onChange={(e) => {
                    const next = [...refs];
                    next[i] = e.target.value;
                    setRefs(next);
                  }}
                  style={{ display: 'block', marginTop: 4, width: '100%' }}
                />
              ))}
            </fieldset>

            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.prefixLabel}
              <input
                data-testid="solver-dim-prefix-input"
                value={prefix}
                onChange={(e) => setPrefix(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.suffixLabel}
              <input
                data-testid="solver-dim-suffix-input"
                value={suffix}
                onChange={(e) => setSuffix(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.valueOverrideLabel}
              <input
                data-testid="solver-dim-value-override-input"
                value={valueOverride}
                onChange={(e) => setValueOverride(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>

            <fieldset style={{ marginBottom: 8 }}>
              <legend>{dict.toleranceLabel}</legend>
              <select
                data-testid="solver-dim-tolerance-kind-select"
                value={tolKind}
                onChange={(e) => setTolKind(e.target.value as ToleranceKind)}
              >
                <option value="none">none</option>
                <option value="bilateral">bilateral</option>
                <option value="unilateral">unilateral</option>
                <option value="limit">limit</option>
                <option value="iso_fit">iso_fit</option>
              </select>
              {(tolKind === 'bilateral' || tolKind === 'unilateral') && (
                <div style={{ marginTop: 4 }}>
                  <label>
                    {dict.toleranceUpper}
                    <input
                      data-testid="solver-dim-tolerance-upper-input"
                      value={tolUpper}
                      onChange={(e) => setTolUpper(e.target.value)}
                      style={{ marginLeft: 4, width: 80 }}
                    />
                  </label>
                  <label style={{ marginLeft: 12 }}>
                    {dict.toleranceLower}
                    <input
                      data-testid="solver-dim-tolerance-lower-input"
                      value={tolLower}
                      onChange={(e) => setTolLower(e.target.value)}
                      style={{ marginLeft: 4, width: 80 }}
                    />
                  </label>
                </div>
              )}
              {tolKind === 'limit' && (
                <div style={{ marginTop: 4 }}>
                  <label>
                    {dict.toleranceMin}
                    <input
                      data-testid="solver-dim-tolerance-min-input"
                      value={tolMin}
                      onChange={(e) => setTolMin(e.target.value)}
                      style={{ marginLeft: 4, width: 80 }}
                    />
                  </label>
                  <label style={{ marginLeft: 12 }}>
                    {dict.toleranceMax}
                    <input
                      data-testid="solver-dim-tolerance-max-input"
                      value={tolMax}
                      onChange={(e) => setTolMax(e.target.value)}
                      style={{ marginLeft: 4, width: 80 }}
                    />
                  </label>
                </div>
              )}
              {tolKind === 'iso_fit' && (
                <div style={{ marginTop: 4 }}>
                  <label>
                    {dict.toleranceDesignation}
                    <input
                      data-testid="solver-dim-tolerance-designation-input"
                      value={tolDesignation}
                      onChange={(e) => setTolDesignation(e.target.value)}
                      style={{ marginLeft: 4 }}
                    />
                  </label>
                </div>
              )}
            </fieldset>
          </div>
        ) : (
          <div data-testid="solver-dim-gdt-form">
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtSymbolLabel}
              <select
                data-testid="solver-dim-gdt-kind-select"
                value={gdtKind}
                onChange={(e) => setGdtKind(e.target.value as GdtKind)}
                style={{ marginLeft: 8 }}
              >
                {GDT_KINDS.map((k) => (
                  <option key={k} value={k}>{k}</option>
                ))}
              </select>
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtTargetLabel}
              <input
                data-testid="solver-dim-gdt-target-input"
                value={gdtTarget}
                onChange={(e) => setGdtTarget(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtToleranceValueLabel}
              <input
                data-testid="solver-dim-gdt-tolerance-input"
                value={gdtToleranceValue}
                onChange={(e) => setGdtToleranceValue(e.target.value)}
                style={{ marginLeft: 8, width: 100 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtDatumsLabel}
              <input
                data-testid="solver-dim-gdt-datums-input"
                value={gdtDatumsStr}
                onChange={(e) => setGdtDatumsStr(e.target.value)}
                style={{ marginLeft: 8 }}
              />
            </label>
            <label style={{ display: 'block', marginBottom: 8 }}>
              {dict.gdtMaterialConditionLabel}
              <select
                data-testid="solver-dim-gdt-mc-select"
                value={gdtMaterialCondition}
                onChange={(e) => setGdtMaterialCondition(e.target.value as '' | 'M' | 'L')}
                style={{ marginLeft: 8 }}
              >
                <option value="">(none / RFS)</option>
                <option value="M">M (max material)</option>
                <option value="L">L (least material)</option>
              </select>
            </label>
          </div>
        )}

        {error ? (
          <div
            data-testid="solver-dim-error"
            style={{ color: '#b91c1c', marginTop: 8, fontSize: 13 }}
          >
            {error}
          </div>
        ) : null}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button
            type="button"
            data-testid="solver-dim-cancel"
            onClick={onClose}
            style={{ padding: '6px 12px' }}
          >
            {dict.cancel}
          </button>
          <button
            type="button"
            data-testid="solver-dim-submit"
            onClick={handleSubmit}
            style={{
              padding: '6px 12px',
              background: '#1d4ed8',
              color: '#fff',
              border: 'none',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            {dict.submit}
          </button>
        </div>
      </div>
    </div>
  );
}
