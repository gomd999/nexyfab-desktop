/**
 * moldBaseLibrary.ts — DME / HASCO / Misumi standard mold base library.
 *
 * Injection mold tooling starts with a *mold base*: the stack of
 * plates (top clamp, A-plate cavity, B-plate core, support plate,
 * ejector retainer, ejector plate, bottom clamp) plus leader pins +
 * return pins + sprue bushing. Buying a standard mold base saves
 * weeks of design + machining.
 *
 * Three major catalogs:
 *   - **DME** (US, ~30% global share) — naming W×L (300×450 etc).
 *   - **HASCO** (EU) — naming Z + width + length.
 *   - **Misumi** (JP/KR) — naming MB + size code.
 *
 * This module supplies the catalog data + selection logic + ejector
 * pin pattern generation + cooling channel routing helpers.
 */

export type MoldBaseStandard = 'DME' | 'HASCO' | 'Misumi';
export type MoldBaseSeries = 'A-series' | 'B-series' | 'C-series' | 'D-series' | 'X-series';

export interface MoldBasePlate {
  /** Plate name. */
  name: string;
  /** Thickness (mm). */
  thicknessMm: number;
  /** Material grade. */
  material: 'P20' | '4140' | 'NAK80' | 'H13' | 'S50C' | '1045' | 'AISI420';
}

export interface MoldBaseSpec {
  id: string;
  standard: MoldBaseStandard;
  series: MoldBaseSeries;
  /** Plate dimensions, width × length (mm). */
  widthMm: number;
  lengthMm: number;
  /** Number of cavity (open / closed) pockets — typical 1-8. */
  cavityCount: 1 | 2 | 4 | 6 | 8 | 16;
  /** Stack of plates from top clamp → bottom clamp. */
  plates: MoldBasePlate[];
  /** Leader pin diameter (mm). */
  leaderPinDiameterMm: number;
  /** Number of leader pins (typ 4). */
  leaderPinCount: number;
  /** Approximate total mass (kg) — for shipping quotes. */
  totalMassKg: number;
}

// Reference subset of DME inch + HASCO metric + Misumi metric.
export const MOLD_BASE_CATALOG: MoldBaseSpec[] = [
  // DME (mm-converted from imperial).
  {
    id: 'DME-A-7×7',
    standard: 'DME', series: 'A-series',
    widthMm: 177.8, lengthMm: 177.8, cavityCount: 1,
    plates: [
      { name: 'Top Clamp', thicknessMm: 25.4, material: '4140' },
      { name: 'A-plate', thicknessMm: 38.1, material: 'P20' },
      { name: 'B-plate', thicknessMm: 38.1, material: 'P20' },
      { name: 'Support', thicknessMm: 25.4, material: '4140' },
      { name: 'Ejector Retainer', thicknessMm: 19.0, material: '4140' },
      { name: 'Ejector', thicknessMm: 19.0, material: '4140' },
      { name: 'Bottom Clamp', thicknessMm: 25.4, material: '4140' },
    ],
    leaderPinDiameterMm: 19.05,
    leaderPinCount: 4,
    totalMassKg: 32,
  },
  {
    id: 'DME-A-12×16',
    standard: 'DME', series: 'A-series',
    widthMm: 304.8, lengthMm: 406.4, cavityCount: 2,
    plates: [
      { name: 'Top Clamp', thicknessMm: 31.75, material: '4140' },
      { name: 'A-plate', thicknessMm: 50.8, material: 'P20' },
      { name: 'B-plate', thicknessMm: 50.8, material: 'P20' },
      { name: 'Support', thicknessMm: 38.1, material: '4140' },
      { name: 'Ejector Retainer', thicknessMm: 25.4, material: '4140' },
      { name: 'Ejector', thicknessMm: 25.4, material: '4140' },
      { name: 'Bottom Clamp', thicknessMm: 31.75, material: '4140' },
    ],
    leaderPinDiameterMm: 25.4,
    leaderPinCount: 4,
    totalMassKg: 192,
  },
  // HASCO Z-series.
  {
    id: 'HASCO-Z-196×246',
    standard: 'HASCO', series: 'A-series',
    widthMm: 196, lengthMm: 246, cavityCount: 1,
    plates: [
      { name: 'Aufspannplatte', thicknessMm: 27, material: '1045' },
      { name: 'Formaufnahmeplatte', thicknessMm: 36, material: 'P20' },
      { name: 'Werkzeugaufnahmeplatte', thicknessMm: 36, material: 'P20' },
      { name: 'Distanzleiste', thicknessMm: 46, material: '1045' },
      { name: 'Auswerferplatte', thicknessMm: 22, material: '1045' },
      { name: 'Auswerfer-Halteplatte', thicknessMm: 17, material: '1045' },
      { name: 'Untere Aufspannplatte', thicknessMm: 27, material: '1045' },
    ],
    leaderPinDiameterMm: 24,
    leaderPinCount: 4,
    totalMassKg: 65,
  },
  {
    id: 'HASCO-Z-346×446',
    standard: 'HASCO', series: 'B-series',
    widthMm: 346, lengthMm: 446, cavityCount: 4,
    plates: [
      { name: 'Aufspannplatte', thicknessMm: 36, material: '1045' },
      { name: 'Formaufnahmeplatte', thicknessMm: 56, material: 'P20' },
      { name: 'Werkzeugaufnahmeplatte', thicknessMm: 56, material: 'P20' },
      { name: 'Distanzleiste', thicknessMm: 66, material: '1045' },
      { name: 'Auswerferplatte', thicknessMm: 27, material: '1045' },
      { name: 'Auswerfer-Halteplatte', thicknessMm: 22, material: '1045' },
      { name: 'Untere Aufspannplatte', thicknessMm: 36, material: '1045' },
    ],
    leaderPinDiameterMm: 32,
    leaderPinCount: 4,
    totalMassKg: 278,
  },
  // Misumi MB-series.
  {
    id: 'Misumi-MB-200×250',
    standard: 'Misumi', series: 'A-series',
    widthMm: 200, lengthMm: 250, cavityCount: 1,
    plates: [
      { name: 'Top Clamp', thicknessMm: 25, material: 'S50C' },
      { name: 'Cavity', thicknessMm: 40, material: 'NAK80' },
      { name: 'Core', thicknessMm: 40, material: 'NAK80' },
      { name: 'Support', thicknessMm: 30, material: 'S50C' },
      { name: 'Ejector Retainer', thicknessMm: 20, material: 'S50C' },
      { name: 'Ejector', thicknessMm: 20, material: 'S50C' },
      { name: 'Bottom Clamp', thicknessMm: 25, material: 'S50C' },
    ],
    leaderPinDiameterMm: 25,
    leaderPinCount: 4,
    totalMassKg: 73,
  },
  {
    id: 'Misumi-MB-350×450',
    standard: 'Misumi', series: 'B-series',
    widthMm: 350, lengthMm: 450, cavityCount: 4,
    plates: [
      { name: 'Top Clamp', thicknessMm: 35, material: 'S50C' },
      { name: 'Cavity', thicknessMm: 55, material: 'NAK80' },
      { name: 'Core', thicknessMm: 55, material: 'NAK80' },
      { name: 'Support', thicknessMm: 40, material: 'S50C' },
      { name: 'Ejector Retainer', thicknessMm: 25, material: 'S50C' },
      { name: 'Ejector', thicknessMm: 25, material: 'S50C' },
      { name: 'Bottom Clamp', thicknessMm: 35, material: 'S50C' },
    ],
    leaderPinDiameterMm: 32,
    leaderPinCount: 4,
    totalMassKg: 320,
  },
];

export function findMoldBase(id: string): MoldBaseSpec | null {
  return MOLD_BASE_CATALOG.find(m => m.id === id) ?? null;
}

export function listMoldBasesByStandard(std: MoldBaseStandard): MoldBaseSpec[] {
  return MOLD_BASE_CATALOG.filter(m => m.standard === std);
}

// ── Mold base selection ─────────────────────────────────────────

export interface SelectionInput {
  /** Part footprint (mm). */
  partWidthMm: number;
  partLengthMm: number;
  /** Part depth (cavity z extent, mm). */
  partDepthMm: number;
  /** Required cavity count (1, 2, 4, 6, 8, 16). */
  cavityCount: 1 | 2 | 4 | 6 | 8 | 16;
  /** Standard preference. */
  preferredStandard?: MoldBaseStandard;
  /** Required side rail / runner clearance per side (mm). */
  edgeMarginMm?: number;
}

export interface SelectionResult {
  bestMatch: MoldBaseSpec | null;
  alternatives: MoldBaseSpec[];
  warnings: string[];
}

/** Pick the smallest mold base that contains the part with the
 *  required margin + matches cavity count. */
export function selectMoldBase(input: SelectionInput): SelectionResult {
  const margin = input.edgeMarginMm ?? 60;
  const requiredW = input.partWidthMm + margin * 2;
  const requiredL = input.partLengthMm + margin * 2;

  let candidates = MOLD_BASE_CATALOG.filter(m =>
    m.cavityCount === input.cavityCount
    && m.widthMm >= requiredW
    && m.lengthMm >= requiredL,
  );
  if (input.preferredStandard) {
    const preferred = candidates.filter(m => m.standard === input.preferredStandard);
    if (preferred.length > 0) candidates = preferred;
  }
  candidates.sort((a, b) => (a.widthMm * a.lengthMm) - (b.widthMm * b.lengthMm));

  const warnings: string[] = [];
  if (candidates.length === 0) {
    warnings.push(`No standard base fits ${input.partWidthMm}×${input.partLengthMm}mm with ${input.cavityCount} cavity`);
  }
  if (input.partDepthMm > 50) {
    warnings.push('Part depth > 50mm may require deep cavity plate — verify A-plate thickness');
  }

  return {
    bestMatch: candidates[0] ?? null,
    alternatives: candidates.slice(1, 4),
    warnings,
  };
}

// ── Ejector pin pattern ─────────────────────────────────────────

export interface EjectorPinSpec {
  /** Ejector pin diameter (mm). */
  diameterMm: number;
  /** Pin head OD (mm). */
  headDiameterMm: number;
  /** Pin length (mm). */
  lengthMm: number;
  /** Position relative to mold base center (mm). */
  position: [number, number];
}

/** Generate a sane default ejector pin pattern for a given part. */
export function generateEjectorPattern(
  partBbox: { widthMm: number; lengthMm: number },
  pinDiameter: number = 4,
  density: 'sparse' | 'normal' | 'dense' = 'normal',
): EjectorPinSpec[] {
  const spacingMm = density === 'sparse' ? 40 : density === 'normal' ? 25 : 15;
  const pins: EjectorPinSpec[] = [];
  const margin = 5;
  const xStart = -partBbox.widthMm / 2 + margin;
  const xEnd   = partBbox.widthMm / 2 - margin;
  const yStart = -partBbox.lengthMm / 2 + margin;
  const yEnd   = partBbox.lengthMm / 2 - margin;
  for (let x = xStart; x <= xEnd; x += spacingMm) {
    for (let y = yStart; y <= yEnd; y += spacingMm) {
      pins.push({
        diameterMm: pinDiameter,
        headDiameterMm: pinDiameter * 1.5,
        lengthMm: 100,
        position: [x, y],
      });
    }
  }
  return pins;
}

// ── Cooling channel routing ─────────────────────────────────────

export interface CoolingChannel {
  /** Channel id. */
  id: string;
  /** Center-line points (mm). */
  centerline: Array<[number, number, number]>;
  /** Channel diameter (mm). */
  diameterMm: number;
  /** Plate the channel runs in. */
  plate: string;
}

/** Generate a baffle-style cooling pattern for a single cavity plate. */
export function generateCoolingPattern(
  cavityBbox: { widthMm: number; lengthMm: number; depthMm: number },
  channelDiameter: number = 8,
  /** Distance from cavity surface to channel center (typ 2–3 × diameter). */
  surfaceOffsetMm: number = 20,
): CoolingChannel[] {
  const channels: CoolingChannel[] = [];
  // Two longitudinal channels along the L direction.
  const x1 = -cavityBbox.widthMm / 4;
  const x2 = cavityBbox.widthMm / 4;
  const z = -cavityBbox.depthMm / 2 - surfaceOffsetMm;
  const yStart = -cavityBbox.lengthMm / 2 - 30;
  const yEnd = cavityBbox.lengthMm / 2 + 30;
  channels.push({
    id: 'C-L-1',
    centerline: [[x1, yStart, z], [x1, yEnd, z]],
    diameterMm: channelDiameter,
    plate: 'A-plate',
  });
  channels.push({
    id: 'C-L-2',
    centerline: [[x2, yStart, z], [x2, yEnd, z]],
    diameterMm: channelDiameter,
    plate: 'A-plate',
  });
  // Cross channel for return.
  channels.push({
    id: 'C-X-1',
    centerline: [[x1, yEnd, z], [x2, yEnd, z]],
    diameterMm: channelDiameter,
    plate: 'A-plate',
  });
  return channels;
}

/** Estimate cooling effectiveness — surface-area-to-volume ratio of
 *  the channel network divided by the cavity surface area. Higher
 *  = better cooling. */
export function coolingEffectivenessRatio(
  channels: CoolingChannel[],
  cavitySurfaceAreaMm2: number,
): number {
  let totalLength = 0;
  for (const c of channels) {
    for (let i = 1; i < c.centerline.length; i++) {
      const dx = c.centerline[i]![0] - c.centerline[i - 1]![0];
      const dy = c.centerline[i]![1] - c.centerline[i - 1]![1];
      const dz = c.centerline[i]![2] - c.centerline[i - 1]![2];
      totalLength += Math.hypot(dx, dy, dz);
    }
  }
  if (channels.length === 0 || cavitySurfaceAreaMm2 === 0) return 0;
  const channelSurface = Math.PI * channels[0]!.diameterMm * totalLength;
  return channelSurface / cavitySurfaceAreaMm2;
}
