export type UnitSystem = 'mm' | 'inch';
export const INCH_TO_MM = 25.4;

export function convertToDisplay(valueMm: number, unit: UnitSystem): number {
  return unit === 'mm' ? valueMm : valueMm / INCH_TO_MM;
}

export function convertFromDisplay(valueDisplay: number, unit: UnitSystem): number {
  return unit === 'mm' ? valueDisplay : valueDisplay * INCH_TO_MM;
}

export function formatWithUnit(valueMm: number, unit: UnitSystem, decimals = 1): string {
  const v = convertToDisplay(valueMm, unit);
  return `${v.toFixed(decimals)} ${unit === 'mm' ? 'mm' : 'in'}`;
}

/**
 * Parse a user-typed dimension string with optional unit suffix and convert
 * to the active unit. Returns the converted numeric value and a note string
 * if a conversion happened (e.g., "1in → 25.4mm"), otherwise note is null.
 *
 * Recognised suffixes: mm, cm, m, in, ", ft, '
 *   "1in"    in mm-mode → { value: 25.4, note: "1in → 25.4mm" }
 *   "10mm"   in inch-mode → { value: 0.394, note: "10mm → 0.394in" }
 *   "5"      → { value: 5, note: null }    (no conversion)
 */
export function convertInputToActiveUnit(
  raw: string,
  active: UnitSystem,
): { value: number | null; note: string | null } {
  if (!raw) return { value: null, note: null };
  const trimmed = raw.trim().toLowerCase();
  // Match number + optional unit suffix
  const m = trimmed.match(/^(-?\d*\.?\d+)\s*(mm|cm|m|in|"|ft|')?$/);
  if (!m) return { value: null, note: null };
  const num = parseFloat(m[1]);
  if (!isFinite(num)) return { value: null, note: null };
  const suffix = m[2];
  // No suffix → already in active unit
  if (!suffix) return { value: num, note: null };
  // Convert input to mm first
  let valueMm: number;
  let suffixLabel: string;
  switch (suffix) {
    case 'mm':  valueMm = num;             suffixLabel = 'mm'; break;
    case 'cm':  valueMm = num * 10;        suffixLabel = 'cm'; break;
    case 'm':   valueMm = num * 1000;      suffixLabel = 'm';  break;
    case 'in':
    case '"':   valueMm = num * INCH_TO_MM; suffixLabel = 'in'; break;
    case 'ft':
    case '\'':  valueMm = num * INCH_TO_MM * 12; suffixLabel = 'ft'; break;
    default:    return { value: num, note: null };
  }
  // Convert mm → active
  const value = convertToDisplay(valueMm, active);
  // Same suffix as active → no conversion note
  if ((active === 'mm' && suffixLabel === 'mm') || (active === 'inch' && suffixLabel === 'in')) {
    return { value, note: null };
  }
  const decimals = active === 'mm' ? 2 : 4;
  const note = `${num}${suffixLabel} → ${value.toFixed(decimals)}${active === 'mm' ? 'mm' : 'in'}`;
  return { value, note };
}
