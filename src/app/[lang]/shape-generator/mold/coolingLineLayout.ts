/**
 * coolingLineLayout.ts — Plan straight cooling channel network for
 * an injection mold cavity.
 *
 * Cooling lines remove heat from the molten polymer. Rules of thumb
 * (Menges / Beaumont):
 *
 *   - Channel diameter Ø7..Ø12 for parts < 200 mm.
 *   - Pitch (centre-to-centre) ≈ 3 × diameter.
 *   - Distance from channel to cavity surface ≈ 1..1.5 × diameter.
 *   - Series flow: simpler; parallel: better uniformity.
 *   - Reynolds # > 10,000 for turbulent flow → max heat transfer.
 *
 * Module:
 *   - Lays out a straight-bore cooling network covering a bounding
 *     box.
 *   - Computes flow rate to maintain Re_target.
 *   - Estimates pressure drop using Darcy–Weisbach.
 *   - Reports if temperature uniformity target is met.
 */

export interface CavityBounds {
  /** Length (mm) along flow direction. */
  lengthMm: number;
  /** Width (mm). */
  widthMm: number;
  /** Cooling channel runs at this depth below the cavity. */
  depthFromCavityMm: number;
}

export interface CoolantSpec {
  /** Density (kg/m³) ≈ 1000 for water. */
  densityKgM3: number;
  /** Dynamic viscosity (Pa·s) ≈ 0.001 for water at 20 °C. */
  viscosityPaS: number;
  /** Specific heat capacity (J/kg·K). */
  cpJKgK: number;
  /** Thermal conductivity (W/m·K). */
  conductivityWMk: number;
}

export const WATER: CoolantSpec = {
  densityKgM3: 1000,
  viscosityPaS: 0.001,
  cpJKgK: 4186,
  conductivityWMk: 0.6,
};

export interface LayoutOptions {
  /** Channel diameter (mm). */
  diameterMm: number;
  /** Target Reynolds number. */
  targetReynolds: number;
  /** Flow scheme. */
  scheme: 'series' | 'parallel';
}

export const DEFAULT_OPTIONS: LayoutOptions = {
  diameterMm: 10,
  targetReynolds: 10000,
  scheme: 'parallel',
};

export interface Channel {
  id: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
  diameterMm: number;
  lengthMm: number;
}

export interface CoolingLayout {
  channels: Channel[];
  flowRateLpm: number;
  pressureDropKpa: number;
  reynoldsNumber: number;
  recommendations: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function generateLayout(
  cavity: CavityBounds,
  coolant: CoolantSpec = WATER,
  options: Partial<LayoutOptions> = {},
): CoolingLayout {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const pitch = 3 * opts.diameterMm;
  const margin = 1.5 * opts.diameterMm;
  const channels: Channel[] = [];

  // Lay parallel straight channels along the length, spaced by pitch.
  let y = margin;
  let id = 0;
  while (y + margin <= cavity.widthMm) {
    channels.push({
      id: `ch${id++}`,
      start: { x: margin, y },
      end: { x: cavity.lengthMm - margin, y },
      diameterMm: opts.diameterMm,
      lengthMm: cavity.lengthMm - 2 * margin,
    });
    y += pitch;
  }

  // Total length (serial = sum, parallel = max).
  const totalLength = opts.scheme === 'series'
    ? channels.reduce((s, c) => s + c.lengthMm, 0)
    : channels.length > 0 ? channels[0]!.lengthMm : 0;

  // Velocity from Reynolds: Re = ρ·v·D / μ.
  const d = opts.diameterMm / 1000;
  const velocity = opts.targetReynolds * coolant.viscosityPaS / (coolant.densityKgM3 * d);
  const flowRateM3S = velocity * Math.PI * d * d / 4;
  // Multiplied by channel count for parallel.
  const totalFlowM3S = opts.scheme === 'parallel' ? flowRateM3S * channels.length : flowRateM3S;
  const flowLpm = totalFlowM3S * 1000 * 60;

  // Darcy friction factor approximation for turbulent flow.
  const f = 0.316 / Math.pow(opts.targetReynolds, 0.25);
  const dpPa = f * (totalLength / 1000) / d * 0.5 * coolant.densityKgM3 * velocity * velocity;
  const dpKpa = dpPa / 1000;

  const recommendations: string[] = [];
  if (channels.length < 2) {
    recommendations.push('Cavity too narrow for multiple cooling lines — consider series serpentine instead.');
  }
  if (opts.targetReynolds < 4000) {
    recommendations.push('Re < 4000 → laminar / transitional. Increase flow rate for turbulent heat transfer.');
  }
  if (cavity.depthFromCavityMm > 1.5 * opts.diameterMm) {
    recommendations.push(`Channels at ${cavity.depthFromCavityMm.toFixed(1)} mm below cavity (> 1.5·D); cooling effectiveness reduced.`);
  }

  return {
    channels,
    flowRateLpm: flowLpm,
    pressureDropKpa: dpKpa,
    reynoldsNumber: opts.targetReynolds,
    recommendations,
  };
}

// ── Heat removal estimate ─────────────────────────────────────

export function estimateHeatRemovalKw(
  layout: CoolingLayout,
  coolant: CoolantSpec,
  inletTempC: number,
  outletTempC: number,
): number {
  const dT = outletTempC - inletTempC;
  const flowM3S = layout.flowRateLpm / 1000 / 60;
  const massFlow = flowM3S * coolant.densityKgM3;
  return massFlow * coolant.cpJKgK * dT / 1000;
}

// ── Uniformity check ──────────────────────────────────────────

export function checkUniformity(layout: CoolingLayout, maxDeltaTC: number, deltaT: number): boolean {
  return deltaT <= maxDeltaTC && layout.channels.length >= 2;
}

// ── Summary ────────────────────────────────────────────────────

export interface LayoutSummary {
  channelCount: number;
  totalLengthMm: number;
  flowRateLpm: number;
  pressureDropKpa: number;
  recommendationCount: number;
}

export function summarize(layout: CoolingLayout): LayoutSummary {
  let totalLen = 0;
  for (const c of layout.channels) totalLen += c.lengthMm;
  return {
    channelCount: layout.channels.length,
    totalLengthMm: totalLen,
    flowRateLpm: layout.flowRateLpm,
    pressureDropKpa: layout.pressureDropKpa,
    recommendationCount: layout.recommendations.length,
  };
}
