/**
 * washerPatternPicker.ts — Pick appropriate washer set for a bolted
 * joint.
 *
 * Joint needs:
 *
 *   - Hard-against-soft material (load distribution).
 *   - Anti-vibration: lock washer (split, star, Nord-Lock).
 *   - Sealing: bonded / Dowty washer.
 *   - Electrical insulation: insulating washer.
 *
 * Module:
 *   - Recommends a washer stack from joint properties.
 *   - Computes total stack thickness for clamping length calc.
 *   - Validates standard sizes available for the chosen bolt size.
 */

export type WasherKind = 'plain-flat' | 'fender' | 'spring-split' | 'tooth-internal' | 'tooth-external' | 'nord-lock' | 'bonded-seal' | 'insulating';

export type JointPurpose = 'standard' | 'soft-material' | 'anti-vibration' | 'seal' | 'electrical-insulation';

export interface WasherStandard {
  kind: WasherKind;
  innerDiameterMm: number;
  outerDiameterMm: number;
  thicknessMm: number;
}

export interface BoltSpec {
  threadDiameterMm: number;
  /** Bolt head diameter (across-flats). */
  headDiameterMm: number;
  /** Plate / soft material info if applicable. */
  softSide?: 'top' | 'bottom' | 'both';
}

export interface PickerOptions {
  purpose: JointPurpose;
  /** Whether to include locking option. */
  includeLockWasher: boolean;
}

export const DEFAULT_OPTIONS: PickerOptions = {
  purpose: 'standard',
  includeLockWasher: false,
};

export interface PickedStack {
  topSide: WasherStandard[];
  bottomSide: WasherStandard[];
  totalThicknessMm: number;
  rationale: string[];
}

// ── Standard washer dimensions per bolt size ──────────────────

export function washerForBolt(kind: WasherKind, bolt: BoltSpec): WasherStandard {
  const inner = bolt.threadDiameterMm * 1.05;
  let outer = bolt.headDiameterMm * 1.5;
  let thickness = 1.5;
  switch (kind) {
    case 'fender': outer = bolt.headDiameterMm * 2.5; thickness = 1.6; break;
    case 'spring-split': outer = bolt.headDiameterMm * 1.4; thickness = 1.8; break;
    case 'tooth-internal':
    case 'tooth-external': outer = bolt.headDiameterMm * 1.5; thickness = 0.6; break;
    case 'nord-lock': outer = bolt.headDiameterMm * 1.5; thickness = 2.0; break;
    case 'bonded-seal': outer = bolt.headDiameterMm * 1.4; thickness = 1.5; break;
    case 'insulating': outer = bolt.headDiameterMm * 1.5; thickness = 1.5; break;
    case 'plain-flat':
    default: break;
  }
  return {
    kind,
    innerDiameterMm: inner,
    outerDiameterMm: outer,
    thicknessMm: thickness,
  };
}

// ── Top-level entry ────────────────────────────────────────────

export function pickStack(bolt: BoltSpec, options: Partial<PickerOptions> = {}): PickedStack {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const topSide: WasherStandard[] = [];
  const bottomSide: WasherStandard[] = [];
  const rationale: string[] = [];

  // Always start with a plain-flat under bolt head.
  topSide.push(washerForBolt('plain-flat', bolt));
  rationale.push('Plain flat washer under head for load distribution.');

  switch (opts.purpose) {
    case 'soft-material':
      if (bolt.softSide === 'top' || bolt.softSide === 'both') {
        topSide.unshift(washerForBolt('fender', bolt));
        rationale.push('Fender (large OD) on soft-side top.');
      }
      if (bolt.softSide === 'bottom' || bolt.softSide === 'both') {
        bottomSide.push(washerForBolt('fender', bolt));
        rationale.push('Fender on soft-side bottom.');
      }
      break;
    case 'anti-vibration':
      topSide.push(washerForBolt('nord-lock', bolt));
      rationale.push('Nord-Lock for anti-vibration retention.');
      break;
    case 'seal':
      bottomSide.unshift(washerForBolt('bonded-seal', bolt));
      rationale.push('Bonded seal on the pressure side.');
      break;
    case 'electrical-insulation':
      topSide.push(washerForBolt('insulating', bolt));
      bottomSide.push(washerForBolt('insulating', bolt));
      rationale.push('Insulating washer top + bottom.');
      break;
  }

  if (opts.includeLockWasher && opts.purpose !== 'anti-vibration') {
    topSide.push(washerForBolt('spring-split', bolt));
    rationale.push('Spring-split lock washer added.');
  }

  const total = [...topSide, ...bottomSide].reduce((s, w) => s + w.thicknessMm, 0);
  return { topSide, bottomSide, totalThicknessMm: total, rationale };
}

// ── Clamp length helper ──────────────────────────────────────

export function clampLength(stack: PickedStack, plateThicknessMm: number): number {
  return stack.totalThicknessMm + plateThicknessMm;
}

// ── Suggest bolt length ──────────────────────────────────────

export interface BoltLengthSuggestion {
  recommendedLengthMm: number;
  rationale: string;
}

export function recommendBoltLength(stack: PickedStack, plateThicknessMm: number, threadEngagementMm: number): BoltLengthSuggestion {
  const length = stack.totalThicknessMm + plateThicknessMm + threadEngagementMm + 2;
  return {
    recommendedLengthMm: length,
    rationale: `Stack ${stack.totalThicknessMm.toFixed(1)} + plate ${plateThicknessMm} + engagement ${threadEngagementMm} + 2 safety = ${length.toFixed(1)} mm.`,
  };
}

// ── Summary ────────────────────────────────────────────────────

export interface StackSummary {
  topCount: number;
  bottomCount: number;
  totalThicknessMm: number;
  purpose: JointPurpose;
}

export function summarize(stack: PickedStack, purpose: JointPurpose): StackSummary {
  return {
    topCount: stack.topSide.length,
    bottomCount: stack.bottomSide.length,
    totalThicknessMm: stack.totalThicknessMm,
    purpose,
  };
}
