import type { RobotEngineeringReport, RobotEngineeringSpec } from './robotEngineering';
import type { JointSelection, JointSelectionRequirement } from './componentSelector';

export type RequirementDerivation =
  | { ok: true; requirements: JointSelectionRequirement[] }
  | { ok: false; errors: string[] };

export type JointHousingCapacity = {
  joint: number;
  internalMm: { x: number; y: number; z: number };
  radialClearanceMm: number;
  axialClearanceMm: number;
  source: string;
  artifactHash: string;
};

export type HousingFitResult = {
  joint: number;
  status: 'passed' | 'failed' | 'not_run';
  requiredInternalMm: { x: number; y: number; z: number } | null;
  availableInternalMm: { x: number; y: number; z: number } | null;
  errors: string[];
};

/** Derive selector inputs only when every non-torque load requirement is explicit. */
export function deriveJointSelectionRequirements(
  spec: RobotEngineeringSpec,
  engineering: RobotEngineeringReport,
  safetyFactor = 1.5,
): RequirementDerivation {
  const errors: string[] = [];
  if (!(safetyFactor >= 1 && Number.isFinite(safetyFactor))) errors.push('safetyFactor must be finite and at least 1');
  const requirements = spec.joints.flatMap((joint, index) => {
    const id = index + 1;
    const torque = engineering.torque.find(item => item.joint === id)?.requiredNm;
    const missing = [
      [torque, 'requiredOutputTorqueNm'],
      [joint.requiredOutputRpm, 'requiredOutputRpm'],
      [joint.radialLoadN, 'radialLoadN'],
      [joint.minShaftDiameterMm, 'minShaftDiameterMm'],
    ].filter(([value]) => typeof value !== 'number' || !Number.isFinite(value) || value <= 0).map(([, field]) => String(field));
    if (missing.length) {
      errors.push(`J${id}: explicit positive ${missing.join(', ')} required for catalog selection`);
      return [];
    }
    return [{
      joint: id,
      requiredOutputTorqueNm: torque!,
      requiredOutputRpm: joint.requiredOutputRpm!,
      radialLoadN: joint.radialLoadN!,
      minShaftDiameterMm: joint.minShaftDiameterMm!,
      safetyFactor,
    }];
  });
  return errors.length ? { ok: false, errors } : { ok: true, requirements };
}

/** Envelope-only preflight. Passing this never proves collision-free or manufacturable housing geometry. */
export function evaluateSelectedDriveHousing(
  selections: readonly JointSelection[],
  capacities: readonly JointHousingCapacity[],
): HousingFitResult[] {
  const capacityByJoint = new Map<number, JointHousingCapacity>();
  for (const capacity of capacities) {
    if (capacityByJoint.has(capacity.joint)) throw new Error(`duplicate housing capacity for J${capacity.joint}`);
    capacityByJoint.set(capacity.joint, capacity);
  }
  return selections.map(selection => {
    const capacity = capacityByJoint.get(selection.joint);
    if (!capacity) return { joint: selection.joint, status: 'not_run', requiredInternalMm: null, availableInternalMm: null, errors: [`J${selection.joint}: traceable housing capacity missing`] };
    const capacityErrors = validateCapacity(capacity);
    const components = [selection.motor, selection.reducer, selection.bearing];
    const requiredInternalMm = {
      x: Math.max(...components.map(component => component.envelopeMm.x)) + capacity.radialClearanceMm * 2,
      y: Math.max(...components.map(component => component.envelopeMm.y)) + capacity.radialClearanceMm * 2,
      z: components.reduce((sum, component) => sum + component.envelopeMm.z, 0) + capacity.axialClearanceMm * 2,
    };
    const fitErrors = (['x', 'y', 'z'] as const).flatMap(axis => requiredInternalMm[axis] <= capacity.internalMm[axis]
      ? [] : [`J${selection.joint}: ${axis} requires ${requiredInternalMm[axis]} mm, available ${capacity.internalMm[axis]} mm`]);
    const errors = [...capacityErrors, ...fitErrors];
    return { joint: selection.joint, status: errors.length ? 'failed' : 'passed', requiredInternalMm, availableInternalMm: capacity.internalMm, errors };
  });
}

function validateCapacity(capacity: JointHousingCapacity): string[] {
  const errors: string[] = [];
  if (!Number.isInteger(capacity.joint) || capacity.joint < 1 || capacity.joint > 6) errors.push(`invalid housing joint ${capacity.joint}`);
  if (Object.values(capacity.internalMm).some(value => !(value > 0 && Number.isFinite(value)))) errors.push(`J${capacity.joint}: positive finite internal dimensions required`);
  if (!(capacity.radialClearanceMm >= 0 && Number.isFinite(capacity.radialClearanceMm))) errors.push(`J${capacity.joint}: invalid radial clearance`);
  if (!(capacity.axialClearanceMm >= 0 && Number.isFinite(capacity.axialClearanceMm))) errors.push(`J${capacity.joint}: invalid axial clearance`);
  if (!capacity.source.trim() || !/^[a-f0-9]{64}$/i.test(capacity.artifactHash)) errors.push(`J${capacity.joint}: traceable housing source and full SHA-256 required`);
  return errors;
}
