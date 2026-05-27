/**
 * toolboxCatalog.ts — Full ISO / ANSI / DIN / JIS standard fastener
 * + bearing + retaining ring + key catalog.
 *
 * Existing `hydraulicFittings.ts` covers hydraulic-specific items;
 * `smartFasteners.ts` has thread tables + hole math. This module
 * is the *broader catalog* — the Toolbox window the user picks from
 * when dropping a bolt / nut / washer / bearing into an assembly.
 *
 * Coverage:
 *
 *   - **Bolts** — Hex Cap (ISO 4014), Socket Head Cap (ISO 4762),
 *     Button Head (ISO 7380), Flat Head (ISO 10642), Set Screw (ISO 4029).
 *   - **Nuts** — Hex (ISO 4032), Nylon Insert (DIN 985), Castellated
 *     (ISO 7036), Wing (DIN 315), Flange (DIN 6923).
 *   - **Washers** — Flat (ISO 7089), Spring Lock (DIN 127),
 *     Internal/External Tooth (DIN 6797), Fender (DIN 9021).
 *   - **Bearings** — Deep groove ball (62/63 series), Tapered roller,
 *     Thrust, Linear ball.
 *   - **Retaining rings** — External (DIN 471), Internal (DIN 472).
 *   - **Keys** — Square + Rectangular + Woodruff (DIN 6885).
 */

export type FastenerCategory =
  | 'bolt-hex' | 'bolt-socket-cap' | 'bolt-button' | 'bolt-flat'
  | 'set-screw' | 'nut-hex' | 'nut-nyloc' | 'nut-flange'
  | 'washer-flat' | 'washer-spring' | 'washer-tooth'
  | 'bearing-ball' | 'bearing-taper' | 'bearing-thrust' | 'bearing-linear'
  | 'retaining-ring' | 'key';

export interface BoltCatalogEntry {
  id: string;
  category: 'bolt-hex' | 'bolt-socket-cap' | 'bolt-button' | 'bolt-flat' | 'set-screw';
  standard: 'ISO' | 'ANSI' | 'DIN' | 'JIS';
  /** Display name (e.g. "M6 x 20 SHCS"). */
  name: string;
  threadId: string;       // e.g. 'M6'
  lengthMm: number;
  headDiameterMm: number;
  headHeightMm: number;
  /** Drive socket size across flats (mm). */
  driveAcrossFlatsMm?: number;
  /** Mass (g) — for assembly weight calc. */
  massGrams: number;
}

export interface NutCatalogEntry {
  id: string;
  category: 'nut-hex' | 'nut-nyloc' | 'nut-flange';
  standard: 'ISO' | 'DIN' | 'JIS';
  name: string;
  threadId: string;
  /** Hex across-flats (mm). */
  acrossFlatsMm: number;
  thicknessMm: number;
  massGrams: number;
}

export interface WasherCatalogEntry {
  id: string;
  category: 'washer-flat' | 'washer-spring' | 'washer-tooth';
  standard: 'ISO' | 'DIN';
  name: string;
  /** Inner diameter (mm). */
  innerDiameterMm: number;
  /** Outer diameter (mm). */
  outerDiameterMm: number;
  thicknessMm: number;
  massGrams: number;
}

export interface BearingCatalogEntry {
  id: string;
  category: 'bearing-ball' | 'bearing-taper' | 'bearing-thrust' | 'bearing-linear';
  standard: 'ISO' | 'JIS';
  /** ISO designation (e.g. "6203"). */
  designation: string;
  /** Bore diameter (mm). */
  boreMm: number;
  outerDiameterMm: number;
  widthMm: number;
  /** Basic dynamic load rating (kN). */
  dynamicLoadRatingKn: number;
  /** Limiting speed (rpm). */
  limitingSpeedRpm: number;
  massGrams: number;
}

export interface RetainingRingCatalogEntry {
  id: string;
  category: 'retaining-ring';
  standard: 'DIN';
  designation: string;
  /** Shaft or bore diameter the ring fits (mm). */
  fitDiameterMm: number;
  /** Type: external (shaft) or internal (bore). */
  type: 'external' | 'internal';
  thicknessMm: number;
  massGrams: number;
}

export interface KeyCatalogEntry {
  id: string;
  category: 'key';
  standard: 'DIN' | 'ISO';
  /** Width × height (mm). */
  widthMm: number;
  heightMm: number;
  lengthMm: number;
  /** Suitable shaft diameter range (mm). */
  shaftMinMm: number;
  shaftMaxMm: number;
}

// ── Subset of catalog for preview ────────────────────────────────

export const BOLT_CATALOG: BoltCatalogEntry[] = [
  // ISO 4762 Socket head cap screws (subset).
  { id: 'shcs-m3x10', category: 'bolt-socket-cap', standard: 'ISO', name: 'M3 × 10 SHCS', threadId: 'M3',
    lengthMm: 10, headDiameterMm: 5.5, headHeightMm: 3.0, driveAcrossFlatsMm: 2.5, massGrams: 0.78 },
  { id: 'shcs-m4x12', category: 'bolt-socket-cap', standard: 'ISO', name: 'M4 × 12 SHCS', threadId: 'M4',
    lengthMm: 12, headDiameterMm: 7.0, headHeightMm: 4.0, driveAcrossFlatsMm: 3, massGrams: 1.6 },
  { id: 'shcs-m5x16', category: 'bolt-socket-cap', standard: 'ISO', name: 'M5 × 16 SHCS', threadId: 'M5',
    lengthMm: 16, headDiameterMm: 8.5, headHeightMm: 5.0, driveAcrossFlatsMm: 4, massGrams: 3.1 },
  { id: 'shcs-m6x20', category: 'bolt-socket-cap', standard: 'ISO', name: 'M6 × 20 SHCS', threadId: 'M6',
    lengthMm: 20, headDiameterMm: 10, headHeightMm: 6.0, driveAcrossFlatsMm: 5, massGrams: 5.6 },
  { id: 'shcs-m8x25', category: 'bolt-socket-cap', standard: 'ISO', name: 'M8 × 25 SHCS', threadId: 'M8',
    lengthMm: 25, headDiameterMm: 13, headHeightMm: 8.0, driveAcrossFlatsMm: 6, massGrams: 12.7 },
  // ISO 4014 Hex bolts.
  { id: 'hex-m6x20', category: 'bolt-hex', standard: 'ISO', name: 'M6 × 20 Hex', threadId: 'M6',
    lengthMm: 20, headDiameterMm: 11.5, headHeightMm: 4.0, driveAcrossFlatsMm: 10, massGrams: 6.8 },
  { id: 'hex-m10x30', category: 'bolt-hex', standard: 'ISO', name: 'M10 × 30 Hex', threadId: 'M10',
    lengthMm: 30, headDiameterMm: 18.5, headHeightMm: 6.4, driveAcrossFlatsMm: 16, massGrams: 27 },
  // Button heads.
  { id: 'btn-m5x10', category: 'bolt-button', standard: 'ISO', name: 'M5 × 10 BHCS', threadId: 'M5',
    lengthMm: 10, headDiameterMm: 9.5, headHeightMm: 2.75, driveAcrossFlatsMm: 3, massGrams: 2.4 },
  // Flat heads.
  { id: 'flt-m6x16', category: 'bolt-flat', standard: 'ISO', name: 'M6 × 16 FHCS', threadId: 'M6',
    lengthMm: 16, headDiameterMm: 12, headHeightMm: 3.5, driveAcrossFlatsMm: 4, massGrams: 4.5 },
];

export const NUT_CATALOG: NutCatalogEntry[] = [
  { id: 'nut-m3', category: 'nut-hex', standard: 'ISO', name: 'M3 Hex Nut', threadId: 'M3',
    acrossFlatsMm: 5.5, thicknessMm: 2.4, massGrams: 0.25 },
  { id: 'nut-m4', category: 'nut-hex', standard: 'ISO', name: 'M4 Hex Nut', threadId: 'M4',
    acrossFlatsMm: 7.0, thicknessMm: 3.2, massGrams: 0.55 },
  { id: 'nut-m5', category: 'nut-hex', standard: 'ISO', name: 'M5 Hex Nut', threadId: 'M5',
    acrossFlatsMm: 8.0, thicknessMm: 4.0, massGrams: 0.9 },
  { id: 'nut-m6', category: 'nut-hex', standard: 'ISO', name: 'M6 Hex Nut', threadId: 'M6',
    acrossFlatsMm: 10.0, thicknessMm: 5.0, massGrams: 1.8 },
  { id: 'nut-m8', category: 'nut-hex', standard: 'ISO', name: 'M8 Hex Nut', threadId: 'M8',
    acrossFlatsMm: 13.0, thicknessMm: 6.5, massGrams: 4.0 },
  // Nyloc.
  { id: 'nyloc-m6', category: 'nut-nyloc', standard: 'DIN', name: 'M6 Nyloc', threadId: 'M6',
    acrossFlatsMm: 10.0, thicknessMm: 7.0, massGrams: 2.4 },
  // Flange.
  { id: 'flange-m6', category: 'nut-flange', standard: 'DIN', name: 'M6 Flange Nut', threadId: 'M6',
    acrossFlatsMm: 10.0, thicknessMm: 6.0, massGrams: 2.7 },
];

export const WASHER_CATALOG: WasherCatalogEntry[] = [
  { id: 'flat-m3', category: 'washer-flat', standard: 'ISO', name: 'M3 Flat Washer',
    innerDiameterMm: 3.2, outerDiameterMm: 7, thicknessMm: 0.5, massGrams: 0.15 },
  { id: 'flat-m6', category: 'washer-flat', standard: 'ISO', name: 'M6 Flat Washer',
    innerDiameterMm: 6.4, outerDiameterMm: 12, thicknessMm: 1.6, massGrams: 1.05 },
  { id: 'spring-m6', category: 'washer-spring', standard: 'DIN', name: 'M6 Spring Lock Washer',
    innerDiameterMm: 6.1, outerDiameterMm: 11.8, thicknessMm: 1.6, massGrams: 0.95 },
  { id: 'tooth-ext-m6', category: 'washer-tooth', standard: 'DIN', name: 'M6 External Tooth Washer',
    innerDiameterMm: 6.4, outerDiameterMm: 11, thicknessMm: 0.8, massGrams: 0.5 },
];

export const BEARING_CATALOG: BearingCatalogEntry[] = [
  // Deep groove ball, 6200 series.
  { id: '6200', category: 'bearing-ball', standard: 'ISO', designation: '6200',
    boreMm: 10, outerDiameterMm: 30, widthMm: 9, dynamicLoadRatingKn: 5.10, limitingSpeedRpm: 28000, massGrams: 32 },
  { id: '6201', category: 'bearing-ball', standard: 'ISO', designation: '6201',
    boreMm: 12, outerDiameterMm: 32, widthMm: 10, dynamicLoadRatingKn: 6.89, limitingSpeedRpm: 24000, massGrams: 38 },
  { id: '6202', category: 'bearing-ball', standard: 'ISO', designation: '6202',
    boreMm: 15, outerDiameterMm: 35, widthMm: 11, dynamicLoadRatingKn: 7.65, limitingSpeedRpm: 22000, massGrams: 45 },
  { id: '6203', category: 'bearing-ball', standard: 'ISO', designation: '6203',
    boreMm: 17, outerDiameterMm: 40, widthMm: 12, dynamicLoadRatingKn: 9.56, limitingSpeedRpm: 19000, massGrams: 65 },
  { id: '6204', category: 'bearing-ball', standard: 'ISO', designation: '6204',
    boreMm: 20, outerDiameterMm: 47, widthMm: 14, dynamicLoadRatingKn: 13.5, limitingSpeedRpm: 17000, massGrams: 105 },
  { id: '6205', category: 'bearing-ball', standard: 'ISO', designation: '6205',
    boreMm: 25, outerDiameterMm: 52, widthMm: 15, dynamicLoadRatingKn: 14.0, limitingSpeedRpm: 14000, massGrams: 130 },
  // Tapered roller, 30200 series.
  { id: '30203', category: 'bearing-taper', standard: 'ISO', designation: '30203',
    boreMm: 17, outerDiameterMm: 40, widthMm: 13.25, dynamicLoadRatingKn: 27.5, limitingSpeedRpm: 8000, massGrams: 138 },
];

export const RETAINING_RING_CATALOG: RetainingRingCatalogEntry[] = [
  { id: 'ext-10', category: 'retaining-ring', standard: 'DIN', designation: 'DIN 471 - 10',
    fitDiameterMm: 10, type: 'external', thicknessMm: 1.0, massGrams: 0.4 },
  { id: 'ext-20', category: 'retaining-ring', standard: 'DIN', designation: 'DIN 471 - 20',
    fitDiameterMm: 20, type: 'external', thicknessMm: 1.2, massGrams: 1.1 },
  { id: 'int-25', category: 'retaining-ring', standard: 'DIN', designation: 'DIN 472 - 25',
    fitDiameterMm: 25, type: 'internal', thicknessMm: 1.2, massGrams: 1.4 },
];

export const KEY_CATALOG: KeyCatalogEntry[] = [
  { id: 'key-3x3-10', category: 'key', standard: 'DIN', widthMm: 3, heightMm: 3, lengthMm: 10,
    shaftMinMm: 8, shaftMaxMm: 10 },
  { id: 'key-4x4-12', category: 'key', standard: 'DIN', widthMm: 4, heightMm: 4, lengthMm: 12,
    shaftMinMm: 10, shaftMaxMm: 12 },
  { id: 'key-5x5-16', category: 'key', standard: 'DIN', widthMm: 5, heightMm: 5, lengthMm: 16,
    shaftMinMm: 12, shaftMaxMm: 17 },
  { id: 'key-6x6-20', category: 'key', standard: 'DIN', widthMm: 6, heightMm: 6, lengthMm: 20,
    shaftMinMm: 17, shaftMaxMm: 22 },
  { id: 'key-8x7-25', category: 'key', standard: 'DIN', widthMm: 8, heightMm: 7, lengthMm: 25,
    shaftMinMm: 22, shaftMaxMm: 30 },
];

// ── Lookup helpers ──────────────────────────────────────────────

export function findBolt(id: string): BoltCatalogEntry | null {
  return BOLT_CATALOG.find(b => b.id === id) ?? null;
}

export function findNut(id: string): NutCatalogEntry | null {
  return NUT_CATALOG.find(n => n.id === id) ?? null;
}

export function findWasher(id: string): WasherCatalogEntry | null {
  return WASHER_CATALOG.find(w => w.id === id) ?? null;
}

export function findBearing(id: string): BearingCatalogEntry | null {
  return BEARING_CATALOG.find(b => b.id === id) ?? null;
}

export function findKey(id: string): KeyCatalogEntry | null {
  return KEY_CATALOG.find(k => k.id === id) ?? null;
}

// ── Bearing selection by load + speed ────────────────────────────

export interface BearingSelectInput {
  /** Shaft diameter (mm). */
  shaftMm: number;
  /** Required dynamic load (kN). */
  loadKn: number;
  /** Operating speed (rpm). */
  speedRpm: number;
  /** Optional category preference. */
  category?: BearingCatalogEntry['category'];
}

export function selectBearing(input: BearingSelectInput): BearingCatalogEntry | null {
  let candidates = BEARING_CATALOG.filter(b =>
    b.boreMm === input.shaftMm
    && b.dynamicLoadRatingKn >= input.loadKn
    && b.limitingSpeedRpm >= input.speedRpm,
  );
  if (input.category) {
    candidates = candidates.filter(b => b.category === input.category);
  }
  // Pick cheapest (proxy: smallest mass).
  candidates.sort((a, b) => a.massGrams - b.massGrams);
  return candidates[0] ?? null;
}

// ── Bearing life calc (L10 in hours) ────────────────────────────

export function bearingL10HoursBall(bearing: BearingCatalogEntry, appliedLoadKn: number, speedRpm: number): number {
  if (appliedLoadKn <= 0 || speedRpm <= 0) return Infinity;
  // L10 (millions of revolutions) = (C / P)^3 for ball bearings.
  const millionRev = Math.pow(bearing.dynamicLoadRatingKn / appliedLoadKn, 3);
  // Convert to hours.
  return millionRev * 1e6 / (speedRpm * 60);
}

export function bearingL10HoursTaper(bearing: BearingCatalogEntry, appliedLoadKn: number, speedRpm: number): number {
  if (appliedLoadKn <= 0 || speedRpm <= 0) return Infinity;
  // Roller: exponent 10/3.
  const millionRev = Math.pow(bearing.dynamicLoadRatingKn / appliedLoadKn, 10 / 3);
  return millionRev * 1e6 / (speedRpm * 60);
}

// ── Key sizing by shaft diameter ────────────────────────────────

export function recommendKey(shaftDiameterMm: number): KeyCatalogEntry | null {
  return KEY_CATALOG.find(k => shaftDiameterMm >= k.shaftMinMm && shaftDiameterMm <= k.shaftMaxMm) ?? null;
}

// ── Hardware kit BOM ────────────────────────────────────────────

/** Aggregate bolt + nut + washer counts into a single BOM list. */
export interface HardwareUsage {
  boltId: string;
  count: number;
  matchingNut?: string;
  matchingWasher?: string;
}

export interface HardwareBom {
  totalMassGrams: number;
  totalBolts: number;
  totalNuts: number;
  totalWashers: number;
  lines: Array<{ id: string; description: string; quantity: number; totalMassGrams: number }>;
}

export function buildHardwareBom(usages: HardwareUsage[]): HardwareBom {
  const lines: HardwareBom['lines'] = [];
  let totalMass = 0;
  let totalBolts = 0;
  let totalNuts = 0;
  let totalWashers = 0;

  const collect = (id: string, count: number): void => {
    const bolt = findBolt(id);
    const nut = findNut(id);
    const washer = findWasher(id);
    const entry = bolt ?? nut ?? washer;
    if (!entry) return;
    const lineMass = entry.massGrams * count;
    lines.push({ id: entry.id, description: entry.name, quantity: count, totalMassGrams: lineMass });
    totalMass += lineMass;
    if (bolt) totalBolts += count;
    if (nut) totalNuts += count;
    if (washer) totalWashers += count;
  };

  for (const u of usages) {
    collect(u.boltId, u.count);
    if (u.matchingNut) collect(u.matchingNut, u.count);
    if (u.matchingWasher) collect(u.matchingWasher, u.count * 2); // typically 2 washers per bolt
  }

  return {
    totalMassGrams: totalMass,
    totalBolts, totalNuts, totalWashers,
    lines,
  };
}
