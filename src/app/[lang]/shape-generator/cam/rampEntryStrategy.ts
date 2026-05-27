/**
 * rampEntryStrategy.ts — Pick a CAM ramp-entry strategy for a pocket
 * or slot.
 *
 * Plunging straight down with an end mill stresses the centre cutting
 * edge (which has zero peripheral velocity) and forms a chip-packing
 * hole. Better strategies:
 *
 *   - Linear ramp: tool descends along a straight line at a ramp
 *     angle (typically 1°-5° for end mills, up to 15° for drills).
 *   - Zig-zag ramp: back-and-forth descent for wide pockets.
 *   - Helical (spiral) ramp: continuous circular motion downward,
 *     uses tool's side cutting; best for end mills.
 *   - Pre-drilled hole: drill first, then position mill in the hole
 *     (used for pockets too small to spiral).
 *
 * Module picks the best strategy based on:
 *   - Tool geometry (centre-cutting? coated?)
 *   - Pocket dimensions vs tool diameter
 *   - Material removal expectations (rough vs finish)
 *   - Machine spindle power
 */

export type ToolType = 'end-mill' | 'centre-cutting-end-mill' | 'drill' | 'ball-nose' | 'insert-mill';

export type RampType = 'plunge' | 'linear-ramp' | 'zigzag-ramp' | 'helical' | 'pre-drilled-hole';

export interface ToolSpec {
  type: ToolType;
  diameterMm: number;
  /** Whether the tool can plunge straight (center-cutting). */
  centreCutting: boolean;
  /** Max recommended ramp angle for this tool. */
  maxRampAngleDeg: number;
}

export interface PocketGeometry {
  /** Pocket length (mm). */
  lengthMm: number;
  /** Pocket width (mm). */
  widthMm: number;
  /** Pocket depth (mm). */
  depthMm: number;
  /** Whether walls are vertical. */
  verticalWalls: boolean;
}

export interface MachineSpec {
  spindlePowerKw: number;
  rapidRateMpm: number;
}

export interface StrategyOptions {
  /** Whether this is a roughing or finishing pass. */
  isRoughing: boolean;
  /** Material grade affects ramp angle / chip evacuation. */
  material: 'aluminum' | 'steel' | 'stainless' | 'titanium' | 'plastic' | 'cast-iron';
}

export const DEFAULT_OPTIONS: StrategyOptions = {
  isRoughing: true,
  material: 'aluminum',
};

export interface StrategyChoice {
  rampType: RampType;
  rampAngleDeg: number;
  helicalRadiusMm?: number;
  estimatedRampTimeSec: number;
  /** Reasoning behind the choice. */
  rationale: string;
  warnings: string[];
}

// ── Top-level entry ────────────────────────────────────────────

export function pickRampStrategy(
  tool: ToolSpec,
  pocket: PocketGeometry,
  machine: MachineSpec,
  options: Partial<StrategyOptions> = {},
): StrategyChoice {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const warnings: string[] = [];

  // Decide ramp type.
  let rampType: RampType;
  let rampAngle: number;
  let helicalRadius: number | undefined;
  let rationale: string;

  const widthRatio = pocket.widthMm / tool.diameterMm;
  const lengthRatio = pocket.lengthMm / tool.diameterMm;
  const isWide = widthRatio >= 2.5 && lengthRatio >= 2.5;
  const isShort = pocket.depthMm < tool.diameterMm * 0.5;
  const materialFactor = materialRampFactor(opts.material);

  if (isWide) {
    // Wide pocket — helical is most efficient.
    rampType = 'helical';
    rampAngle = Math.min(tool.maxRampAngleDeg, 3 * materialFactor);
    helicalRadius = tool.diameterMm * 0.4;
    rationale = `Pocket is wide (${widthRatio.toFixed(1)}× tool dia × ${lengthRatio.toFixed(1)}× tool dia). Helical ramp uses peripheral cutting edges — best chip evacuation.`;
  } else if (widthRatio < 1.2) {
    // Pocket barely wider than tool — can't helix.
    if (tool.centreCutting && isShort) {
      rampType = 'plunge';
      rampAngle = 90;
      rationale = `Pocket too narrow for ramping. Centre-cutting tool + shallow depth allow plunge.`;
    } else {
      rampType = 'pre-drilled-hole';
      rampAngle = 0;
      rationale = `Pocket too narrow for ramping. Pre-drill a pilot hole.`;
    }
  } else if (lengthRatio >= 1.5) {
    // Slot-like pocket: linear ramp works.
    rampType = 'linear-ramp';
    rampAngle = Math.min(tool.maxRampAngleDeg, 5 * materialFactor);
    rationale = `Slot-shaped pocket (${lengthRatio.toFixed(1)}× × ${widthRatio.toFixed(1)}×). Linear ramp at ${rampAngle.toFixed(0)}° works.`;
  } else {
    rampType = 'zigzag-ramp';
    rampAngle = Math.min(tool.maxRampAngleDeg, 3 * materialFactor);
    rationale = `Medium pocket. Zigzag ramp distributes load.`;
  }

  // Power check.
  const requiredPowerKw = estimateRampPower(tool, pocket.depthMm, rampAngle, opts.material);
  if (requiredPowerKw > machine.spindlePowerKw) {
    warnings.push(`Estimated ramp power ${requiredPowerKw.toFixed(1)} kW exceeds spindle ${machine.spindlePowerKw.toFixed(1)} kW. Reduce DOC or ramp angle.`);
  }

  // Time estimate.
  const time = estimateRampTime(pocket.depthMm, rampAngle, rampType, helicalRadius, machine.rapidRateMpm);

  // Centre-cutting warning.
  if (rampType === 'plunge' && !tool.centreCutting) {
    warnings.push(`Tool is not centre-cutting; plunging will dwell on the chip flute.`);
  }

  const choice: StrategyChoice = {
    rampType,
    rampAngleDeg: rampAngle,
    estimatedRampTimeSec: time,
    rationale,
    warnings,
  };
  if (helicalRadius !== undefined) {
    choice.helicalRadiusMm = helicalRadius;
  }
  return choice;
}

// ── Helpers ───────────────────────────────────────────────────

function materialRampFactor(material: StrategyOptions['material']): number {
  const factors: Record<StrategyOptions['material'], number> = {
    aluminum: 1.5,
    steel: 1.0,
    stainless: 0.8,
    titanium: 0.5,
    plastic: 1.5,
    'cast-iron': 1.0,
  };
  return factors[material];
}

function estimateRampPower(tool: ToolSpec, depthMm: number, _rampAngleDeg: number, material: StrategyOptions['material']): number {
  const sfm: Record<StrategyOptions['material'], number> = {
    aluminum: 0.4, steel: 1.4, stainless: 1.8, titanium: 2.5, plastic: 0.2, 'cast-iron': 1.0,
  };
  // Very rough: P = MRR × specific cutting energy.
  const mrrMm3PerMin = tool.diameterMm * 0.5 * depthMm * 100;
  return (mrrMm3PerMin / 60000) * sfm[material] * 10;
}

function estimateRampTime(depth: number, angle: number, rampType: RampType, helixR: number | undefined, rapidMpm: number): number {
  if (angle <= 0 || rapidMpm <= 0) return 0;
  if (rampType === 'plunge') return depth / (rapidMpm * 1000 / 60);
  if (rampType === 'helical' && helixR !== undefined) {
    const turns = depth / Math.max(0.1, helixR * 2 * Math.tan(angle * Math.PI / 180));
    const dist = turns * 2 * Math.PI * helixR;
    return dist / (rapidMpm * 1000 / 60);
  }
  // Linear / zig-zag: horizontal travel / sin(angle).
  const dist = depth / Math.sin(angle * Math.PI / 180);
  return dist / (rapidMpm * 1000 / 60);
}

// ── Summary ────────────────────────────────────────────────────

export interface RampSummary {
  rampType: RampType;
  rampAngleDeg: number;
  estimatedTimeSec: number;
  warningCount: number;
}

export function summarize(choice: StrategyChoice): RampSummary {
  return {
    rampType: choice.rampType,
    rampAngleDeg: choice.rampAngleDeg,
    estimatedTimeSec: choice.estimatedRampTimeSec,
    warningCount: choice.warnings.length,
  };
}
