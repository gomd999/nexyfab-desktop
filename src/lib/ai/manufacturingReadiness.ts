export type ManufacturingReadinessLevel =
  | 'verified'
  | 'review_required'
  | 'concept_only';

export interface ManufacturingReadiness {
  level: ManufacturingReadinessLevel;
  manufacturingAllowed: boolean;
  reasons: string[];
}

export interface ManufacturingReadinessInput {
  hasGeometry: boolean;
  hasFeatureProgram: boolean;
  analyticStepHandoffPassed?: boolean;
  skippedFeatures?: string[];
  clampedDimensions?: string[];
  gateReport?: ManufacturingGateReport;
}

/** A rendered mesh proves preview success, not manufacturability. */
export function classifyManufacturingReadiness(
  input: ManufacturingReadinessInput,
): ManufacturingReadiness {
  if (!input.hasGeometry) {
    return {
      level: 'concept_only',
      manufacturingAllowed: false,
      reasons: ['No rendered geometry is available.'],
    };
  }

  if (!input.hasFeatureProgram) {
    return {
      level: 'concept_only',
      manufacturingAllowed: false,
      reasons: ['The model is free-form or tessellated, not an analytic feature model.'],
    };
  }

  const skipped = input.skippedFeatures?.filter(Boolean) ?? [];
  const clamped = input.clampedDimensions?.filter(Boolean) ?? [];
  const reasons: string[] = [];
  if (skipped.length > 0) reasons.push(`Features were not applied: ${skipped.join(', ')}`);
  if (clamped.length > 0) reasons.push(`Dimensions were clamped: ${clamped.join(', ')}`);
  if (!input.analyticStepHandoffPassed) reasons.push('Analytic STEP handoff has not passed yet.');
  if (!input.gateReport?.passed) {
    const blocking = input.gateReport?.firstBlockingGate ?? 'G0';
    reasons.push(`Manufacturing gates G0-G9 have not all passed (blocked at ${blocking}).`);
  }

  if (reasons.length > 0) {
    return { level: 'review_required', manufacturingAllowed: false, reasons };
  }

  return {
    level: 'verified',
    manufacturingAllowed: true,
    reasons: ['Analytic STEP handoff passed without reported feature loss or clamping.'],
  };
}
import type { ManufacturingGateReport } from './manufacturingGates';
