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
