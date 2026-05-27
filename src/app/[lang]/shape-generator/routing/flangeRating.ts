/**
 * flangeRating.ts — Check an ASME B16.5 flange's pressure-temperature
 * rating: given a class + material group + operating temperature, return
 * the allowable working pressure and whether the design pressure is OK.
 *
 * Ratings derate with temperature. We carry a small table of allowable
 * pressure (bar) at temperature breakpoints for Group 1.1 (carbon steel)
 * and 2.2 (304 SS) across the common classes, and linearly interpolate.
 */

export type FlangeClass = 150 | 300 | 600 | 900 | 1500 | 2500;
export type MaterialGroup = '1.1-carbon' | '2.2-304SS';

// Allowable pressure (bar) at temperature (°C) breakpoints — illustrative
// B16.5-style values, Group 1.1 carbon steel.
const RATING_TABLE: Record<MaterialGroup, { tempC: number; byClass: Record<FlangeClass, number> }[]> = {
  '1.1-carbon': [
    { tempC: 38,  byClass: { 150: 19.6, 300: 51.1, 600: 102.1, 900: 153.2, 1500: 255.3, 2500: 425.5 } },
    { tempC: 200, byClass: { 150: 13.8, 300: 43.8, 600: 87.6,  900: 131.4, 1500: 219.0, 2500: 365.0 } },
    { tempC: 400, byClass: { 150: 6.5,  300: 34.7, 600: 69.4,  900: 104.2, 1500: 173.6, 2500: 289.3 } },
    { tempC: 538, byClass: { 150: 0.0,  300: 13.8, 600: 27.6,  900: 41.4,  1500: 69.0,  2500: 115.0 } },
  ],
  '2.2-304SS': [
    { tempC: 38,  byClass: { 150: 19.0, 300: 49.6, 600: 99.3,  900: 148.9, 1500: 248.2, 2500: 413.7 } },
    { tempC: 200, byClass: { 150: 13.3, 300: 40.3, 600: 80.6,  900: 120.9, 1500: 201.5, 2500: 335.8 } },
    { tempC: 400, byClass: { 150: 10.0, 300: 33.4, 600: 66.8,  900: 100.2, 1500: 167.0, 2500: 278.3 } },
    { tempC: 538, byClass: { 150: 7.4,  300: 29.2, 600: 58.4,  900: 87.6,  1500: 146.0, 2500: 243.3 } },
  ],
};

export interface FlangeRatingInput {
  flangeClass: FlangeClass;
  materialGroup: MaterialGroup;
  operatingTempC: number;
  designPressureBar: number;
}

export interface FlangeRatingResult {
  allowablePressureBar: number;
  adequate: boolean;
  marginBar: number;
  recommendedClass: FlangeClass | null; // smallest class that passes
  warnings: string[];
}

export function check(input: FlangeRatingInput): FlangeRatingResult {
  const warnings: string[] = [];
  const allowable = allowablePressure(input.materialGroup, input.flangeClass, input.operatingTempC);
  if (allowable <= 0) warnings.push('Flange has no rating at this temperature (derated to zero).');

  const adequate = input.designPressureBar <= allowable;
  const margin = allowable - input.designPressureBar;
  if (!adequate) warnings.push(`Design ${input.designPressureBar} bar exceeds allowable ${allowable.toFixed(1)} bar at ${input.operatingTempC}°C.`);

  // Smallest class meeting the design pressure at temperature.
  const classes: FlangeClass[] = [150, 300, 600, 900, 1500, 2500];
  const recommended = classes.find(c => allowablePressure(input.materialGroup, c, input.operatingTempC) >= input.designPressureBar) ?? null;

  return { allowablePressureBar: allowable, adequate, marginBar: margin, recommendedClass: recommended, warnings };
}

/** Interpolated allowable pressure (bar) at temperature for a class. */
export function allowablePressure(group: MaterialGroup, cls: FlangeClass, tempC: number): number {
  const table = RATING_TABLE[group];
  if (!table) return 0;
  if (tempC <= table[0]!.tempC) return table[0]!.byClass[cls];
  const last = table[table.length - 1]!;
  if (tempC >= last.tempC) return last.byClass[cls];
  for (let i = 1; i < table.length; i++) {
    const a = table[i - 1]!, b = table[i]!;
    if (tempC <= b.tempC) {
      const t = (tempC - a.tempC) / (b.tempC - a.tempC);
      return a.byClass[cls] + t * (b.byClass[cls] - a.byClass[cls]);
    }
  }
  return last.byClass[cls];
}

export function summarize(r: FlangeRatingResult): { allowablePressureBar: number; adequate: boolean; recommendedClass: FlangeClass | null } {
  return { allowablePressureBar: r.allowablePressureBar, adequate: r.adequate, recommendedClass: r.recommendedClass };
}
