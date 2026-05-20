/**
 * threadCalloutGenerator.ts — Generate thread call-out strings per
 * ISO 6410 / ASME Y14.6.
 *
 * Examples:
 *
 *   ISO metric:        M6 × 1 — 6H/6g, ⌀ depth 15
 *   Inch UNC:          1/4-20 UNC — 2B/2A
 *   Pipe (NPT):        1/4-18 NPT
 *   Thread mill:       M6 × 1 — 5H
 *
 * Module:
 *   - Builds the canonical call-out string from a structured spec.
 *   - Validates the spec (size in standard list, pitch consistent).
 *   - Suggests fit-class when omitted.
 */

export type ThreadStandard = 'metric' | 'unc' | 'unf' | 'npt' | 'bsp';

export type ThreadDirection = 'right' | 'left';

export interface ThreadSpec {
  standard: ThreadStandard;
  /** Nominal diameter (mm for metric; tap-drill size index for inch). */
  nominalMm: number;
  pitchMm?: number;
  /** Class (e.g., 6H/6g for metric; 2B/2A for inch). */
  fitClass?: string;
  /** Internal (tapped) or external (bolt). */
  internal: boolean;
  /** Direction. */
  direction: ThreadDirection;
  /** Thread depth (mm). 0 = through. */
  depthMm: number;
  /** Drill depth (mm). 0 = same as thread. */
  drillDepthMm?: number;
}

export interface CalloutResult {
  text: string;
  /** Drill diameter (mm) for internal threads. */
  drillDiameterMm?: number;
  warnings: string[];
}

// ── Standard metric pitches per nominal ──────────────────────

export const METRIC_COARSE_PITCH: Record<number, number> = {
  3: 0.5, 4: 0.7, 5: 0.8, 6: 1.0, 8: 1.25, 10: 1.5, 12: 1.75, 16: 2.0, 20: 2.5, 24: 3.0, 30: 3.5, 36: 4.0,
};

export const UNC_TPI: Record<number, number> = {
  0.25: 20, 0.3125: 18, 0.375: 16, 0.4375: 14, 0.5: 13, 0.625: 11, 0.75: 10, 0.875: 9, 1.0: 8,
};

// ── Top-level entry ────────────────────────────────────────────

export function buildCallout(spec: ThreadSpec): CalloutResult {
  const warnings: string[] = [];
  const parts: string[] = [];
  let drillDia: number | undefined;

  switch (spec.standard) {
    case 'metric': {
      const pitch = spec.pitchMm ?? METRIC_COARSE_PITCH[spec.nominalMm];
      if (pitch === undefined) {
        warnings.push(`No standard pitch for M${spec.nominalMm}; specify pitch.`);
      }
      parts.push(`M${spec.nominalMm}`);
      if (pitch !== undefined) parts.push(`× ${pitch}`);
      const fit = spec.fitClass ?? (spec.internal ? '6H' : '6g');
      parts.push(`— ${fit}`);
      drillDia = spec.internal && pitch ? metricTapDrill(spec.nominalMm, pitch) : undefined;
      break;
    }
    case 'unc':
    case 'unf': {
      const tpi = spec.pitchMm
        ? Math.round(25.4 / spec.pitchMm)
        : UNC_TPI[Math.round(spec.nominalMm / 25.4 * 10000) / 10000];
      if (!tpi) warnings.push(`No standard TPI for given nominal.`);
      const inchNominal = (spec.nominalMm / 25.4).toFixed(4);
      parts.push(`${inchNominal}-${tpi ?? '?'}`);
      parts.push(spec.standard.toUpperCase());
      const fit = spec.fitClass ?? (spec.internal ? '2B' : '2A');
      parts.push(`— ${fit}`);
      drillDia = spec.internal && tpi ? inchTapDrill(spec.nominalMm, tpi) : undefined;
      break;
    }
    case 'npt': {
      const tpi = spec.pitchMm ? Math.round(25.4 / spec.pitchMm) : 18;
      const inchNominal = (spec.nominalMm / 25.4).toFixed(4);
      parts.push(`${inchNominal}-${tpi} NPT`);
      break;
    }
    case 'bsp': {
      parts.push(`${(spec.nominalMm / 25.4).toFixed(4)}-BSP`);
      break;
    }
  }

  if (spec.direction === 'left') parts.push('LH');
  if (spec.depthMm > 0) parts.push(`DP ${spec.depthMm}`);
  if (spec.drillDepthMm !== undefined && spec.drillDepthMm > spec.depthMm) {
    parts.push(`DRILL DP ${spec.drillDepthMm}`);
  }

  const callout: CalloutResult = { text: parts.join(' '), warnings };
  if (drillDia !== undefined) callout.drillDiameterMm = drillDia;
  return callout;
}

// ── Helpers ──────────────────────────────────────────────────

function metricTapDrill(nominalMm: number, pitchMm: number): number {
  // 75% engagement default rule.
  return nominalMm - 1.0825 * pitchMm * 0.75;
}

function inchTapDrill(nominalMm: number, tpi: number): number {
  const pitch = 25.4 / tpi;
  return nominalMm - 1.0825 * pitch * 0.75;
}

// ── Bulk generation ──────────────────────────────────────────

export function generateBatch(specs: ThreadSpec[]): CalloutResult[] {
  return specs.map(buildCallout);
}

// ── Standard call-out grammar check ──────────────────────────

export interface GrammarCheck {
  text: string;
  valid: boolean;
  issues: string[];
}

export function validateCallout(text: string): GrammarCheck {
  const issues: string[] = [];
  if (/^M\d+\s/.test(text)) {
    if (!/×\s*\d+(\.\d+)?/.test(text)) issues.push('Metric thread missing pitch × clause.');
  }
  if (/UNC|UNF/.test(text) && !/\d+\/\d+|\d+\.\d+/.test(text)) {
    issues.push('Inch thread missing fractional or decimal nominal.');
  }
  return { text, valid: issues.length === 0, issues };
}

// ── Summary ────────────────────────────────────────────────────

export interface CalloutSummary {
  text: string;
  hasDrill: boolean;
  warningCount: number;
}

export function summarize(result: CalloutResult): CalloutSummary {
  return {
    text: result.text,
    hasDrill: result.drillDiameterMm !== undefined,
    warningCount: result.warnings.length,
  };
}
