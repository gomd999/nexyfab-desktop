/**
 * matePinningKit.ts — Manage a "pinning" kit of dowel pins, alignment
 * features, and fasteners that lock two components in position.
 *
 * Pinning typically combines:
 *   - 2 dowel pins (for X-Y position).
 *   - N bolts (for clamping force).
 *
 * Module:
 *   - Generates dowel + bolt positions on a flange.
 *   - Validates spacing (pins ≥ 2× diameter from any bolt).
 *   - Computes required hole tolerances (slip-fit vs press-fit).
 *   - Suggests dowel diameter for required positional accuracy.
 */

export interface Vec2 { x: number; y: number }

export type DowelFit = 'press' | 'slip' | 'tight';

export interface PinningOptions {
  /** Dowel pin diameter (mm). */
  dowelDiameterMm: number;
  /** Bolt size (M-thread). */
  boltSizeMm: number;
  /** Bolt count (≥ 2). */
  boltCount: number;
  /** Required positional accuracy (mm). */
  positionalAccuracyMm: number;
  dowelFit: DowelFit;
}

export const DEFAULT_OPTIONS: PinningOptions = {
  dowelDiameterMm: 6,
  boltSizeMm: 6,
  boltCount: 4,
  positionalAccuracyMm: 0.05,
  dowelFit: 'press',
};

export interface PinningFeature {
  id: string;
  kind: 'dowel' | 'bolt';
  position: Vec2;
  diameterMm: number;
  /** For dowels: required hole tolerance class. */
  holeFit?: 'H7' | 'H8' | 'H6' | 'H7-press';
}

export interface PinningKit {
  features: PinningFeature[];
  /** Recommended hole-to-hole spacing minimum (mm). */
  minSpacingMm: number;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateKit(flangeMin: Vec2, flangeMax: Vec2, options: Partial<PinningOptions> = {}): PinningKit {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];
  const features: PinningFeature[] = [];

  if (opts.boltCount < 2) warnings.push('Need at least 2 bolts for clamping.');

  const minSpacing = Math.max(opts.dowelDiameterMm, opts.boltSizeMm) * 3;

  // Dowels: diagonally opposite corners offset 5 mm from edge.
  const inset = 5;
  features.push({
    id: 'dowel-1',
    kind: 'dowel',
    position: { x: flangeMin.x + inset, y: flangeMin.y + inset },
    diameterMm: opts.dowelDiameterMm,
    holeFit: pickHoleFit(opts.dowelFit),
  });
  features.push({
    id: 'dowel-2',
    kind: 'dowel',
    position: { x: flangeMax.x - inset, y: flangeMax.y - inset },
    diameterMm: opts.dowelDiameterMm,
    holeFit: pickHoleFit(opts.dowelFit),
  });

  // Bolts: distribute around perimeter.
  const w = flangeMax.x - flangeMin.x;
  const h = flangeMax.y - flangeMin.y;
  const cx = (flangeMin.x + flangeMax.x) / 2;
  const cy = (flangeMin.y + flangeMax.y) / 2;
  const r = Math.min(w, h) * 0.35;
  for (let i = 0; i < opts.boltCount; i++) {
    const angle = (i / opts.boltCount) * Math.PI * 2;
    features.push({
      id: `bolt-${i + 1}`,
      kind: 'bolt',
      position: { x: cx + r * Math.cos(angle), y: cy + r * Math.sin(angle) },
      diameterMm: opts.boltSizeMm,
    });
  }

  // Validate spacing.
  const issues = validateSpacing(features, minSpacing);
  warnings.push(...issues);

  // Accuracy check.
  const recommendedDowelDia = recommendDowelDiameter(opts.positionalAccuracyMm);
  if (recommendedDowelDia > opts.dowelDiameterMm) {
    warnings.push(`Dowel diameter ${opts.dowelDiameterMm} below recommended ${recommendedDowelDia} for ${opts.positionalAccuracyMm} mm accuracy.`);
  }

  return { features, minSpacingMm: minSpacing, warnings };
}

function pickHoleFit(fit: DowelFit): PinningFeature['holeFit'] {
  switch (fit) {
    case 'press': return 'H7-press';
    case 'slip': return 'H7';
    case 'tight': return 'H6';
  }
}

// ── Spacing validation ───────────────────────────────────────

function validateSpacing(features: PinningFeature[], minSpacing: number): string[] {
  const issues: string[] = [];
  for (let i = 0; i < features.length; i++) {
    for (let j = i + 1; j < features.length; j++) {
      const a = features[i]!;
      const b = features[j]!;
      const dist = Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y);
      if (dist < minSpacing) {
        issues.push(`Features ${a.id} ↔ ${b.id} too close (${dist.toFixed(2)} < ${minSpacing.toFixed(2)} mm).`);
      }
    }
  }
  return issues;
}

// ── Dowel diameter recommendation ────────────────────────────

function recommendDowelDiameter(positionalAccuracyMm: number): number {
  // Rough rule: dowel diameter ≥ 100 × accuracy (so radial tolerance is ~1%).
  return Math.max(4, positionalAccuracyMm * 100);
}

// ── Material removal (drilling stock) estimate ───────────────

export interface DrillingStock {
  totalHoleCount: number;
  /** Total drilled volume (mm³). */
  totalVolumeMm3: number;
}

export function estimateDrillingStock(kit: PinningKit, depthMm: number): DrillingStock {
  let totalVolume = 0;
  for (const f of kit.features) {
    const radius = f.diameterMm / 2;
    totalVolume += Math.PI * radius * radius * depthMm;
  }
  return { totalHoleCount: kit.features.length, totalVolumeMm3: totalVolume };
}

// ── Summary ────────────────────────────────────────────────────

export interface KitSummary {
  dowelCount: number;
  boltCount: number;
  warningCount: number;
  minSpacingMm: number;
}

export function summarize(kit: PinningKit): KitSummary {
  let dowels = 0, bolts = 0;
  for (const f of kit.features) {
    if (f.kind === 'dowel') dowels++;
    else bolts++;
  }
  return { dowelCount: dowels, boltCount: bolts, warningCount: kit.warnings.length, minSpacingMm: kit.minSpacingMm };
}
