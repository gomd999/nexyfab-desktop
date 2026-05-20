/**
 * dimensionStyleManager.ts — Manage drawing dimension styles per
 * standard (ISO / ANSI / JIS / GB / DIN).
 *
 * Different standards prescribe different conventions for:
 *
 *   - Decimal vs comma separator (comma for ISO/DIN/GB, dot for ANSI).
 *   - Leading-zero rule (ISO: 0.5; ANSI: .5).
 *   - Unit label suffix (mm vs in vs μm).
 *   - Tolerance format (linear ± / limit upper-lower / fit class).
 *   - Arrow head style (filled triangle / open / dot / slash).
 *   - Extension line gap / overshoot.
 *   - Text height and font.
 *
 * Module provides:
 *
 *   - Built-in style presets per standard.
 *   - Formatters for the given dimension value + tolerance.
 *   - Style validator (warn on conflicts: e.g., ANSI + comma).
 */

export type DimensionStandard = 'ISO' | 'ANSI' | 'JIS' | 'DIN' | 'GB';

export type ArrowHead = 'filled-triangle' | 'open-triangle' | 'dot' | 'slash' | 'open-arrow';

export type ToleranceFormat = 'symmetric' | 'limit' | 'unilateral-plus' | 'unilateral-minus' | 'fit-class';

export interface DimensionStyle {
  standard: DimensionStandard;
  decimalSeparator: '.' | ',';
  /** True = "0.5", false = ".5". */
  leadingZero: boolean;
  /** Display the unit suffix, e.g. "mm" or "in". */
  unitSuffix: string;
  /** Precision (digits after separator). */
  precision: number;
  toleranceFormat: ToleranceFormat;
  arrowHead: ArrowHead;
  /** Text height, mm. */
  textHeightMm: number;
  /** Extension line gap from the geometry, mm. */
  extensionGapMm: number;
  /** Extension line overshoot past the dimension line, mm. */
  extensionOvershootMm: number;
}

// ── Built-in styles ────────────────────────────────────────────

export function presetForStandard(standard: DimensionStandard): DimensionStyle {
  switch (standard) {
    case 'ISO':
      return {
        standard: 'ISO',
        decimalSeparator: ',',
        leadingZero: true,
        unitSuffix: '',
        precision: 2,
        toleranceFormat: 'symmetric',
        arrowHead: 'filled-triangle',
        textHeightMm: 3.5,
        extensionGapMm: 1.5,
        extensionOvershootMm: 2.0,
      };
    case 'ANSI':
      return {
        standard: 'ANSI',
        decimalSeparator: '.',
        leadingZero: false,
        unitSuffix: '',
        precision: 3,
        toleranceFormat: 'limit',
        arrowHead: 'filled-triangle',
        textHeightMm: 3.0,
        extensionGapMm: 1.5,
        extensionOvershootMm: 3.0,
      };
    case 'JIS':
      return {
        standard: 'JIS',
        decimalSeparator: '.',
        leadingZero: true,
        unitSuffix: '',
        precision: 2,
        toleranceFormat: 'symmetric',
        arrowHead: 'filled-triangle',
        textHeightMm: 3.5,
        extensionGapMm: 1.5,
        extensionOvershootMm: 2.0,
      };
    case 'DIN':
      return {
        standard: 'DIN',
        decimalSeparator: ',',
        leadingZero: true,
        unitSuffix: '',
        precision: 2,
        toleranceFormat: 'symmetric',
        arrowHead: 'open-triangle',
        textHeightMm: 3.5,
        extensionGapMm: 1.5,
        extensionOvershootMm: 2.0,
      };
    case 'GB':
      return {
        standard: 'GB',
        decimalSeparator: '.',
        leadingZero: true,
        unitSuffix: '',
        precision: 2,
        toleranceFormat: 'symmetric',
        arrowHead: 'filled-triangle',
        textHeightMm: 3.5,
        extensionGapMm: 1.5,
        extensionOvershootMm: 2.0,
      };
  }
}

// ── Formatters ─────────────────────────────────────────────────

export interface DimensionWithTolerance {
  nominalMm: number;
  /** Upper tolerance (mm), e.g. +0.05. */
  upperMm?: number;
  /** Lower tolerance (mm), e.g. -0.05. */
  lowerMm?: number;
  /** ISO fit class (e.g. "H7"). */
  fitClass?: string;
}

export function formatNumber(value: number, style: DimensionStyle): string {
  let txt = value.toFixed(style.precision);
  if (style.decimalSeparator === ',') txt = txt.replace('.', ',');
  if (!style.leadingZero && Math.abs(value) < 1) {
    // Strip the leading "0" (e.g. "0.5" → ".5").
    txt = txt.replace(/^(-?)0/, '$1');
  }
  return txt + (style.unitSuffix ? ` ${style.unitSuffix}` : '');
}

export function formatDimension(d: DimensionWithTolerance, style: DimensionStyle): string {
  const nominal = formatNumber(d.nominalMm, style);
  switch (style.toleranceFormat) {
    case 'symmetric': {
      if (d.upperMm !== undefined && d.lowerMm !== undefined) {
        const sym = Math.max(Math.abs(d.upperMm), Math.abs(d.lowerMm));
        return `${nominal} ±${formatNumber(sym, style)}`;
      }
      return nominal;
    }
    case 'limit': {
      if (d.upperMm !== undefined && d.lowerMm !== undefined) {
        const upper = formatNumber(d.nominalMm + d.upperMm, style);
        const lower = formatNumber(d.nominalMm + d.lowerMm, style);
        return `${upper} / ${lower}`;
      }
      return nominal;
    }
    case 'unilateral-plus':
      return d.upperMm !== undefined
        ? `${nominal} +${formatNumber(d.upperMm, style)}`
        : nominal;
    case 'unilateral-minus':
      return d.lowerMm !== undefined
        ? `${nominal} -${formatNumber(Math.abs(d.lowerMm), style)}`
        : nominal;
    case 'fit-class':
      return d.fitClass ? `${nominal} ${d.fitClass}` : nominal;
  }
}

// ── Validation ─────────────────────────────────────────────────

export interface StyleWarning {
  message: string;
  field: keyof DimensionStyle;
}

export function validateStyle(style: DimensionStyle): StyleWarning[] {
  const warnings: StyleWarning[] = [];
  if (style.standard === 'ANSI' && style.decimalSeparator === ',') {
    warnings.push({ message: 'ANSI typically uses "." not "," as decimal separator.', field: 'decimalSeparator' });
  }
  if (style.standard === 'ISO' && style.decimalSeparator === '.') {
    warnings.push({ message: 'ISO recommends "," as decimal separator.', field: 'decimalSeparator' });
  }
  if (style.precision < 0 || style.precision > 6) {
    warnings.push({ message: 'precision should be in 0..6 digits.', field: 'precision' });
  }
  if (style.textHeightMm < 1.8) {
    warnings.push({ message: 'Text height < 1.8 mm is below readability standard.', field: 'textHeightMm' });
  }
  return warnings;
}

// ── Summary ────────────────────────────────────────────────────

export interface StyleSummary {
  standard: DimensionStandard;
  textHeightMm: number;
  precision: number;
  toleranceFormat: ToleranceFormat;
  warningCount: number;
}

export function summarize(style: DimensionStyle): StyleSummary {
  return {
    standard: style.standard,
    textHeightMm: style.textHeightMm,
    precision: style.precision,
    toleranceFormat: style.toleranceFormat,
    warningCount: validateStyle(style).length,
  };
}
