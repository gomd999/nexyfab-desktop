import type { CadFailureCode } from '@/lib/reference/cadFailureTaxonomy';

export type CrossDomainGateStatus = 'passed' | 'failed' | 'not_run';
export interface CrossDomainGate {
  id: 'structure' | 'placement' | 'assembly-dof' | 'precise-interference' | 'space-boundary' | 'egress' | 'door-swing' | 'mep-interference';
  status: CrossDomainGateStatus;
  reason: string;
  failureCode?: CadFailureCode;
}

export interface CrossDomainVerificationInput {
  structure: { valid: boolean };
  placement: { required: number; resolved: number; invalid: number };
  assembly?: { applicable: boolean; authoritativeDof?: { ran: boolean; accepted: boolean }; preciseInterference?: { ran: boolean; collisions: number; missingGeometry: number } };
  interior?: { applicable: boolean; spaceBoundary?: { ran: boolean; openBoundaries: number; conservative: boolean }; egress?: { ran: boolean; passed: boolean; conservative: boolean }; doorSwing?: { ran: boolean; clear: boolean; conservative: boolean }; mepInterference?: { ran: boolean; collisions: number; missingGeometry: number; conservative: boolean } };
}

export interface CrossDomainVerificationResult { gates: CrossDomainGate[]; releaseReady: boolean }

const gate = (id: CrossDomainGate['id'], status: CrossDomainGateStatus, reason: string, failureCode?: CadFailureCode): CrossDomainGate =>
  ({ id, status, reason, ...(failureCode ? { failureCode } : {}) });

/** Shared release gate for mechanical products and spatial/interior projects. */
export function verifyCrossDomainDesign(input: CrossDomainVerificationInput): CrossDomainVerificationResult {
  const gates: CrossDomainGate[] = [];
  gates.push(input.structure.valid
    ? gate('structure', 'passed', 'Product/spatial hierarchy is valid.')
    : gate('structure', 'failed', 'Product/spatial hierarchy is invalid.', 'SEMANTIC_MAPPING_UNAVAILABLE'));
  gates.push(input.placement.invalid > 0
    ? gate('placement', 'failed', 'One or more placements are invalid.', 'INVALID_TRANSFORM')
    : input.placement.resolved === input.placement.required
      ? gate('placement', 'passed', 'Every required placement is resolved.')
      : gate('placement', 'not_run', 'Not every required placement is resolved.', 'MISSING_TRANSFORM'));

  if (input.assembly?.applicable) {
    const dof = input.assembly.authoritativeDof;
    gates.push(!dof?.ran ? gate('assembly-dof', 'not_run', 'Authoritative DoF solving was not run.')
      : dof.accepted ? gate('assembly-dof', 'passed', 'Authoritative remaining DoF is accepted.')
        : gate('assembly-dof', 'failed', 'Assembly remaining DoF is not accepted.'));
    const interference = input.assembly.preciseInterference;
    gates.push(!interference?.ran || interference.missingGeometry > 0
      ? gate('precise-interference', 'not_run', 'Exact collision geometry is incomplete.', 'PRECISE_INTERFERENCE_NOT_RUN')
      : interference.collisions > 0 ? gate('precise-interference', 'failed', 'Exact solid collisions remain.')
        : gate('precise-interference', 'passed', 'Exact solid interference check found no collision.'));
  }

  if (input.interior?.applicable) {
    const boundary = input.interior.spaceBoundary;
    gates.push(!boundary?.ran ? gate('space-boundary', 'not_run', 'Space boundary closure was not measured.', 'SPACE_BOUNDARY_OPEN')
      : !boundary.conservative ? gate('space-boundary', 'not_run', 'Space boundary evidence is not a conservative topology result.', 'SPACE_BOUNDARY_OPEN')
      : boundary.openBoundaries > 0 ? gate('space-boundary', 'failed', 'Open space boundaries remain.', 'SPACE_BOUNDARY_OPEN')
        : gate('space-boundary', 'passed', 'Space boundaries are closed.'));
    const egress = input.interior.egress;
    gates.push(!egress?.ran ? gate('egress', 'not_run', 'Egress verification lacks governed project inputs.')
      : !egress.conservative ? gate('egress', 'not_run', 'Egress evidence is not a conservative governed route calculation.')
        : egress.passed ? gate('egress', 'passed', 'Egress verification passed.') : gate('egress', 'failed', 'Egress verification failed.'));
    const doorSwing = input.interior.doorSwing;
    gates.push(!doorSwing?.ran ? gate('door-swing', 'not_run', 'Continuous door-swing clearance was not run.', 'PRECISE_INTERFERENCE_NOT_RUN')
      : !doorSwing.conservative ? gate('door-swing', 'not_run', 'Door-swing result is not a conservative continuous envelope.', 'PRECISE_INTERFERENCE_NOT_RUN')
        : doorSwing.clear ? gate('door-swing', 'passed', 'Continuous finite-thickness door-swing envelope is clear.') : gate('door-swing', 'failed', 'Door-swing envelope collides with an obstacle.'));
    const mep = input.interior.mepInterference;
    gates.push(!mep?.ran || mep.missingGeometry > 0 || !mep.conservative
      ? gate('mep-interference', 'not_run', 'MEP collision geometry is incomplete.', 'PRECISE_INTERFERENCE_NOT_RUN')
      : mep.collisions > 0 ? gate('mep-interference', 'failed', 'MEP collisions remain.')
        : gate('mep-interference', 'passed', 'MEP interference check found no collision.'));
  }
  return { gates, releaseReady: gates.length > 0 && gates.every(item => item.status === 'passed') };
}
