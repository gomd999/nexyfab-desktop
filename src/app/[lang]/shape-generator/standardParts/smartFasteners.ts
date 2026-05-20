/**
 * smartFasteners.ts — Hole wizard + smart fastener auto-fit.
 *
 * SolidWorks Toolbox / Smart Components: when you drop a screw into
 * a hole, the hole auto-sizes to the fastener's clearance / tap
 * specification. Conversely, picking a hole pattern from the wizard
 * provides the matching screw / nut / washer assembly.
 *
 * This module is the *catalog + fit logic* between fasteners and
 * holes. The 3D placement / mate generation lives in the existing
 * `assembly/applyGeometryMatesToPlaced.ts`.
 *
 * Capabilities:
 *
 *   - **Standard thread → drill table** — given M5×0.8, return the
 *     tap drill diameter (4.2 mm) and clearance hole diameters
 *     (close 5.3 / medium 5.5 / loose 5.8).
 *
 *   - **Counter-bore / counter-sink dimensions** — head clearance
 *     diameters per ISO 4762 (socket head cap), DIN 7991 (flat head),
 *     ASME B18.3.
 *
 *   - **Tap drill % thread engagement** — most prints want 75%; 50%
 *     for soft materials or tap life concerns.
 *
 *   - **Fastener length recommendation** — given plate thicknesses
 *     + thread engagement target, pick the standard length that
 *     gives the required engagement.
 */

export type ThreadStandard = 'metric-coarse' | 'metric-fine' | 'unified-coarse' | 'unified-fine';
export type ThreadFitClass = 'close' | 'medium' | 'loose';
export type HeadStyle = 'socket-cap' | 'flat-head' | 'button' | 'pan' | 'hex' | 'cheese';

export interface ThreadSpec {
  /** Display id (M5, M6×1, 1/4-20, etc). */
  id: string;
  standard: ThreadStandard;
  /** Nominal diameter (mm). */
  nominalMm: number;
  /** Pitch (mm). */
  pitchMm: number;
  /** Tap drill diameter for 75% engagement (mm). */
  tapDrillMm: number;
  /** Clearance hole diameters by fit class. */
  clearanceCloseMm: number;
  clearanceMediumMm: number;
  clearanceLooseMm: number;
}

/** Subset of M3 / M4 / M5 / M6 / M8 / M10 / M12 metric coarse. */
export const THREAD_CATALOG: ThreadSpec[] = [
  { id: 'M3',  standard: 'metric-coarse', nominalMm: 3,  pitchMm: 0.5,
    tapDrillMm: 2.5, clearanceCloseMm: 3.2, clearanceMediumMm: 3.4, clearanceLooseMm: 3.6 },
  { id: 'M4',  standard: 'metric-coarse', nominalMm: 4,  pitchMm: 0.7,
    tapDrillMm: 3.3, clearanceCloseMm: 4.3, clearanceMediumMm: 4.5, clearanceLooseMm: 4.8 },
  { id: 'M5',  standard: 'metric-coarse', nominalMm: 5,  pitchMm: 0.8,
    tapDrillMm: 4.2, clearanceCloseMm: 5.3, clearanceMediumMm: 5.5, clearanceLooseMm: 5.8 },
  { id: 'M6',  standard: 'metric-coarse', nominalMm: 6,  pitchMm: 1.0,
    tapDrillMm: 5.0, clearanceCloseMm: 6.4, clearanceMediumMm: 6.6, clearanceLooseMm: 7.0 },
  { id: 'M8',  standard: 'metric-coarse', nominalMm: 8,  pitchMm: 1.25,
    tapDrillMm: 6.8, clearanceCloseMm: 8.4, clearanceMediumMm: 9.0, clearanceLooseMm: 10.0 },
  { id: 'M10', standard: 'metric-coarse', nominalMm: 10, pitchMm: 1.5,
    tapDrillMm: 8.5, clearanceCloseMm: 10.5, clearanceMediumMm: 11.0, clearanceLooseMm: 12.0 },
  { id: 'M12', standard: 'metric-coarse', nominalMm: 12, pitchMm: 1.75,
    tapDrillMm: 10.2, clearanceCloseMm: 13.0, clearanceMediumMm: 14.0, clearanceLooseMm: 15.0 },
];

export function findThreadSpec(id: string): ThreadSpec | null {
  return THREAD_CATALOG.find(s => s.id === id) ?? null;
}

/** Compute tap drill diameter for a given thread engagement percentage. */
export function tapDrillFor(spec: ThreadSpec, percentEngagement: number = 75): number {
  // Thread height = 0.65 × pitch (ISO theoretical).
  // % engagement scales how much of that height is engaged.
  const threadHeight = 0.65 * spec.pitchMm;
  const engagedHeight = threadHeight * (percentEngagement / 100);
  // Tap drill = nominal - 2 × engaged height.
  return spec.nominalMm - 2 * engagedHeight;
}

// ── Counter-bore + counter-sink ──────────────────────────────────

export interface CounterBoreSpec {
  /** Counter-bore diameter (mm). */
  cBoreDiameterMm: number;
  /** Counter-bore depth (mm). Caller can extend for full head + safety. */
  cBoreDepthMm: number;
}

export interface CounterSinkSpec {
  /** Counter-sink diameter at the surface (mm). */
  cSinkDiameterMm: number;
  /** Counter-sink angle (degrees). 82° for ANSI inch, 90° for ISO. */
  angleDeg: number;
}

const HEAD_DIAMETERS: Record<HeadStyle, Record<string, number>> = {
  'socket-cap':  { M3: 5.5, M4: 7.0, M5: 8.5, M6: 10, M8: 13, M10: 16, M12: 18 },
  'button':      { M3: 5.7, M4: 7.6, M5: 9.5, M6: 10.5, M8: 14, M10: 17.5, M12: 21 },
  'pan':         { M3: 5.6, M4: 7.5, M5: 9.5, M6: 11.2, M8: 14.6, M10: 18.0, M12: 21.6 },
  'cheese':      { M3: 5.5, M4: 7.0, M5: 8.5, M6: 10, M8: 13, M10: 16, M12: 18 },
  'hex':         { M3: 6.4, M4: 8.0, M5: 9.2, M6: 11.5, M8: 15.0, M10: 18.7, M12: 22.0 },
  // Flat heads use counter-sink not counter-bore.
  'flat-head':   { M3: 6.0, M4: 8.0, M5: 9.8, M6: 12.0, M8: 16.0, M10: 20.0, M12: 23.5 },
};

export function counterBoreFor(threadId: string, head: HeadStyle, plateThicknessMm: number): CounterBoreSpec | null {
  const headDiamRow = HEAD_DIAMETERS[head];
  if (!headDiamRow) return null;
  const headDiam = headDiamRow[threadId];
  if (headDiam == null) return null;
  // Counter-bore diameter = head diameter + small clearance (0.4 mm).
  // Counter-bore depth = head height + 0.5 mm clearance (typical).
  // We approximate head height as 0.7 × thread nominal.
  const spec = findThreadSpec(threadId);
  if (!spec) return null;
  const headHeight = spec.nominalMm * 0.7;
  return {
    cBoreDiameterMm: headDiam + 0.4,
    cBoreDepthMm: Math.min(headHeight + 0.5, plateThicknessMm * 0.7),
  };
}

export function counterSinkFor(threadId: string, isoOrAnsi: 'ISO' | 'ANSI' = 'ISO'): CounterSinkSpec | null {
  const spec = findThreadSpec(threadId);
  if (!spec) return null;
  const headDiam = HEAD_DIAMETERS['flat-head'][threadId];
  if (headDiam == null) return null;
  return {
    cSinkDiameterMm: headDiam,
    angleDeg: isoOrAnsi === 'ISO' ? 90 : 82,
  };
}

// ── Fastener auto-fit ────────────────────────────────────────────

export interface AutoFitInput {
  threadId: string;
  fitClass?: ThreadFitClass;
  headStyle?: HeadStyle;
  /** Plate thicknesses through which the fastener passes. */
  plateStackMm: number[];
  /** Material it threads into (last plate). */
  threadedPlateMaterial?: 'steel' | 'aluminum' | 'cast-iron' | 'plastic';
  /** Required thread engagement (× nominal). Default 1.5 for steel, 2 for aluminum. */
  engagementRatio?: number;
}

export interface AutoFitResult {
  /** Hole diameter for the through-plate(s) (mm). */
  clearanceHoleMm: number;
  /** Tap drill for the threaded plate (mm). */
  tapDrillMm: number;
  /** Required thread engagement length (mm). */
  engagementMm: number;
  /** Recommended fastener length (mm). */
  fastenerLengthMm: number;
  /** Optional counter-bore. */
  counterBore?: CounterBoreSpec;
  /** Optional counter-sink. */
  counterSink?: CounterSinkSpec;
  /** Warnings (e.g. plate too thin for engagement). */
  warnings: string[];
}

const ENGAGEMENT_BY_MATERIAL: Record<string, number> = {
  steel: 1.0,
  'cast-iron': 1.25,
  aluminum: 1.5,
  plastic: 2.0,
};

export function autoFitFastener(input: AutoFitInput): AutoFitResult | null {
  const spec = findThreadSpec(input.threadId);
  if (!spec) return null;
  const fitClass = input.fitClass ?? 'medium';
  const head = input.headStyle ?? 'socket-cap';
  const plates = input.plateStackMm;
  if (plates.length === 0) return null;

  const clearance = fitClass === 'close'
    ? spec.clearanceCloseMm
    : fitClass === 'loose' ? spec.clearanceLooseMm : spec.clearanceMediumMm;

  const tap = spec.tapDrillMm;
  const engagement = (input.engagementRatio ?? ENGAGEMENT_BY_MATERIAL[input.threadedPlateMaterial ?? 'steel']!) * spec.nominalMm;

  const lastPlate = plates[plates.length - 1]!;
  const warnings: string[] = [];
  if (lastPlate < engagement) {
    warnings.push(`Last plate (${lastPlate.toFixed(1)}mm) too thin for ${engagement.toFixed(1)}mm engagement`);
  }

  // Required fastener length = sum of through plates + engagement + small extension.
  const throughLength = plates.slice(0, -1).reduce((s, t) => s + t, 0);
  const minLength = throughLength + Math.min(engagement, lastPlate);
  // Round up to standard length (5mm increments).
  const fastenerLength = Math.ceil(minLength / 5) * 5;

  let counterBore: CounterBoreSpec | undefined;
  let counterSink: CounterSinkSpec | undefined;
  if (head === 'flat-head') {
    counterSink = counterSinkFor(input.threadId) ?? undefined;
  } else {
    counterBore = counterBoreFor(input.threadId, head, plates[0]!) ?? undefined;
  }

  return {
    clearanceHoleMm: clearance,
    tapDrillMm: tap,
    engagementMm: engagement,
    fastenerLengthMm: fastenerLength,
    counterBore,
    counterSink,
    warnings,
  };
}

// ── Hole wizard preset ───────────────────────────────────────────

export type WizardHoleType =
  | 'simple-drilled'
  | 'tapped-blind'
  | 'tapped-through'
  | 'clearance-counterbore'
  | 'clearance-countersink';

export interface HoleWizardPreset {
  holeType: WizardHoleType;
  threadId: string;
  fitClass?: ThreadFitClass;
  headStyle?: HeadStyle;
  /** Hole depth (mm). For 'through', null = match plate. */
  depthMm?: number;
}

export interface WizardHoleSpec {
  /** Diameter at top surface (mm). */
  diameterMm: number;
  depthMm: number;
  /** True for tapped holes. */
  isTapped: boolean;
  /** Counter-bore / sink applied? */
  hasCounterFeature: boolean;
  counterBore?: CounterBoreSpec;
  counterSink?: CounterSinkSpec;
}

export function generateWizardHole(preset: HoleWizardPreset, plateThicknessMm: number): WizardHoleSpec | null {
  const spec = findThreadSpec(preset.threadId);
  if (!spec) return null;
  const fitClass = preset.fitClass ?? 'medium';
  switch (preset.holeType) {
    case 'simple-drilled':
      return {
        diameterMm: spec.nominalMm + 0.5,
        depthMm: preset.depthMm ?? plateThicknessMm,
        isTapped: false,
        hasCounterFeature: false,
      };
    case 'tapped-blind':
      return {
        diameterMm: spec.tapDrillMm,
        depthMm: preset.depthMm ?? Math.min(plateThicknessMm - 1, spec.nominalMm * 2),
        isTapped: true,
        hasCounterFeature: false,
      };
    case 'tapped-through':
      return {
        diameterMm: spec.tapDrillMm,
        depthMm: plateThicknessMm,
        isTapped: true,
        hasCounterFeature: false,
      };
    case 'clearance-counterbore': {
      const cb = counterBoreFor(preset.threadId, preset.headStyle ?? 'socket-cap', plateThicknessMm);
      return {
        diameterMm: fitClass === 'close' ? spec.clearanceCloseMm
          : fitClass === 'loose' ? spec.clearanceLooseMm
          : spec.clearanceMediumMm,
        depthMm: plateThicknessMm,
        isTapped: false,
        hasCounterFeature: cb != null,
        counterBore: cb ?? undefined,
      };
    }
    case 'clearance-countersink': {
      const cs = counterSinkFor(preset.threadId);
      return {
        diameterMm: spec.clearanceMediumMm,
        depthMm: plateThicknessMm,
        isTapped: false,
        hasCounterFeature: cs != null,
        counterSink: cs ?? undefined,
      };
    }
  }
}
